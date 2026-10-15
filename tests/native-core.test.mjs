import test from "node:test";
import assert from "node:assert/strict";
import * as B from "@babylonjs/core";
import { PerformanceConfigurator } from "@babylonjs/core/Engines/performanceConfigurator.js";
PerformanceConfigurator.SetMatrixPrecision(true);
import factory from "../src/wasm/arkglide_math.js";
import "../public/arkglide-api.js";
const module = await factory();
const close = (a, b) => {
  assert.equal(a.length, b.length);
  a.forEach((v, i) =>
    assert.ok(Math.abs(v - b[i]) < 1e-5, `${i}: ${v} != ${b[i]}`),
  );
};

test("native world rejects stale handles, duplicate IDs and hierarchy cycles across slot reuse and resets", () => {
  const w = new module.RuntimeWorld();
  try {
    const a = w.create("a", "Shared"),
      b = w.create("b", "Shared");
    assert.ok(a && b);
    assert.equal(w.create("a", "duplicate"), 0);
    assert.equal(w.setParent(b, a), true);
    assert.equal(w.setParent(a, b), false);
    assert.equal(w.parent(b), a);
    w.erase(a);
    assert.equal(w.parent(b), 0);
    const c = w.create("c", "Shared");
    assert.notEqual(c, a);
    assert.equal(w.alive(a), false);
    assert.equal(w.rename(a, "stale"), false);
    assert.deepEqual(Array.from(w.named("Shared")), [b, c]);
    assert.equal(w.capacity(), 2);
    w.clear();
    const next = w.create("next", "Next");
    assert.notEqual(next, b);
    assert.equal(w.alive(b), false);
    assert.equal(w.count(), 1);
  } finally {
    w.delete();
  }
});
test("native double-precision hierarchy matches Babylon and only recomputes changed world matrices", () => {
  const w = new module.RuntimeWorld(),
    a = w.create("a", "A"),
    b = w.create("b", "B");
  try {
    w.transform(a, 12345.123456789, 2, 3, 0.2, -0.3, 0.4, 2, 3, 4);
    w.transform(b, 1, 2, 3, 0.3, 0.1, -0.2, 1, 2, 1);
    w.setParent(b, a);
    const local = (p, r, s) =>
      B.Matrix.Compose(
        new B.Vector3(...s),
        B.Quaternion.FromEulerAngles(...r),
        new B.Vector3(...p),
      );
    close(
      Array.from(w.world(b)),
      Array.from(
        local([1, 2, 3], [0.3, 0.1, -0.2], [1, 2, 1]).multiply(
          local([12345.123456789, 2, 3], [0.2, -0.3, 0.4], [2, 3, 4]),
        ).m,
      ),
    );
    const count = w.matrixUpdates();
    w.world(b);
    w.update();
    assert.equal(w.matrixUpdates(), count);
    w.transform(a, 12346.123456789, 2, 3, 0.2, -0.3, 0.4, 2, 3, 4);
    w.world(b);
    assert.equal(w.matrixUpdates(), count + 2);
    assert.ok(Math.abs(w.world(a)[12] - 12346.123456789) < 1e-10);
  } finally {
    w.delete();
  }
});
test("native hierarchy resolves deep trees iteratively and reparenting invalidates descendants", () => {
  const w = new module.RuntimeWorld();
  try {
    let parent = 0,
      root = 0,
      last = 0;
    for (let i = 0; i < 4000; i++) {
      last = w.create("node" + i, "Node");
      w.transform(last, 1, 0, 0, 0, 0, 0, 1, 1, 1);
      w.setParent(last, parent);
      if (!i) root = last;
      parent = last;
    }
    assert.equal(w.world(last)[12], 4000);
    assert.equal(w.descendants(root).length, 3999);
    w.setParent(last, root);
    assert.equal(w.world(last)[12], 2);
  } finally {
    w.delete();
  }
});
test("entity facade imports physics-side transform changes and invalidates all old references on native destruction", () => {
  const engine = new B.NullEngine(),
    scene = new B.Scene(engine),
    w = new module.RuntimeWorld();
  const api = ArkGlideRuntime.createEntityAPI(
    B,
    () => scene,
    () => null,
    { getWorld: () => w },
  );
  try {
    const a = api.sceneAPI.create("box", "a"),
      b = api.sceneAPI.create("box", "b");
    const mesh = api.getObject("b");
    mesh.parent = api.getObject("a");
    a.position.x = 4;
    mesh.position.y = 3;
    mesh.rotationQuaternion = B.Quaternion.FromEulerAngles(0.1, 0.2, 0.3);
    const view = b.position;
    assert.equal(b.getWorldPosition().x, 4);
    assert.equal(b.getWorldPosition().y, 3);
    api.sync();
    a.destroy();
    assert.equal(w.count(), 0);
    assert.equal(b.destroyed, true);
    assert.throws(() => view.x, /destroyed/);
    const replacement = api.sceneAPI.create("sphere", "b");
    assert.notEqual(replacement, b);
    assert.equal(b.destroyed, true);
    assert.equal(api.stats().sceneBackend, "cpp-wasm");
  } finally {
    engine.dispose();
    w.delete();
  }
});

