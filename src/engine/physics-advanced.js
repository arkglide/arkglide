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
    let maxConvexQueryVertices = o.config?.maxConvexQueryVertices ?? 256;
    const movementDefaults = Object.freeze({ groundAcceleration: 40, airAcceleration: 6, groundFriction: 8 });
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
            // Babylon LH faces use the opposite winding from Jolt triangle faces.
            const t = new J.IndexedTriangle(
              data.indices[i],
              data.indices[i + 2],
              data.indices[i + 1],
              0,
            );
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
          r = bodies.get(eid) || chars.get(eid),
          entity = o.find(eid);
        return (
          !!r &&
          entity && !entity.destroyed &&
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
              subShape: h.mSubShapeID2.GetValue(),
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
    function primitiveQueryShape(c) {
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
        return new J.BoxShape(p, Math.min(0.001,c.size.x/4,c.size.y/4,c.size.z/4));
      } finally {
        J.destroy(p);
      }
    }
    // Returned shapes own one reference; callers must release it once.
    function queryShape(c) {
      if (c.kind !== "convex") { const shape = primitiveQueryShape(c); shape.AddRef(); return shape; }
      if (!Array.isArray(c.points) || c.points.length < 4 || c.points.length > maxConvexQueryVertices) throw Error("Invalid convex query points/budget");
      c.points.forEach(finite);
      const settings = new J.ConvexHullShapeSettings(); let result;
      try {
        settings.mMaxConvexRadius = 0;
        for (const p of c.points) { const point=vector(p); settings.mPoints.push_back(point); J.destroy(point); }
        result=settings.Create(); if(result.HasError())throw Error(result.GetError().c_str());
        const shape=result.Get(); shape.AddRef(); return shape;
      } finally { if(result)J.destroy(result);J.destroy(settings); }
    }
    function shapeQuery(kind, c, position, direction, q = {}, nativeShape) {
      validateQuery(q);
      if (stopped) throw Error("物理会话已停止");
      finite(position);
      finite(direction);
      const shape = nativeShape || queryShape(c);
      if (nativeShape) shape.AddRef();
      let queryPosition = position;
      {
        // Public queries use the authored shape origin; Jolt needs the COM
        // transform. Off-center query hulls need this just like body casts.
        const com = v(shape.GetCenterOfMass()),
          rotation = q.rotation
            ? new B.Quaternion(
                q.rotation.x,
                q.rotation.y,
                q.rotation.z,
                q.rotation.w,
              )
            : B.Quaternion.Identity(),
          offset = B.Vector3.TransformNormal(
            new B.Vector3(com.x, com.y, com.z),
            B.Matrix.Compose(B.Vector3.One(), rotation, B.Vector3.Zero()),
          );
        queryPosition = {
          x: position.x + offset.x,
          y: position.y + offset.y,
          z: position.z + offset.z,
        };
      }
      const scale = new J.Vec3(1, 1, 1),
        p = vector(queryPosition, J.RVec3),
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
            subShape: h.mSubShapeID2.GetValue(),
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
      o.mutate?.();
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
      if (!["direct", "inertial"].includes(c.movementMode || "direct"))
        throw Error("Invalid character movement mode");
      for (const key of [
        "groundAcceleration",
        "airAcceleration",
        "groundFriction",
      ])
        if (
          c[key] !== undefined &&
          (!Number.isFinite(c[key]) || c[key] < 0 || c[key] > 10000)
        )
          throw Error("Invalid character movement coefficient");
      if (
        c.mass !== undefined &&
        (!Number.isFinite(c.mass) || c.mass <= 0 || c.mass > 10000)
      )
        throw Error("Invalid character mass");
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
        if (c.mass !== undefined) cs.mMass = c.mass;
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
        pendingVelocity: null,
        carry: { x: 0, y: 0, z: 0 },
        last: o.signature(pose),
      });
    }
    function requireCharacter(e) {
      const c = chars.get(e?.id);
      if (stopped || !c || e.destroyed || o.find(e.id) !== e)
        throw Error("角色不存在");
      return c;
    }
    function configureCharacter(e, patch = {}, resize = {}) {
      o.mutate?.();
      const c = requireCharacter(e), allowed = ["radius", "height", "stepHeight", "maxSlope", "speed", "jumpSpeed", "movementMode", "groundAcceleration", "airAcceleration", "groundFriction", "gravity", "gravityFactor", "mass", "controlEnabled"];
      if (Object.keys(patch).some(k => !allowed.includes(k))) throw Error("Unknown character property");
      const next = { ...c.config, ...structuredClone(patch) };
      for (const k of ["radius", "height", "stepHeight", "maxSlope", "speed", "jumpSpeed", "groundAcceleration", "airAcceleration", "groundFriction", "gravityFactor", "mass"])
        if (next[k] !== undefined && (!Number.isFinite(next[k]) || next[k] < 0)) throw Error("Invalid character " + k);
      if (next.radius <= 0 || next.height < next.radius * 2 || next.maxSlope >= 90 || next.mass === 0 || !["direct", "inertial"].includes(next.movementMode || "direct")) throw Error("Invalid character configuration");
      if (next.controlEnabled !== undefined && typeof next.controlEnabled !== "boolean") throw Error("Invalid character controlEnabled");
      if (next.gravity) finite(next.gravity);
      // Permit the existing ground contact's numerical penetration, while
      // rejecting new obstacles. Callers can override the native tolerance.
      const tolerance = resize.maxPenetration ?? c.ch.GetCharacterPadding();
      if (!Number.isFinite(tolerance) || tolerance < 0) throw Error("Invalid resize penetration");
      if (next.radius !== c.config.radius || next.height !== c.config.height) {
        const position = v(c.ch.GetPosition()), candidate = { ...position };
        if (resize.keepFeet !== false) candidate.y += (next.height - c.config.height) * c.scale.x / 2;
        const shape = queryShape({ kind: "capsule", radius: next.radius * c.scale.x, height: next.height * c.scale.x }),
          f = filters({ group: next.group || "Default", sensors: false, ignore: [e] }), p = vector(candidate, J.RVec3);
        try {
          c.ch.SetPosition(p);
          if (!c.ch.SetShape(shape, tolerance, ...f.args, world.GetTempAllocator())) {
            const original = vector(position, J.RVec3);
            try { c.ch.SetPosition(original); } finally { J.destroy(original); }
            return false;
          }
          c.ch.SetInnerBodyShape(shape);
          writePosition(c.object, candidate);
        } finally { J.destroy(p); f.dispose(); shape.Release(); }
      }
      c.config = next;
      c.ch.SetMaxSlopeAngle(next.maxSlope * Math.PI / 180);
      if (next.mass !== undefined) c.ch.SetMass(next.mass);
      const step = new J.Vec3(0, next.stepHeight * c.scale.x, 0), floor = new J.Vec3(0, -next.stepHeight * c.scale.x, 0);
      try { c.ext.mWalkStairsStepUp = step; c.ext.mStickToFloorStepDown = floor; } finally { J.destroy(step); J.destroy(floor); }
      if (c.wish) c.move = { x: c.wish.x * next.speed, y: 0, z: c.wish.z * next.speed };
      if (next.controlEnabled === false) { c.move = { x: 0, y: 0, z: 0 }; c.jump = false; }
      c.last = o.signature(o.worldPose(c.object));
      return true;
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
        const sourceGravity = c.config.gravity || o.gravity || { x: 0, y: -9.8, z: 0 }, factor = c.config.gravityFactor ?? 1;
        const g = { x: sourceGravity.x * factor, y: sourceGravity.y * factor, z: sourceGravity.z * factor };
        let horizontal = { x: c.move.x, z: c.move.z };
        const pending = c.pendingVelocity;
        if (c.config.movementMode === "inertial" && !c.rootMotion) {
          horizontal = { x: pending?.x ?? old.x, z: pending?.z ?? old.z };
          if (grounded) {
            const friction = c.config.groundFriction ?? movementDefaults.groundFriction;
            const factor = Math.max(0, 1 - friction * dt);
            horizontal.x *= factor;
            horizontal.z *= factor;
            const delta = {
                x: c.move.x - horizontal.x,
                z: c.move.z - horizontal.z,
              },
              length = Math.hypot(delta.x, delta.z),
              max = (c.config.groundAcceleration ?? movementDefaults.groundAcceleration) * dt;
            if (length) {
              const f = Math.min(1, max / length);
              horizontal.x += delta.x * f;
              horizontal.z += delta.z * f;
            }
          } else {
            // Acceleration along the wish direction is capped, external momentum is not.
            const speed = Math.hypot(c.move.x, c.move.z);
            if (speed) {
              const x = c.move.x / speed,
                z = c.move.z / speed,
                add = Math.max(
                  0,
                  Math.min(
                    speed - horizontal.x * x - horizontal.z * z,
                    (c.config.airAcceleration ?? movementDefaults.airAcceleration) * dt,
                  ),
                );
              horizontal.x += x * add;
              horizontal.z += z * add;
            }
          }
        } else if (!c.rootMotion) {
          if (pending) {
            c.carry = {
              x: pending.x - c.move.x,
              y: 0,
              z: pending.z - c.move.z,
            };
          }
          if (grounded && !pending) {
            const f = Math.max(0, 1 - (c.config.groundFriction ?? movementDefaults.groundFriction) * dt);
            c.carry.x *= f;
            c.carry.z *= f;
          }
          horizontal.x += c.carry.x;
          horizontal.z += c.carry.z;
        }
        const velocity = {
          x: horizontal.x + (grounded ? ground.x : 0) + g.x * dt,
          y:
            (c.rootMotion ? c.move.y : 0) +
            (pending?.y ?? (grounded ? Math.max(0, old.y - ground.y) : old.y)) +
            g.y * dt,
          z: horizontal.z + (grounded ? ground.z : 0) + g.z * dt,
        };
        c.pendingVelocity = null;
        if (c.jump && grounded) velocity.y = c.config.jumpSpeed + ground.y;
        else if (grounded) velocity.y += ground.y;
        const force = c.force || { x: 0, y: 0, z: 0 };
        for (const k of ["x", "y", "z"]) velocity[k] += force[k] / c.ch.GetMass() * dt;
        if (c.config.movementMode !== "inertial" && !c.rootMotion) {
          c.carry.x += force.x / c.ch.GetMass() * dt + g.x * dt;
          c.carry.z += force.z / c.ch.GetMass() * dt + g.z * dt;
        }
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
      o.mutate?.();
      c = structuredClone(c);
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
      function validateMotor(m) {
        const mode = m.mode || "velocity";
        if (!["hinge", "slider"].includes(c.kind) || !["off", "velocity", "position"].includes(mode)) throw Error("Invalid motor mode");
        if (mode !== "off" && (!Number.isFinite(m.force) || m.force < 0 || !Number.isFinite(mode === "position" ? m.position : m.velocity))) throw Error("Invalid motor target/force");
        for (const k of ["frequency", "damping"]) if (m[k] !== undefined && (!Number.isFinite(m[k]) || m[k] < 0)) throw Error("Invalid motor spring");
        return mode;
      }
      if (c.motor) validateMotor(c.motor);
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
        if (c.motor && (c.motor.mode || "velocity") !== "off") {
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
          const mode = c.motor.mode || "velocity";
          cast.SetMotorState(J["EMotorState_" + mode[0].toUpperCase() + mode.slice(1)]);
          if (mode === "velocity") cast[c.kind === "hinge" ? "SetTargetAngularVelocity" : "SetTargetVelocity"](c.motor.velocity);
          if (mode === "position") cast[c.kind === "hinge" ? "SetTargetAngle" : "SetTargetPosition"](c.motor.position);
          const spring = cast.GetMotorSettings().mSpringSettings;
          if (c.motor.frequency !== undefined) spring.mFrequency = c.motor.frequency;
          if (c.motor.damping !== undefined) spring.mDamping = c.motor.damping;
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
        o.mutate?.();
        live = false;
        system.RemoveConstraint(constraint);
        constraint.Release();
        joints.delete(id);
        untrack?.();
      }
      const cast = J.castObject(constraint, { fixed: J.FixedConstraint, hinge: J.HingeConstraint, slider: J.SliderConstraint, distance: J.DistanceConstraint }[c.kind]);
      function check() {
        if (!live || stopped || (owner && !owner.record.active)) throw Error("Joint expired");
      }
      function setMotor(m) {
        check(); o.mutate?.();
        const mode = validateMotor(m), settings = cast.GetMotorSettings();
        if (mode !== "off") {
          settings.mMinForceLimit = settings.mMinTorqueLimit = -m.force;
          settings.mMaxForceLimit = settings.mMaxTorqueLimit = m.force;
          if (m.frequency !== undefined) settings.mSpringSettings.mFrequency = m.frequency;
          if (m.damping !== undefined) settings.mSpringSettings.mDamping = m.damping;
          cast[mode === "position" ? c.kind === "hinge" ? "SetTargetAngle" : "SetTargetPosition" : c.kind === "hinge" ? "SetTargetAngularVelocity" : "SetTargetVelocity"](mode === "position" ? m.position : m.velocity);
        }
        cast.SetMotorState(J["EMotorState_" + mode[0].toUpperCase() + mode.slice(1)]);
        c.motor = structuredClone(m);
        bi.ActivateBody(a.body.GetID()); bi.ActivateBody(b.body.GetID());
      }
      const handle = Object.freeze({
        id, destroy, setMotor,
        entities: Object.freeze([e,target]),
        get active() { return live; },
        get kind() { return c.kind; },
        setLimits(min, max) {
          check(); o.mutate?.();
          if (c.kind === "fixed" || ![min, max].every(Number.isFinite) || min > max || (c.kind === "hinge" && (min < -Math.PI || max > Math.PI)) || (c.kind === "distance" && min < 0)) throw Error("Invalid joint limits");
          cast[c.kind === "distance" ? "SetDistance" : "SetLimits"](min, max);
          c.min = min; c.max = max;
          bi.ActivateBody(a.body.GetID()); bi.ActivateBody(b.body.GetID());
        },
        getState() {
          check();
          const current = c.kind === "hinge" ? cast.GetCurrentAngle() : c.kind === "slider" ? cast.GetCurrentPosition() : c.kind === "distance"
            ? B.Vector3.Distance(B.Vector3.TransformCoordinates(localA, a.object.computeWorldMatrix(true)), B.Vector3.TransformCoordinates(localB, b.object.computeWorldMatrix(true))) : null;
          return { kind: c.kind, current, min: c.kind === "fixed" ? null : c.kind === "distance" ? cast.GetMinDistance() : cast.GetLimitsMin(),
            max: c.kind === "fixed" ? null : c.kind === "distance" ? cast.GetMaxDistance() : cast.GetLimitsMax(), motor: c.motor ? structuredClone(c.motor) : { mode: "off" },
            motorImpulse: ["hinge", "slider"].includes(c.kind) ? cast.GetTotalLambdaMotor() : null };
        },
      });
      // Capture local anchors once; measured distance follows moving bodies.
      const localA = B.Vector3.TransformCoordinates(new B.Vector3(anchor.x, anchor.y, anchor.z), B.Matrix.Invert(a.object.computeWorldMatrix(true))),
        localB = B.Vector3.TransformCoordinates(new B.Vector3(anchor2.x, anchor2.y, anchor2.z), B.Matrix.Invert(b.object.computeWorldMatrix(true)));
      joints.set(id, { a: e.id, b: target.id, destroy, handle });
      if (owner) untrack = owner.track(destroy);
      return handle;
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
          // Babylon vectors keep coordinates behind prototype accessors. The
          // joint API clones plain options, so cross that boundary as Vec3 data.
          const plain = vector => ({ x: vector.x, y: vector.y, z: vector.z });
          joint(o.find(n.id), target, { ...c, anchor: plain(anchor), anchor2: plain(anchor2), axis: plain(axis) });
        }
    }
    function connectedBodies(entity) {
      if (!entity || entity.destroyed || o.find(entity.id) !== entity || !bodies.has(entity.id))
        throw Error("Connected body query needs a valid rigid body");
      const ids = new Set([entity.id]);
      const queue = [entity.id];
      const adjacency = new Map();
      for (const joint of joints.values()) {
        for (const [from, to] of [[joint.a, joint.b], [joint.b, joint.a]]) {
          if (!adjacency.has(from)) adjacency.set(from, []);
          adjacency.get(from).push(to);
        }
      }
      for (let i = 0; i < queue.length; i++)
        for (const next of adjacency.get(queue[i]) || []) {
          const candidate = o.find(next);
          if (!ids.has(next) && bodies.has(next) && candidate && !candidate.destroyed) { ids.add(next); queue.push(next); }
        }
      return queue.map((id) => o.find(id));
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
    function state(e) {
      const c = requireCharacter(e),
        p = o.worldPose(c.object);
      return {
        kind: "character",
        group: c.config.group || "Default",
        sensor: false,
        mass: c.ch.GetMass(),
        position: v(c.ch.GetPosition()),
        rotation: { x: p.rot.x, y: p.rot.y, z: p.rot.z, w: p.rot.w },
        velocity: { ...(c.pendingVelocity || v(c.ch.GetLinearVelocity())) },
        angularVelocity: { x: 0, y: 0, z: 0 },
        radius: c.config.radius * c.scale.x,
        height: c.config.height * c.scale.x,
      };
    }
    function setState(e, s) {
      const c = requireCharacter(e);
      if (s.position) {
        const p = vector(s.position, J.RVec3);
        try {
          c.ch.SetPosition(p);
          writePosition(c.object, s.position);
        } finally {
          J.destroy(p);
        }
      }
      if (s.rotation) {
        const q = s.rotation;
        if (
          ![q.x, q.y, q.z, q.w].every(Number.isFinite) ||
          Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) > 0.001
        )
          throw Error("Expected unit quaternion");
        const r = new J.Quat(q.x, q.y, q.z, q.w);
        try {
          c.ch.SetRotation(r);
          writePosition(c.object, v(c.ch.GetPosition()), q);
        } finally {
          J.destroy(r);
        }
      }
      if (s.velocity) {
        const p = vector(s.velocity);
        try {
          c.ch.SetLinearVelocity(p);
          c.pendingVelocity = { ...s.velocity };
        } finally {
          J.destroy(p);
        }
      }
      c.last = o.signature(o.worldPose(c.object));
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
        setQueryLimits(limits) {
          if (!owner.record.active) throw Error("脚本已销毁");
          if (Object.keys(limits).some(k=>k!=="maxConvexVertices") || !Number.isInteger(limits.maxConvexVertices) || limits.maxConvexVertices<4) throw Error("Invalid convex query budget");
          maxConvexQueryVertices=limits.maxConvexVertices;
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
        getJoints(e) {
          if (!owner.record.active) throw Error("脚本已销毁");
          if (e && (!bodies.has(e.id) || o.find(e.id) !== e)) throw Error("Invalid joint endpoint");
          return [...joints.values()].filter(j => !e || j.a === e.id || j.b === e.id).map(j => j.handle);
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
              o.mutate?.();
              if (c.rootMotion) throw Error("根运动正在控制角色移动");
              finite(direction);
              const length = Math.max(1, Math.hypot(direction.x, direction.z));
              c.wish = { x: direction.x / length, z: direction.z / length };
              c.move = {
                x: c.config.controlEnabled === false ? 0 : c.wish.x * c.config.speed,
                y: 0,
                z: c.config.controlEnabled === false ? 0 : c.wish.z * c.config.speed,
              };
            },
            jump() {
              guard();
              o.mutate?.();
              c.jump = c.config.controlEnabled !== false;
            },
            clearInput() {
              guard(); o.mutate?.();
              c.wish = { x: 0, z: 0 }; c.move = { x: 0, y: 0, z: 0 }; c.jump = false;
            },
            configure(patch, resize) { guard(); return configureCharacter(e, patch, resize); },
            getConfig() { guard(); return structuredClone(c.config); },
            getGround() {
              guard();
              if (c.ch.GetGroundState() !== J.EGroundState_OnGround) return null;
              const id = numbers.get(c.ch.GetGroundBodyID().GetIndexAndSequenceNumber());
              return { entity: o.find(id) || null, point: v(c.ch.GetGroundPosition()), normal: v(c.ch.GetGroundNormal()), velocity: v(c.ch.GetGroundVelocity()) };
            },
            applyForce(value) { guard(); o.mutate?.(); finite(value); const f = c.force ||= { x: 0, y: 0, z: 0 }; for (const k of ["x", "y", "z"]) f[k] += value[k]; },
            setVelocity(velocity) {
              guard();
              o.mutate?.();
              setState(e, { velocity });
            },
            addImpulse(deltaVelocity) {
              guard();
              o.mutate?.();
              finite(deltaVelocity);
              const old = c.pendingVelocity || v(c.ch.GetLinearVelocity());
              setState(e, {
                velocity: {
                  x: old.x + deltaVelocity.x,
                  y: old.y + deltaVelocity.y,
                  z: old.z + deltaVelocity.z,
                },
              });
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
              o.mutate?.();
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
      state,
      setState,
      castBody(e, position, rotation, direction, filter) {
        const r = bodies.get(e.id) || chars.get(e.id);
        if (!r) throw Error("Motion component absent");
        const shape = (r.body || r.queryBody).GetShape();
        return shapeQuery(
          "cast",
          null,
          position,
          direction,
          { ...filter, rotation, all: true },
          shape,
        );
      },
      applyRootMotion,
      clearRootMotion,
      layer,
      modelShape,
      modelBounds(object, parts, scale) {
        const data = geometry(object, parts, scale),
          min = [Infinity, Infinity, Infinity],
          max = [-Infinity, -Infinity, -Infinity];
        data.vertices.forEach((v, i) => {
          const k = i % 3;
          min[k] = Math.min(min[k], v);
          max[k] = Math.max(max[k], v);
        });
        return { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
      },
      character,
      queryShape,
      configureCharacter,
      force(e, value) { const c = requireCharacter(e), f = c.force ||= { x: 0, y: 0, z: 0 }; for (const k of ["x", "y", "z"]) f[k] += value[k]; },
      clearForces() { for (const c of chars.values()) c.force = null; },
      warpInput(entity, matrix) {
        const c = chars.get(entity.id);
        if (!c) return;
        const map = value => {
          const result = B.Vector3.TransformNormal(new B.Vector3(value.x, value.y || 0, value.z), matrix);
          if (!c.rootMotion) result.y = 0;
          return { x: result.x, y: result.y, z: result.z };
        };
        c.move = map(c.move);
        if (c.wish) { const wish = map(c.wish); c.wish = { x: wish.x, z: wish.z }; }
      },
      attachJoints,
      connectedBodies,
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
