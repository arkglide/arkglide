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
      contacts = new Map(),
      queue = [];
    let disposed = false;
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
    function contact(kind, a, b) {
      const ia = numbers.get(a),
        ib = numbers.get(b);
      if (!ia || !ib) return;
      const key = [a, b].sort((a, b) => a - b).join(":");
      if (kind === "enter") {
        if (contacts.has(key)) return;
        contacts.set(key, { a: ia, b: ib });
      } else if (kind === "exit") {
        const old = contacts.get(key);
        if (!old) return;
        contacts.delete(key);
      }
      queue.push({
        phase: kind,
        a: ia,
        b: ib,
        sensor: !!(
          bodies.get(ia)?.config.sensor || bodies.get(ib)?.config.sensor
        ),
      });
    }
    const listener = new J.ContactListenerJS();
    listener.OnContactValidate = () =>
      J.ValidateResult_AcceptAllContactsForThisBodyPair;
    listener.OnContactAdded = (a, b, manifold) => (
      debugContact(manifold),
      contact(
        "enter",
        bodyNumber(J.wrapPointer(a, J.Body)),
        bodyNumber(J.wrapPointer(b, J.Body)),
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
    listener.OnContactPersisted = (a, b, m) => debugContact(m);
    listener.OnContactRemoved = (p) => {
      const pair = J.wrapPointer(p, J.SubShapeIDPair);
      contact(
        "exit",
        pair.GetBody1ID().GetIndexAndSequenceNumber(),
        pair.GetBody2ID().GetIndexAndSequenceNumber(),
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
    });
    function add(node) {
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
        ![c.friction, c.restitution].every(
          (v) => Number.isFinite(v) && v >= 0 && v <= 1,
        ) ||
        typeof c.sensor !== "boolean" ||
        typeof c.lockRotation !== "boolean"
      )
        throw new Error("无效刚体配置");
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
        cs = new J.BodyCreationSettings(
          shape,
          pos,
          rot,
          motion,
          tools ? tools.layer(c) : c.motion === "static" ? 0 : 1,
        );
      cs.mFriction = c.friction;
      cs.mRestitution = c.restitution;
      cs.mIsSensor = c.sensor;
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
      });
      numbers.set(bodyNumber(body), node.id);
    }
    function remove(id) {
      tools?.remove(id);
      for (const [key, c] of contacts)
        if (c.a === id || c.b === id) contacts.delete(key);
      const r = bodies.get(id);
      if (!r) return;
      const number = bodyNumber(r.body);
      bi.RemoveBody(r.body.GetID());
      bi.DestroyBody(r.body.GetID());
      bodies.delete(id);
      numbers.delete(number);
      for (const [key, c] of contacts)
        if (c.a === id || c.b === id) contacts.delete(key);
    }
    function flush() {
      for (const event of queue.splice(0)) {
        for (const sub of [...subscribers]) {
          if (!subscribers.has(sub) || !sub.owner.record.active) continue;
          if (sub.id && event.a !== sub.id && event.b !== sub.id) continue;
          const a = options.find(event.a),
            b = options.find(event.b);
          if (!a || !b) continue;
          try {
            sub.fn({
              phase: event.phase,
              self: sub.id === event.b ? b : a,
              other: sub.id === event.b ? a : b,
              sensor: event.sensor,
            });
          } catch (error) {
            options.onError?.({
              file: sub.owner.record.file,
              entityId: sub.owner.record.entity?.id,
              hook: "physics.contact",
              error,
            });
            sub.dispose();
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
        const p = worldPose(r.object);
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
      tools?.beforeStep(dt);
      world.Step(dt, 1);
      for (const r of bodies.values()) {
        if (r.config.motion === "static") continue;
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
      flush();
      tools?.updateDebug();
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
    function forOwner(owner) {
      const guard = () => {
        if (!owner.record.active) throw new Error("脚本已销毁");
      };
      return Object.freeze({
        ...tools?.ownerAPI(owner),
        backend: "jolt-wasm",
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
          if (entity) requireBody(entity);
          if (typeof fn !== "function")
            throw new TypeError("Expected contact callback");
          const sub = { id: entity?.id, fn, owner };
          sub.dispose = owner.track(() => subscribers.delete(sub));
          if (owner.record.active && !owner.record.destroying)
            subscribers.add(sub);
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
