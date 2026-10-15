// Force-based grabbing is independent of camera mode, object type and game rules.
(function (root) {
  "use strict";
  function create(B, o) {
    const S = root.ArkGlideSpatial,
      grabs = new Set();
    let disposed = false;
    const V = (p) => {
      S.vec(p);
      return new B.Vector3(p.x, p.y, p.z);
    };
    function grab(entity, config, owner) {
      if (disposed || !owner.record.active)
        throw Error("Interaction owner expired");
      const state = o.physics.getState(entity);
      if (state.kind !== "dynamic")
        throw Error("Only dynamic bodies can be grabbed");
      if ([...grabs].some((g) => g.entity === entity))
        throw Error("Body already grabbed");
      const settings = {
        stiffness: config.stiffness ?? 100,
        damping: config.damping ?? 18,
        maxForce: config.maxForce ?? 2000,
        maxDistance: config.maxDistance ?? 10,
      };
      for (const [k, v] of Object.entries(settings))
        S.number(v, 0.001, 1e6, "Invalid grab " + k);
      const g = {
        entity,
        owner,
        settings,
        target: V(config.position || state.position),
        rotation: config.rotation || null,
        live: true,
      };
      if (g.rotation) S.quat(g.rotation);
      grabs.add(g);
      let off, offTraversal;
      const release = () => {
        if (!g.live) return;
        g.live = false;
        grabs.delete(g);
        offTraversal?.();
        off?.();
      };
      g.release = release;
      off = owner.track(release);
      offTraversal = o.portals.forOwner(owner).onTraverse((event) => {
        if (event.entity !== entity || !g.live) return;
        const matrix = B.Matrix.FromArray(event.matrix);
        g.target = B.Vector3.TransformCoordinates(g.target, matrix);
        if (g.rotation) {
          const scale = new B.Vector3(),
            q = new B.Quaternion(),
            p = new B.Vector3();
          matrix.decompose(scale, q, p);
          g.rotation = S.plainQ(
            q
              .multiply(
                new B.Quaternion(
                  g.rotation.x,
                  g.rotation.y,
                  g.rotation.z,
                  g.rotation.w,
                ),
              )
              .normalize(),
          );
        }
      });
      return Object.freeze({
        entity,
        get active() {
          return g.live && !entity.destroyed;
        },
        setTarget(position, rotation) {
          if (!g.live || !owner.record.active) throw Error("Grab expired");
          g.target = V(position);
          if (rotation) {
            S.quat(rotation);
            g.rotation = { ...rotation };
          }
        },
        setRay(origin, direction, distance = 2.5, options = {}) {
          if (!g.live || !owner.record.active) throw Error("Grab expired");
          S.number(
            distance,
            0.01,
            settings.maxDistance,
            "Invalid hold distance",
          );
          const ray = V(direction);
          if (ray.lengthSquared() < 1e-10) throw Error("Empty grab ray");
          const trace = o.portals
            .forOwner(owner)
            .raycast(origin, S.plain(ray.normalize().scale(distance)), {
              ignore: [
                entity,
                owner.record.entity,
                ...(options.ignore || []),
              ].filter(Boolean),
              sensors: false,
            });
          let index = options.segment;
          if (index === undefined) {
            const position = V(o.physics.getState(entity).position);
            let nearest = Infinity;
            trace.segments.forEach((segment, i) => {
              const start = V(segment.origin),
                delta = V(segment.end).subtract(start),
                length = delta.lengthSquared(),
                t = length
                  ? Math.max(
                      0,
                      Math.min(
                        1,
                        B.Vector3.Dot(position.subtract(start), delta) / length,
                      ),
                    )
                  : 0,
                distance = B.Vector3.DistanceSquared(
                  position,
                  start.add(delta.scale(t)),
                );
              if (distance < nearest) {
                nearest = distance;
                index = i;
              }
            });
          }
          if (
            !Number.isInteger(index) ||
            index < 0 ||
            index >= trace.segments.length
          )
            throw Error("Invalid hold ray segment");
          let target = V(trace.segments.at(-1).end);
          const api = o.portals.forOwner(owner);
          for (let i = trace.path.length - 1; i >= index; i--) {
            const portal = api.get(trace.path[i]),
              destination = portal?.getDestination();
            if (!destination) throw Error("Hold ray portal expired");
            target = V(destination.mapPoint(S.plain(target)));
          }
          g.target = target;
        },
        release,
      });
    }
    return {
      forOwner(owner) {
        return Object.freeze({
          grab: (e, config = {}) => grab(e, config, owner),
        });
      },
      step(dt) {
        for (const g of [...grabs]) {
          if (g.entity.destroyed || !g.owner.record.active) {
            g.release();
            continue;
          }
          let state;
          try {
            state = o.physics.getState(g.entity);
          } catch {
            g.release();
            continue;
          }
          const difference = g.target.subtract(V(state.position));
          if (difference.length() > g.settings.maxDistance) {
            g.release();
            continue;
          }
          const k = g.settings,
            force = difference
              .scale(k.stiffness)
              .subtract(V(state.velocity).scale(k.damping));
          if (force.length() > k.maxForce)
            force.normalize().scaleInPlace(k.maxForce);
          o.physics
            .forOwner(g.owner)
            .addImpulse(g.entity, S.plain(force.scale(dt)));
          if (g.rotation) {
            const q = new B.Quaternion(
                state.rotation.x,
                state.rotation.y,
                state.rotation.z,
                state.rotation.w,
              ),
              target = new B.Quaternion(
                g.rotation.x,
                g.rotation.y,
                g.rotation.z,
                g.rotation.w,
              ),
              delta = target.multiply(q.conjugate()).normalize();
            if (delta.w < 0) delta.scaleInPlace(-1);
            const angle = 2 * Math.acos(Math.max(-1, Math.min(1, delta.w))),
              axis = new B.Vector3(delta.x, delta.y, delta.z);
            if (axis.lengthSquared() > 1e-8) {
              axis.normalize();
              const desired = axis.scale(Math.min(10, angle * 8));
              o.physics.setState(g.entity, {
                angularVelocity: S.plain(desired),
              });
            }
          }
        }
      },
      stats: () => ({ physicsGrabs: grabs.size }),
      releaseAll() { for (const g of [...grabs]) g.release(); },
      dispose() {
        for (const g of [...grabs]) g.release();
        grabs.clear();
        disposed = true;
      },
    };
  }
  root.ArkGlideInteraction = { create };
})(globalThis);
