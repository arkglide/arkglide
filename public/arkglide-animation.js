(function (root) {
  "use strict";
  function createAnimation(options) {
    const live = new Map();
    const advanced = root.ArkGlideAnimationTools?.create(
      options.BABYLON || root.BABYLON,
      {
        ...options,
        stopLegacy: (e) => live.get(e.id)?.release(),
      },
    );
    let disposed = false;
    function groups(entity) {
      if (
        disposed ||
        !entity ||
        entity.destroyed ||
        options.find(entity.id) !== entity
      )
        throw new Error("动画实体不存在");
      return advanced
        ? advanced.groups(entity)
        : options.getGroups(entity.id) || [];
    }
    function play(entity, name, params = {}, owner) {
      advanced?.remove(entity.id);
      const group = groups(entity).find((g) => g.name === name);
      if (!group) throw new Error("动画不存在: " + name);
      const speed = params.speed ?? 1,
        fade = params.fade ?? 0;
      if (
        !Number.isFinite(speed) ||
        speed < 0 ||
        speed > 100 ||
        !Number.isFinite(fade) ||
        fade < 0 ||
        fade > 60
      )
        throw new Error("无效动画速度/混合时间");
      const previous = live.get(entity.id);
      let oldGroup = null;
      if (previous) {
        if (fade > 0 && previous.group !== group) {
          oldGroup = previous.group;
          previous.release(false);
        } else previous.release(true);
      }
      for (const g of groups(entity))
        if (g !== group && g !== oldGroup) g.stop();
      group.start(params.loop !== false, speed);
      group.setWeightForAllAnimatables(fade ? 0 : 1);
      let active = true,
        untrack;
      const slot = {
        entity,
        group,
        speed,
        fade,
        elapsed: 0,
        oldGroup,
        release(stop = true) {
          if (!active) return;
          active = false;
          if (stop) group.stop();
          if (slot.oldGroup) slot.oldGroup.stop();
          if (live.get(entity.id) === slot) live.delete(entity.id);
          untrack?.();
        },
      };
      live.set(entity.id, slot);
      if (owner) untrack = owner.track(() => slot.release());
      const handle = Object.freeze({
        get playing() {
          return active && group.isStarted;
        },
        stop: () => slot.release(),
      });
      return handle;
    }
    function update(dt) {
      for (const [id, s] of [...live]) {
        if (s.entity.destroyed) {
          s.release();
          continue;
        }
        s.group.speedRatio = s.speed;
        if (s.fade) {
          s.elapsed += dt;
          const w = Math.min(1, s.elapsed / s.fade);
          s.group.setWeightForAllAnimatables(w);
          s.oldGroup?.setWeightForAllAnimatables(1 - w);
          if (w === 1) {
            s.oldGroup?.stop();
            s.oldGroup = null;
            s.fade = 0;
          }
        }
        if (!s.group.isStarted) s.release(false);
      }
    }
    return {
      forOwner: (owner) =>
        Object.freeze({
          ...advanced?.api(owner),
          list: (e) => groups(e).map((g) => g.name),
          play: (e, n, p) => play(e, n, p, owner),
          stop: (e) => {
            groups(e);
            live.get(e.id)?.release();
            advanced?.remove(e.id);
          },
        }),
      attach(nodes) {
        advanced?.attach(nodes);
        for (const n of nodes) {
          if (n.animation?.autoplay && !n.animation.controllerId) {
            const e = options.find(n.id);
            if (e)
              try {
                play(e, n.animation.clip, n.animation);
              } catch (error) {
                options.onError?.({ hook: "animation", entityId: n.id, error });
              }
          }
        }
      },
      update,
      fixedUpdate: (dt) => advanced?.update(dt),
      remove: (id) => {
        live.get(id)?.release();
        advanced?.removeEntity(id);
      },
      stats: () => ({ animationPlayers: live.size, ...advanced?.stats() }),
      dispose() {
        for (const s of [...live.values()]) s.release();
        advanced?.dispose();
        disposed = true;
      },
    };
  }
  root.ArkGlideAnimation = { createAnimation };
})(globalThis);
