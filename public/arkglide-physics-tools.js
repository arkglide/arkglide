// Jolt queries, character movement, model shapes and native constraints.
(function (root) {
  "use strict";
  function create(J, B, o) {
    const { system, world, bodies, numbers, bi } = o;
    const chars = new Map(),
      joints = new Map(),
      cache = new Map(),
      debug = new Map();
    let stopped = false,
      cacheBytes = 0,
      activeQueries = 0,
      debugEnabled = !!o.config?.debug;
    const v = (j) => ({ x: j.GetX(), y: j.GetY(), z: j.GetZ() });
    function finite(p) {
      if (!p || ![p.x, p.y, p.z].every(Number.isFinite))
        throw Error("需要有限世界坐标 Vec3");
      return p;
    }
    function vector(p, C = J.Vec3) {
      finite(p);
      return new C(p.x, p.y, p.z);
    }
    const groups = o.config?.groups || [{ name: "Default", mask: 1 }],
      characterTrackers = groups.map(
        () => new J.CharacterVsCharacterCollisionSimple(),
      );
    function group(name = "Default") {
      const i = groups.findIndex((g) => g.name === name);
      if (i < 0) throw Error("碰撞分组不存在: " + name);
      return i;
    }
    function layer(c) {
      return group(c.group) * 2 + (c.motion === "static" ? 0 : 1);
    }
    function geometry(object, parts, scale) {
      const meshes = [object, ...(object.getChildMeshes?.() || [])].filter(
        (m) => m.getVerticesData?.(B.VertexBuffer.PositionKind),
      );
      if (parts?.some((name) => !meshes.some((m) => m.name === name)))
        throw Error("模型碰撞部件不存在");
      const inverse = B.Matrix.Invert(object.computeWorldMatrix(true)),
        vertices = [],
        indices = [];
      for (const mesh of meshes) {
        if (parts?.length && !parts.includes(mesh.name)) continue;
        if (mesh.skeleton)
          throw Error("模型碰撞体需要静态几何；骨骼模型请使用基础形状");
        const data = mesh.getVerticesData(B.VertexBuffer.PositionKind),
          idx = mesh.getIndices(),
          offset = vertices.length / 3;
        const matrix = mesh.computeWorldMatrix(true).multiply(inverse);
        for (let i = 0; i < data.length; i += 3) {
          const p = B.Vector3.TransformCoordinates(
            new B.Vector3(data[i], data[i + 1], data[i + 2]),
            matrix,
          );
          vertices.push(p.x * scale.x, p.y * scale.y, p.z * scale.z);
        }
        const count = idx?.length || data.length / 3;
        for (let i = 0; i < count; i++)
          indices.push((idx?.length ? idx[i] : i) + offset);
      }
      if (
        !vertices.length ||
        vertices.length > 300000 ||
        indices.length > 600000
      )
        throw Error("碰撞几何为空或超过 10 万顶点 / 20 万三角形上限");
      return { vertices, indices };
    }
    function modelShape(object, c, scale) {
      if (c.shape === "mesh" && c.motion !== "static")
        throw Error("三角网格碰撞体仅支持静态刚体");
      const data = geometry(object, c.parts, scale),
        key = JSON.stringify([c.shape, data]);
      if (cache.has(key)) return cache.get(key);
      let settings, result, shape;
      try {
        if (c.shape === "convex") {
          settings = new J.ConvexHullShapeSettings();
          settings.mMaxConvexRadius = 0.01;
          for (let i = 0; i < data.vertices.length; i += 3) {
            const p = new J.Vec3(...data.vertices.slice(i, i + 3));
            settings.mPoints.push_back(p);
            J.destroy(p);
          }
        } else {
          settings = new J.MeshShapeSettings();
          for (let i = 0; i < data.vertices.length; i += 3) {
            const p = new J.Float3(...data.vertices.slice(i, i + 3));
            settings.mTriangleVertices.push_back(p);
            J.destroy(p);
          }
          for (let i = 0; i < data.indices.length; i += 3) {
            const t = new J.IndexedTriangle(...data.indices.slice(i, i + 3), 0);
            settings.mIndexedTriangles.push_back(t);
            J.destroy(t);
          }
          settings.Sanitize();
        }
        result = settings.Create();
        if (result.HasError())
          throw Error("模型碰撞体生成失败: " + result.GetError().c_str());
        shape = result.Get();
        shape.AddRef();
        while (
          cache.size &&
          (cache.size >= 64 || cacheBytes + key.length * 2 > 32 * 1024 * 1024)
        ) {
          const first = cache.keys().next().value;
          cache.get(first).Release();
          cacheBytes -= first.length * 2;
          cache.delete(first);
        }
        cache.set(key, shape);
        cacheBytes += key.length * 2;
        return shape;
      } finally {
        if (result) J.destroy(result);
        if (settings) J.destroy(settings);
      }
    }
    function validateQuery(q = {}) {
      if (q.group !== undefined) group(q.group);
      if (
        q.mask !== undefined &&
        (!Number.isInteger(q.mask) ||
          q.mask < 0 ||
          q.mask > (1 << groups.length) - 1)
      )
        throw Error("无效查询掩码");
      if (q.ignore !== undefined && !Array.isArray(q.ignore))
        throw Error("查询忽略列表必须为数组");
      if (q.rotation) {
        const r = q.rotation;
        if (
          ![r.x, r.y, r.z, r.w].every(Number.isFinite) ||
          Math.abs(Math.hypot(r.x, r.y, r.z, r.w) - 1) > 0.01
        )
          throw Error("查询旋转必须为单位四元数");
      }
    }
    function filters(q = {}) {
      const a = new J.BroadPhaseLayerFilter(),
        b = new J.ObjectLayerFilterJS(),
        c = new J.BodyFilterJS(),
        d = new J.ShapeFilter();
      const mask = q.mask ?? (1 << groups.length) - 1,
        sourceGroup = q.group === undefined ? null : group(q.group),
        allowed = sourceGroup === null ? null : groups[sourceGroup].mask;
      b.ShouldCollide = (l) =>
        !!(mask & (1 << (l >> 1))) &&
        (allowed === null ||
          (!!(allowed & (1 << (l >> 1))) &&
            !!(groups[l >> 1].mask & (1 << sourceGroup))));
      const accept = (id) => {
        const eid = numbers.get(id),
          r = bodies.get(eid) || chars.get(eid);
        return (
          !!r &&
          o.find(eid) &&
          (!q.character || !chars.has(eid)) &&
          !(q.ignore || []).some((e) => (e?.id || e) === eid) &&
          (q.sensors !== false || !r.config.sensor)
        );
      };
      c.ShouldCollide = (p) =>
        accept(J.wrapPointer(p, J.BodyID).GetIndexAndSequenceNumber());
      c.ShouldCollideLocked = (p) =>
        accept(J.wrapPointer(p, J.Body).GetID().GetIndexAndSequenceNumber());
      return {
        args: [a, b, c, d],
        dispose() {
          for (const x of [a, b, c, d]) J.destroy(x);
        },
      };
    }
    function raycast(origin, direction, q = {}) {
      validateQuery(q);
      finite(origin);
      finite(direction);
      if (stopped) throw Error("物理会话已停止");
      const length = Math.hypot(direction.x, direction.y, direction.z);
      if (!length) throw Error("射线方向长度必须大于零");
      const a = vector(origin, J.RVec3),
        b = vector(direction),
        ray = new J.RRayCast(a, b),
        settings = new J.RayCastSettings(),
        collector = new J.CastRayAllHitCollisionCollector(),
        f = filters(q),
        hits = [];
      activeQueries++;
      try {
        system
          .GetNarrowPhaseQuery()
          .CastRay(ray, settings, collector, ...f.args);
        collector.Sort();
        for (let i = 0; i < collector.mHits.size(); i++) {
          const h = collector.mHits.at(i),
            id = numbers.get(h.mBodyID.GetIndexAndSequenceNumber()),
            r = bodies.get(id) || chars.get(id),
            entity = o.find(id);
          if (!r || !entity) continue;
          const fraction = h.mFraction,
            point = {
              x: origin.x + direction.x * fraction,
              y: origin.y + direction.y * fraction,
              z: origin.z + direction.z * fraction,
            },
            jp = vector(point, J.RVec3);
          try {
            hits.push({
              entity,
              fraction,
              distance: length * fraction,
              point,
              normal: v(
                (r.body || r.queryBody).GetWorldSpaceSurfaceNormal(
                  h.mSubShapeID2,
                  jp,
                ),
              ),
            });
          } finally {
            J.destroy(jp);
          }
        }
        return q.all ? hits : hits[0] || null;
      } finally {
        activeQueries--;
        f.dispose();
        for (const x of [collector, settings, ray, b, a]) J.destroy(x);
      }
    }
    function queryShape(c) {
      if (c.kind === "sphere") {
        if (!Number.isFinite(c.radius) || c.radius <= 0)
          throw Error("无效查询半径");
        return new J.SphereShape(c.radius);
      }
      if (c.kind === "capsule") {
        if (
          !Number.isFinite(c.radius) ||
          c.radius <= 0 ||
          !Number.isFinite(c.height) ||
          c.height < 2 * c.radius
        )
          throw Error("无效查询胶囊");
        return new J.CapsuleShape(
          Math.max(0.001, c.height / 2 - c.radius),
          c.radius,
        );
      }
      if (
        c.kind !== "box" ||
        !c.size ||
        [c.size.x, c.size.y, c.size.z].some(
          (n) => !Number.isFinite(n) || n <= 0,
        )
      )
        throw Error("无效查询盒体");
      const p = vector({ x: c.size.x / 2, y: c.size.y / 2, z: c.size.z / 2 });
      try {
        return new J.BoxShape(p, 0.001);
      } finally {
        J.destroy(p);
      }
    }
    function shapeQuery(kind, c, position, direction, q = {}) {
      validateQuery(q);
      if (stopped) throw Error("物理会话已停止");
      finite(position);
      finite(direction);
      const shape = queryShape(c);
      shape.AddRef();
      const scale = new J.Vec3(1, 1, 1),
        p = vector(position, J.RVec3),
        rot = q.rotation
          ? new J.Quat(q.rotation.x, q.rotation.y, q.rotation.z, q.rotation.w)
          : new J.Quat(0, 0, 0, 1),
        matrix = J.RMat44.prototype.sRotationTranslation(rot, p),
        dir = vector(direction),
        offset = new J.RVec3(0, 0, 0),
        f = filters(q);
      const settings =
          kind === "cast"
            ? new J.ShapeCastSettings()
            : new J.CollideShapeSettings(),
        collector =
          kind === "cast"
            ? new J.CastShapeAllHitCollisionCollector()
            : new J.CollideShapeAllHitCollisionCollector();
      let cast;
      activeQueries++;
      try {
        if (kind === "cast") {
          cast = new J.RShapeCast(shape, scale, matrix, dir);
          system
            .GetNarrowPhaseQuery()
            .CastShape(cast, settings, offset, collector, ...f.args);
          collector.Sort();
        } else
          system
            .GetNarrowPhaseQuery()
            .CollideShape(
              shape,
              scale,
              matrix,
              settings,
              offset,
              collector,
              ...f.args,
            );
        const hits = [];
        for (let i = 0; i < collector.mHits.size(); i++) {
          const h = collector.mHits.at(i),
            entity = o.find(
              numbers.get(h.mBodyID2.GetIndexAndSequenceNumber()),
            );
          if (!entity) continue;
          const axis = v(h.mPenetrationAxis),
            length = Math.hypot(axis.x, axis.y, axis.z) || 1;
          hits.push({
            entity,
            point: v(h.mContactPointOn2),
            normal: {
              x: -axis.x / length,
              y: -axis.y / length,
              z: -axis.z / length,
            },
            fraction: kind === "cast" ? h.mFraction : 0,
            distance:
              kind === "cast"
                ? Math.hypot(direction.x, direction.y, direction.z) *
                  h.mFraction
                : 0,
            penetration: Math.max(0, h.mPenetrationDepth),
          });
        }
        return kind === "cast" && !q.all ? hits[0] || null : hits;
      } finally {
        activeQueries--;
        f.dispose();
        for (const x of [
          cast,
          collector,
          settings,
          offset,
          dir,
          matrix,
          rot,
          p,
          scale,
        ])
          if (x) J.destroy(x);
        shape.Release();
      }
    }
    function writePosition(object, pos, rotation) {
      let p = new B.Vector3(pos.x, pos.y, pos.z);
      if (object.parent)
        p = B.Vector3.TransformCoordinates(
          p,
          B.Matrix.Invert(object.parent.computeWorldMatrix(true)),
        );
      object.position.copyFrom(p);
      if (rotation) {
        let q = new B.Quaternion(
          rotation.x,
          rotation.y,
          rotation.z,
          rotation.w,
        );
        if (object.parent)
          q = o.worldPose(object.parent).rot.conjugate().multiply(q);
        object.rotationQuaternion = q;
      }
    }
    function character(node) {
      if (!node.character || chars.has(node.id)) return;
      if (node.physics) throw Error("角色控制器与刚体不能同时控制同一实体");
      const object = o.getObject(node.id),
        c = node.character,
        pose = o.worldPose(object);
      if (
        object
          .getWorldMatrix()
          .m.some(
            (v, i) =>
              Math.abs(
                v - B.Matrix.Compose(pose.scale, pose.rot, pose.pos).m[i],
              ) > 1e-4,
          )
      )
        throw Error("角色父层级包含剪切变换");
      if (
        Math.max(pose.scale.x, pose.scale.y, pose.scale.z) -
          Math.min(pose.scale.x, pose.scale.y, pose.scale.z) >
          1e-4 ||
        pose.scale.x <= 0
      )
        throw Error("角色需要正数均匀世界缩放");
      if (
        ![
          c.radius,
          c.height,
          c.stepHeight,
          c.maxSlope,
          c.speed,
          c.jumpSpeed,
        ].every(Number.isFinite) ||
        c.radius <= 0 ||
        c.height < 2 * c.radius ||
        c.stepHeight < 0 ||
        c.maxSlope < 0 ||
        c.maxSlope >= 90
      )
        throw Error("无效角色配置");
      group(c.group);
      const shape = new J.CapsuleShape(
        Math.max(0.001, (c.height / 2 - c.radius) * pose.scale.x),
        c.radius * pose.scale.x,
      );
      shape.AddRef();
      const cs = new J.CharacterVirtualSettings(),
        p = vector(pose.pos, J.RVec3),
        r = new J.Quat(pose.rot.x, pose.rot.y, pose.rot.z, pose.rot.w),
        up = new J.Vec3(0, 1, 0),
        plane = new J.Plane(up, -c.radius * pose.scale.x);
      let ch;
      try {
        cs.mShape = shape;
        cs.mInnerBodyShape = shape;
        cs.mInnerBodyLayer = layer({ ...c, motion: "kinematic" });
        cs.mMaxSlopeAngle = (c.maxSlope * Math.PI) / 180;
        cs.mSupportingVolume = plane;
        ch = new J.CharacterVirtual(cs, p, r, system);
        const index = group(c.group);
        ch.SetCharacterVsCharacterCollision(characterTrackers[index]);
        for (let i = 0; i < groups.length; i++)
          if (groups[index].mask & (1 << i) && groups[i].mask & (1 << index))
            characterTrackers[i].Add(ch);
      } finally {
        for (const x of [plane, up, r, p, cs]) J.destroy(x);
        shape.Release();
      }
      const ext = new J.ExtendedUpdateSettings(),
        stair = new J.Vec3(0, c.stepHeight * pose.scale.x, 0),
        floor = new J.Vec3(0, -Math.max(0.05, c.stepHeight * pose.scale.x), 0);
      ext.mWalkStairsStepUp = stair;
      ext.mStickToFloorStepDown = floor;
      J.destroy(stair);
      J.destroy(floor);
      numbers.set(ch.GetInnerBodyID().GetIndexAndSequenceNumber(), node.id);
      const queryBody = system
        .GetBodyLockInterface()
        .TryGetBody(ch.GetInnerBodyID());
      chars.set(node.id, {
        ch,
        queryBody,
        object,
        config: structuredClone(c),
        scale: pose.scale.clone(),
        ext,
        move: { x: 0, y: 0, z: 0 },
        rootMotion: false,
        jump: false,
        last: o.signature(pose),
      });
    }
    function requireCharacter(e) {
      const c = chars.get(e?.id);
      if (stopped || !c || e.destroyed || o.find(e.id) !== e)
        throw Error("角色不存在");
      return c;
    }
    function beforeStep(dt) {
      contactPoints.length = 0;
      for (const [id, c] of chars) {
        if (!o.find(id) || c.object.isDisposed()) {
          remove(id);
          continue;
        }
        const pose = o.worldPose(c.object),
          sig = o.signature(pose);
        if (B.Vector3.Distance(pose.scale, c.scale) > 1e-4)
          throw Error("运行时改变角色缩放需移除后重新添加");
        if (sig !== c.last) {
          const p = vector(pose.pos, J.RVec3),
            r = new J.Quat(pose.rot.x, pose.rot.y, pose.rot.z, pose.rot.w);
          c.ch.SetPosition(p);
          c.ch.SetRotation(r);
          J.destroy(r);
          J.destroy(p);
        }
        c.ch.UpdateGroundVelocity();
        const old = v(c.ch.GetLinearVelocity()),
          ground = v(c.ch.GetGroundVelocity()),
          grounded = c.ch.GetGroundState() === J.EGroundState_OnGround;
        const g = o.gravity || { x: 0, y: -9.8, z: 0 };
        const velocity = {
          x: c.move.x + ground.x + g.x * dt,
          y:
            (c.rootMotion ? c.move.y : 0) +
            (grounded ? Math.max(0, old.y - ground.y) : old.y) +
            g.y * dt,
          z: c.move.z + ground.z + g.z * dt,
        };
        if (c.jump && grounded) velocity.y = c.config.jumpSpeed + ground.y;
        else if (grounded) velocity.y += ground.y;
        c.jump = false;
        const vv = vector(velocity),
          gravity = vector(g),
          f = filters({
            group: c.config.group || "Default",
            sensors: false,
            ignore: [id],
            character: true,
          });
        try {
          c.ch.SetLinearVelocity(vv);
          c.ch.ExtendedUpdate(
            dt,
            gravity,
            c.ext,
            ...f.args,
            world.GetTempAllocator(),
          );
          writePosition(c.object, v(c.ch.GetPosition()));
          c.last = o.signature(o.worldPose(c.object));
        } finally {
          f.dispose();
          J.destroy(gravity);
          J.destroy(vv);
        }
      }
    }
    function joint(e, target, c, owner) {
      const a = bodies.get(e?.id),
        b = bodies.get(target?.id);
      if (!a || !b || e === target || e.destroyed || target.destroyed)
        throw Error("关节需要两个有效且不同的刚体");
      const classes = {
          fixed: J.FixedConstraintSettings,
          hinge: J.HingeConstraintSettings,
          slider: J.SliderConstraintSettings,
          distance: J.DistanceConstraintSettings,
        },
        C = classes[c.kind];
      if (!C) throw Error("不支持的关节类型");
      if (
        c.kind !== "fixed" &&
        (!Number.isFinite(c.min ?? (c.kind === "hinge" ? -Math.PI : 0)) ||
          !Number.isFinite(c.max ?? (c.kind === "hinge" ? Math.PI : 1)) ||
          (c.min ?? (c.kind === "hinge" ? -Math.PI : 0)) >
            (c.max ?? (c.kind === "hinge" ? Math.PI : 1)))
      )
        throw Error("无效关节限制");
      if (
        c.kind === "hinge" &&
        ((c.min ?? -Math.PI) < -Math.PI || (c.max ?? Math.PI) > Math.PI)
      )
        throw Error("铰链角度限制必须在 -π..π");
      if (c.kind === "distance" && (c.min ?? 0) < 0)
        throw Error("距离限制不能为负");
      if (
        c.motor &&
        (!["hinge", "slider"].includes(c.kind) ||
          !Number.isFinite(c.motor.force) ||
          c.motor.force < 0 ||
          !Number.isFinite(c.motor.velocity))
      )
        throw Error("无效关节电机");
      const anchor = c.anchor || v(a.body.GetPosition()),
        anchor2 = c.anchor2 || anchor,
        axis = c.axis || { x: 0, y: 1, z: 0 };
      finite(anchor);
      finite(anchor2);
      finite(axis);
      const len = Math.hypot(axis.x, axis.y, axis.z);
      if (len < 1e-6) throw Error("关节轴不能为零");
      const settings = new C(),
        p1 = vector(anchor, J.RVec3),
        p2 = vector(anchor2, J.RVec3),
        ax = vector({ x: axis.x / len, y: axis.y / len, z: axis.z / len });
      const n = B.Vector3.Cross(
          new B.Vector3(axis.x, axis.y, axis.z),
          Math.abs(axis.y / len) > 0.9 ? B.Vector3.Right() : B.Vector3.Up(),
        ).normalize(),
        normal = vector(n);
      let constraint;
      try {
        settings.mSpace = J.EConstraintSpace_WorldSpace;
        settings.mPoint1 = p1;
        settings.mPoint2 = p2;
        if (c.kind === "fixed") {
          settings.mAutoDetectPoint = false;
          settings.mAxisX1 = ax;
          settings.mAxisX2 = ax;
          settings.mAxisY1 = normal;
          settings.mAxisY2 = normal;
        }
        if (c.kind === "hinge" || c.kind === "slider") {
          const prefix = c.kind === "hinge" ? "mHingeAxis" : "mSliderAxis";
          settings[prefix + "1"] = ax;
          settings[prefix + "2"] = ax;
          settings.mNormalAxis1 = normal;
          settings.mNormalAxis2 = normal;
          settings.mLimitsMin = c.min ?? (c.kind === "hinge" ? -Math.PI : 0);
          settings.mLimitsMax = c.max ?? (c.kind === "hinge" ? Math.PI : 1);
        }
        if (c.kind === "distance") {
          settings.mMinDistance = c.min ?? 0;
          settings.mMaxDistance = c.max ?? 1;
        }
        if (
          c.motor &&
          ![c.motor.velocity, c.motor.force].every(Number.isFinite)
        )
          throw Error("无效关节电机");
        if (c.motor && (c.kind === "hinge" || c.kind === "slider")) {
          settings.mMotorSettings.mMinForceLimit = -c.motor.force;
          settings.mMotorSettings.mMaxForceLimit = c.motor.force;
          settings.mMotorSettings.mMinTorqueLimit = -c.motor.force;
          settings.mMotorSettings.mMaxTorqueLimit = c.motor.force;
        }
        constraint = settings.Create(a.body, b.body);
        if (!constraint || !J.getPointer(constraint))
          throw Error("关节创建失败");
        constraint.AddRef();
        system.AddConstraint(constraint);
        if (c.motor) {
          if (c.kind !== "hinge" && c.kind !== "slider")
            throw Error("电机仅支持铰链/滑动关节");
          const cast = J.castObject(
            constraint,
            c.kind === "hinge" ? J.HingeConstraint : J.SliderConstraint,
          );
          cast.SetMotorState(J.EMotorState_Velocity);
          if (c.kind === "hinge")
            cast.SetTargetAngularVelocity(c.motor.velocity);
          else cast.SetTargetVelocity(c.motor.velocity);
        }
      } catch (error) {
        if (constraint) {
          system.RemoveConstraint(constraint);
          constraint.Release();
        }
        throw error;
      } finally {
        for (const x of [normal, ax, p2, p1, settings]) J.destroy(x);
      }
      const id = crypto.randomUUID();
      let live = true,
        untrack;
      function destroy() {
        if (!live) return;
        live = false;
        system.RemoveConstraint(constraint);
        constraint.Release();
        joints.delete(id);
        untrack?.();
      }
      joints.set(id, { a: e.id, b: target.id, destroy });
      if (owner) untrack = owner.track(destroy);
      return Object.freeze({
        id,
        destroy,
        get active() {
          return live;
        },
      });
    }
    function attachJoints(nodes) {
      for (const n of nodes)
        for (const c of n.joints || []) {
          const target = o.find(c.targetId);
          if (!target) throw Error("关节引用的实体不存在: " + c.targetId);
          const object = o.getObject(n.id),
            targetObject = o.getObject(c.targetId);
          const anchor = B.Vector3.TransformCoordinates(
              new B.Vector3(c.anchor.x, c.anchor.y, c.anchor.z),
              object.computeWorldMatrix(true),
            ),
            anchor2 = B.Vector3.TransformCoordinates(
              new B.Vector3(c.anchor2.x, c.anchor2.y, c.anchor2.z),
              targetObject.computeWorldMatrix(true),
            ),
            axis = B.Vector3.TransformNormal(
              new B.Vector3(c.axis.x, c.axis.y, c.axis.z),
              object.getWorldMatrix(),
            ).normalize();
          joint(o.find(n.id), target, { ...c, anchor, anchor2, axis });
        }
    }
    function remove(id) {
      const c = chars.get(id);
      if (c) {
        numbers.delete(c.ch.GetInnerBodyID().GetIndexAndSequenceNumber());
        const index = group(c.config.group);
        for (let i = 0; i < groups.length; i++)
          if (groups[index].mask & (1 << i) && groups[i].mask & (1 << index))
            characterTrackers[i].Remove(c.ch);
        J.destroy(c.ch);
        J.destroy(c.ext);
        chars.delete(id);
      }
      for (const j of [...joints.values()])
        if (j.a === id || j.b === id) j.destroy();
      for (const key of [id, id + ":velocity"]) {
        debug.get(key)?.dispose();
        debug.delete(key);
      }
    }
    const contactPoints = [];
    function contactPoint(p, n) {
      if (debugEnabled && contactPoints.length < 128)
        contactPoints.push({ p: { ...p }, n: { ...n } });
    }
    function wire(shape, scene, id) {
      const min = new J.Vec3(-1e10, -1e10, -1e10),
        max = new J.Vec3(1e10, 1e10, 1e10),
        box = new J.AABox(min, max),
        pos = new J.Vec3(0, 0, 0),
        rot = new J.Quat(0, 0, 0, 1),
        scale = new J.Vec3(1, 1, 1);
      let triangles;
      try {
        triangles = new J.ShapeGetTriangles(shape, box, pos, rot, scale);
        const count = triangles.GetNumTriangles();
        if (count > 20000)
          throw Error("碰撞调试超过两万三角形，请减少碰撞几何或关闭调试");
        const raw = triangles.GetVerticesData(),
          pointer = typeof raw === "number" ? raw : J.getPointer(raw),
          data = J.HEAPF32.subarray(pointer / 4, pointer / 4 + count * 9),
          lines = [];
        for (let i = 0; i < data.length; i += 9) {
          const a = new B.Vector3(data[i], data[i + 1], data[i + 2]),
            b = new B.Vector3(data[i + 3], data[i + 4], data[i + 5]),
            c = new B.Vector3(data[i + 6], data[i + 7], data[i + 8]);
          lines.push([a, b, c, a]);
        }
        const mesh = B.MeshBuilder.CreateLineSystem(
          "__physics_debug_" + id,
          { lines },
          scene,
        );
        mesh.isPickable = false;
        mesh.metadata = { arkglidePhysicsDebug: true };
        return mesh;
      } finally {
        for (const x of [triangles, scale, rot, pos, box, max, min])
          if (x) J.destroy(x);
      }
    }
    function clearDebug() {
      for (const m of debug.values()) m.dispose();
      debug.clear();
    }
    function updateDebug() {
      if (!debugEnabled) {
        clearDebug();
        return;
      }
      for (const [id, r] of [...bodies, ...chars]) {
        const body = r.body || r.ch;
        let mesh = debug.get(id);
        if (!mesh) {
          mesh = wire(body.GetShape(), r.object.getScene(), id);
          debug.set(id, mesh);
        }
        const p = v(body.GetCenterOfMassPosition()),
          q = body.GetRotation();
        mesh.position.copyFromFloats(p.x, p.y, p.z);
        mesh.rotationQuaternion = new B.Quaternion(
          q.GetX(),
          q.GetY(),
          q.GetZ(),
          q.GetW(),
        );
        mesh.color = B.Color3.FromHexString(
          r.ch
            ? "#FBBF24"
            : r.config.sensor
              ? "#E879F9"
              : r.config.motion === "static"
                ? "#4ADE80"
                : "#38BDF8",
        );
        const velocity = v(body.GetLinearVelocity()),
          key = id + ":velocity";
        debug.get(key)?.dispose();
        const line = B.MeshBuilder.CreateLines(
          "__physics_velocity",
          {
            points: [
              new B.Vector3(p.x, p.y, p.z),
              new B.Vector3(
                p.x + velocity.x,
                p.y + velocity.y,
                p.z + velocity.z,
              ),
            ],
          },
          r.object.getScene(),
        );
        line.isPickable = false;
        line.color = B.Color3.White();
        debug.set(key, line);
      }
      debug.get("__contacts")?.dispose();
      debug.delete("__contacts");
      const scene = bodies.values().next().value?.object.getScene();
      if (scene && contactPoints.length) {
        const lines = contactPoints.map(({ p, n }) => [
          new B.Vector3(p.x, p.y, p.z),
          new B.Vector3(p.x + n.x * 0.25, p.y + n.y * 0.25, p.z + n.z * 0.25),
        ]);
        const mesh = B.MeshBuilder.CreateLineSystem(
          "__physics_contacts",
          { lines },
          scene,
        );
        mesh.isPickable = false;
        mesh.color = B.Color3.Red();
        debug.set("__contacts", mesh);
      }
    }
    const ownerAPI = (owner) =>
      Object.freeze({
        raycast: (p, d, q) => {
          if (!owner.record.active) throw Error("脚本已销毁");
          return raycast(p, d, q);
        },
        shapeCast: (s, p, d, q) => {
          if (!owner.record.active) throw Error("脚本已销毁");
          return shapeQuery("cast", s, p, d, q);
        },
        overlap: (s, p, q) => {
          if (!owner.record.active) throw Error("脚本已销毁");
          return shapeQuery("overlap", s, p, { x: 0, y: 0, z: 0 }, q);
        },
        setDebug(value) {
          if (!owner.record.active) throw Error("脚本已销毁");
          debugEnabled = !!value;
          updateDebug();
        },
        createJoint(e, t, c) {
          if (!owner.record.active) throw Error("脚本已销毁");
          return joint(e, t, c, owner);
        },
        character(e) {
          const c = requireCharacter(e);
          const guard = () => {
            if (!owner.record.active) throw Error("脚本已销毁");
            if (requireCharacter(e) !== c) throw Error("角色不存在");
          };
          return Object.freeze({
            move(direction) {
              guard();
              if (c.rootMotion) throw Error("根运动正在控制角色移动");
              finite(direction);
              const length = Math.max(1, Math.hypot(direction.x, direction.z));
              c.move = {
                x: (direction.x / length) * c.config.speed,
                y: 0,
                z: (direction.z / length) * c.config.speed,
              };
            },
            jump() {
              guard();
              c.jump = true;
            },
            get grounded() {
              guard();
              return c.ch.GetGroundState() === J.EGroundState_OnGround;
            },
            get velocity() {
              guard();
              return v(c.ch.GetLinearVelocity());
            },
            get groundNormal() {
              guard();
              return v(c.ch.GetGroundNormal());
            },
            teleport(position) {
              guard();
              const p = vector(position, J.RVec3);
              try {
                c.ch.SetPosition(p);
                writePosition(c.object, position);
                c.last = o.signature(o.worldPose(c.object));
              } finally {
                J.destroy(p);
              }
            },
          });
        },
        removeCharacter(e) {
          if (!owner.record.active) throw Error("脚本已销毁");
          requireCharacter(e);
          o.remove(e.id);
        },
        addCharacter(e, c) {
          if (!owner.record.active) throw Error("脚本已销毁");
          if (
            !e ||
            e.destroyed ||
            o.find(e.id) !== e ||
            bodies.has(e.id) ||
            chars.has(e.id)
          )
            throw Error("角色实体无效或已有运动组件");
          character({ id: e.id, character: c });
          const created = chars.get(e.id);
          owner.track(() => {
            if (chars.get(e.id) === created) remove(e.id);
          });
          return this.character(e);
        },
      });
    function applyRootMotion(e, delta, rotation, dt) {
      const c = chars.get(e.id);
      if (!c) return false;
      c.rootMotion = true;
      c.move = { x: delta.x / dt, y: delta.y / dt, z: delta.z / dt };
      const q = new J.Quat(rotation.x, rotation.y, rotation.z, rotation.w);
      try {
        c.ch.SetRotation(q);
        writePosition(c.object, v(c.ch.GetPosition()), rotation);
        c.last = o.signature(o.worldPose(c.object));
      } finally {
        J.destroy(q);
      }
      return true;
    }
    function clearRootMotion(e) {
      const c = chars.get(e.id);
      if (c) {
        c.rootMotion = false;
        c.move = { x: 0, y: 0, z: 0 };
      }
    }
    return {
      hasCharacter: (id) => chars.has(id),
      applyRootMotion,
      clearRootMotion,
      layer,
      modelShape,
      character,
      attachJoints,
      beforeStep,
      updateDebug,
      contactPoint,
      remove,
      ownerAPI,
      stats: () => ({
        physicsCharacters: chars.size,
        physicsConstraints: joints.size,
        physicsShapeCache: cache.size,
        physicsCacheBytes: cacheBytes,
        physicsQueriesActive: activeQueries,
        physicsDebugMeshes: debug.size,
      }),
      dispose() {
        if (stopped) return;
        for (const id of [...chars.keys()]) remove(id);
        for (const j of [...joints.values()]) j.destroy();
        for (const shape of cache.values()) shape.Release();
        cache.clear();
        cacheBytes = 0;
        for (const m of debug.values()) m.dispose();
        debug.clear();
        for (const tracker of characterTrackers) J.destroy(tracker);
        stopped = true;
      },
    };
  }
  root.ArkGlidePhysicsTools = { create };
})(globalThis);
