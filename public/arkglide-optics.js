// Reflect native collision normals and optionally traverse registered portals.
(function (root) {
  "use strict";
  function create(B, o) {
    const S = root.ArkGlideSpatial, reflectors = new Map();
    let dead = false, limits = { maxReflectors: 512, maxBounces: 64, maxPortalHops: 64, maxSegments: 1024 };
    const vector = p => { S.vec(p); return new B.Vector3(p.x, p.y, p.z); };
    const guard = owner => { if (dead || !owner.record.active || owner.record.destroying) throw Error("Optics owner expired"); };
    function settings(config = {}) {
      const reflectivity = config.reflectivity ?? 1, twoSided = config.twoSided ?? true;
      S.number(reflectivity, 0, 1, "Invalid reflectivity");
      if (typeof twoSided !== "boolean") throw TypeError("Expected twoSided flag");
      return { reflectivity, twoSided };
    }
    function trace(owner, config) {
      guard(owner);
      let start = vector(config.origin), direction = vector(config.direction), remaining = direction.length();
      if (!Number.isFinite(remaining) || remaining <= 0) throw Error("Expected nonzero finite optical ray");
      direction.normalize();
      const range = remaining, segments = [], reflections = [], path = [];
      const maxBounces = config.maxBounces ?? Math.min(8, limits.maxBounces), maxHops = config.maxPortalHops ?? Math.min(8, limits.maxPortalHops);
      for (const [value, maximum] of [[maxBounces, limits.maxBounces], [maxHops, limits.maxPortalHops]])
        if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw RangeError("Invalid optical path budget");
      const epsilon = config.epsilon ?? 0.0005, minimum = config.minEnergy ?? 0.001;
      S.number(epsilon, Number.MIN_VALUE, Number.MAX_VALUE, "Expected positive optical epsilon");
      S.number(minimum, 0, Number.MAX_VALUE, "Invalid minimum optical energy");
      let energy = config.energy ?? 1, hit = null, reason = "range";
      S.number(energy, 0, Number.MAX_VALUE, "Invalid optical energy");
      if (config.throughPortals !== undefined && typeof config.throughPortals !== "boolean") throw TypeError("Expected throughPortals flag");
      if (config.filter?.all || config.filter?.rotation) throw Error("Optical rays return one terminal hit and have no shape rotation");
      const physics = o.physics.forOwner(owner), portals = o.portals.forOwner(owner);
      while (remaining > 0) {
        if (energy < minimum || energy === 0) { reason = "energy"; break; }
        const result = config.throughPortals === false ? (() => {
          const h = physics.raycast(S.plain(start), S.plain(direction.scale(remaining)), config.filter);
          return { hit: h, path: [], truncated: false,
            segments: [{ origin: S.plain(start), end: h ? { ...h.point } : S.plain(start.add(direction.scale(remaining))) }] };
        })() : portals.raycast(S.plain(start), S.plain(direction.scale(remaining)), { ...config.filter, maxHops: Math.min(32, maxHops - path.length) });
        if (segments.length + result.segments.length > limits.maxSegments) { reason = "budget"; hit = null; break; }
        segments.push(...result.segments.map(segment => ({ ...segment, origin: { ...segment.origin }, end: { ...segment.end }, energy })));
        path.push(...result.path);
        hit = result.hit;
        const traveled = hit?.distance ?? result.segments.reduce((sum, segment) => sum + B.Vector3.Distance(vector(segment.origin), vector(segment.end)), 0);
        remaining = Math.max(0, remaining - traveled);
        if (result.truncated) { reason = "budget"; break; }
        if (!hit) { remaining = 0; reason = "range"; break; }
        const reflector = reflectors.get(hit.entity.id);
        if (!reflector?.live || reflector.entity !== hit.entity || hit.entity.destroyed) { reason = "hit"; break; }
        const last = result.segments.at(-1);
        if (!last) { reason = "budget"; break; }
        const incoming = vector(last.end).subtract(vector(last.origin));
        if (incoming.lengthSquared() < 1e-20) { reason = "hit"; break; }
        incoming.normalize();
        const normal = vector(hit.normal).normalize(), dot = B.Vector3.Dot(incoming, normal);
        if ((!reflector.config.twoSided && dot >= 0) || normal.lengthSquared() === 0) { reason = "hit"; break; }
        if (reflections.length >= maxBounces) { reason = "budget"; break; }
        direction = incoming.subtract(normal.scale(2 * dot)).normalize();
        energy *= reflector.config.reflectivity;
        reflections.push({ entity: hit.entity, point: { ...hit.point }, normal: S.plain(normal), direction: S.plain(direction), energy });
        const offset = Math.min(epsilon, remaining);
        start = vector(hit.point).add(direction.scale(offset));
        remaining -= offset;
        hit = null;
      }
      return { segments, reflections, path, hit, energy, distance: range - remaining, truncated: reason === "budget", reason };
    }
    return {
      forOwner(owner) {
        guard(owner);
        return Object.freeze({
          addReflector(entity, config) {
            guard(owner);
            if (!entity || entity.destroyed || o.find(entity.id) !== entity || reflectors.has(entity.id)) throw Error("Invalid or duplicate reflector");
            o.physics.getState(entity);
            const record = { entity, config: settings(config), live: true };
            let off;
            function destroy() { if (!record.live) return; record.live = false; reflectors.delete(entity.id); off?.(); }
            record.destroy = destroy; reflectors.set(entity.id, record);
            if (reflectors.size > limits.maxReflectors) { destroy(); throw RangeError("Reflector budget exceeded"); }
            off = owner.track(destroy);
            return Object.freeze({ get active() { return record.live && !entity.destroyed; },
              update(patch) { guard(owner); if (!record.live || entity.destroyed) throw Error("Reflector expired"); record.config = settings({ ...record.config, ...patch }); }, destroy });
          },
          trace: config => trace(owner, config),
          setLimits(patch) {
            guard(owner);
            if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw TypeError("Expected optical limits");
            for (const [key, value] of Object.entries(patch))
              if (!Object.hasOwn(limits, key) || !Number.isSafeInteger(value) || value < (key === "maxBounces" || key === "maxPortalHops" ? 0 : 1)) throw RangeError("Invalid optical limit");
            const next = { ...limits, ...patch };
            if (next.maxReflectors < reflectors.size) throw RangeError("Reflector limit below usage");
            limits = next;
          },
          getLimits() { guard(owner); return { ...limits }; },
        });
      },
      prune() { for (const record of [...reflectors.values()]) if (record.entity.destroyed) record.destroy(); },
      stats: () => ({ opticalReflectors: reflectors.size }),
      dispose() { if (dead) return; for (const record of [...reflectors.values()]) record.destroy(); dead = true; },
    };
  }
  root.ArkGlideOptics = { create };
})(globalThis);