test("lifecycle clock views refresh after unrelated scene allocations grow WASM memory", async () => {
  await import("../src/engine/lifecycle-runtime.js");
  const w = new module.RuntimeWorld(),
    session = ArkGlideLifecycle.createSession({ nativeModule: module });
  try {
    session.start();
    session.tick(0);
    session.tick(20);
    const before = module.HEAPU8.byteLength;
    for (let i = 0; i < 40000; i++) w.create("allocation" + i, "Entity");
    assert.ok(module.HEAPU8.byteLength > before);
    session.tick(40);
    assert.equal(session.time.totalTime, 0.04);
    assert.equal(session.stats().lifecycleBackend, "cpp-wasm");
  } finally {
    session.stop();
    w.delete();
  }
});

test("native facade skips clean writes but immediately imports renderer mutations and reparenting", () => {
  const engine = new B.NullEngine(),
    scene = new B.Scene(engine),
    w = new module.RuntimeWorld();
  const calls = { transform: 0, setParent: 0 };
  for (const method of Object.keys(calls)) {
    const fn = w[method].bind(w);
    w[method] = (...args) => {
      calls[method]++;
      return fn(...args);
    };
  }
  const api = ArkGlideRuntime.createEntityAPI(
    B,
    () => scene,
    () => null,
    { getWorld: () => w },
  );
  try {
    const a = api.sceneAPI.create("box", "a"),
      b = api.sceneAPI.create("box", "b"),
      c = api.sceneAPI.create("box", "c");
    api.getObject("b").parent = api.getObject("a");
    api.sync();
    calls.transform = calls.setParent = 0;
    for (let i = 0; i < 10; i++) {
      api.sync();
      b.getWorldMatrix();
      b.getWorldPosition();
    }
    assert.deepEqual(calls, { transform: 0, setParent: 0 });
    const copy = b.getWorldMatrix();
    copy[12] = 123;
    assert.equal(b.getWorldPosition().x, 0);
    // Updates within one frame must be visible, including a changed ancestor.
    api.getObject("a").position.x = 4;
    api.getObject("b").position.y = 3;
    assert.deepEqual(b.getWorldPosition(), { x: 4, y: 3, z: 0 });
    assert.deepEqual(calls, { transform: 2, setParent: 0 });
    c.setPosition(10, 0, 0);
    api.getObject("b").parent = api.getObject("c");
    assert.deepEqual(b.getWorldPosition(), { x: 10, y: 3, z: 0 });
    assert.equal(calls.setParent, 1);
    api.getObject("b").parent = null;
    assert.equal(b.getWorldPosition().x, 0);
    const foreign = new B.TransformNode("foreign", scene);
    foreign.position.z = 7;
    api.getObject("b").parent = foreign;
    assert.deepEqual(b.getWorldPosition(), { x: 0, y: 3, z: 7 });
    api.getObject("b").parent = api.getObject("a");
    a.destroy();
    assert.equal(b.destroyed, true);
    assert.throws(() => b.getWorldPosition(), /destroyed/);
  } finally {
    engine.dispose();
    w.delete();
  }
});
