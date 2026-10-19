import test from "node:test";
import assert from "node:assert/strict";
import * as B from "@babylonjs/core";
import factory from "../src/wasm/arkglide_math.js";
import "../src/engine/render-view-budget.js";
import "../src/engine/render-compute.js";
const module = await factory(), V = globalThis.ArkGlideViewBudget;
const budget = { width: 320, height: 180, maxSize: 512, maxViews: 12, maxPixels: 170000, minArea: 0.0001, minResolution: 16 };
function camera(position = new B.Vector3(0, 0, 5), target = B.Vector3.Zero()) {
  const data = new Float64Array(19);
  data.set(B.Matrix.LookAtLH(position, target, B.Axis.Y).multiply(B.Matrix.PerspectiveFovLH(1, 16 / 9, 0.1, 100)).m);
  data.set(position.asArray(), 16); return data;
}
function same(a, b) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    for (const key of ["index", "width", "height"]) assert.equal(a[i][key], b[i][key]);
    assert.ok(Math.abs(a[i].area - b[i].area) < 1e-10);
  }
}
test("WASM projects, clips, prioritizes and budgets the same views as JS, including near-plane intersections", () => {
  const native = new module.RenderBatch(), planner = V.create(native, 0);
  let seed = 6; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  try {
    for (const count of [1, 4, 32, 512]) {
      const input = new Float64Array(count * 10);
      for (let i = 0; i < count; i++) {
        const q = B.Quaternion.RotationYawPitchRoll(random() * 6, random() * 2, random());
        input.set([random() * 30 - 15, random() * 12 - 6, random() * 30 - 20, q.x, q.y, q.z, q.w, 0.1 + random() * 8, 0.1 + random() * 8, 0.2 + random()], i * 10);
      }
      for (const cam of [camera(), camera(new B.Vector3(4, 2, -6))]) for (const maxPixels of [0, 1100, 60000, 170000, 1000000]) {
        const b = { ...budget, maxPixels };
        const actual = planner.plan(input, cam, b); same(actual, V.plan(input, cam, b));
        assert.ok(actual.length <= b.maxViews);
        assert.ok(actual.reduce((sum, v) => sum + v.width * v.height, 0) <= b.maxPixels);
        for (const view of actual) assert.ok(view.width <= b.maxSize && view.height <= b.maxSize);
      }
    }
    const edge = new Float64Array([0, 0, 4.9, 0, Math.sin(0.4), 0, Math.cos(0.4), 2, 2, 1, 0, 0, 10, 0, 0, 0, 1, 2, 2, 1, 30, 0, 0, 0, 0, 0, 1, 2, 2, 1]);
    const result = planner.plan(edge, camera(), budget); same(result, V.plan(edge, camera(), budget));
    assert.deepEqual(result.map(v => v.index), [0]);
    assert.ok(result[0].area > 0);
    for (const distance of [0.08, 0.01, 0.002, 0.0002]) {
      const close = new Float64Array([0, 0, 5 - distance, 0, 0, 0, 1, 2, 2, 1]);
      const result = planner.plan(close, camera(), budget); same(result, V.plan(close, camera(), budget));
      assert.equal(result.length, 1, "a near aperture remains visible");
      assert.ok(result[0].area > 0.99);
    }
  } finally { planner.dispose(); native.delete(); }
});
test("view batches reject invalid budgets, recover from WASM memory growth and retain owned output", () => {
  const native = new module.RenderBatch(), planner = V.create(native, 0);
  const input = new Float64Array([0, 0, 0, 0, 0, 0, 1, 2, 2, 1]), cam = camera();
  try {
    const first = planner.plan(input, cam, budget);
    native.reserveGeometry(700000, 0);
    same(first, planner.plan(input, cam, budget));
    for (const b of [{ ...budget, maxViews: -1 }, { ...budget, maxPixels: NaN }, { ...budget, width: 2 ** 32 }, { ...budget, minArea: -1 }]) assert.throws(() => planner.plan(input, cam, b), /budget/);
    native.reserveViews(1);
    assert.equal(native.planViews(2, 320, 180, 512, 0, 2, 10000, 16), -1);
    assert.equal(native.planViews(0xffffffff, 320, 180, 512, 0, 2, 10000, 16), -1);
    assert.equal(native.planViews(0, 320, 180, 512, NaN, 2, 10000, 16), -1);
    planner.dispose(); assert.throws(() => planner.plan(input, cam, budget), /disposed/);
  } finally { native.delete(); }
});
test("render compute uses a configurable WASM batch threshold and the same JS fallback", () => {
  const input = new Float64Array([0, 0, 0, 0, 0, 0, 1, 2, 2, 1]), cam = camera();
  const native = globalThis.ArkGlideRenderCompute.create(B, module, { viewsMinPortals: 0 });
  const fallback = globalThis.ArkGlideRenderCompute.create(B, module, { enabled: false });
  try {
    same(native.planViews(input, cam, budget), fallback.planViews(input, cam, budget));
    assert.equal(native.stats().viewBudgetNativeBatches, 1);
    assert.equal(fallback.stats().viewBudgetJSBatches, 1);
    native.dispose(); assert.throws(() => native.planViews(input, cam, budget), /disposed/i);
  } finally { native.dispose(); fallback.dispose(); }
});
