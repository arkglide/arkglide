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
        // Ordered entrance IDs from the holder's space to the body's space.
        // Keep topology even when the requested hold point is before the door.
        path: config.path === undefined ? null : config.path,
        holder: config.holder || owner.record.entity,
        rayDriven: false,
        live: true,
      };
      const api = o.portals.forOwner(owner);
      function route(path) {
        if (!Array.isArray(path) || path.length > 32 || path.some(id => typeof id !== "string" || !api.get(id)?.linked))
          throw Error("Invalid grab portal path");
        return path;
      }
      function reducePath(path) {
        const result = [];
        for (const id of path) {
          if (api.get(result.at(-1))?.getDestination()?.id === id) result.pop();
          else result.push(id);
        }
        return result;
      }
      if (g.path !== null) g.path = [...route(g.path)];
      g.routeValid = () => { try { route(g.path); return true; } catch { return false; } };
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
        if (!g.live) return;
        if (event.entity === g.holder && g.rayDriven && g.path) {
          if (g.path[0] === event.source.id) g.path.shift();
          else g.path.unshift(event.destination.id);
        }
        if (event.entity !== entity) return;
        if (g.rayDriven && g.path) {
          const last = api.get(g.path.at(-1));
          if (last?.getDestination()?.id === event.source.id) g.path.pop();
          else g.path.push(event.source.id);
        }
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
          g.rayDriven = false;
          g.path = null;
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
          ray.normalize();
          const viewPath = o.portals.viewPath?.(g.holder, origin) || [];
          const filter = {
              ignore: [
                entity,
                owner.record.entity,
                g.holder,
                ...(options.ignore || []),
              ].filter(Boolean),
              sensors: false,
            };
          // Acquisition can be beyond the hold distance, on the far side of a
          // portal. A short hold ray alone cannot identify that body's space.
          const trace = (g.path === null || options.segment !== undefined)
            ? api.raycast(origin, S.plain(ray.scale(settings.maxDistance)), filter) : null;
          let index = options.segment;
          if (index === undefined && g.path === null) {
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
          if (index !== undefined && (
            !Number.isInteger(index) ||
            index < 0 ||
            index >= trace.segments.length
          ))
            throw Error("Invalid hold ray segment");
          if (index !== undefined) g.path = reducePath([...viewPath, ...trace.path.slice(0, index)]);
          else if (!g.rayDriven) g.path = reducePath([...viewPath, ...g.path]);
          try { route(g.path); } catch { release(); return; }
          const hold = distance === settings.maxDistance && trace ? trace : api.raycast(origin, S.plain(ray.scale(distance)), filter);
          let target = V(hold.segments.at(-1).end);
          // Bring the hold point back into the holder frame, then into the
          // body's frame. The two points need not cross the same number of doors.
          for (let i = hold.path.length - 1; i >= 0; i--) {
            const portal = api.get(hold.path[i]),
              destination = portal?.getDestination();
            if (!destination) throw Error("Hold ray portal expired");
            target = V(destination.mapPoint(S.plain(target)));
          }
          // A first-person eye may still be on the opposite side of the body
          // during a crossing. Normalize that view back to the holder's frame.
          for (let i = viewPath.length - 1; i >= 0; i--)
            target = V(api.get(viewPath[i]).getDestination().mapPoint(S.plain(target)));
          for (const id of g.path) target = V(api.get(id).mapPoint(S.plain(target)));
          g.target = target;
          g.rayDriven = true;
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
          if (g.rayDriven && !g.routeValid()) { g.release(); continue; }
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
