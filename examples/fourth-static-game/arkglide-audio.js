(function (root) {
  "use strict";
  function createAudio(options) {
    const Context =
        options.AudioContext || root.AudioContext || root.webkitAudioContext,
      context = Context ? new Context() : null;
    const buffers = new Map(),
      assets = new Map(),
      data = new Map(),
      voices = new Set(),
      sources = new Map(),
      buses = new Map();
    const config = options.config || {
      buses: [
        { id: "Master", parentId: null, volume: 1, mute: false },
        ...["Music", "SFX", "UI"].map((id) => ({
          id,
          parentId: "Master",
          volume: 1,
          mute: false,
        })),
      ],
      snapshots: [],
      ducking: [],
      maxVoices: 32,
    };
    let disposed = false,
      paused = false,
      scale = 1,
      unlocked = false,
      sequence = 0,
      stretchReady = false,
      stretchURL = null,
      snapshot = null,
      stretchPromise = null;
    for (const b of config.buses) {
      const gain = context?.createGain();
      buses.set(b.id, { ...b, gain, current: b.volume, duck: 1 });
    }
    for (const bus of buses.values())
      bus.gain?.connect(
        bus.parentId ? buses.get(bus.parentId).gain : context.destination,
      );
    function finite(value, min = 0, max = 1) {
      if (!Number.isFinite(value) || value < min || value > max)
        throw Error("音频参数范围 " + min + ".." + max);
      return value;
    }
    function requireBus(id = "SFX") {
      const bus = buses.get(id);
      if (!bus || disposed) throw Error("音频总线不存在或会话已停止: " + id);
      return bus;
    }
    function isUI(id) {
      for (let i = 0; i < 32 && id; i++) {
        if (id === "UI") return true;
        id = buses.get(id)?.parentId;
      }
      return false;
    }
    function ancestry(id, target) {
      for (let i = 0; i < 32 && id; i++) {
        if (id === target) return true;
        id = buses.get(id)?.parentId;
      }
      return false;
    }
    function prepareStretch() {
      return (stretchPromise ??= (async () => {
        if (
          !context?.audioWorklet ||
          !root.ArkGlideStretch ||
          !root.AudioWorkletNode
        )
          return;
        stretchURL = URL.createObjectURL(
          new Blob([root.ArkGlideStretch.workletSource], {
            type: "text/javascript",
          }),
        );
        try {
          await context.audioWorklet.addModule(stretchURL);
          if (!disposed) stretchReady = true;
        } catch (error) {
          if (!disposed) options.onError?.({ hook: "audio.worklet", error });
        } finally {
          if (stretchURL) URL.revokeObjectURL(stretchURL);
          stretchURL = null;
        }
      })());
    }
    async function load(list, bytes) {
      if (!context) {
        if (list.length)
          options.onError?.({
            hook: "audio",
            error: Error("浏览器不支持 Web Audio"),
          });
        return;
      }
      const stretch = prepareStretch();
      await Promise.all(
        list.map(async (a) => {
          const raw = bytes[a.id];
          if (!raw) {
            options.onError?.({
              hook: "audio",
              entityId: a.id,
              error: Error("音频资源缺失: " + a.name),
            });
            return;
          }
          if (!disposed) {
            assets.set(a.id, a);
            data.set(a.id, raw);
          }
          if (a.stream) return;
          try {
            const decoded = await context.decodeAudioData(raw.slice(0));
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
      await stretch;
    }
    function mediaPlay(voice) {
      if (!voice.live) return;
      voice.media
        .play()
        .then(() => {
          if (!voice.live) voice.media.pause();
        })
        .catch((error) => {
          if (voice.live && unlocked)
            options.onError?.({ hook: "audio.stream", error });
        });
    }
    function transport() {
      if (!context || disposed) return;
      const uiActive = [...voices].some((v) => v.live && isUI(v.bus));
      for (const voice of [...voices]) {
        const frozen =
            voice.localPaused || (!isUI(voice.bus) && (paused || scale === 0)),
          rate = voice.rate * (isUI(voice.bus) ? 1 : Math.max(0.001, scale));
        if (voice.stretch) {
          if (!frozen && (rate < 0.5 || rate > 2)) {
            voice.stop();
            options.onError?.({
              hook: "audio.rate",
              error: Error("音高保持的缓冲音效仅支持有效倍率 0.5..2"),
            });
            continue;
          }
          voice.source.port.postMessage({ type: "pause", value: frozen });
          if (!frozen) voice.source.port.postMessage({ type: "rate", rate });
        } else if (voice.media) {
          if (!frozen && (rate < 0.0625 || rate > 16)) {
            voice.stop();
            options.onError?.({
              hook: "audio.rate",
              error: Error("流式播放有效倍率必须在 0.0625..16"),
            });
            continue;
          }
          voice.media.playbackRate = Math.min(16, Math.max(0.0625, rate));
          if (frozen) voice.media.pause();
          else if (unlocked) mediaPlay(voice);
        } else voice.source.playbackRate.value = frozen ? 0 : rate;
      }
      if ((paused || scale === 0) && !uiActive)
        context.suspend().catch(() => {});
      else if (unlocked) context.resume().catch(() => {});
    }
    async function unlock() {
      if (disposed || !context) throw Error("Audio unavailable");
      unlocked = true;
      transport();
      if (!(paused || scale === 0) || [...voices].some((v) => isUI(v.bus)))
        await context.resume();
      for (const v of voices)
        if (v.media && !(!isUI(v.bus) && (paused || scale === 0))) mediaPlay(v);
      return context.state === "running";
    }
    function expired(reason) {
      return Object.freeze({
        playing: false,
        reason,
        stop() {},
        setVolume() {},
        fadeTo() {},
        setRate() {},
        pause() {},
        resume() {},
        seek() {},
        position: 0,
        duration: 0,
      });
    }
    function play(id, params = {}, owner) {
      if (disposed || (owner && !owner.record.active))
        throw Error("Audio session stopped");
      if (!context || !assets.has(id)) throw Error("音频不存在: " + id);
      const volume = finite(params.volume ?? 1),
        rate = finite(params.rate ?? 1, 0.001, 16),
        priority = finite(params.priority ?? 0, -1000, 1000),
        bus = requireBus(params.bus || "SFX"),
        entity = params.entity,
        stream = params.stream ?? assets.get(id).stream ?? false;
      const preservePitch = params.preservePitch ?? stream;
      if (entity && (entity.destroyed || options.find(entity.id) !== entity))
        throw Error("空间音频实体不存在");
      if (params.spatial) {
        if (!entity) throw Error("空间音频需要entity");
        const refDistance = params.refDistance ?? 1;
        if (!Number.isFinite(refDistance) || refDistance <= 0)
          throw Error("refDistance无效");
      }
      if (!stream && !buffers.has(id))
        throw Error("音频未解码，请使用流式播放: " + id);
      if (!stream && preservePitch && (!stretchReady || rate < 0.5 || rate > 2))
        throw Error(
          "浏览器时间拉伸不可用或倍率超出 0.5..2；不会退化为变调播放",
        );
      const maximum = config.maxVoices ?? 32;
      if (voices.size >= maximum) {
        const candidate = [...voices].sort(
          (a, b) => a.priority - b.priority || a.sequence - b.sequence,
        )[0];
        if (candidate.priority > priority) return expired("priority-limit");
      }
      const gain = context.createGain(),
        panner = params.spatial ? context.createPanner() : null;
      gain.gain.value = volume;
      let source, media, url;
      try {
        if (stream) {
          media =
            options.createMediaElement?.() ||
            root.document?.createElement("audio");
          if (!media) throw Error("浏览器不支持媒体流");
          if (preservePitch && !("preservesPitch" in media))
            throw Error("浏览器不支持流式变速不变调");
          if ("preservesPitch" in media) media.preservesPitch = preservePitch;
          url = URL.createObjectURL(
            new Blob([data.get(id)], {
              type: assets.get(id).mime || "audio/wav",
            }),
          );
          media.preload = "metadata";
          media.src = url;
          media.loop = !!params.loop;
          source = context.createMediaElementSource(media);
        } else if (preservePitch) {
          const pcm = buffers.get(id),
            channels = Array.from({ length: pcm.numberOfChannels }, (_, i) =>
              pcm.getChannelData(i).slice(),
            );
          source = new root.AudioWorkletNode(context, "arkglide-stretch", {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [pcm.numberOfChannels],
          });
          source.port.postMessage(
            { type: "load", channels, rate, loop: !!params.loop },
            channels.map((c) => c.buffer),
          );
        } else {
          source = context.createBufferSource();
          source.buffer = buffers.get(id);
          source.loop = !!params.loop;
          source.playbackRate.value = rate;
        }
        source.connect(gain);
        if (panner) {
          panner.panningModel = "HRTF";
          panner.distanceModel = "inverse";
          panner.refDistance = params.refDistance ?? 1;
          gain.connect(panner);
          panner.connect(bus.gain);
        } else gain.connect(bus.gain);
      } catch (error) {
        source?.disconnect();
        gain.disconnect();
        panner?.disconnect();
        if (media) {
          media.pause();
          media.removeAttribute("src");
          media.load();
        }
        if (url) URL.revokeObjectURL(url);
        throw error;
      }
      if (voices.size >= maximum)
        [...voices]
          .sort((a, b) => a.priority - b.priority || a.sequence - b.sequence)[0]
          .stop();
      let untrack;
      const voice = {
        source,
        gain,
        panner,
        media,
        url,
        entity,
        volume,
        rate,
        priority,
        bus: bus.id,
        sequence: sequence++,
        live: true,
        stretch: !stream && preservePitch,
        progress: 0,
        localPaused: false,
        ramp: null,
        stop: null,
      };
      function finish() {
        if (!voice.live) return;
        voice.live = false;
        voices.delete(voice);
        if (media) {
          media.onended = media.onerror = null;
          media.pause();
          media.removeAttribute("src");
          media.load();
          URL.revokeObjectURL(url);
        } else if (voice.stretch) {
          source.port.postMessage({ type: "stop" });
          source.port.onmessage = null;
          source.port.close();
        } else {
          source.onended = null;
          try {
            source.stop();
          } catch {}
        }
        source.disconnect();
        gain.disconnect();
        panner?.disconnect();
        voice.ramp = null;
        untrack?.();
        if (!disposed) transport();
      }
      voice.stop = finish;
      voices.add(voice);
      if (media) {
        media.onended = finish;
        media.onerror = () => {
          options.onError?.({
            hook: "audio.stream",
            error: Error("浏览器无法解码流式媒体: " + assets.get(id)?.name),
          });
          finish();
        };
      } else if (voice.stretch)
        source.port.onmessage = (e) => {
          if (e.data.type === "ended") finish();
          if (e.data.type === "progress")
            voice.progress = e.data.samples / context.sampleRate;
          if (e.data.type === "error") {
            options.onError?.({
              hook: "audio.worklet",
              error: Error(e.data.message),
            });
            finish();
          }
        };
      else source.onended = finish;
      if (owner) untrack = owner.track(finish);
      if (voice.live && !media && !voice.stretch) source.start();
      const valid = () => {
        if (!voice.live) throw Error("Audio voice ended");
      };
      const handle = Object.freeze({
        get playing() {
          return voice.live;
        },
        get position() {
          return media?.currentTime ?? voice.progress;
        },
        get duration() {
          const n = media?.duration ?? buffers.get(id)?.duration;
          return Number.isFinite(n) ? n : null;
        },
        stop: finish,
        setVolume(value) {
          valid();
          voice.volume = finite(value);
          voice.ramp = null;
          gain.gain.value = voice.volume;
        },
        fadeTo(value, seconds = 0, stopAfter = false) {
          valid();
          finite(value);
          finite(seconds, 0, 60);
          voice.ramp = {
            from: voice.volume,
            to: value,
            elapsed: 0,
            duration: seconds,
            stopAfter,
          };
          if (!seconds) {
            voice.volume = value;
            gain.gain.value = value;
            voice.ramp = null;
            if (stopAfter) finish();
          }
        },
        setRate(value) {
          valid();
          finite(value, 0.001, 16);
          if (voice.stretch && (value < 0.5 || value > 2))
            throw Error("缓冲时间拉伸倍率必须在 0.5..2");
          voice.rate = value;
          transport();
        },
        pause() {
          valid();
          voice.localPaused = true;
          if (media) media.pause();
          else if (voice.stretch)
            source.port.postMessage({ type: "pause", value: true });
          else source.playbackRate.value = 0;
        },
        resume() {
          valid();
          voice.localPaused = false;
          transport();
        },
        seek(value) {
          valid();
          if (!media) throw Error("进度跳转仅支持流式音乐");
          finite(
            value,
            0,
            Number.isFinite(media.duration) ? media.duration : 1e6,
          );
          media.currentTime = value;
        },
      });
      transport();
      update(0);
      return handle;
    }
    function setVector(node, p) {
      if (node.positionX) {
        node.positionX.value = p.x;
        node.positionY.value = p.y;
        node.positionZ.value = p.z;
      } else node.setPosition(p.x, p.y, p.z);
    }
    function update(dt = 0, realDt = dt) {
      if (disposed || !context) return;
      if (snapshot?.ramp) {
        const r = snapshot.ramp;
        r.time = Math.min(r.duration, r.time + realDt);
        const t = r.duration ? r.time / r.duration : 1;
        for (const [id, end] of Object.entries(r.target)) {
          const bus = buses.get(id);
          bus.volume =
            t === 1
              ? end.volume
              : r.start[id].volume + (end.volume - r.start[id].volume) * t;
          bus.mute = t === 1 ? end.mute : false;
          bus.current =
            (r.start[id].mute ? 0 : r.start[id].volume) +
            ((end.mute ? 0 : end.volume) -
              (r.start[id].mute ? 0 : r.start[id].volume)) *
              t;
        }
        if (t === 1) snapshot.ramp = null;
      }
      for (const bus of buses.values()) {
        let target = 1,
          seconds = 0.01;
        for (const rule of config.ducking || [])
          if (ancestry(bus.id, rule.targetBus)) {
            const busy = [...voices].some(
              (v) =>
                ancestry(v.bus, rule.sourceBus) && v.live && !v.localPaused,
            );
            if (busy) {
              target = Math.min(target, rule.amount);
              seconds = Math.max(seconds, rule.attack);
            } else seconds = Math.max(seconds, rule.release);
          }
        const t = seconds ? Math.min(1, realDt / seconds) : 1;
        bus.duck += (target - bus.duck) * t;
        if (!snapshot?.ramp) bus.current = bus.mute ? 0 : bus.volume;
        bus.gain.gain.value = bus.current * bus.duck;
      }
      for (const voice of [...voices]) {
        if (voice.entity?.destroyed) {
          voice.stop();
          continue;
        }
        if (voice.ramp) {
          const r = voice.ramp;
          r.elapsed += isUI(voice.bus) ? realDt : dt;
          const t = r.duration ? Math.min(1, r.elapsed / r.duration) : 1;
          voice.volume = r.from + (r.to - r.from) * t;
          voice.gain.gain.value = voice.volume;
          if (t === 1) {
            voice.ramp = null;
            if (r.stopAfter) {
              voice.stop();
              continue;
            }
          }
        }
        if (voice.panner)
          setVector(voice.panner, voice.entity.getWorldPosition());
      }
      const camera = options.camera?.();
      if (camera) {
        setVector(context.listener, camera.globalPosition || camera.position);
        const forward = camera.getForwardRay?.().direction,
          up = camera.upVector;
        if (forward && up) {
          const l = context.listener;
          if (l.forwardX) {
            for (const [prefix, p] of [
              ["forward", forward],
              ["up", up],
            ]) {
              l[prefix + "X"].value = p.x;
              l[prefix + "Y"].value = p.y;
              l[prefix + "Z"].value = p.z;
            }
          } else
            l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
        }
      }
    }
    function applySnapshot(id, seconds = 0, owner) {
      const s = (config.snapshots || []).find((s) => s.id === id);
      if (!s) throw Error("混音快照不存在: " + id);
      finite(seconds, 0, 60);
      snapshot?.release(false);
      const start = Object.fromEntries(
          [...buses].map(([id, b]) => [id, { volume: b.volume, mute: b.mute }]),
        ),
        token = {
          ramp: {
            start,
            target: structuredClone(s.buses),
            duration: seconds,
            time: 0,
          },
          release: null,
        };
      let untrack;
      function release(restore = true) {
        if (snapshot !== token) return;
        snapshot = null;
        token.ramp = null;
        if (restore)
          for (const [id, b] of Object.entries(start)) {
            Object.assign(buses.get(id), b);
          }
        untrack?.();
        update(0);
      }
      token.release = release;
      snapshot = token;
      if (owner) untrack = owner.track(release);
      update(0);
      return Object.freeze({
        release: () => release(),
        get transitioning() {
          return snapshot === token && !!token.ramp;
        },
      });
    }
    const api = (owner) => {
      const guard = () => {
        if (disposed || (owner && !owner.record.active))
          throw Error("音频脚本已销毁");
      };
      return Object.freeze({
        list: () => [...assets.keys()],
        unlock: () => {
          guard();
          return unlock();
        },
        play: (id, params) => play(id, params, owner),
        setMasterVolume(value) {
          guard();
          const bus = requireBus("Master");
          bus.volume = finite(value);
          bus.mute = false;
          update(0);
        },
        setBusVolume(id, value) {
          guard();
          requireBus(id).volume = finite(value);
          update(0);
        },
        setBusMuted(id, value) {
          guard();
          requireBus(id).mute = !!value;
          update(0);
        },
        buses: () =>
          [...buses.values()].map((b) => ({
            id: b.id,
            name: b.name,
            parentId: b.parentId,
            volume: b.volume,
            mute: b.mute,
            duck: b.duck,
          })),
        applySnapshot: (id, seconds) => {
          guard();
          return applySnapshot(id, seconds, owner);
        },
        get state() {
          return context?.state || "unavailable";
        },
      });
    };
    return {
      load,
      unlock,
      forOwner: api,
      attach(nodes) {
        for (const n of nodes) {
          const c = n.audioSource;
          if (!c || !c.autoplay || sources.has(n.id) || !assets.has(c.assetId))
            continue;
          const e = options.find(n.id);
          if (e)
            try {
              sources.set(n.id, play(c.assetId, { ...c, entity: e }));
            } catch (error) {
              options.onError?.({
                hook: "audio.attach",
                entityId: n.id,
                error,
              });
            }
        }
      },
      remove(id) {
        sources.get(id)?.stop();
        sources.delete(id);
        for (const v of [...voices]) if (v.entity?.id === id) v.stop();
      },
      update,
      setPaused(value) {
        paused = !!value;
        transport();
      },
      setScale(value) {
        finite(value, 0, 100);
        if (value !== scale) {
          scale = value;
          transport();
        }
      },
      stats: () => ({
        audioVoices: voices.size,
        audioBuffers: buffers.size,
        audioState: context?.state || "unavailable",
        audioBuses: buses.size,
        audioStreams: [...voices].filter((v) => v.media).length,
        audioWorklets: [...voices].filter((v) => v.stretch).length,
        audioTransitions:
          (snapshot?.ramp ? 1 : 0) + [...voices].filter((v) => v.ramp).length,
        audioBlobURLs:
          [...voices].filter((v) => v.url).length + (stretchURL ? 1 : 0),
      }),
      dispose() {
        if (disposed) return;
        snapshot?.release(false);
        for (const v of [...voices]) v.stop();
        sources.clear();
        buffers.clear();
        assets.clear();
        data.clear();
        for (const b of buses.values()) b.gain?.disconnect();
        buses.clear();
        if (stretchURL) {
          URL.revokeObjectURL(stretchURL);
          stretchURL = null;
        }
        disposed = true;
        if (context && context.state !== "closed")
          context.close().catch(() => {});
      },
    };
  }
  root.ArkGlideAudio = { createAudio };
})(globalThis);
