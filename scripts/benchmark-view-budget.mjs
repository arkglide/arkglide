// Measures clipping/sorting/allocation with validation and owned JS/WASM copies.
import * as B from "@babylonjs/core";
import factory from "../src/wasm/arkglide_math.js";
import "../src/engine/render-view-budget.js";
const module = await factory(), V = globalThis.ArkGlideViewBudget;
const iterations = Number(process.env.BENCH_ITERATIONS || 100), samples = Number(process.env.BENCH_SAMPLES || 5);
if (![iterations, samples].every(n => Number.isSafeInteger(n) && n > 0 && n <= 10000)) throw Error("Invalid benchmark size");
const warmupIterations = Math.max(1000, iterations);
function measure(fn) {
  for (let i = 0; i < warmupIterations; i++) fn();
  const times = [];
  for (let sample = 0; sample < samples; sample++) {
    const start = performance.now(); for (let i = 0; i < iterations; i++) fn();
    times.push((performance.now() - start) / iterations);
  }
  return times.sort((a, b) => a - b)[Math.floor(times.length / 2)];
}
const camera = new Float64Array(19);
camera.set(B.Matrix.LookAtLH(new B.Vector3(0, 0, 8), B.Vector3.Zero(), B.Axis.Y).multiply(B.Matrix.PerspectiveFovLH(1, 16 / 9, 0.1, 100)).m); camera.set([0, 0, 8], 16);
const budget = { width: 1920, height: 1080, maxSize: 4096, maxViews: 16, maxPixels: 8388608, minArea: 0.0001, minResolution: 32 };
const cases = [];
for (const count of [2, 8, 16, 32, 128, 512, 2048]) {
  const native = new module.RenderBatch(), wasm = V.create(native, 0), js = V.create(null, 0), input = new Float64Array(count * 10);
  for (let i = 0; i < count; i++) input.set([((i * 7) % 31) - 15, ((i * 3) % 11) - 5, -(i % 12), 0, 0, 0, 1, 1.8, 2.6, i % 3 ? 0.75 : 1], i * 10);
  try {
    const a = wasm.plan(input, camera, budget), b = js.plan(input, camera, budget);
    if (a.length !== b.length || a.some((v, i) => v.index !== b[i].index || v.width !== b[i].width || v.height !== b[i].height || Math.abs(v.area - b[i].area) > 1e-10)) throw Error("View budget parity failed: " + JSON.stringify({ count, a, b }));
    cases.push({ candidates: count, selected: a.length, javascriptMs: measure(() => js.plan(input, camera, budget)), wasmWithCopiesMs: measure(() => wasm.plan(input, camera, budget)) });
  } finally { wasm.dispose(); js.dispose(); native.delete(); }
}
console.log(JSON.stringify({ runtime: process.version, iterations, samples, warmupIterations, cases, limits: "CPU view projection, homogeneous clipping, area sorting and pixel allocation, including validation and buffer copies; excludes scene extraction, draw submission and GPU time. Not target-device FPS." }, null, 2));
