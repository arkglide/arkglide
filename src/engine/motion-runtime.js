// Reversible world-space kinematic actuators. No door or platform rules here.
(function (root) {
  "use strict";
  function create(B, o) {
    const S = root.ArkGlideSpatial, records = new Map();
    let dead = false, maxMotions = 256;
    const unit = value => S.number(value, 0, 1, "Expected normalized motion progress");
    function guard(owner) {
      if (dead || !owner.record.active || owner.record.destroying) throw Error("Motion owner expired");
    }
    function make(owner, entity, config) {
      guard(owner);
      if (records.size >= maxMotions) throw RangeError("Motion budget exceeded");
      if (!entity || entity.destroyed || o.find(entity.id) !== entity || records.has(entity.id)) throw Error("Invalid or already controlled motion entity");
      const physics = o.physics.forOwner(owner), state = physics.getState(entity);
      if (state.kind !== "kinematic") throw Error("Motion requires a kinematic rigid body");
      const from = structuredClone(config.from ?? { position: state.position, rotation: state.rotation }),
        to = structuredClone(config.to);
      for (const pose of [from, to]) { S.vec(pose?.position); S.quat(pose?.rotation); }
      const duration = S.number(config.duration, Number.MIN_VALUE, Number.MAX_VALUE, "Expected positive motion duration");
      const easing = config.easing ?? "linear";
      if (!["linear", "smoothstep"].includes(easing)) throw Error("Invalid motion easing");
      let progress = unit(config.progress ?? 0), target = unit(config.target ?? progress), paused = config.paused ?? false, live = true, off;
      if (typeof paused !== "boolean") throw TypeError("Expected motion paused flag");
      function poseAt(value) {
        const t = easing === "smoothstep" ? value * value * (3 - 2 * value) : value;
        return { position: S.plain(B.Vector3.Lerp(new B.Vector3(from.position.x, from.position.y, from.position.z), new B.Vector3(to.position.x, to.position.y, to.position.z), t)),
          rotation: S.plainQ(B.Quaternion.Slerp(new B.Quaternion(from.rotation.x, from.rotation.y, from.rotation.z, from.rotation.w), new B.Quaternion(to.rotation.x, to.rotation.y, to.rotation.z, to.rotation.w), t).normalize()) };
      }
      function check() { guard(owner); if (!live || entity.destroyed) throw Error("Motion expired"); }
      function destroy() { if (!live) return; live = false; records.delete(entity.id); off?.(); }
      // Explicit initial/seek poses teleport. Normal updates author a target for
      // physics.beginFrame, retaining native velocity and portal substep interpolation.
      physics.setState(entity, poseAt(progress));
      const record = { destroy, step(dt) {
        if (!live || !owner.record.active || entity.destroyed) { destroy(); return; }
        if (physics.getState(entity).kind !== "kinematic") throw Error("Motion body is no longer kinematic");
        if (!paused) progress += Math.sign(target - progress) * Math.min(Math.abs(target - progress), dt / duration);
        const pose = poseAt(progress);
        S.write(B, o.getObject(entity.id), pose.position, pose.rotation);
      }, owner };
      records.set(entity.id, record); off = owner.track(destroy);
      return Object.freeze({
        get active() { return live && !entity.destroyed; },
        setTarget(value) { check(); target = unit(value); },
        setPaused(value) { check(); if (typeof value !== "boolean") throw TypeError("Expected motion paused flag"); paused = value; },
        getState() { check(); return { progress, target, paused }; },
        restore(snapshot) {
          check(); const next = { progress: unit(snapshot.progress), target: unit(snapshot.target), paused: snapshot.paused };
          if (typeof next.paused !== "boolean") throw TypeError("Expected motion paused flag");
          physics.setState(entity, poseAt(next.progress));
          ({ progress, target, paused } = next);
        },
        destroy,
      });
    }
    return {
      forOwner(owner) { guard(owner); return Object.freeze({
        create(entity, config) { return make(owner, entity, config); },
        setLimit(value) { guard(owner); if (!Number.isSafeInteger(value) || value < 1 || value < records.size) throw RangeError("Invalid motion limit"); maxMotions = value; },
      }); },
      step(dt) {
        if (dead) return;
        if (!Number.isFinite(dt) || dt <= 0) throw RangeError("Expected positive motion deltaTime");
        for (const record of [...records.values()]) try { record.step(dt); }
        catch (error) { record.destroy(); o.onError?.({ file: record.owner.record.file, hook: "motion.step", error }); }
      },
      stats: () => ({ motionControllers: records.size }),
      dispose() { if (dead) return; for (const r of [...records.values()]) r.destroy(); dead = true; },
    };
  }
  root.ArkGlideMotion = { create };
})(globalThis);
