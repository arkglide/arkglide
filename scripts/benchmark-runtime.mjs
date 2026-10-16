// CPU/JS-WASM boundary benchmark; no GPU or production FPS claims.
import fs from "node:fs/promises";
import vm from "node:vm";
import * as B from "@babylonjs/core";
import factory from "../src/wasm/arkglide_math.js";

B.Logger.LogLevels = B.Logger.NoneLogLevel;

const count = Number(process.env.BENCH_ENTITIES || 1000),
  frames = Number(process.env.BENCH_FRAMES || 60),
  samples = Number(process.env.BENCH_SAMPLES || 5);
if (![count, frames, samples].every((n) => Number.isSafeInteger(n) && n > 0))
  throw Error("Benchmark sizes must be positive integers");
vm.runInThisContext(
  await fs.readFile(
    process.argv[2] || new URL("../public/arkglide-api.js", import.meta.url),
    "utf8",
  ),
);
const module = await factory(),
  engine = new B.NullEngine(),
  scene = new B.Scene(engine),
  world = new module.RuntimeWorld(),
  calls = { transform: 0, transformQuaternion: 0, setParent: 0, applySync: 0 };
const api = ArkGlideRuntime.createEntityAPI(
    B,
    () => scene,
    () => null,
    { getWorld: () => world },
  ),
  entities = [];
try {
  for (let i = 0; i < count; i++) {
    const node = new B.TransformNode("node" + i, scene);
    if (i % 10) node.parent = api.getObject("node" + (i - 1));
    entities.push(api.register(node, "node" + i, "Node"));
  }
  const cases = [];
  for (const dirtyFraction of [0, 0.01, 0.1, 1]) {
    const durations = [];
    function step() {
      // Simulate physics/animation mutations outside the script facade.
      for (let i = 0; i < Math.ceil(count * dirtyFraction); i++)
        api.getObject("node" + i).position.x += 0.001;
      api.sync();
      for (const entity of entities) entity.getWorldPosition();
    }
    // Count one untimed frame, then restore direct native methods. Timing must
    // not charge the old implementation for thousands of counter wrappers.
    const originals = {};
    for (const method of Object.keys(calls)) {
      calls[method] = 0;
      originals[method] = world[method];
      world[method] = (...args) => {
        calls[method]++;
        return originals[method].apply(world, args);
      };
    }
    step();
    for (const method of Object.keys(calls)) world[method] = originals[method];
    const boundaryCalls = { ...calls };
    for (let sample = -1; sample < samples; sample++) {
      const started = performance.now();
      for (let frame = 0; frame < frames; frame++) step();
      if (sample >= 0) durations.push((performance.now() - started) / frames);
    }
    durations.sort((a, b) => a - b);
    cases.push({
      dirtyFraction,
      medianFrameMs: durations[Math.floor(samples / 2)],
      callsPerFrame: boundaryCalls,
    });
  }
  console.log(
    JSON.stringify(
      {
        runtime: process.version,
        entities: count,
        frames,
        samples,
        backend: api.stats().sceneBackend,
        cases,
      },
      null,
      2,
    ),
  );
} finally {
  engine.dispose();
  world.delete();
}
