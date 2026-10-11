import test from "node:test";
import assert from "node:assert/strict";
import * as B from "@babylonjs/core";
import "../public/lib/jolt-physics.js";
import "../src/engine/physics-runtime.js";
import "../src/engine/audio-runtime.js";
import "../src/engine/animation-runtime.js";
import "../src/engine/input-ui-runtime.js";
import "../src/engine/lifecycle-runtime.js";
const J = await globalThis.createArkGlideJolt();
function physical() {
  const engine = new B.NullEngine(),
    scene = new B.Scene(engine),
    objects = new Map(),
    entities = new Map();
  const errors = [];
  const p = ArkGlidePhysics.createPhysics(J, B, {
    getObject: (id) => objects.get(id),
    find: (id) => entities.get(id),
    onError: (e) => errors.push(e),
  });
  const session = ArkGlideLifecycle.createSession();
  const config = (motion = "dynamic", shape = "box", sensor = false) => ({
    motion,
    shape,
    size: { x: 1, y: 1, z: 1 },
    mass: 1,
    friction: 0.5,
    restitution: 0,
    sensor,
    lockRotation: true,
  });
  function add(id, pos, c = config(), parent) {
    const m = B.MeshBuilder.CreateBox(id, {}, scene);
    m.position.copyFromFloats(...pos);
    m.parent = parent || null;
    objects.set(id, m);
    const e = {
      id,
      name: id,
      getWorldPosition: () => {
        m.computeWorldMatrix(true);
        return m.getAbsolutePosition();
      },
      get destroyed() {
        return m.isDisposed();
      },
    };
    entities.set(id, e);
    p.add({ id, name: id, physics: c });
    return { m, e };
  }
  return {
    p,
    engine,
    scene,
    objects,
    entities,
    errors,
    session,
    config,
    add,
    done() {
      session.stop();
      p.dispose();
      engine.dispose();
    },
  };
}
test("actual Jolt WASM gravity, floor collision, velocity and impulse integrate at fixed steps", () => {
  const t = physical();
  try {
    const floor = t.add("floor", [0, -0.5, 0], {
        ...t.config("static"),
        size: { x: 20, y: 1, z: 20 },
      }),
      ball = t.add("ball", [0, 3, 0]);
    const owner = t.session.owner(ball.e, "player.js"),
      api = t.p.forOwner(owner),
      events = [];
    api.onContact(ball.e, (e) => events.push(e));
    for (let i = 0; i < 120; i++) t.p.step(1 / 60);
    assert.ok(Math.abs(ball.m.position.y - 0.5) < 0.04);
    assert.ok(events.some((e) => e.phase === "enter" && e.other === floor.e));
    api.addImpulse(ball.e, { x: 0, y: 5, z: 0 });
    t.p.step(1 / 60);
    assert.ok(api.getVelocity(ball.e).y > 4);
    assert.ok(ball.m.position.y > 0.5);
    api.teleport(ball.e, { x: 2, y: 4, z: 0 });
    assert.equal(ball.m.position.x, 2);
    assert.throws(() => api.add(ball.e, t.config()), /已有/);
    assert.throws(() => api.setVelocity(ball.e, { x: NaN, y: 0, z: 0 }));
  } finally {
    t.done();
  }
});
test("sensor callbacks are deferred outside solver and can safely destroy the contacting body", () => {
  const t = physical();
  try {
    const a = t.add("a", [0, 0, 0]),
      b = t.add("sensor", [0, 0, 0], t.config("static", "box", true));
    let entered = 0;
    const owner = t.session.owner(a.e, "test.js"),
      api = t.p.forOwner(owner);
    api.onContact(a.e, (e) => {
      if (e.phase === "enter") {
        entered++;
        assert.equal(e.sensor, true);
        t.p.remove(b.e.id);
        b.m.dispose();
      }
    });
    t.p.step(1 / 60);
    assert.equal(entered, 1);
    assert.equal(t.p.stats().physicsBodies, 1);
    owner.abort();
    assert.equal(t.p.stats().physicsSubscriptions, 0);
    for (let i = 0; i < 30; i++) t.p.step(1 / 60);
    assert.ok(a.m.position.y < -0.5);
  } finally {
    t.done();
  }
});
test("physics world-space teleport writes through a transformed parent and kinematic motion stays managed", () => {
  const t = physical();
  try {
    const parent = new B.TransformNode("parent", t.scene);
    parent.position.x = 10;
    parent.rotation.y = 0.3;
    const a = t.add("child", [0, 1, 0], t.config("kinematic"), parent),
      owner = t.session.owner(a.e, "test.js"),
      api = t.p.forOwner(owner);
    api.teleport(a.e, { x: 12, y: 2, z: 3 });
    assert.ok(
      B.Vector3.Distance(a.m.getAbsolutePosition(), new B.Vector3(12, 2, 3)) <
        1e-5,
    );
    a.m.position.y += 1;
    t.p.step(1 / 60);
    assert.ok(Math.abs(a.m.getAbsolutePosition().y - 3) < 1e-4);
    for (let i = 0; i < 30; i++) {
      const e = t.add("spawn" + i, [0, 0, 0]);
      t.p.remove(e.e.id);
      e.m.dispose();
    }
    assert.equal(t.p.stats().physicsBodies, 1);
    assert.throws(() => api.add({ id: "fake" }, t.config()));
    assert.throws(() =>
      t.add("invalid", [0, 0, 0], { ...t.config(), shape: "mesh" }),
    );
  } finally {
    t.done();
  }
});
test("lifecycle pause and zero time scale do not advance real physics", () => {
  const t = physical();
  try {
    const a = t.add("a", [0, 4, 0]),
      s = ArkGlideLifecycle.createSession({
        onFixedStep: (dt) => t.p.step(dt),
      });
    s.start();
    s.tick(0);
    s.tick(100);
    const y = a.m.position.y;
    assert.ok(y < 4);
    s.pause();
    s.tick(500);
    assert.equal(a.m.position.y, y);
    s.resume();
    s.tick(1000);
    assert.equal(a.m.position.y, y);
    s.time.timeScale = 0;
    s.tick(1200);
    assert.equal(a.m.position.y, y);
    s.time.timeScale = 1;
    s.tick(1300);
    assert.ok(a.m.position.y < y);
    s.stop();
  } finally {
    t.done();
  }
});
class Target {
  constructor() {
    this.listeners = new Map();
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.textContent = "";
  }
  addEventListener(n, f) {
    const s = this.listeners.get(n) || new Set();
    s.add(f);
    this.listeners.set(n, s);
  }
  removeEventListener(n, f) {
    this.listeners.get(n)?.delete(f);
  }
  emit(n, e = {}) {
    for (const f of this.listeners.get(n) || [])
      f({ target: this, preventDefault() {}, stopPropagation() {}, ...e });
  }
  appendChild(e) {
    this.children.push(e);
  }
  remove() {}
  querySelectorAll() {
    return this.children.filter((c) => c.tag === "button");
  }
  replaceChildren() {
    this.children = [];
  }
  setPointerCapture() {}
}
function uiFixture() {
  const window = new Target(),
    document = new Target(),
    canvas = new Target(),
    layer = new Target();
  document.createElement = (tag) => Object.assign(new Target(), { tag });
  document.visibilityState = "visible";
  const s = ArkGlideLifecycle.createSession(),
    owner = s.owner({ id: "owner" }, "test.js");
  const ui = ArkGlideInputUI.createInputUI({
    window,
    document,
    canvas,
    layer,
    config: {
      captureInput: true,
      actions: [{ name: "move", positive: ["KeyD"], negative: ["KeyA"] }],
      hud: [],
    },
  });
  return { window, document, canvas, layer, ui, owner, s };
}
test("action mappings combine opposing keyboard and multiple touch sources and clear on blur/pause", () => {
  const t = uiFixture();
  try {
    t.window.emit("keydown", { key: "d", code: "KeyD" });
    assert.equal(t.ui.input.getAction("move"), 1);
    assert.equal(t.ui.input.wasActionPressed("move"), true);
    t.window.emit("keydown", { key: "a", code: "KeyA" });
    assert.equal(t.ui.input.getAction("move"), 0);
    t.ui.endFrame();
    assert.equal(t.ui.input.wasActionPressed("move"), false);
    const api = t.ui.forOwner(t.owner);
    api.createButton({ id: "touch", text: "Right", action: "move" });
    const el = t.layer.children[0];
    t.window.emit("blur");
    el.emit("pointerdown", { pointerId: 1 });
    el.emit("pointerdown", { pointerId: 2 });
    el.emit("pointercancel", { pointerId: 1 });
    assert.equal(t.ui.input.getAction("move"), 1);
    el.emit("pointerup", { pointerId: 2 });
    assert.equal(t.ui.input.getAction("move"), 0);
    t.window.emit("keydown", { key: "d", code: "KeyD" });
    t.ui.setActive(false);
    assert.equal(t.ui.input.getAction("move"), 0);
    t.window.emit("keydown", { key: "d", code: "KeyD" });
    assert.equal(t.ui.input.getAction("move"), 0);
  } finally {
    t.s.stop();
    t.ui.dispose();
  }
});
test("hiding a held HUD button releases only its own touches and does not resume stale input", () => {
  const t = uiFixture();
  try {
    const api = t.ui.forOwner(t.owner),
      hidden = api.createButton({ id: "hidden", action: "move" });
    api.createButton({ id: "other", action: "move" });
    const [el, other] = t.layer.children;
    el.emit("pointerdown", { pointerId: 1 });
    el.emit("pointerdown", { pointerId: 2 });
    other.emit("pointerdown", { pointerId: 3 });
    hidden.setVisible(false);
    assert.equal(t.ui.stats().inputHeld, 1);
    assert.equal(t.ui.input.getAction("move"), 1);
    other.emit("pointerup", { pointerId: 3 });
    assert.equal(t.ui.input.getAction("move"), 0);
    assert.equal(t.ui.input.wasActionReleased("move"), true);
    el.emit("pointerdown", { pointerId: 5 });
    assert.equal(t.ui.input.getAction("move"), 0);
    hidden.setVisible(true);
    assert.equal(t.ui.input.getAction("move"), 0);
    el.emit("pointerup", { pointerId: 1 });
    t.window.emit("keydown", { key: "d", code: "KeyD" });
    el.emit("pointerdown", { pointerId: 4 });
    hidden.setVisible(false);
    assert.equal(t.ui.input.getAction("move"), 1);
    t.window.emit("keyup", { key: "d", code: "KeyD" });
    assert.equal(t.ui.input.getAction("move"), 0);
  } finally {
    t.s.stop();
    t.ui.dispose();
  }
});
test("HUD buttons created during pause stay disabled until the session resumes", () => {
  const t = uiFixture();
  try {
    t.ui.setActive(false);
    t.ui.forOwner(t.owner).createButton({ id: "paused", action: "move" });
    const el = t.layer.children[0];
    assert.equal(el.disabled, true);
    el.emit("pointerdown", { pointerId: 1 });
    assert.equal(t.ui.input.getAction("move"), 0);
    t.ui.setActive(true);
    assert.equal(el.disabled, false);
    el.emit("pointerdown", { pointerId: 2 });
    assert.equal(t.ui.input.getAction("move"), 1);
  } finally {
    t.s.stop();
    t.ui.dispose();
  }
});
test("HUD text is literal and script destruction clears buttons, callbacks and virtual input", () => {
  const t = uiFixture();
  const api = t.ui.forOwner(t.owner),
    h = api.createText({ id: "score" });
  h.setText("<img src=x onerror=alert(1)>");
  assert.equal(h.text, "<img src=x onerror=alert(1)>");
  assert.throws(() => api.createText({ id: "score" }));
  api.createButton({ id: "b", action: "move" });
  t.layer.children[1].emit("pointerdown", { pointerId: 1 });
  assert.equal(t.ui.input.getAction("move"), 1);
  t.owner.abort();
  assert.equal(t.ui.stats().hudElements, 0);
  assert.equal(t.ui.input.getAction("move"), 0);
  assert.throws(() => h.setText("x"));
  t.ui.dispose();
  assert.equal(
    [...t.window.listeners.values()].reduce((n, v) => n + v.size, 0),
    0,
  );
});
class Node {
  constructor() {
    this.gain = { value: 1 };
    this.playbackRate = { value: 1 };
    this.positionX = { value: 0 };
    this.positionY = { value: 0 };
    this.positionZ = { value: 0 };
    this.connected = false;
  }
  connect() {
    this.connected = true;
  }
  disconnect() {
    this.connected = false;
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
    this.listener = new Node();
    this.destination = {};
  }
  createGain() {
    return new Node();
  }
  createBufferSource() {
    return new Node();
  }
  createPanner() {
    return new Node();
  }
  async decodeAudioData() {
    return { length: 100 };
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
test("audio buffers decode once, voices track owner/position, pause and timeScale freeze context, stop releases all", async () => {
  const entity = { id: "e", getWorldPosition: () => ({ x: 3, y: 2, z: 1 }) },
    session = ArkGlideLifecycle.createSession(),
    owner = session.owner(entity, "audio.js"),
    a = ArkGlideAudio.createAudio({
      AudioContext: Context,
      find: (id) => (id === "e" ? entity : null),
    });
  await a.load([{ id: "sound" }], { sound: new ArrayBuffer(8) });
  const api = a.forOwner(owner);
  assert.equal(await api.unlock(), true);
  const v = api.play("sound", { entity, spatial: true, loop: true });
  assert.equal(a.stats().audioVoices, 1);
  a.setPaused(true);
  assert.equal(api.state, "suspended");
  a.setPaused(false);
  assert.equal(api.state, "running");
  a.setScale(0);
  assert.equal(api.state, "suspended");
  a.setScale(1);
  assert.equal(api.state, "running");
  owner.abort();
  assert.equal(v.playing, false);
  assert.equal(a.stats().audioVoices, 0);
  a.dispose();
  assert.equal(a.stats().audioBuffers, 0);
  assert.equal(api.state, "closed");
  assert.throws(() => api.play("sound"));
});
test("invalid spatial audio parameters allocate no Web Audio nodes", async () => {
  let allocations = 0;
  class CountingContext extends Context {
    createGain() { allocations++; return super.createGain(); }
    createBufferSource() { allocations++; return super.createBufferSource(); }
    createPanner() { allocations++; return super.createPanner(); }
  }
  const entity = { id: "e", getWorldPosition: () => ({ x: 0, y: 0, z: 0 }) },
    a = ArkGlideAudio.createAudio({ AudioContext: CountingContext, find: () => entity });
  try {
    await a.load([{ id: "sound" }], { sound: new ArrayBuffer(8) });
    const api = a.forOwner(), baseline = allocations;
    assert.throws(() => api.play("sound", { spatial: true }), /entity/);
    for (const refDistance of [0, -1, NaN, Infinity])
      assert.throws(() => api.play("sound", { spatial: true, entity, refDistance }), /refDistance/);
    assert.equal(allocations, baseline);
    assert.equal(a.stats().audioVoices, 0);
    const voice = api.play("sound", { spatial: true, entity, refDistance: 2 });
    assert.equal(a.stats().audioVoices, 1);
    voice.stop();
    assert.equal(a.stats().audioVoices, 0);
  } finally { a.dispose(); }
});
test("a late audio decode cannot revive a stopped run", async () => {
  let release;
  class Slow extends Context {
    decodeAudioData() {
      return new Promise((r) => (release = r));
    }
  }
  const a = ArkGlideAudio.createAudio({ AudioContext: Slow }),
    p = a.load([{ id: "sound" }], { sound: new ArrayBuffer(8) });
  a.dispose();
  release({});
  await p;
  assert.equal(a.stats().audioBuffers, 0);
});
test("animation groups switch with blend weights and owner destruction stops playback", () => {
  const engine = new B.NullEngine(),
    scene = new B.Scene(engine),
    mesh = B.MeshBuilder.CreateBox("model", {}, scene),
    entity = { id: "model" },
    groups = [];
  for (const [name, target, values] of [
    ["Idle", "position.y", [0, 1]],
    ["Move", "position.x", [0, 2]],
  ]) {
    const animation = new B.Animation(
      name,
      target,
      30,
      B.Animation.ANIMATIONTYPE_FLOAT,
    );
    animation.setKeys([
      { frame: 0, value: values[0] },
      { frame: 30, value: values[1] },
    ]);
    const group = new B.AnimationGroup(name, scene);
    group.addTargetedAnimation(animation, mesh);
    groups.push(group);
  }
  const s = ArkGlideLifecycle.createSession(),
    owner = s.owner(entity, "animation.js"),
    a = ArkGlideAnimation.createAnimation({
      find: () => entity,
      getGroups: () => groups,
    }),
    api = a.forOwner(owner);
  try {
    assert.deepEqual(api.list(entity), ["Idle", "Move"]);
    api.play(entity, "Idle");
    scene._animate(0);
    scene._animate(100);
    assert.ok(mesh.position.y > 0);
    api.play(entity, "Move", { fade: 0.2 });
    a.update(0.1);
    assert.equal(groups[1].animatables[0].weight, 0.5);
    a.update(0.1);
    assert.equal(groups[0].isStarted, false);
    assert.equal(groups[1].animatables[0].weight, 1);
    owner.abort();
    assert.equal(a.stats().animationPlayers, 0);
    assert.equal(groups[1].isStarted, false);
  } finally {
    a.dispose();
    engine.dispose();
  }
});
