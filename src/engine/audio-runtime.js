(function (root) {
  "use strict";
  function createAudio(options) {
    const Context =
      options.AudioContext || root.AudioContext || root.webkitAudioContext;
    const context = Context ? new Context() : null,
      buffers = new Map(),
      voices = new Set(),
      sources = new Map();
    let disposed = false,
      paused = false,
      scale = 1,
      unlocked = false;
    const master = context?.createGain();
    master?.connect(context.destination);
    async function load(assets, data) {
      if (!context) {
        if (assets.length)
          options.onError?.({
            hook: "audio",
            error: new Error("浏览器不支持Web Audio"),
          });
        return;
      }
      await Promise.all(
        assets.map(async (a) => {
          const b = data[a.id];
          if (!b) {
            options.onError?.({
              hook: "audio",
              entityId: a.id,
              error: new Error("音频资源缺失: " + a.name),
            });
            return;
          }
          try {
            const decoded = await context.decodeAudioData(b.slice(0));
            if (!disposed) buffers.set(a.id, decoded);
          } catch (error) {
            if (!disposed)
              options.onError?.({
                hook: "audio.decode",
                entityId: a.id,
                error,
              });
          }
        }),
      );
    }
    async function unlock() {
      if (disposed || !context) throw new Error("Audio unavailable");
      unlocked = true;
      if (!paused && scale > 0) await context.resume();
      return context.state === "running";
    }
    function transport() {
      if (!context || disposed) return;
      for (const v of voices)
        v.source.playbackRate.value = v.rate * Math.max(0.001, scale);
      if (paused || scale === 0) context.suspend().catch(() => {});
      else if (unlocked) context.resume().catch(() => {});
    }
    function play(id, params = {}, owner) {
      if (disposed || (owner && !owner.record.active))
        throw new Error("Audio session stopped");
      if (!context || !buffers.has(id))
        throw new Error("音频未解码或不存在: " + id);
      const volume = params.volume ?? 1,
        rate = params.rate ?? 1;
      if (
        !Number.isFinite(volume) ||
        volume < 0 ||
        volume > 1 ||
        !Number.isFinite(rate) ||
        rate <= 0 ||
        rate > 16
      )
        throw new Error("音量/播放速率无效");
      const entity = params.entity;
      if (entity && (entity.destroyed || options.find(entity.id) !== entity))
        throw new Error("空间音频实体不存在");
      const ref = params.refDistance ?? 1;
      if (params.spatial) {
        if (!entity) throw new Error("空间音频需要entity");
        if (!Number.isFinite(ref) || ref <= 0)
          throw new Error("refDistance无效");
      }
      const source = context.createBufferSource(),
        gain = context.createGain();
      source.buffer = buffers.get(id);
      source.loop = !!params.loop;
      source.playbackRate.value = rate * Math.max(0.001, scale);
      gain.gain.value = volume;
      source.connect(gain);
      const panner = params.spatial ? context.createPanner() : null;
      if (panner) {
        panner.panningModel = "HRTF";
        panner.distanceModel = "inverse";
        panner.refDistance = ref;
        gain.connect(panner);
        panner.connect(master);
      } else gain.connect(master);
      let live = true,
        untrack;
      const voice = { source, gain, panner, entity, rate, stop: null };
      function finish() {
        if (!live) return;
        live = false;
        voices.delete(voice);
        source.onended = null;
        try {
          source.stop();
        } catch {}
        source.disconnect();
        gain.disconnect();
        panner?.disconnect();
        untrack?.();
      }
      voice.stop = finish;
      const handle = Object.freeze({
        get playing() {
          return live;
        },
        stop: finish,
        setVolume(v) {
          if (!live) throw new Error("Audio voice ended");
          if (!Number.isFinite(v) || v < 0 || v > 1)
            throw new Error("音量范围0..1");
          gain.gain.value = v;
        },
      });
      voices.add(voice);
      source.onended = finish;
      if (owner) untrack = owner.track(finish);
      if (live) source.start();
      update();
      return handle;
    }
    function setVector(node, p) {
      if (node.positionX) {
        node.positionX.value = p.x;
        node.positionY.value = p.y;
        node.positionZ.value = p.z;
      } else node.setPosition(p.x, p.y, p.z);
    }
    function update() {
      if (disposed || !context) return;
      for (const v of [...voices]) {
        if (v.entity?.destroyed) {
          v.stop();
          continue;
        }
        if (v.panner) setVector(v.panner, v.entity.getWorldPosition());
      }
      const camera = options.camera?.();
      if (camera) {
        setVector(context.listener, camera.globalPosition || camera.position);
        const forward = camera.getForwardRay?.().direction,
          up = camera.upVector;
        if (forward && up) {
          const l = context.listener;
          if (l.forwardX) {
            l.forwardX.value = forward.x;
            l.forwardY.value = forward.y;
            l.forwardZ.value = forward.z;
            l.upX.value = up.x;
            l.upY.value = up.y;
            l.upZ.value = up.z;
          } else
            l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
        }
      }
    }
    function attach(nodes) {
      for (const n of nodes) {
        const c = n.audioSource;
        if (!c || !c.autoplay || sources.has(n.id) || !buffers.has(c.assetId))
          continue;
        const e = options.find(n.id);
        if (e) sources.set(n.id, play(c.assetId, { ...c, entity: e }));
      }
    }
    const api = (owner) =>
      Object.freeze({
        list: () => [...buffers.keys()],
        unlock,
        play: (id, p) => play(id, p, owner),
        setMasterVolume(v) {
          if (!Number.isFinite(v) || v < 0 || v > 1)
            throw new Error("音量范围0..1");
          if (master) master.gain.value = v;
        },
        get state() {
          return context?.state || "unavailable";
        },
      });
    return {
      load,
      unlock,
      forOwner: api,
      attach,
      remove(id) {
        sources.get(id)?.stop();
        sources.delete(id);
        for (const v of [...voices]) if (v.entity?.id === id) v.stop();
      },
      update,
      setPaused(v) {
        paused = v;
        transport();
      },
      setScale(v) {
        if (scale !== v) {
          scale = v;
          transport();
        }
      },
      stats: () => ({
        audioVoices: voices.size,
        audioBuffers: buffers.size,
        audioState: context?.state || "unavailable",
      }),
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const v of [...voices]) v.stop();
        sources.clear();
        buffers.clear();
        master?.disconnect();
        if (context && context.state !== "closed")
          context.close().catch(() => {});
      },
    };
  }
  root.ArkGlideAudio = { createAudio };
})(globalThis);
