// Full CPU preparation path: live transform checks, copies, bounds and culling.
// The two variants differ only in batched sync and native world-bound reuse.
import assert from "node:assert/strict";
import * as B from "@babylonjs/core";
import factory from "../src/wasm/arkglide_math.js";
import "../public/arkglide-api.js";
import "../src/engine/render-compute.js";

B.Logger.LogLevels = B.Logger.NoneLogLevel;
const module = await factory();
const count = Number(process.env.BENCH_ENTITIES || 2000),
  frames = Number(process.env.BENCH_FRAMES || 20),
  samples = Number(process.env.BENCH_SAMPLES || 5),
  views = Number(process.env.BENCH_VIEWS || 4);
if (
  ![count, frames, samples, views].every(
    (n) => Number.isSafeInteger(n) && n > 0,
  ) ||
  views > 16
)
  throw Error("Invalid scene benchmark sizes");

function run(nativeBounds) {
  const engine = new B.NullEngine(),
    scene = new B.Scene(engine),
    world = new module.RuntimeWorld();
  const api = ArkGlideRuntime.createEntityAPI(
    B,
    () => scene,
    () => null,
    {
      getWorld: () => world,
      getBatchMinEntities: () => (nativeBounds ? 0 : Number.MAX_SAFE_INTEGER),
    },
  );
  const render = ArkGlideRenderCompute.create(
    B,
    module,
    {
      worldBounds: nativeBounds,
      cullMinMeshes: 0,
      maxBatchMeshes: count,
    },
    api,
  );
  const meshes = [],
    material = new B.StandardMaterial("benchmark-material", scene);
  const frustums = Array.from({ length: views }, (_, i) =>
    B.Frustum.GetPlanes(
      B.Matrix.LookAtLH(
        new B.Vector3(i * 0.2, 0, -4),
        B.Vector3.Zero(),
        B.Axis.Y,
      ).multiply(B.Matrix.PerspectiveFovLH(1, 1, 0.1, 100)),
    ),
  );
  try {
    for (let i = 0; i < count; i++) {
      const mesh = B.MeshBuilder.CreateBox("node" + i, {}, scene);
      if (i % 10) {
        mesh.parent = meshes[i - 1];
        mesh.position.z = 0.02;
      } else mesh.position.x = Math.floor(i / 10) % 2 ? 30 : 0;
      mesh.rotation.y = 0.01;
      mesh.material = material;
      api.register(mesh, mesh.name);
      meshes.push(mesh);
    }
    const cases = [];
    for (const dirtyFraction of [0, 0.01, 0.1, 1]) {
      const moving = Math.ceil(count * dirtyFraction);
      function step() {
        render.beginFrame();
        for (let i = 0; i < moving; i++) meshes[i].position.y += 0.00001;
        // Both variants import the same logical transforms before rendering.
        // A real render includes script/physics queries in addition to culling.
        api.sync();
        return frustums.map((planes) => render.select(meshes, planes));
      }
      // Native warm-up can be followed by one compatibility frame. Measure
      // counters only after both variants have reached their steady path.
      for (let i = 0; i < 3; i++) step();
      const before = { ...api.stats(), ...render.stats() };
      let rendererMatrixCalls = 0;
      const original = B.TransformNode.prototype.computeWorldMatrix;
      let selected;
      B.TransformNode.prototype.computeWorldMatrix = function (...args) {
        rendererMatrixCalls++;
        return original.apply(this, args);
      };
      try {
        selected = step().map((list) => list.map((mesh) => mesh.name));
      } finally {
        B.TransformNode.prototype.computeWorldMatrix = original;
      }
      const after = { ...api.stats(), ...render.stats() },
        durations = [];
      for (let sample = -1; sample < samples; sample++) {
        const start = performance.now();
        for (let i = 0; i < frames; i++) step();
        if (sample >= 0) durations.push((performance.now() - start) / frames);
      }
      durations.sort((a, b) => a - b);
      cases.push({
        dirtyFraction,
        medianFrameMs: durations[Math.floor(samples / 2)],
        rendererMatrixCalls,
        nativeTransformBatches:
          after.nativeTransformBatches - before.nativeTransformBatches,
        nativeTransformWrites:
          after.nativeTransformWrites - before.nativeTransformWrites,
        nativeBoundsUpdates:
          after.nativeBoundsUpdates - before.nativeBoundsUpdates,
        nativeBoundsQueries:
          after.nativeBoundsBatches - before.nativeBoundsBatches,
        selected,
      });
    }
    return cases;
  } finally {
    render.dispose();
    engine.dispose();
    assert.equal(world.count(), 0);
    assert.equal(world.boundEntries(), 0);
    world.delete();
  }
}
const scalar = run(false),
  native = run(true);
for (let i = 0; i < scalar.length; i++) {
  assert.deepEqual(native[i].selected, scalar[i].selected);
  const selectedPerView = native[i].selected.map((list) => list.length);
  delete scalar[i].selected;
  delete native[i].selected;
  scalar[i].selectedPerView = native[i].selectedPerView = selectedPerView;
}
console.log(
  JSON.stringify(
    {
      runtime: process.version,
      entities: count,
      frames,
      samples,
      views,
      hierarchyDepth: 10,
      scalarBabylonBounds: scalar,
      batchNativeBounds: native,
      limits:
        "Steady-state CPU scene synchronization and offscreen preparation, including JS checks and input/output copies. Same native library in both variants; excludes main-view rendering, GPU work, physics and production FPS.",
    },
    null,
    2,
  ),
);
