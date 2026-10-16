// CPU preparation benchmark, including input/output copies. Draw calls and
// pixel parity are checked separately by the browser regression's render target.
import * as B from "@babylonjs/core";
import factory from "../src/wasm/arkglide_math.js";
import "../src/engine/render-compute.js";
const module = await factory(),
  render = ArkGlideRenderCompute.create(B, module, { normalsMinVertices: 0 });
const iterations = Number(process.env.BENCH_ITERATIONS || 40),
  samples = Number(process.env.BENCH_SAMPLES || 5),
  count = Number(process.env.BENCH_MESHES || 6000),
  sizes = (process.env.BENCH_GRID_SIZES || "8,32,128").split(",").map(Number);
if (
  ![iterations, samples, count, ...sizes].every(
    (n) => Number.isSafeInteger(n) && n > 0,
  ) ||
  sizes.some((n) => n > 256)
)
  throw Error("Invalid render benchmark sizes");
function measure(fn) {
  const times = [];
  fn();
  for (let sample = 0; sample < samples; sample++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    times.push((performance.now() - start) / iterations);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(samples / 2)];
}
const native = new module.RenderBatch();
try {
  const normals = [];
  for (const side of sizes) {
    const positions = [],
      indices = [];
    for (let y = 0; y <= side; y++)
      for (let x = 0; x <= side; x++)
        positions.push(x, y, Math.sin(x * 0.1) * Math.cos(y * 0.1));
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++) {
        const a = y * (side + 1) + x,
          b = a + 1,
          c = a + side + 1,
          d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    const javascript = () => {
        const out = [];
        B.VertexData.ComputeNormals(positions, indices, out);
        return new Float32Array(out);
      },
      wasm = () => render.normalData(positions, indices);
    const expected = javascript(),
      actual = wasm();
    let maxDifference = 0;
    for (let i = 0; i < expected.length; i++)
      maxDifference = Math.max(
        maxDifference,
        Math.abs(expected[i] - actual[i]),
      );
    if (maxDifference > 1e-6) throw Error("Normal parity failed");
    normals.push({
      vertices: positions.length / 3,
      triangles: indices.length / 3,
      javascriptMs: measure(javascript),
      wasmWithCopiesMs: measure(wasm),
      maxDifference,
    });
  }
  native.reserveBoxes(count);
  const planes = B.Frustum.GetPlanes(B.Matrix.Identity()),
    flatPlanes = new Float64Array(24);
  planes.forEach((p, i) =>
    flatPlanes.set([p.normal.x, p.normal.y, p.normal.z, p.d], i * 4),
  );
  const visibility = [];
  for (const fraction of [0.1, 0.5, 0.9]) {
    const boxes = new Float64Array(count * 6),
      scratch = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      const x = i < Math.floor(count * fraction) ? 0 : 10 + i;
      boxes.set([x - 0.1, -0.1, 0.4, x + 0.1, 0.1, 0.6], i * 6);
    }
    const javascript = () => {
      let n = 0;
      for (let i = 0; i < count; i++) {
        let visible = true;
        for (let p = 0; p < 6; p++) {
          const at = p * 4,
            x = flatPlanes[at],
            y = flatPlanes[at + 1],
            z = flatPlanes[at + 2];
          if (
            x * boxes[i * 6 + (x >= 0 ? 3 : 0)] +
              y * boxes[i * 6 + (y >= 0 ? 4 : 1)] +
              z * boxes[i * 6 + (z >= 0 ? 5 : 2)] +
              flatPlanes[at + 3] <
            -1e-7
          ) {
            visible = false;
            break;
          }
        }
        if (visible) scratch[n++] = i;
      }
      return scratch.slice(0, n);
    };
    const wasm = () => {
      native.boxView().set(boxes);
      native.planeView().set(flatPlanes);
      const n = native.cull(count, 1e-7);
      return native.visibleView().slice(0, n);
    };
    const expected = javascript(),
      actual = wasm();
    if (
      expected.length !== actual.length ||
      expected.some((v, i) => v !== actual[i])
    )
      throw Error("Visibility parity failed");
    visibility.push({
      meshes: count,
      visibleFraction: fraction,
      selected: actual.length,
      javascriptMs: measure(javascript),
      wasmWithCopiesMs: measure(wasm),
    });
  }
  console.log(
    JSON.stringify(
      {
        runtime: process.version,
        iterations,
        samples,
        normals,
        visibility,
        limits:
          "CPU kernels with transfers and owned output copies; excludes Babylon bounds collection, GPU uploads, shading and target-device FPS.",
      },
      null,
      2,
    ),
  );
} finally {
  native.delete();
  render.dispose();
}
