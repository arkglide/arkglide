import test from "node:test";
import assert from "node:assert/strict";
import "../src/engine/audio-stretch.js";
import "../src/engine/audio-runtime.js";
import "../src/engine/lifecycle-runtime.js";
test("WSOLA preserves a 440 Hz PCM tone at 0.5/1/2x with bounded duration and finite stereo output", () => {
  const sr = 44100,
    pcm = Float32Array.from(
      { length: sr * 2 },
      (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr),
    );
  for (const rate of [0.5, 1, 2]) {
    const dsp = new ArkGlideStretch.StretchDSP([pcm, pcm.slice()], rate),
      left = [],
      right = [];
    let active = true;
    while (active && left.length < sr * 6) {
      const outputs = [new Float32Array(128), new Float32Array(128)];
      active = dsp.process(outputs);
      left.push(...outputs[0]);
      right.push(...outputs[1]);
    }
    assert.ok(
      Math.abs(left.length / sr - 2 / rate) < 0.1,
      `rate ${rate} duration ${left.length / sr}`,
    );
    const first = Math.floor(sr * 0.2),
      end = Math.min(left.length - first, Math.floor(sr * 0.8));
    let crossings = 0;
    for (let i = first + 1; i < end; i++)
      if (left[i - 1] <= 0 && left[i] > 0) crossings++;
    const hz = (crossings * sr) / (end - first);
    assert.ok(Math.abs(hz - 440) < 4.4, `rate ${rate}: ${hz} Hz`);
    assert.ok(left.every(Number.isFinite));
    assert.deepEqual(left, right);
  }
});
class Param {
  constructor(value = 0) {
    this.value = value;
  }
}
class Node {
  constructor() {
    this.gain = new Param(1);
    this.playbackRate = new Param(1);
    this.positionX = new Param();
    this.positionY = new Param();
    this.positionZ = new Param();
    this.connections = [];
    this.onended = null;
  }
  connect(n) {
    this.connections.push(n);
  }
  disconnect() {
    this.connections = [];
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}
class Context {
  constructor() {
    this.state = "suspended";
    this.destination = new Node();
    this.listener = new Node();
    this.sampleRate = 44100;
    this.nodes = [];
    Context.last = this;
  }
  createGain() {
    const n = new Node();
    this.nodes.push(n);
    return n;
  }
  createBufferSource() {
    const n = new Node();
    this.nodes.push(n);
    return n;
  }
  createPanner() {
    return this.createGain();
  }
  createMediaElementSource(media) {
    const n = new Node();
    n.media = media;
    this.nodes.push(n);
    return n;
  }
  async decodeAudioData() {
    return { duration: 1 };
  }
  async resume() {
    this.state = "running";
  }
  async suspend() {
    this.state = "suspended";
  }
  async close() {
    this.state = "closed";
  }
}
const mixer = () => ({
  buses: [
    { id: "Master", name: "Master", parentId: null, volume: 1, mute: false },
    ...["Music", "SFX", "UI"].map((id) => ({
      id,
      name: id,
      parentId: "Master",
      volume: 1,
      mute: false,
    })),
  ],
  snapshots: [
    {
      id: "pause",
      name: "Pause",
      buses: {
        Music: { volume: 0.2, mute: false },
        UI: { volume: 1, mute: false },
      },
    },
  ],
  ducking: [
    {
      sourceBus: "SFX",
      targetBus: "Music",
      amount: 0.4,
      attack: 0.1,
      release: 0.2,
    },
  ],
  maxVoices: 2,
});
test("bus routing, fades, deterministic voice stealing, snapshots and ducking clean up on owner release", async () => {
  const session = ArkGlideLifecycle.createSession(),
    owner = session.owner(null, "audio-test"),
    audio = ArkGlideAudio.createAudio({
      AudioContext: Context,
      config: mixer(),
    });
  await audio.load([{ id: "tone" }], { tone: new ArrayBuffer(4) });
  const api = audio.forOwner(owner);
  try {
    await api.unlock();
    const first = api.play("tone", { bus: "Music", priority: 1 }),
      second = api.play("tone", { bus: "SFX", priority: 2 });
    audio.update(0.1);
    assert.equal(api.buses().find((b) => b.id === "Music").duck, 0.4);
    const third = api.play("tone", { bus: "UI", priority: 3 });
    assert.equal(first.playing, false);
    assert.equal(second.playing, true);
    assert.equal(third.playing, true);
    assert.equal(api.play("tone", { priority: 0 }).reason, "priority-limit");
    assert.equal(audio.stats().audioVoices, 2);
    third.fadeTo(0, 0.2, true);
    audio.update(0.1);
    assert.equal(third.playing, true);
    audio.update(0.1);
    assert.equal(third.playing, false);
    const snapshot = api.applySnapshot("pause", 0.2);
    audio.update(0.1);
    assert.ok(
      Math.abs(api.buses().find((b) => b.id === "Music").volume - 0.6) < 1e-6,
    );
    audio.update(0.1);
    assert.equal(snapshot.transitioning, false);
    assert.equal(api.buses().find((b) => b.id === "Music").volume, 0.2);
    owner.abort();
    assert.equal(audio.stats().audioTransitions, 0);
    assert.equal(audio.stats().audioVoices, 0);
  } finally {
    audio.dispose();
    session.stop();
  }
  assert.equal(audio.stats().audioBuses, 0);
  assert.ok(Context.last.nodes.every((n) => n.connections.length === 0));
});
test("streaming skips decode and retains media position through pause/resume; stop revokes URLs", async () => {
  let decodes = 0;
  class StreamContext extends Context {
    async decodeAudioData() {
      decodes++;
      return {};
    }
  }
  const elements = [];
  const audio = ArkGlideAudio.createAudio({
    AudioContext: StreamContext,
    config: mixer(),
    createMediaElement() {
      const media = {
        preservesPitch: true,
        currentTime: 0,
        duration: 300,
        async play() {
          this.paused = false;
        },
        pause() {
          this.paused = true;
        },
        removeAttribute() {
          this.src = "";
        },
        load() {},
      };
      elements.push(media);
      return media;
    },
  });
  await audio.load(
    [{ id: "music", name: "Long music", mime: "audio/wav", stream: true }],
    { music: new ArrayBuffer(4) },
  );
  assert.equal(decodes, 0);
  const session = ArkGlideLifecycle.createSession(),
    owner = session.owner(null, "stream-test"),
    api = audio.forOwner(owner);
  await api.unlock();
  const voice = api.play("music", { bus: "Music", rate: 0.5 });
  voice.seek(30);
  assert.equal(voice.position, 30);
  assert.equal(elements[0].preservesPitch, true);
  audio.setPaused(true);
  assert.equal(elements[0].paused, true);
  audio.setPaused(false);
  await Promise.resolve();
  assert.equal(voice.position, 30);
  voice.stop();
  assert.equal(audio.stats().audioStreams, 0);
  assert.equal(audio.stats().audioBlobURLs, 0);
  audio.dispose();
  session.stop();
});
