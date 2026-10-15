// Owned overlap regions. Game scripts decide what an occupancy event means.
(function (root) {
  "use strict";
  const DEFAULT_LIMITS = Object.freeze({
    maxTriggers: 256,
    maxVolumesPerTrigger: 32,
    maxMembersPerTrigger: 4096,
  });
  const MOTIONS = ["static", "dynamic", "kinematic", "character"];

  function create(options) {
    const spatial = root.ArkGlideSpatial, records = new Set();
    let limits = { ...DEFAULT_LIMITS }, disposed = false, stepping = false;

    function guard(owner) {
      if (disposed || !owner.record.active || owner.record.destroying)
        throw Error("Trigger owner expired");
    }
    function fail(record, error) {
      record.destroy();
      options.onError?.({ file: record.owner.record.file, hook: "triggers.step", error });
    }
    function setLimits(patch) {
      if (!patch || typeof patch !== "object" || Array.isArray(patch))
        throw TypeError("Expected trigger limits");
      for (const [key, value] of Object.entries(patch))
        if (!Object.hasOwn(DEFAULT_LIMITS, key) || !Number.isSafeInteger(value) || value < 1)
          throw RangeError("Invalid trigger limit: " + key);
      const next = { ...limits, ...patch };
      if (records.size > next.maxTriggers || [...records].some(record =>
        record.config.volumes.length > next.maxVolumesPerTrigger ||
        record.members.size > next.maxMembersPerTrigger))
        throw RangeError("Trigger limits are below current usage");
      limits = next;
    }
    function validate(input, physics) {
      if (!input || !Array.isArray(input.volumes) || !input.volumes.length ||
          input.volumes.length > limits.maxVolumesPerTrigger)
        throw RangeError("Trigger needs a bounded, nonempty volume list");
      const volumes = input.volumes.map(volume => {
        if (!volume) throw TypeError("Expected trigger volume");
        spatial.vec(volume.position);
        if (volume.rotation !== undefined) spatial.quat(volume.rotation);
        return structuredClone({ shape: volume.shape, position: volume.position,
          ...(volume.rotation !== undefined ? { rotation: volume.rotation } : {}) });
      });
      const motions = [...(input.motions ?? ["dynamic", "kinematic", "character"])];
      if (!Array.isArray(input.motions ?? []) || !motions.length ||
          motions.some(motion => !MOTIONS.includes(motion)))
        throw TypeError("Invalid trigger motion filter");
      const interval = input.interval ?? 0;
      if (!Number.isFinite(interval) || interval < 0)
        throw RangeError("Trigger interval must be finite and nonnegative");
      if (input.enabled !== undefined && typeof input.enabled !== "boolean")
        throw TypeError("Expected trigger enabled flag");
      for (const key of ["filterEntity", "onEnter", "onStay", "onExit"])
        if (input[key] !== undefined && typeof input[key] !== "function")
          throw TypeError("Expected trigger callback: " + key);
      const filter = input.filter ?? {};
      if (!filter || typeof filter !== "object" || Array.isArray(filter) ||
          Object.keys(filter).some(key => !["group", "mask", "sensors", "ignore"].includes(key)) ||
          (filter.sensors !== undefined && typeof filter.sensors !== "boolean") ||
          (filter.ignore !== undefined && !Array.isArray(filter.ignore)))
        throw TypeError("Invalid trigger query filter");
      const config = { ...input, volumes, motions, interval,
        filter: { sensors: false, ...filter,
          ...(filter.ignore ? { ignore: [...filter.ignore] } : {}) } };
      // Native validation occurs before registering or replacing any state.
      for (const volume of volumes)
        physics.overlap(volume.shape, volume.position,
          { ...config.filter, rotation: volume.rotation });
      return config;
    }
    function createTrigger(owner, input) {
      guard(owner);
      if (records.size >= limits.maxTriggers) throw RangeError("Trigger budget exceeded");
      const physics = options.physics.forOwner(owner);
      const record = { config: validate(input, physics), members: new Map(), owner,
        elapsed: 0, dirty: true, revision: 0, live: true };
      let untrack;
      function check() {
        guard(owner);
        if (!record.live) throw Error("Trigger destroyed");
      }
      function destroy() {
        if (!record.live) return;
        record.live = false;
        records.delete(record);
        record.members.clear();
        untrack?.();
      }
      function collect(config) {
        const next = new Map();
        if (config.enabled === false) return next;
        const candidates = new Map();
        for (const volume of config.volumes)
          for (const hit of physics.overlap(volume.shape, volume.position,
            { ...config.filter, rotation: volume.rotation }))
            if (!hit.entity.destroyed) candidates.set(hit.entity.id, hit.entity);
        for (const [id, entity] of [...candidates].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
          if (!record.live || !owner.record.active || owner.record.destroying) break;
          if (entity.destroyed) continue;
          let state;
          try { state = options.physics.getState(entity); } catch { continue; }
          if (!config.motions.includes(state.kind)) continue;
          if (config.filterEntity) {
            const accepted = config.filterEntity(entity);
            if (typeof accepted !== "boolean") {
              // Reject async predicates without leaking their later rejection.
              if (accepted && typeof accepted.then === "function")
                Promise.resolve(accepted).catch(() => {});
              throw TypeError("Trigger filterEntity must return a synchronous boolean");
            }
            if (!accepted || entity.destroyed) continue;
          }
          if (next.size >= limits.maxMembersPerTrigger)
            throw RangeError("Trigger membership budget exceeded");
          next.set(id, entity);
        }
        return next;
      }
      function notify(config, phase, entity, dt, reason) {
        if (!record.live || !owner.record.active || owner.record.destroying) return;
        const result = config["on" + phase[0].toUpperCase() + phase.slice(1)]?.({
          trigger: handle, entity, phase, deltaTime: dt,
          ...(reason ? { reason } : {}),
        });
        // Async effects may use storage; they never block the physics clock.
        if (result && typeof result.then === "function")
          Promise.resolve(result).catch(error => {
            if (record.live && owner.record.active && !owner.record.destroying) fail(record, error);
          });
      }
      record.step = dt => {
        if (!record.live || !owner.record.active || owner.record.destroying) return;
        record.elapsed += dt;
        if (!record.dirty && record.elapsed < record.config.interval) return;
        // Snapshot configuration: callback updates take effect at the next sample.
        const config = record.config, elapsed = record.elapsed, revision = record.revision;
        const next = collect(config), previous = record.members;
        if (!record.live || !owner.record.active || owner.record.destroying) return;
        record.elapsed = 0;
        record.dirty = record.revision !== revision;
        record.members = next;
        for (const [id, entity] of previous)
          if (next.get(id) !== entity) notify(config, "exit", entity, elapsed,
            entity.destroyed ? "destroyed" : config.enabled === false ? "disabled" : "left");
        for (const [id, entity] of next) {
          if (!record.live || !owner.record.active || owner.record.destroying) break;
          if (entity.destroyed) { next.delete(id); continue; }
          notify(config, previous.get(id) === entity ? "stay" : "enter", entity, elapsed);
        }
      };
      const handle = Object.freeze({
        get active() { return record.live; },
        setEnabled(enabled) {
          check();
          if (typeof enabled !== "boolean") throw TypeError("Expected trigger enabled flag");
          if (record.config.enabled === enabled) return;
          record.config = { ...record.config, enabled };
          record.revision++;
          record.dirty = true;
        },
        update(patch) {
          check();
          if (!patch || typeof patch !== "object" || Array.isArray(patch))
            throw TypeError("Expected trigger options");
          record.config = validate({ ...record.config, ...patch }, physics);
          record.revision++;
          record.dirty = true;
        },
        getEntities() { check(); return [...record.members.values()].filter(entity => !entity.destroyed); },
        contains(entity) { check(); return !entity.destroyed && record.members.get(entity.id) === entity; },
        query() { check(); return [...collect(record.config).values()]; },
        destroy,
      });
      record.destroy = destroy;
      records.add(record);
      untrack = owner.track(destroy);
      return handle;
    }
    return {
      forOwner(owner) {
        guard(owner);
        return Object.freeze({
          create: input => createTrigger(owner, input),
          setLimits(patch) { guard(owner); setLimits(patch); },
          getLimits() { guard(owner); return { ...limits }; },
        });
      },
      step(dt) {
        if (disposed) return;
        if (!Number.isFinite(dt) || dt <= 0) throw RangeError("Expected positive trigger deltaTime");
        if (stepping) throw Error("Trigger sampling cannot be reentered");
        stepping = true;
        try {
          for (const record of [...records]) {
            try { record.step(dt); }
            catch (error) {
              fail(record, error);
            }
          }
        } finally { stepping = false; }
      },
      stats: () => ({ physicsTriggers: records.size,
        triggerMembers: [...records].reduce((sum, record) => sum + record.members.size, 0) }),
      dispose() {
        if (disposed) return;
        for (const record of [...records]) record.destroy();
        disposed = true;
      },
    };
  }
  root.ArkGlideTriggers = { create };
})(globalThis);
