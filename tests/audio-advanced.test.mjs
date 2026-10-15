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
    this.wasDisconnected = true;
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
    this.currentTime = 0;
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
test('buffer source start failures release voice nodes and owner cleanup',async()=>{
 class FailingContext extends Context {
  createBufferSource(){const n=super.createBufferSource();n.start=()=>{throw Error('source start failed');};return n;}
 }
 const session=ArkGlideLifecycle.createSession(),owner=session.owner(null,'audio.js');owner.attach({});
 const audio=ArkGlideAudio.createAudio({AudioContext:FailingContext,config:mixer()});
 try {
  await audio.load([{id:'tone',name:'tone.wav',mime:'audio/wav'}],{tone:new ArrayBuffer(4)});
  const cleanups=owner.record.cleanup.size;
  assert.throws(()=>audio.forOwner(owner).play('tone'),/source start failed/);
  assert.equal(audio.stats().audioVoices,0);assert.equal(owner.record.cleanup.size,cleanups);
  assert.ok(Context.last.nodes.slice(mixer().buses.length).every(n=>n.connections.length===0));
 } finally {audio.dispose();session.stop();}
});
test('a failed replacement voice preserves existing playback at the voice limit',async()=>{
 const audio=ArkGlideAudio.createAudio({AudioContext:Context,config:mixer()});
 try {
  await audio.load([{id:'tone'}],{tone:new ArrayBuffer(4)});
  const api=audio.forOwner(),first=api.play('tone'),second=api.play('tone');
  const context=Context.last,create=context.createBufferSource.bind(context);
  context.createBufferSource=()=>{const node=create();node.start=()=>{throw Error('start failed');};return node;};
  assert.throws(()=>api.play('tone'),/start failed/);
  assert.equal(first.playing,true);assert.equal(second.playing,true);assert.equal(audio.stats().audioVoices,2);
 } finally {audio.dispose();}
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

test('loading after audio disposal performs no decoding or resource diagnostics',async()=>{
 let decodes=0,errors=0;
 class CountingContext extends Context {async decodeAudioData(){decodes++;return {duration:1};}}
 const audio=ArkGlideAudio.createAudio({AudioContext:CountingContext,config:mixer(),onError:()=>errors++});
 audio.dispose();await audio.load([{id:'tone'},{id:'missing'}],{tone:new ArrayBuffer(4)});
 assert.equal(decodes,0);assert.equal(errors,0);assert.equal(audio.stats().audioBuffers,0);
});

test('late audio decoding cannot replace the latest version of an asset',async()=>{
 const pending=[];
 class DelayedContext extends Context {decodeAudioData(){return new Promise(resolve=>pending.push(resolve));}}
 const audio=ArkGlideAudio.createAudio({AudioContext:DelayedContext,config:mixer()});
 try {
  const first=audio.load([{id:'tone'}],{tone:new ArrayBuffer(4)});
  const second=audio.load([{id:'tone'}],{tone:new ArrayBuffer(8)});
  pending[1]({duration:2});await second;pending[0]({duration:1});await first;
  assert.equal(audio.forOwner().play('tone').duration,2);
 } finally {audio.dispose();}
});

test('failed audio replacement does not reuse decoded bytes from the previous asset version',async()=>{
 let fail=false;
 class ReplacementContext extends Context {async decodeAudioData(){if(fail)throw Error('decode failed');return {duration:1};}}
 const audio=ArkGlideAudio.createAudio({AudioContext:ReplacementContext,config:mixer()});
 try {
  await audio.load([{id:'tone'}],{tone:new ArrayBuffer(4)});fail=true;
  await audio.load([{id:'tone'}],{tone:new ArrayBuffer(8)});
  assert.throws(()=>audio.forOwner().play('tone'),/未解码/);assert.equal(audio.stats().audioBuffers,0);
 } finally {audio.dispose();}
});

test('playing buffer voices retain their original duration after asset replacement',async()=>{
 let duration=1;
 class VersionContext extends Context {async decodeAudioData(){return {duration};}}
 const audio=ArkGlideAudio.createAudio({AudioContext:VersionContext,config:mixer()});
 try {
  await audio.load([{id:'tone'}],{tone:new ArrayBuffer(4)});const old=audio.forOwner().play('tone');
  duration=2;await audio.load([{id:'tone'}],{tone:new ArrayBuffer(8)});
  const latest=audio.forOwner().play('tone');
  assert.equal(old.duration,1);assert.equal(latest.duration,2);
 } finally {audio.dispose();}
});

test('spatial audio allocation failure releases its partially created voice gain',async()=>{
 let gain;
 class AllocationContext extends Context {
  createGain(){gain=super.createGain();return gain;}
  createPanner(){throw Error('panner allocation failed');}
 }
 const entity={id:'speaker'},audio=ArkGlideAudio.createAudio({AudioContext:AllocationContext,config:mixer(),find:()=>entity});
 try {
  await audio.load([{id:'tone'}],{tone:new ArrayBuffer(4)});
  assert.throws(()=>audio.forOwner().play('tone',{spatial:true,entity}),/panner allocation failed/);
  assert.equal(gain.wasDisconnected,true);assert.equal(audio.stats().audioVoices,0);
 } finally {audio.dispose();}
});

test('buffer voice position advances at playback rate and freezes while locally paused',async()=>{
 const audio=ArkGlideAudio.createAudio({AudioContext:Context,config:mixer()});
 try {
  await audio.load([{id:'tone'}],{tone:new ArrayBuffer(4)});
  await audio.unlock();const voice=audio.forOwner().play('tone',{rate:2,loop:true});
  Context.last.currentTime=0.2;audio.update(0.01);assert.ok(Math.abs(voice.position-0.4)<1e-9);
  voice.pause();Context.last.currentTime=0.4;audio.update(0.01);assert.ok(Math.abs(voice.position-0.4)<1e-9);
  voice.resume();Context.last.currentTime=0.8;audio.update(0.01);assert.ok(Math.abs(voice.position-0.2)<1e-9);
 } finally {audio.dispose();}
});

test('stream decode errors release the voice even if diagnostic reporting throws',async()=>{
 let media;
 const audio=ArkGlideAudio.createAudio({AudioContext:Context,config:mixer(),
  onError(){throw Error('reporter failed');},
  createMediaElement(){return media={preservesPitch:true,pause(){},removeAttribute(){},load(){},async play(){}};},
 });
 try {
  await audio.load([{id:'music',stream:true}],{music:new ArrayBuffer(4)});
  audio.forOwner().play('music');assert.equal(audio.stats().audioVoices,1);
  assert.throws(()=>media.onerror(),/reporter failed/);
  assert.equal(audio.stats().audioVoices,0);assert.equal(audio.stats().audioBlobURLs,0);
 } finally {audio.dispose();}
});

test('failed worklet voice setup closes its message port',async()=>{
 const original=globalThis.AudioWorkletNode;let closed=0;
 class WorkletContext extends Context {
  constructor(){super();this.audioWorklet={async addModule(){}};}
  async decodeAudioData(){return {duration:1,numberOfChannels:1,getChannelData:()=>new Float32Array(128)};}
 }
 globalThis.AudioWorkletNode=class extends Node {
  constructor(){super();this.port={postMessage(){},close(){closed++;}};}
  connect(){throw Error('worklet connection failed');}
 };
 const audio=ArkGlideAudio.createAudio({AudioContext:WorkletContext,config:mixer()});
 try {
  await audio.load([{id:'tone'}],{tone:new ArrayBuffer(4)});
  assert.throws(()=>audio.forOwner().play('tone',{preservePitch:true}),/worklet connection failed/);
  assert.equal(closed,1);assert.equal(audio.stats().audioVoices,0);
 } finally {audio.dispose();if(original===undefined)delete globalThis.AudioWorkletNode;else globalThis.AudioWorkletNode=original;}
});

test('worklet stop message failures cannot interrupt voice cleanup',async()=>{
 const original=globalThis.AudioWorkletNode;let closed=0,worklet;
 class WorkletContext extends Context {
  constructor(){super();this.audioWorklet={async addModule(){}};}
  async decodeAudioData(){return {duration:1,numberOfChannels:1,getChannelData:()=>new Float32Array(128)};}
 }
 globalThis.AudioWorkletNode=class extends Node {
  constructor(){super();worklet=this;this.port={postMessage(message){if(message.type==='stop')throw Error('closed transport');},close(){closed++;}};}
 };
 const session=ArkGlideLifecycle.createSession(),owner=session.owner(null,'sound.js');owner.attach({});
 const audio=ArkGlideAudio.createAudio({AudioContext:WorkletContext,config:mixer()});
 try {
  await audio.load([{id:'tone'}],{tone:new ArrayBuffer(4)});const baseline=owner.record.cleanup.size;
  const voice=audio.forOwner(owner).play('tone',{preservePitch:true});
  assert.doesNotThrow(()=>voice.stop());assert.equal(closed,1);assert.equal(worklet.wasDisconnected,true);
  assert.equal(owner.record.cleanup.size,baseline);assert.equal(audio.stats().audioVoices,0);
 } finally {audio.dispose();session.stop();if(original===undefined)delete globalThis.AudioWorkletNode;else globalThis.AudioWorkletNode=original;}
});

test('snapshot requests during owner teardown preserve another owners restore handle',()=>{
 const session=ArkGlideLifecycle.createSession(),a=session.owner({id:'a'},'a.js'),b=session.owner({id:'b'},'b.js');
 a.attach({});b.attach({});
 const audio=ArkGlideAudio.createAudio({AudioContext:Context,config:mixer()});
 try {
  const original=audio.forOwner(b).applySnapshot('pause');
  a.attach({onDestroy(){assert.throws(()=>audio.forOwner(a).applySnapshot('pause'),/销毁/);}});
  session.destroyEntity('a');assert.equal(session.stats().errors,0);
  original.release();assert.equal(audio.forOwner(b).buses().find(bus=>bus.id==='Music').volume,1);
 } finally {session.stop();audio.dispose();}
});
