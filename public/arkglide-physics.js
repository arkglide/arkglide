(function (root) {
  "use strict";
  function createPhysics(J, B, options) {
    const settings = new J.JoltSettings();
    settings.mMaxBodies = 4096;
    settings.mMaxBodyPairs = 8192;
    settings.mMaxContactConstraints = 8192;
    const collisionGroups = options.config?.groups || [
      { name: "Default", mask: 1 },
    ];
    if (!collisionGroups.length || collisionGroups.length > 16)
      throw Error("碰撞分组数量必须在 1–16 之间");
    const layerCount = collisionGroups.length * 2;
    const pairs = new J.ObjectLayerPairFilterTable(layerCount);
    for (let a = 0; a < layerCount; a++)
      for (let b = a; b < layerCount; b++)
        if (
          (a % 2 || b % 2) &&
          collisionGroups[a >> 1].mask & (1 << (b >> 1)) &&
          collisionGroups[b >> 1].mask & (1 << (a >> 1))
        )
          pairs.EnableCollision(a, b);
    const broad = new J.BroadPhaseLayerInterfaceTable(layerCount, 2),
      l0 = new J.BroadPhaseLayer(0),
      l1 = new J.BroadPhaseLayer(1);
    for (let i = 0; i < layerCount; i++)
      broad.MapObjectToBroadPhaseLayer(i, i % 2 ? l1 : l0);
    J.destroy(l0);
    J.destroy(l1);
    settings.mObjectLayerPairFilter = pairs;
    settings.mBroadPhaseLayerInterface = broad;
    settings.mObjectVsBroadPhaseLayerFilter =
      new J.ObjectVsBroadPhaseLayerFilterTable(broad, 2, pairs, layerCount);
    const world = new J.JoltInterface(settings);
    J.destroy(settings);
    const system = world.GetPhysicsSystem(),
      bi = system.GetBodyInterface(),
      bodies = new Map(),
      numbers = new Map(),
      subscribers = new Set(),
      materialRules = new Set(),
      contacts = new Map(),
      queue = [];
    let disposed = false, frame = null, solving = false;
    const mutate = () => {
      if (solving) throw Error("Physics mutations are not allowed inside contact material rules");
      if (disposed) throw Error("Physics session stopped");
    };
    const value = (v) => ({ x: v.GetX(), y: v.GetY(), z: v.GetZ() });
    const vec = (v) => {
      if (!v || ![v.x, v.y, v.z].every(Number.isFinite))
        throw new TypeError("Expected finite Vec3");
      return v;
    };
    function worldPose(object) {
      object.computeWorldMatrix(true);
      const scale = new B.Vector3(),
        rot = new B.Quaternion(),
        pos = new B.Vector3();
      object.getWorldMatrix().decompose(scale, rot, pos);
      return { scale, rot, pos };
    }
    const signature = (p) =>
      [p.pos.x, p.pos.y, p.pos.z, p.rot.x, p.rot.y, p.rot.z, p.rot.w]
        .map((v) => v.toFixed(6))
        .join(",");
    function bodyNumber(body) {
      return body.GetID().GetIndexAndSequenceNumber();
    }
    function contact(kind, a, b, manifold, settings, subKey) {
      const ia = numbers.get(a),
        ib = numbers.get(b);
      if (!ia || !ib) return;
      const key = [a, b].sort((a, b) => a - b).join(":");
      let old = contacts.get(key);
      if (kind === "exit") {
        if (!old) return;
        old.parts.delete(subKey);
        if (old.parts.size) return;
        contacts.delete(key);
        queue.push({ ...old.detail, phase: "exit" });
        return;
      }
      const m = J.wrapPointer(manifold, J.ContactManifold),
        detail = { a: ia, b: ib, normal: value(m.mWorldSpaceNormal),
          points: Array.from({ length: m.mRelativeContactPointsOn1.size() }, (_, i) => ({
            self: value(m.GetWorldSpaceContactPointOn1(i)), other: value(m.GetWorldSpaceContactPointOn2(i)),
          })), subShape: m.mSubShapeID1.GetValue(), otherSubShape: m.mSubShapeID2.GetValue(),
          sensor: !!(bodies.get(ia)?.config.sensor || bodies.get(ib)?.config.sensor) };
      const part = detail.subShape + ":" + detail.otherSubShape;
      if (!old) {
        old = { a: ia, b: ib, parts: new Set(), detail };
        contacts.set(key, old);
        queue.push({ ...detail, phase: "enter" });
      }
      old.parts.add(part);
      old.detail = detail;
      if (settings) {
        const native = J.wrapPointer(settings, J.ContactSettings);
        for (const rule of [...materialRules]) {
          if (!rule.owner.record.active || (rule.id && rule.id !== ia && rule.id !== ib)) continue;
          try {
            const result = rule.fn(eventFor(detail, rule.id, "stay"));
            if (!result) continue;
            for (const [name, nativeName] of [["friction", "mCombinedFriction"], ["restitution", "mCombinedRestitution"]])
              if (result[name] !== undefined) {
                if (!Number.isFinite(result[name]) || result[name] < 0 || (name === "restitution" && result[name] > 1))
                  throw Error("Invalid contact " + name);
                native[nativeName] = result[name];
              }
            if (result.surfaceVelocity) {
              const p = vec(result.surfaceVelocity), n = new J.Vec3(p.x, p.y, p.z);
              try { native.mRelativeLinearSurfaceVelocity = n; } finally { J.destroy(n); }
            }
          } catch (error) {
            options.onError?.({ file: rule.owner.record.file, hook: "physics.contactMaterial", error });
            rule.dispose();
          }
        }
      }
    }
    function eventFor(detail, id, phase) {
      const reverse = id === detail.b;
      const self = options.find(reverse ? detail.b : detail.a), other = options.find(reverse ? detail.a : detail.b);
      if (!self || !other) return null;
      const points = detail.points.map(p => ({ ...(reverse ? p.other : p.self) }));
      return { phase, self, other, sensor: detail.sensor,
        normal: Object.fromEntries(Object.entries(detail.normal).map(([k, v]) => [k, reverse ? -v : v])),
        point: points[0] || null, points, subShape: reverse ? detail.otherSubShape : detail.subShape,
        otherSubShape: reverse ? detail.subShape : detail.otherSubShape };
    }
    const listener = new J.ContactListenerJS();
    listener.OnContactValidate = () =>
      J.ValidateResult_AcceptAllContactsForThisBodyPair;
    listener.OnContactAdded = (a, b, manifold, settings) => (
      debugContact(manifold),
      contact(
        "enter",
        bodyNumber(J.wrapPointer(a, J.Body)),
        bodyNumber(J.wrapPointer(b, J.Body)), manifold, settings,
      )
    );
    function debugContact(manifold) {
      if (!tools) return;
      const m = J.wrapPointer(manifold, J.ContactManifold);
      for (let i = 0; i < m.mRelativeContactPointsOn1.size(); i++)
        tools.contactPoint(
          value(m.GetWorldSpaceContactPointOn1(i)),
          value(m.mWorldSpaceNormal),
        );
    }
    listener.OnContactPersisted = (a, b, m, settings) => {
      debugContact(m);
      contact("stay", bodyNumber(J.wrapPointer(a, J.Body)), bodyNumber(J.wrapPointer(b, J.Body)), m, settings);
    };
    listener.OnContactRemoved = (p) => {
      const pair = J.wrapPointer(p, J.SubShapeIDPair);
      contact(
        "exit",
        pair.GetBody1ID().GetIndexAndSequenceNumber(),
        pair.GetBody2ID().GetIndexAndSequenceNumber(), null, null,
        pair.GetSubShapeID1().GetValue() + ":" + pair.GetSubShapeID2().GetValue(),
      );
    };
    system.SetContactListener(listener);
    const tools = root.ArkGlidePhysicsTools?.create(J, B, {
      ...options,
      world,
      system,
      bi,
      bodies,
      numbers,
      worldPose,
      signature,
      remove,
      mutate,
    });
    function add(node) {
      mutate();
      if (node.character) {
        if (!tools) throw Error("角色运行库未加载");
        tools.character(node);
        return;
      }
      if (!node.physics || bodies.has(node.id)) return;
      if (disposed) throw new Error("Physics session stopped");
      const object = options.getObject(node.id);
      if (!object) throw new Error("Physics entity absent");
      const c = node.physics;
      if (
        !["static", "dynamic", "kinematic"].includes(c.motion) ||
        !["box", "sphere", "capsule", "convex", "mesh"].includes(c.shape) ||
        !c.size ||
        ![c.size.x, c.size.y, c.size.z].every(
          (v) => Number.isFinite(v) && v >= 0.001 && v <= 10000,
        ) ||
        !Number.isFinite(c.mass) ||
        c.mass <= 0 ||
        !Number.isFinite(c.friction) || c.friction < 0 ||
        !Number.isFinite(c.restitution) || c.restitution < 0 || c.restitution > 1 ||
        typeof c.sensor !== "boolean" ||
        typeof c.lockRotation !== "boolean"
      )
        throw new Error("无效刚体配置");
      for (const key of ["linearDamping", "angularDamping"])
        if (
          c[key] !== undefined &&
          (!Number.isFinite(c[key]) || c[key] < 0 || c[key] > 100)
        )
          throw Error("Invalid rigid body damping");
      if (c.gravityFactor !== undefined && (!Number.isFinite(c.gravityFactor) || c.gravityFactor < 0)) throw Error("Invalid gravity factor");
      const objectLayer = tools
        ? tools.layer(c)
        : c.motion === "static"
          ? 0
          : 1;
      const p = worldPose(object),
        s = p.scale;
      if ([s.x, s.y, s.z].some((v) => v <= 0 || !Number.isFinite(v)))
        throw new Error("刚体需要正数且非零的世界缩放: " + node.name);
      // A rotated child under nonuniformly scaled ancestors can produce shear, which rigid bodies cannot represent.
      const recomposed = B.Matrix.Compose(s, p.rot, p.pos).m,
        actual = object.getWorldMatrix().m;
      if (actual.some((v, i) => Math.abs(v - recomposed[i]) > 1e-4))
        throw new Error("刚体父层级包含剪切变换: " + node.name);
      let shape;
      if (c.shape === "convex" || c.shape === "mesh") {
        if (!tools) throw Error("模型碰撞运行库未加载");
        shape = tools.modelShape(object, c, s);
      } else if (c.shape === "box") {
        const ext = new J.Vec3(
          (c.size.x * s.x) / 2,
          (c.size.y * s.y) / 2,
          (c.size.z * s.z) / 2,
        );
        shape = new J.BoxShape(
          ext,
          Math.min(
            0.05,
            (c.size.x * s.x) / 4,
            (c.size.y * s.y) / 4,
            (c.size.z * s.z) / 4,
          ),
        );
        J.destroy(ext);
      } else {
        if (Math.max(s.x, s.y, s.z) - Math.min(s.x, s.y, s.z) > 1e-4)
          throw new Error("球体/胶囊碰撞体需要均匀世界缩放");
        shape =
          c.shape === "sphere"
            ? new J.SphereShape((c.size.x * s.x) / 2)
            : new J.CapsuleShape(
                Math.max(0.001, ((c.size.y - c.size.x) * s.y) / 2),
                (c.size.x * s.x) / 2,
              );
      }
      shape.AddRef();
      const pos = new J.RVec3(p.pos.x, p.pos.y, p.pos.z),
        rot = new J.Quat(p.rot.x, p.rot.y, p.rot.z, p.rot.w);
      const motion =
          J["EMotionType_" + c.motion[0].toUpperCase() + c.motion.slice(1)],
        cs = new J.BodyCreationSettings(shape, pos, rot, motion, objectLayer);
      if (c.linearDamping !== undefined) cs.mLinearDamping = c.linearDamping;
      if (c.angularDamping !== undefined) cs.mAngularDamping = c.angularDamping;
      cs.mFriction = c.friction;
      cs.mRestitution = c.restitution;
      cs.mIsSensor = c.sensor;
      if (c.gravityFactor !== undefined) {
        cs.mGravityFactor = c.gravityFactor;
      }
      cs.mCollideKinematicVsNonDynamic = true;
      if (c.lockRotation)
        cs.mAllowedDOFs =
          J.EAllowedDOFs_TranslationX |
          J.EAllowedDOFs_TranslationY |
          J.EAllowedDOFs_TranslationZ;
      if (c.motion === "dynamic") {
        cs.mAllowSleeping = false;
        cs.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
        cs.mMassPropertiesOverride.mMass = c.mass;
        cs.mMotionQuality = J.EMotionQuality_LinearCast;
      }
      let body;
      try {
        body = bi.CreateBody(cs);
        if (!body || !J.getPointer(body)) throw new Error("物理刚体容量已满");
        bi.AddBody(body.GetID(), J.EActivation_Activate);
      } finally {
        J.destroy(cs);
        J.destroy(pos);
        J.destroy(rot);
        shape.Release();
      }
      bodies.set(node.id, {
        body,
        object,
        config: structuredClone(c),
        last: signature(p),
        scale: [s.x, s.y, s.z],
        boundsSize:
          c.shape === "convex" || c.shape === "mesh"
            ? tools.modelBounds(object, c.parts, s)
            : null,
      });
      numbers.set(bodyNumber(body), node.id);
    }
    function remove(id) {
      if (disposed) return;
      mutate();
      tools?.remove(id);
      for (const [key, c] of contacts)
        if (c.a === id || c.b === id) contacts.delete(key);
      const r = bodies.get(id);
      if (!r) return;
      const number = bodyNumber(r.body);
      bi.RemoveBody(r.body.GetID());
      bi.DestroyBody(r.body.GetID());
      r.apertureOriginal?.Release();
      bodies.delete(id);
      numbers.delete(number);
      for (const [key, c] of contacts)
        if (c.a === id || c.b === id) contacts.delete(key);
    }
    function flush() {
      for (const event of queue.splice(0)) {
        for (const sub of [...subscribers]) {
          if (!subscribers.has(sub) || !sub.owner.record.active ||
              sub.owner.record.destroying || sub.owner.record.entity?.destroyed) continue;
          if (sub.id && event.a !== sub.id && event.b !== sub.id) continue;
          const a = options.find(event.a),
            b = options.find(event.b);
          if (!a || !b || a.destroyed || b.destroyed) continue;
          try {
            sub.fn(eventFor(event, sub.id, event.phase));
          } catch (error) {
            sub.dispose();
            options.onError?.({
              file: sub.owner.record.file,
              entityId: sub.owner.record.entity?.id,
              hook: "physics.contact",
              error,
            });
          }
        }
      }
    }
    function step(dt) {
      if (disposed) return;
      for (const [id, r] of bodies) {
        if (r.object.isDisposed?.()) {
          remove(id);
          continue;
        }
        let p = worldPose(r.object);
        const target = frame?.targets.get(id);
        if (target) {
          const t = Math.min(1, (frame.elapsed + dt) / frame.duration);
          p = {
            pos: B.Vector3.Lerp(target.start.pos, target.end.pos, t),
            rot: B.Quaternion.Slerp(target.start.rot, target.end.rot, t),
            scale: target.end.scale,
          };
        }
        if (
          [p.scale.x, p.scale.y, p.scale.z].some(
            (v, i) => Math.abs(v - r.scale[i]) > 1e-4,
          )
        )
          throw new Error("运行时改变刚体缩放需移除后重新添加碰撞体");
        const sig = signature(p);
        if (sig !== r.last || r.config.motion === "kinematic") {
          const pos = new J.RVec3(p.pos.x, p.pos.y, p.pos.z),
            rot = new J.Quat(p.rot.x, p.rot.y, p.rot.z, p.rot.w);
          if (r.config.motion === "kinematic")
            bi.MoveKinematic(r.body.GetID(), pos, rot, dt);
          else
            bi.SetPositionAndRotation(
              r.body.GetID(),
              pos,
              rot,
              J.EActivation_Activate,
            );
          J.destroy(pos);
          J.destroy(rot);
          r.last = sig;
        }
      }
      for (const r of bodies.values()) for (const f of r.forces || []) {
        const n = new J.Vec3(f.value.x, f.value.y, f.value.z);
        let point;
        try {
          if (f.point) { point = new J.RVec3(f.point.x, f.point.y, f.point.z); bi.AddForce(r.body.GetID(), n, point); }
          else bi[f.torque ? "AddTorque" : "AddForce"](r.body.GetID(), n);
        } finally { if (point) J.destroy(point); J.destroy(n); }
      }
      solving = true;
      try { tools?.beforeStep(dt); world.Step(dt, 1); } finally { solving = false; }
      syncTransforms([...bodies.values()].filter((r) => r.config.motion !== "static"));
      for (const c of contacts.values()) queue.push({ ...c.detail, phase: "stay" });
      flush();
      tools?.updateDebug();
      if (frame) frame.elapsed += dt;
      else clearForces();
    }
    function hierarchyDepth(object) {
      let depth = 0;
      for (let parent = object.parent; parent; parent = parent.parent) depth++;
      return depth;
    }
    function syncTransforms(records) {
      records.sort((a, b) => hierarchyDepth(a.object) - hierarchyDepth(b.object));
      for (const r of records) {
        const pos = r.body.GetPosition(),
          rot = r.body.GetRotation();
        let p = new B.Vector3(pos.GetX(), pos.GetY(), pos.GetZ()),
          q = new B.Quaternion(rot.GetX(), rot.GetY(), rot.GetZ(), rot.GetW());
        if (r.object.parent) {
          const wp = worldPose(r.object.parent);
          p = B.Vector3.TransformCoordinates(
            p,
            B.Matrix.Invert(r.object.parent.getWorldMatrix()),
          );
          q = wp.rot.conjugate().multiply(q);
        }
        r.object.position.copyFrom(p);
        if (r.object.rotationQuaternion)
          r.object.rotationQuaternion.copyFrom(q);
        else r.object.rotation.copyFrom(q.toEulerAngles());
        r.last = signature(worldPose(r.object));
      }
    }
    // Preserve the full-frame target when a caller subdivides a native step.
    function beginFrame(dt) {
      if (frame) throw Error("Physics frame already active");
      if (!Number.isFinite(dt) || dt <= 0) throw Error("Invalid physics frame duration");
      frame = { duration: dt, elapsed: 0, targets: new Map() };
      for (const [id, r] of bodies) {
        if (r.config.motion !== "kinematic" || r.object.isDisposed?.()) continue;
        const end = worldPose(r.object), pos = r.body.GetPosition(), rot = r.body.GetRotation();
        const start = {
          pos: new B.Vector3(pos.GetX(), pos.GetY(), pos.GetZ()),
          rot: new B.Quaternion(rot.GetX(), rot.GetY(), rot.GetZ(), rot.GetW()),
        };
        frame.targets.set(id, { start, end });
      }
      // Capture every target before restoring parents, so child targets retain
      // the world pose authored by the script for this full frame.
      const targets = [...frame.targets].sort(([a], [b]) => hierarchyDepth(bodies.get(a).object) - hierarchyDepth(bodies.get(b).object));
      for (const [id, target] of targets) {
        root.ArkGlideSpatial.write(B, bodies.get(id).object,
          { x: target.start.pos.x, y: target.start.pos.y, z: target.start.pos.z },
          { x: target.start.rot.x, y: target.start.rot.y, z: target.start.rot.z, w: target.start.rot.w });
      }
    }
    function requireBody(entity) {
      if (
        disposed ||
        !entity ||
        entity.destroyed ||
        options.find(entity.id) !== entity ||
        !bodies.has(entity.id)
      )
        throw new Error("实体没有有效刚体");
      return bodies.get(entity.id);
    }
    function getState(e) {
      if (tools?.hasCharacter(e?.id)) return tools.state(e);
      const r = requireBody(e),
        p = worldPose(r.object);
      return {
        kind: r.config.motion,
        group: r.config.group || "Default",
        sensor: r.config.sensor,
        position: value(r.body.GetPosition()),
        rotation: { x: p.rot.x, y: p.rot.y, z: p.rot.z, w: p.rot.w },
        velocity: value(r.body.GetLinearVelocity()),
        angularVelocity: value(r.body.GetAngularVelocity()),
        mass: r.config.mass,
        shape: r.config.shape,
        size: r.boundsSize || {
          x: r.config.size.x * p.scale.x,
          y: r.config.size.y * p.scale.y,
          z: r.config.size.z * p.scale.z,
        },
      };
    }
    function setState(e, s) {
      mutate();
      if (s.position) vec(s.position);
      if (s.velocity) vec(s.velocity);
      if (s.angularVelocity) vec(s.angularVelocity);
      if (
        s.rotation &&
        (![s.rotation.x, s.rotation.y, s.rotation.z, s.rotation.w].every(
          Number.isFinite,
        ) ||
          Math.abs(
            Math.hypot(s.rotation.x, s.rotation.y, s.rotation.z, s.rotation.w) -
              1,
          ) > 0.001)
      )
        throw Error("Expected unit quaternion");
      if (tools?.hasCharacter(e?.id)) {
        tools.setState(e, s);
        return;
      }
      const r = requireBody(e);
      if (s.position || s.rotation) {
        const p = s.position || value(r.body.GetPosition()),
          q = s.rotation || getState(e).rotation,
          position = new J.RVec3(p.x, p.y, p.z),
          rotation = new J.Quat(q.x, q.y, q.z, q.w);
        try {
          bi.SetPositionAndRotation(
            r.body.GetID(),
            position,
            rotation,
            J.EActivation_Activate,
          );
        } finally {
          J.destroy(position);
          J.destroy(rotation);
        }
        root.ArkGlideSpatial.write(B, r.object, p, q);
        r.last = signature(worldPose(r.object));
      }
      for (const [key, method] of [
        ["velocity", "SetLinearVelocity"],
        ["angularVelocity", "SetAngularVelocity"],
      ])
        if (s[key]) {
          const v = new J.Vec3(s[key].x, s[key].y, s[key].z);
          try {
            bi[method](r.body.GetID(), v);
          } finally {
            J.destroy(v);
          }
        }
    }
    // Static hosts use triangle geometry; movable hosts use convex solid cells.
    // Both retain the body ID, native joints, collision groups and scripted mass.
    function replaceApertureGeometry(e, vertices, indices, cells) {
      mutate();
      const r = requireBody(e);
      if (!vertices) {
        if (r.apertureOriginal) {
          bi.SetShape(r.body.GetID(), r.apertureOriginal, true, J.EActivation_Activate);
          if (r.config.motion === "dynamic") r.body.GetMotionProperties().ScaleToMass(r.config.mass);
          r.apertureOriginal.Release();
          r.apertureOriginal = null;
        }
        return;
      }
      if (!r.apertureOriginal) {
        r.apertureOriginal = r.body.GetShape();
        r.apertureOriginal.AddRef();
      }
      const movable = r.config.motion !== "static";
      const shapeSettings = movable ? new J.StaticCompoundShapeSettings() : new J.MeshShapeSettings();
      let result;
      try {
        if (movable) {
          if (!cells?.length) throw Error("Movable aperture needs convex solid cells");
          const position = new J.Vec3(0, 0, 0), rotation = new J.Quat(0, 0, 0, 1);
          try {
            for (const cell of cells) {
              const hull = new J.ConvexHullShapeSettings();
              let hullResult;
              try {
                hull.mMaxConvexRadius = 0;
                for (const point of cell) {
                  const v = new J.Vec3(point.x, point.y, point.z);
                  hull.mPoints.push_back(v);
                  J.destroy(v);
                }
                hullResult = hull.Create();
                if (hullResult.HasError()) throw Error(hullResult.GetError().c_str());
                shapeSettings.AddShapeShape(position, rotation, hullResult.Get(), 0);
              } finally {
                if (hullResult) J.destroy(hullResult);
                J.destroy(hull);
              }
            }
          } finally { J.destroy(rotation); J.destroy(position); }
        } else {
          for (let i = 0; i < vertices.length; i += 3) {
            const v = new J.Float3(vertices[i], vertices[i + 1], vertices[i + 2]);
            shapeSettings.mTriangleVertices.push_back(v);
            J.destroy(v);
          }
          for (let i = 0; i < indices.length; i += 3) {
            const t = new J.IndexedTriangle(
              indices[i],
              indices[i + 2],
              indices[i + 1],
              0,
            );
            shapeSettings.mIndexedTriangles.push_back(t);
            J.destroy(t);
          }
          shapeSettings.Sanitize();
        }
        result = shapeSettings.Create();
        if (result.HasError()) throw Error(result.GetError().c_str());
        // Native constraints store anchors relative to the original COM. Keep
        // that frame unchanged when an asymmetric aperture removes material.
        let replacement = result.Get(), adjusted;
        if (movable) {
          // Getter bindings reuse temporary native vectors; copy before the next call.
          const originalCOM = value(r.apertureOriginal.GetCenterOfMass()), nextCOM = value(replacement.GetCenterOfMass());
          const offset = new J.Vec3(originalCOM.x - nextCOM.x,
            originalCOM.y - nextCOM.y, originalCOM.z - nextCOM.z);
          try { adjusted = new J.OffsetCenterOfMassShape(replacement, offset); adjusted.AddRef(); }
          finally { J.destroy(offset); }
          replacement = adjusted;
        }
        try { bi.SetShape(r.body.GetID(), replacement, true, J.EActivation_Activate); }
        finally { adjusted?.Release(); }
        if (r.config.motion === "dynamic") r.body.GetMotionProperties().ScaleToMass(r.config.mass);
      } finally {
        if (result) J.destroy(result);
        J.destroy(shapeSettings);
      }
    }
    function configure(e, patch) {
      mutate();
      const r = requireBody(e), allowed = ["mass", "friction", "restitution", "gravityFactor", "linearDamping", "angularDamping"];
      if (!patch || Object.keys(patch).some(k => !allowed.includes(k))) throw Error("Unknown runtime body property");
      for (const [k, v] of Object.entries(patch))
        if (!Number.isFinite(v) || v < 0 || (k === "mass" && v === 0) || (k === "restitution" && v > 1)) throw Error("Invalid body " + k);
      if (r.config.motion === "static" && ["mass", "gravityFactor", "linearDamping", "angularDamping"].some(k => patch[k] !== undefined))
        throw Error("Motion properties require a movable body");
      const motion = r.config.motion === "static" ? null : r.body.GetMotionProperties();
      for (const [k, method] of [["friction", "SetFriction"], ["restitution", "SetRestitution"], ["gravityFactor", "SetGravityFactor"]])
        if (patch[k] !== undefined) bi[method](r.body.GetID(), patch[k]);
      for (const [k, method] of [["linearDamping", "SetLinearDamping"], ["angularDamping", "SetAngularDamping"], ["mass", "ScaleToMass"]])
        if (patch[k] !== undefined) motion[method](patch[k]);
      Object.assign(r.config, patch);
    }
    function updateShape(e, patch) {
      mutate();
      const r = requireBody(e);
      if (r.geometryOwner || r.apertureOriginal) throw Error("Unregister portal surface before updating its collider");
      if (!patch || Object.keys(patch).some(k => !["shape", "size", "parts"].includes(k))) throw Error("Invalid collider update");
      const config = { ...r.config, ...structuredClone(patch) }, pose = worldPose(r.object);
      if (!["box", "sphere", "capsule", "convex", "mesh"].includes(config.shape)) throw Error("Unknown collider shape");
      if (config.parts && (!Array.isArray(config.parts) || config.parts.some(p => typeof p !== "string"))) throw Error("Invalid collider parts");
      if (!config.size || ![config.size.x, config.size.y, config.size.z].every(v => Number.isFinite(v) && v > 0)) throw Error("Collider needs positive dimensions");
      const scale = pose.scale;
      if ([scale.x, scale.y, scale.z].some(v => !Number.isFinite(v) || v <= 0)) throw Error("Collider scale must be positive");
      const actual = r.object.getWorldMatrix().m, recomposed = B.Matrix.Compose(scale, pose.rot, pose.pos).m;
      if (actual.some((v, i) => Math.abs(v - recomposed[i]) > 1e-4)) throw Error("Collider hierarchy has shear");
      let shape, adjusted;
      if (["mesh", "convex"].includes(config.shape)) { shape = tools.modelShape(r.object, config, scale); shape.AddRef(); }
      else {
        if (config.shape !== "box" && Math.max(scale.x, scale.y, scale.z) - Math.min(scale.x, scale.y, scale.z) > 1e-4)
          throw Error("Sphere/capsule need uniform scale");
        const size = { x: config.size.x * scale.x, y: config.size.y * scale.y, z: config.size.z * scale.z };
        shape = tools.queryShape(config.shape === "box" ? { kind: "box", size } : config.shape === "sphere"
          ? { kind: "sphere", radius: size.x / 2 } : { kind: "capsule", radius: size.x / 2, height: size.y });
      }
      try {
        const old = value(r.body.GetShape().GetCenterOfMass()), next = value(shape.GetCenterOfMass()), offset = new J.Vec3(old.x - next.x, old.y - next.y, old.z - next.z);
        try { adjusted = new J.OffsetCenterOfMassShape(shape, offset); adjusted.AddRef(); } finally { J.destroy(offset); }
        bi.SetShape(r.body.GetID(), adjusted, true, J.EActivation_Activate);
        if (config.motion === "dynamic") r.body.GetMotionProperties().ScaleToMass(config.mass);
        r.config = config;
        r.scale = [scale.x, scale.y, scale.z];
        r.boundsSize = ["convex", "mesh"].includes(config.shape) ? tools.modelBounds(r.object, config.parts, scale) : null;
        r.last = signature(pose);
      } finally { adjusted?.Release(); shape.Release(); }
    }
    function force(e, force, point, torque = false) {
      mutate();
      vec(force);
      if (point) vec(point);
      if (tools.hasCharacter(e?.id)) {
        if (point || torque) throw Error("Character forces act at its center");
        tools.force(e, force);
        return;
      }
      const r = requireBody(e);
      if (r.config.motion !== "dynamic") throw Error("Forces require a dynamic body");
      (r.forces ||= []).push({ value: { ...force }, point: point ? { ...point } : null, torque });
    }
    function clearForces() {
      for (const r of bodies.values()) r.forces = [];
      tools?.clearForces();
    }
    function contactResponse(e, point, axis) {
      vec(point);
      vec(axis);
      if (tools?.hasCharacter(e?.id)) {
        const state = tools.state(e);
        return {
          velocity: state.velocity,
          inverseMass: 1 / state.mass,
          friction: 0.5,
          restitution: 0,
        };
      }
      const r = requireBody(e),
        center = value(r.body.GetCenterOfMassPosition()),
        state = getState(e),
        offset = {
          x: point.x - center.x,
          y: point.y - center.y,
          z: point.z - center.z,
        };
      const cross = (a, b) => ({
          x: a.y * b.z - a.z * b.y,
          y: a.z * b.x - a.x * b.z,
          z: a.x * b.y - a.y * b.x,
        }),
        angular = cross(state.angularVelocity, offset),
        velocity = {
          x: state.velocity.x + angular.x,
          y: state.velocity.y + angular.y,
          z: state.velocity.z + angular.z,
        };
      let inverseMass = 0;
      if (r.config.motion === "dynamic") {
        const arm = cross(offset, axis),
          v = new J.Vec3(arm.x, arm.y, arm.z);
        try {
          const inertia = value(r.body.GetInverseInertia().Multiply3x3(v));
          inverseMass =
            1 / r.config.mass +
            arm.x * inertia.x +
            arm.y * inertia.y +
            arm.z * inertia.z;
        } finally {
          J.destroy(v);
        }
      }
      return {
        velocity,
        inverseMass,
        friction: r.config.friction,
        restitution: r.config.restitution,
      };
    }
    function impulseAt(e, impulse, point) {
      mutate();
      vec(impulse);
      vec(point);
      if (tools?.hasCharacter(e?.id)) {
        const state = tools.state(e);
        tools.setState(e, {
          velocity: {
            x: state.velocity.x + impulse.x / state.mass,
            y: state.velocity.y + impulse.y / state.mass,
            z: state.velocity.z + impulse.z / state.mass,
          },
        });
        return;
      }
      const r = requireBody(e);
      if (r.config.motion !== "dynamic") return;
      const v = new J.Vec3(impulse.x, impulse.y, impulse.z),
        p = new J.RVec3(point.x, point.y, point.z);
      try {
        bi.AddImpulse(r.body.GetID(), v, p);
      } finally {
        J.destroy(v);
        J.destroy(p);
      }
    }
    function forOwner(owner) {
      const guard = () => {
        if (!owner.record.active) throw new Error("脚本已销毁");
      };
      return Object.freeze({
        ...tools?.ownerAPI(owner),
        backend: "jolt-wasm",
        getProperties(entity) { guard(); const r = requireBody(entity); return structuredClone({ gravityFactor: 1, ...r.config }); },
        configure(entity, patch) { guard(); configure(entity, patch); },
        updateShape(entity, patch) { guard(); updateShape(entity, patch); },
        applyForce(entity, value, worldPoint) { guard(); force(entity, value, worldPoint); },
        applyTorque(entity, value) { guard(); force(entity, value, null, true); },
        onContactMaterial(entity, fn) {
          guard();
          if (entity) requireBody(entity);
          if (typeof fn !== "function") throw Error("Expected material callback");
          const rule = { owner, id: entity?.id, fn };
          rule.dispose = owner.track(() => materialRules.delete(rule));
          materialRules.add(rule);
          return rule.dispose;
        },
        addImpulseAt(entity, impulse, worldPoint) {
          guard();
          if (getState(entity).kind !== "dynamic")
            throw Error("Point impulse requires dynamic rigid body");
          impulseAt(entity, impulse, worldPoint);
        },
        addAngularImpulse(entity, impulse) {
          guard();
          mutate();
          vec(impulse);
          const r = requireBody(entity);
          if (r.config.motion !== "dynamic")
            throw Error("Angular impulse requires dynamic rigid body");
          const v = new J.Vec3(impulse.x, impulse.y, impulse.z);
          try {
            bi.AddAngularImpulse(r.body.GetID(), v);
          } finally {
            J.destroy(v);
          }
        },
        getPointVelocity(entity, worldPoint) {
          guard();
          return contactResponse(entity, worldPoint, { x: 0, y: 0, z: 0 })
            .velocity;
        },
        getConnectedBodies(entity) {
          guard();
          requireBody(entity);
          return tools.connectedBodies(entity);
        },
        getState(entity) {
          guard();
          return getState(entity);
        },
        setState(entity, state) {
          guard();
          setState(entity, state);
        },
        getAngularVelocity(entity) {
          guard();
          return value(requireBody(entity).body.GetAngularVelocity());
        },
        setAngularVelocity(entity, value) {
          guard();
          setState(entity, { angularVelocity: value });
        },
        has: (entity) => !!entity && !entity.destroyed && bodies.has(entity.id),
        add(entity, config) {
          if (!owner.record.active) throw new Error("脚本已销毁");
          if (!entity || entity.destroyed || options.find(entity.id) !== entity)
            throw new Error("实体不存在");
          if (bodies.has(entity.id) || tools?.hasCharacter(entity.id))
            throw new Error("实体已有运动组件");
          add({ id: entity.id, name: entity.name, physics: config });
        },
        remove: (entity) => {
          guard();
          requireBody(entity);
          remove(entity.id);
        },
        getVelocity: (entity) =>
          value(requireBody(entity).body.GetLinearVelocity()),
        setVelocity(entity, v) {
          guard();
          mutate();
          const r = requireBody(entity);
          vec(v);
          const n = new J.Vec3(v.x, v.y, v.z);
          try {
            bi.SetLinearVelocity(r.body.GetID(), n);
          } finally {
            J.destroy(n);
          }
        },
        addImpulse(entity, v) {
          guard();
          mutate();
          const r = requireBody(entity);
          if (r.config.motion !== "dynamic")
            throw new Error("冲量仅支持动态刚体");
          vec(v);
          const n = new J.Vec3(v.x, v.y, v.z);
          try {
            bi.AddImpulse(r.body.GetID(), n);
          } finally {
            J.destroy(n);
          }
        },
        teleport(entity, v) {
          guard();
          mutate();
          const r = requireBody(entity);
          vec(v);
          const n = new J.RVec3(v.x, v.y, v.z);
          try {
            bi.SetPosition(r.body.GetID(), n, J.EActivation_Activate);
          } finally {
            J.destroy(n);
          }
          const p = r.object.parent
            ? B.Vector3.TransformCoordinates(
                new B.Vector3(v.x, v.y, v.z),
                B.Matrix.Invert(r.object.parent.computeWorldMatrix(true)),
              )
            : v;
          r.object.position.copyFromFloats(p.x, p.y, p.z);
          r.last = signature(worldPose(r.object));
        },
        onContact(entity, fn) {
          if (disposed) throw new Error("Physics session stopped");
          guard();
          if (entity) requireBody(entity);
          if (typeof fn !== "function")
            throw new TypeError("Expected contact callback");
          const sub = { id: entity?.id, fn, owner };
          if (owner.record.active && !owner.record.destroying)
            subscribers.add(sub);
          sub.dispose = owner.track(() => subscribers.delete(sub));
          return sub.dispose;
        },
      });
    }
    const gravity = vec(options.gravity || { x: 0, y: -9.8, z: 0 }),
      g = new J.Vec3(gravity.x, gravity.y, gravity.z);
    system.SetGravity(g);
    J.destroy(g);
    return {
      add,
      attachJoints: (nodes) => tools?.attachJoints(nodes),
      clearRootMotion: (e) => tools?.clearRootMotion(e),
      applyRootMotion(e, delta, rotation, dt) {
        const r = bodies.get(e.id),
          object = options.getObject(e.id);
        if (!object) return;
        const pose = worldPose(object),
          d = B.Vector3.TransformNormal(
            delta,
            B.Matrix.Compose(pose.scale, pose.rot, B.Vector3.Zero()),
          ),
          q = pose.rot.multiply(rotation);
        if (tools?.applyRootMotion(e, d, q, dt)) return;
        if (r?.config.motion === "dynamic") {
          const old = value(r.body.GetLinearVelocity()),
            velocity = new J.Vec3(d.x / dt, old.y + d.y / dt, d.z / dt),
            rot = new J.Quat(q.x, q.y, q.z, q.w);
          try {
            bi.SetLinearVelocity(r.body.GetID(), velocity);
            bi.SetRotation(r.body.GetID(), rot, J.EActivation_Activate);
          } finally {
            J.destroy(rot);
            J.destroy(velocity);
          }
          return;
        }
        let p = pose.pos.add(d),
          localQ = q;
        if (object.parent) {
          p = B.Vector3.TransformCoordinates(
            p,
            B.Matrix.Invert(object.parent.computeWorldMatrix(true)),
          );
          localQ = worldPose(object.parent).rot.conjugate().multiply(q);
        }
        object.position.copyFrom(p);
        object.rotationQuaternion = localQ;
      },
      remove,
      getState,
      setState,
      contactResponse,
      impulseAt,
      replaceApertureGeometry,
      beginFrame,
      endFrame() { frame = null; clearForces(); },
      cancelFrameTarget(entity) { frame?.targets.delete(entity.id); },
      warpFrame(entity, matrix) {
        tools?.warpInput(entity, matrix);
        const target = frame?.targets.get(entity.id);
        if (!target) return;
        const rotation = new B.Quaternion();
        matrix.decompose(new B.Vector3(), rotation, new B.Vector3());
        for (const pose of [target.start, target.end]) {
          pose.pos = B.Vector3.TransformCoordinates(pose.pos, matrix);
          pose.rot = rotation.multiply(pose.rot).normalize();
        }
      },
      connectedBodies: (e) => tools.connectedBodies(e),
      syncEntities(entities) { syncTransforms(entities.map(requireBody)); },
      castBody: (...args) => tools.castBody(...args),
      describe(entity) {
        const r = requireBody(entity);
        return {
          config: structuredClone(r.config),
          object: r.object,
          pose: worldPose(r.object),
        };
      },
      lockGeometry(entity, token) { requireBody(entity).geometryOwner = token; },
      configure,
      updateShape,
      clearForces,
      assertMutable: mutate,
      step,
      forOwner,
      stats: () => ({
        physicsBodies: bodies.size,
        physicsContacts: contacts.size,
        physicsSubscriptions: subscribers.size,
        physicsBackend: "jolt-wasm",
        ...tools?.stats(),
      }),
      dispose() {
        if (disposed) return;
        for (const id of [...bodies.keys()]) remove(id);
        tools?.dispose();
        disposed = true;
        subscribers.clear();
        materialRules.clear();
        contacts.clear();
        queue.length = 0;
        system.SetContactListener(null);
        J.destroy(listener);
        J.destroy(world);
      },
    };
  }
  root.ArkGlidePhysics = { createPhysics };
})(globalThis);
