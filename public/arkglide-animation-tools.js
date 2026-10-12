(function (root) {
  "use strict";
  function weights(blend, parameters) {
    if (!blend) return [];
    const children = blend.children,
      p = Number(parameters[blend.parameterX]);
    if (blend.kind === "1d") {
      const sorted = children
          .map((c, i) => ({ c, i }))
          .sort((a, b) => a.c.threshold - b.c.threshold),
        w = children.map(() => 0);
      if (p <= sorted[0].c.threshold) w[sorted[0].i] = 1;
      else if (p >= sorted.at(-1).c.threshold) w[sorted.at(-1).i] = 1;
      else
        for (let i = 0; i < sorted.length - 1; i++) {
          const a = sorted[i],
            b = sorted[i + 1];
          if (p >= a.c.threshold && p <= b.c.threshold) {
            const t = (p - a.c.threshold) / (b.c.threshold - a.c.threshold);
            w[a.i] = 1 - t;
            w[b.i] = t;
            break;
          }
        }
      return children
        .map((c, i) => ({ clip: c.clip, weight: w[i] }))
        .filter((c) => c.weight > 0);
    }
    const y = Number(parameters[blend.parameterY]),
      values = children.map((a, i) => {
        let weight = 1;
        for (let j = 0; j < children.length; j++) {
          if (j === i) continue;
          const b = children[j],
            x = b.x - a.x,
            dy = b.y - a.y;
          weight = Math.min(
            weight,
            Math.max(
              0,
              1 - ((p - a.x) * x + (y - a.y) * dy) / (x * x + dy * dy),
            ),
          );
        }
        return weight;
      }),
      total = values.reduce((a, b) => a + b, 0);
    if (total < 1e-8) {
      let index = 0;
      for (let i = 1; i < children.length; i++)
        if (
          (p - children[i].x) ** 2 + (y - children[i].y) ** 2 <
          (p - children[index].x) ** 2 + (y - children[index].y) ** 2
        )
          index = i;
      return [{ clip: children[index].clip, weight: 1 }];
    }
    return children
      .map((c, i) => ({ clip: c.clip, weight: values[i] / total }))
      .filter((c) => c.weight > 0);
  }
  function create(B, o) {
    const live = new Map(),
      retargeted = new Map(),
      listeners = new Set();
    let disposed = false,
      droppedEvents = 0;
    const clone = (v) => (v?.clone ? v.clone() : v);
    function groups(e) {
      if (disposed || !e || e.destroyed || o.find(e.id) !== e)
        throw Error("动画实体不存在");
      return [...(o.getGroups(e.id) || []), ...(retargeted.get(e.id) || [])];
    }
    function duration(g) {
      const fps = g.targetedAnimations[0]?.animation.framePerSecond || 60;
      return Math.max(1e-6, (g.to - g.from) / fps);
    }
    function sample(g, elapsed, loop) {
      const fps = g.targetedAnimations[0]?.animation.framePerSecond || 60,
        d = duration(g),
        t = loop ? ((elapsed % d) + d) % d : Math.min(d, Math.max(0, elapsed));
      return g.from + t * fps;
    }
    function getState(c, name) {
      const s = c.resource.states.find((s) => s.name === name);
      if (!s) throw Error("动画状态不存在: " + name);
      return s;
    }
    function stateWeights(c, state) {
      return state.blend
        ? weights(state.blend, c.parameters)
        : [{ clip: state.clip, weight: 1 }];
    }
    function clips(c, s) {
      return stateWeights(c, s).map((w) => {
        const g = c.groups.find((g) => g.name === w.clip);
        if (!g) throw Error("控制器片段不存在: " + w.clip);
        return { ...w, g };
      });
    }
    function stateDuration(c, s) {
      return clips(c, s).reduce((n, w) => n + duration(w.g) * w.weight, 0) || 1;
    }
    function blendValue(a, b, t, property) {
      if (typeof a === "number" && typeof b === "number")
        return a + (b - a) * t;
      if (
        a?.w !== undefined &&
        b?.w !== undefined &&
        property === "rotationQuaternion"
      )
        return B.Quaternion.Slerp(a, b, t).normalize();
      if (a?.scale && b?.scale) return a.scale(1 - t).add(b.scale(t));
      throw Error("控制器不支持混合动画通道: " + property);
    }
    function emit(c, event) {
      const revision = c.revision;
      for (const sub of [...listeners])
        if (
          c.live &&
          c.revision === revision &&
          !c.entity.destroyed &&
          sub.id === c.entity.id &&
          listeners.has(sub) &&
          sub.owner.record.active
        ) {
          try {
            sub.fn({ ...event, entity: c.entity, state: c.state });
          } catch (error) {
            o.onError?.({
              hook: "animation.event",
              file: sub.owner.record.file,
              entityId: c.entity.id,
              error,
            });
            sub.dispose();
          }
        }
    }
    function events(c, state, from, to) {
      const revision = c.revision;
      const d = stateDuration(c, state),
        first = state.loop ? Math.floor(Math.max(0, from) / d) : 0,
        last = state.loop ? Math.floor(to / d) : 0;
      let count = 0,
        scheduled = 0;
      for (const event of state.events || []) {
        if (event.time > d) continue;
        if (state.loop) {
          const lo = Math.max(0, Math.floor((from - event.time) / d) + 1),
            hi = Math.floor((to - event.time) / d);
          scheduled += Math.max(0, hi - lo + 1);
        } else if (event.time > from && event.time <= to) scheduled++;
      }
      // At most 128 dispatches per fixed step, including skipped loops. No unbounded catch-up.
      for (let cycle = first; cycle <= Math.min(last, first + 128); cycle++)
        for (const event of state.events || []) {
          const t = cycle * d + event.time;
          if (event.time > d || t <= from || t > to) continue;
          if (count >= 128) {
            droppedEvents += Math.max(0, scheduled - count);
            return;
          }
          count++;
          emit(c, {
            name: event.name,
            data: event.data,
            time: event.time,
            loop: cycle,
          });
          if (!c.live || c.entity.destroyed || c.revision !== revision) return;
        }
      droppedEvents += Math.max(0, scheduled - count);
    }
    function tracks(c, list) {
      const targets = new Map(
        [...c.bindPose].map(([target, values]) => [
          target,
          new Map(
            [...values].map(([path, value]) => [
              path,
              { value: clone(value), weight: 0 },
            ]),
          ),
        ]),
      );
      for (const slot of list)
        for (const { g, weight } of clips(c, slot.state)) {
          const effective = weight * slot.weight;
          if (effective <= 0) continue;
          const frame = sample(g, slot.time, slot.state.loop);
          for (const a of g.targetedAnimations) {
            const property = a.animation.targetProperty,
              target = a.target;
            if (
              c.rootMotion &&
              target.name === c.rootMotion.target &&
              ((property === "position" && c.rootMotion.translation) ||
                (property === "rotationQuaternion" && c.rootMotion.rotation))
            )
              continue;
            const value = a.animation.evaluate(frame);
            let values = targets.get(target);
            if (!values) {
              values = new Map();
              targets.set(target, values);
            }
            const old = values.get(property);
            values.set(
              property,
              old?.weight
                ? {
                    value: blendValue(
                      old.value,
                      value,
                      effective / (old.weight + effective),
                      property,
                    ),
                    weight: old.weight + effective,
                  }
                : { value: clone(value), weight: effective },
            );
          }
        }
      for (const [target, values] of targets)
        for (const [path, value] of values) {
          const parts = path.split(".");
          let ref = target;
          for (let i = 0; i < parts.length - 1; i++) ref = ref[parts[i]];
          const key = parts.at(-1),
            base = c.bindPose.get(target).get(path),
            out =
              value.weight < 1
                ? blendValue(base, value.value, value.weight, path)
                : value.value;
          if (ref[key]?.copyFrom) ref[key].copyFrom(out);
          else ref[key] = out;
        }
    }
    function motionTrack(a, g, t, loop, rotation) {
      const d = duration(g),
        cycles = loop ? Math.floor(t / d) : 0,
        frame = sample(g, t, loop),
        first = a.evaluate(g.from),
        last = a.evaluate(g.to),
        value = a.evaluate(frame);
      if (rotation) {
        const delta = last.multiply(first.conjugate());
        let result = B.Quaternion.Identity(),
          base = delta,
          n = Math.max(0, cycles);
        while (n > 0) {
          if (n % 2) result = result.multiply(base);
          base = base.multiply(base);
          n = Math.floor(n / 2);
        }
        return result.multiply(value);
      }
      return value.add(last.subtract(first).scale(cycles));
    }
    function rootDelta(c, state, from, to) {
      let delta = B.Vector3.Zero(),
        rotation = B.Quaternion.Identity(),
        rw = 0;
      for (const { g, weight } of clips(c, state))
        for (const t of g.targetedAnimations) {
          if (t.target.name !== c.rootMotion.target) continue;
          if (
            c.rootMotion.translation &&
            t.animation.targetProperty === "position"
          ) {
            delta = delta.add(
              motionTrack(t.animation, g, to, state.loop, false)
                .subtract(motionTrack(t.animation, g, from, state.loop, false))
                .scale(weight),
            );
          }
          if (
            c.rootMotion.rotation &&
            t.animation.targetProperty === "rotationQuaternion"
          ) {
            const a = motionTrack(t.animation, g, from, state.loop, true),
              b = motionTrack(t.animation, g, to, state.loop, true),
              q = b.multiply(a.conjugate());
            rotation = B.Quaternion.Slerp(rotation, q, weight / (rw + weight));
            rw += weight;
          }
        }
      return { delta, rotation };
    }
    function control(entity, id, params = {}, owner) {
      if (owner && !owner.record.active) throw Error("动画脚本已销毁");
      const resource = o.controllers?.[id];
      if (!resource) throw Error("动画控制器不存在: " + id);
      const imported = groups(entity);
      const c = {
        entity,
        resource: structuredClone(resource),
        parameters: structuredClone(resource.parameters),
        groups: imported,
        state: resource.defaultState,
        revision: 0,
        time: 0,
        previous: null,
        fade: 0,
        fadeTime: 0,
        rootMotion: params.rootMotion,
        bindPose: new Map(),
        live: true,
        untrack: null,
      };
      for (const s of resource.states) clips(c, s);
      for (const g of imported)
        for (const a of g.targetedAnimations) {
          const path = a.animation.targetProperty;
          if (
            c.rootMotion &&
            a.target.name === c.rootMotion.target &&
            ((path === "position" && c.rootMotion.translation) ||
              (path === "rotationQuaternion" && c.rootMotion.rotation))
          )
            continue;
          let value = a.target;
          for (const key of path.split(".")) value = value?.[key];
          if (value === undefined) throw Error("动画目标属性缺失: " + path);
          blendValue(value, value, 0, path);
          if (!c.bindPose.has(a.target)) c.bindPose.set(a.target, new Map());
          c.bindPose.get(a.target).set(path, clone(value));
        }
      if (c.rootMotion) {
        const targets = imported
          .flatMap((g) => g.targetedAnimations)
          .filter((t) => t.target.name === c.rootMotion.target);
        if (!targets.length)
          throw Error("根运动节点不存在: " + c.rootMotion.target);
        if (
          c.rootMotion.translation &&
          !targets.some((t) => t.animation.targetProperty === "position")
        )
          throw Error("根运动节点没有平移轨道");
        if (
          c.rootMotion.rotation &&
          !targets.some(
            (t) => t.animation.targetProperty === "rotationQuaternion",
          )
        )
          throw Error("根运动节点没有四元数轨道");
      }
      remove(entity.id);
      o.stopLegacy?.(entity);
      for (const g of imported) g.stop();
      // The previous controller restores its bind pose when removed.
      // Capture that restored pose rather than its last animated frame.
      for (const [target, paths] of c.bindPose)
        for (const path of paths.keys()) {
          let value = target;
          for (const key of path.split(".")) value = value[key];
          paths.set(path, clone(value));
        }
      live.set(entity.id, c);
      if (owner) c.untrack = owner.track(() => remove(entity.id));
      const valid = () => {
        if (!c.live || entity.destroyed || (owner && !owner.record.active))
          throw Error("动画控制器已销毁");
      };
      c.handle = Object.freeze({
        get state() {
          valid();
          return c.state;
        },
        setParameter(name, value) {
          valid();
          if (
            !Object.hasOwn(c.parameters, name) ||
            typeof value !== typeof c.parameters[name] ||
            (typeof value === "number" && !Number.isFinite(value))
          )
            throw Error("动画参数不存在或类型无效: " + name);
          c.parameters[name] = value;
        },
        getParameter(name) {
          valid();
          if (!Object.hasOwn(c.parameters, name))
            throw Error("动画参数不存在: " + name);
          return c.parameters[name];
        },
        setState(name, fade = 0) {
          valid();
          getState(c, name);
          if (!Number.isFinite(fade) || fade < 0 || fade > 60)
            throw Error("无效混合时长");
          transition(c, name, fade);
        },
        inspect() {
          valid();
          return {
            state: c.state,
            parameters: { ...c.parameters },
            weights: stateWeights(c, getState(c, c.state)),
            time: c.time,
          };
        },
        destroy() {
          if (live.get(entity.id) === c) remove(entity.id);
        },
      });
      events(c, getState(c, c.state), -1e-9, 0);
      if (c.live && !c.entity.destroyed)
        tracks(c, [{ state: getState(c, c.state), time: 0, weight: 1 }]);
      return c.handle;
    }
    function transition(c, to, fade) {
      c.revision++;
      c.previous =
        fade > 0 ? { state: getState(c, c.state), time: c.time } : null;
      c.state = to;
      c.time = 0;
      c.fade = fade;
      c.fadeTime = 0;
      events(c, getState(c, to), -1e-9, 0);
    }
    const condition = (c, d) =>
      d.op === ">"
        ? c.parameters[d.parameter] > d.value
        : d.op === "<"
          ? c.parameters[d.parameter] < d.value
          : d.op === "=="
            ? c.parameters[d.parameter] === d.value
            : c.parameters[d.parameter] !== d.value;
    function update(dt) {
      if (disposed || dt <= 0) return;
      for (const c of [...live.values()]) {
        if (!c.live) continue;
        if (c.entity.destroyed) {
          remove(c.entity.id);
          continue;
        }
        let state = getState(c, c.state);
        const t = c.resource.transitions.find(
          (t) =>
            t.to !== c.state &&
            (t.from === "*" || t.from === c.state) &&
            (t.exitTime === undefined ||
              c.time / stateDuration(c, state) >= t.exitTime) &&
            t.conditions.every((d) => condition(c, d)),
        );
        if (t) {
          const revision = c.revision;
          transition(c, t.to, t.duration);
          if (c.revision !== revision + 1) continue;
          if (!c.live || c.entity.destroyed) continue;
          state = getState(c, c.state);
        }
        const before = c.time,
          revision = c.revision;
        c.time += dt * state.speed;
        events(c, state, before, c.time);
        if (!c.live || c.entity.destroyed || c.revision !== revision) continue;
        c.fadeTime += dt;
        const w = c.previous && c.fade ? Math.min(1, c.fadeTime / c.fade) : 1;
        const list = [{ state, time: c.time, weight: w }];
        if (c.previous) {
          c.previous.time += dt * c.previous.state.speed;
          list.push({ ...c.previous, weight: 1 - w });
        }
        tracks(c, list);
        if (c.rootMotion) {
          let m = rootDelta(c, state, before, c.time);
          if (c.previous) {
            const old = rootDelta(
              c,
              c.previous.state,
              c.previous.time - dt * c.previous.state.speed,
              c.previous.time,
            );
            m = {
              delta: old.delta.scale(1 - w).add(m.delta.scale(w)),
              rotation: B.Quaternion.Slerp(old.rotation, m.rotation, w),
            };
          }
          o.applyRootMotion?.(c.entity, m.delta, m.rotation, dt);
        }
        if (w === 1) c.previous = null;
      }
    }
    function retarget(source, target, profile) {
      if (!profile?.mapping || source === target)
        throw Error("重定向需要不同模型与显式映射");
      const sourceGroups = groups(source),
        targetGroups = groups(target),
        objects =
          o.getTargets?.(target.id) ||
          targetGroups.flatMap((g) =>
            g.targetedAnimations.map((t) => t.target),
          );
      const map = new Map();
      for (const t of objects) {
        if (map.has(t.name) && Object.values(profile.mapping).includes(t.name))
          throw Error("重定向目标节点重名: " + t.name);
        map.set(t.name, t);
      }
      const animated = sourceGroups.flatMap((g) =>
        g.targetedAnimations.map((t) => t.target.name),
      );
      for (const name of new Set(animated))
        if (!profile.mapping[name] || !map.has(profile.mapping[name]))
          throw Error("动画骨骼/节点映射缺失: " + name);
      if (!Number.isFinite(profile.scale) || profile.scale <= 0)
        throw Error("无效重定向比例");
      const created = [];
      try {
        for (const g of sourceGroups) {
          if (targetGroups.some((t) => t.name === g.name))
            throw Error("目标动画片段重名: " + g.name);
          const copy = g.clone(
            g.name,
            (t) => map.get(profile.mapping[t.name]),
            true,
            true,
          );
          copy.stop();
          created.push(copy);
          for (let i = 0; i < copy.targetedAnimations.length; i++) {
            const a = copy.targetedAnimations[i].animation,
              src = g.targetedAnimations[i].target.name,
              dst = profile.mapping[src],
              sp = profile.sourcePose?.[src],
              tp = profile.targetPose?.[dst];
            if ((sp && !tp) || (!sp && tp))
              throw Error("源/目标参考姿势必须成对提供: " + src);
            a.setKeys(
              a.getKeys().map((key) => {
                let value = clone(key.value);
                if (a.targetProperty === "position") {
                  const s = sp
                      ? new B.Vector3(
                          sp.position.x,
                          sp.position.y,
                          sp.position.z,
                        )
                      : B.Vector3.Zero(),
                    t = tp
                      ? new B.Vector3(
                          tp.position.x,
                          tp.position.y,
                          tp.position.z,
                        )
                      : B.Vector3.Zero();
                  value = t.add(value.subtract(s).scale(profile.scale));
                }
                if (a.targetProperty === "rotationQuaternion" && sp && tp) {
                  const s = new B.Quaternion(
                      sp.rotation.x,
                      sp.rotation.y,
                      sp.rotation.z,
                      sp.rotation.w,
                    ),
                    t = new B.Quaternion(
                      tp.rotation.x,
                      tp.rotation.y,
                      tp.rotation.z,
                      tp.rotation.w,
                    );
                  value = t.multiply(s.conjugate()).multiply(value).normalize();
                }
                return { ...key, value };
              }),
            );
          }
        }
        retargeted.set(target.id, [
          ...(retargeted.get(target.id) || []),
          ...created,
        ]);
        return created.map((g) => g.name);
      } catch (error) {
        for (const g of created) g.dispose();
        throw error;
      }
    }
    function remove(id) {
      const c = live.get(id);
      if (c) {
        c.live = false;
        live.delete(id);
        c.untrack?.();
        o.clearRootMotion?.(c.entity);
        if (!c.entity.destroyed) tracks(c, []);
      }
    }
    const api = (owner) => ({
      createController: (e, id, params) => control(e, id, params, owner),
      controller(e) {
        groups(e);
        return live.get(e.id)?.handle || null;
      },
      onEvent(e, fn) {
        groups(e);
        if (typeof fn !== "function") throw Error("动画事件需要回调");
        const sub = { id: e.id, fn, owner };
        sub.dispose = owner.track(() => listeners.delete(sub));
        if (owner.record.active) listeners.add(sub);
        return sub.dispose;
      },
      retarget(source, target, id) {
        if (!owner.record.active) throw Error("脚本已销毁");
        const p = typeof id === "string" ? o.profiles?.[id] : id;
        const names = retarget(source, target, p);
        const created = retargeted
          .get(target.id)
          .filter((g) => names.includes(g.name));
        owner.track(() => {
          const controller = live.get(target.id);
          if (
            controller?.resource.states.some((state) =>
              (state.blend ? state.blend.children : [{ clip: state.clip }]).some(
                (entry) => created.some((group) => group.name === entry.clip),
              ),
            )
          )
            remove(target.id);
          for (const g of created) g.dispose();
          retargeted.set(
            target.id,
            (retargeted.get(target.id) || []).filter(
              (g) => !created.includes(g),
            ),
          );
        });
        return names;
      },
    });
    return {
      groups,
      control,
      update,
      remove,
      api,
      attach(nodes) {
        for (const n of nodes) {
          try {
            if (n.animation?.retarget) {
              const r = n.animation.retarget;
              retarget(
                o.find(r.sourceId),
                o.find(n.id),
                o.profiles?.[r.profileId],
              );
            }
            if (n.animation?.controllerId && n.animation.autoplay)
              control(o.find(n.id), n.animation.controllerId, n.animation);
          } catch (error) {
            o.onError?.({ hook: "animation.attach", entityId: n.id, error });
          }
        }
      },
      removeEntity(id) {
        remove(id);
        for (const g of retargeted.get(id) || []) g.dispose();
        retargeted.delete(id);
        for (const sub of [...listeners]) if (sub.id === id) sub.dispose();
      },
      stats: () => ({
        animationControllers: live.size,
        animationEventSubscriptions: listeners.size,
        animationRetargetGroups: [...retargeted.values()].reduce(
          (n, g) => n + g.length,
          0,
        ),
        animationDroppedEvents: droppedEvents,
      }),
      dispose() {
        if (disposed) return;
        for (const id of new Set([...live.keys(), ...retargeted.keys()]))
          this.removeEntity(id);
        for (const sub of [...listeners]) sub.dispose();
        listeners.clear();
        disposed = true;
      },
    };
  }
  root.ArkGlideAnimationTools = { create, weights };
})(globalThis);
