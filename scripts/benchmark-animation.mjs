// Full controller update, including clip selection, validation and Babylon writes.
import * as B from "@babylonjs/core";
import factory from "../src/wasm/arkglide_math.js";
import "../src/engine/animation-compute.js";
import "../src/engine/animation-advanced.js";
import "../src/engine/animation-runtime.js";
B.Logger.LogLevels = 0;
const module = await factory(),
  frames = Number(process.env.BENCH_FRAMES || 120),
  samples = Number(process.env.BENCH_SAMPLES || 5),
  sizes = (process.env.BENCH_BONES || "8,64,256").split(",").map(Number),
  keyCounts = (process.env.BENCH_KEYS || "2,61").split(",").map(Number);
if (
  ![frames, samples, ...sizes, ...keyCounts].every(
    (n) => Number.isSafeInteger(n) && n > 0,
  ) ||
  sizes.some((n) => n > 1024) ||
  keyCounts.some((n) => n > 1000)
)
  throw Error("Invalid animation benchmark sizes");
function rig(boneCount, keyCount, enabled) {
  const engine = new B.NullEngine(),
    scene = new B.Scene(engine),
    entity = { id: "rig" },
    bones = Array.from({ length: boneCount }, (_, i) => {
      const node = new B.TransformNode("bone" + i, scene);
      node.rotationQuaternion = B.Quaternion.Identity();
      return node;
    }),
    groups = [];
  for (let clip = 0; clip < 2; clip++) {
    const group = new B.AnimationGroup("clip" + clip, scene);
    for (let i = 0; i < boneCount; i++)
      for (const path of ["position", "rotationQuaternion", "scaling"]) {
        const quaternion = path === "rotationQuaternion",
          animation = new B.Animation(path, path, 60, quaternion ? 2 : 1);
        animation.setKeys(
          Array.from({ length: keyCount }, (_, k) => {
            const t = keyCount === 1 ? 0 : k / (keyCount - 1);
            return {
              frame: t * 60,
              value: quaternion
                ? B.Quaternion.RotationYawPitchRoll(t + clip, i * 0.01, 0.1)
                : new B.Vector3(
                    t + clip + i * 0.01,
                    path === "scaling" ? 1 : 0,
                    1,
                  ),
            };
          }),
        );
        group.addTargetedAnimation(animation, bones[i]);
      }
    groups.push(group);
  }
  const state = {
      name: "Blend",
      speed: 1,
      loop: true,
      events: [],
      blend: {
        kind: "1d",
        parameterX: "speed",
        children: [
          { clip: "clip0", threshold: 0 },
          { clip: "clip1", threshold: 1 },
        ],
      },
    },
    runtime = ArkGlideAnimation.createAnimation({
      BABYLON: B,
      coreModule: module,
      computeSettings: { enabled, minTracks: 0 },
      find: () => entity,
      getGroups: () => groups,
      controllers: {
        rig: {
          defaultState: "Blend",
          parameters: { speed: 0.4 },
          states: [state],
          transitions: [],
        },
      },
    });
  runtime.forOwner().createController(entity, "rig");
  return {
    runtime,
    bones,
    dispose() {
      runtime.dispose();
      engine.dispose();
    },
  };
}
function measure(runtime) {
  for (let i = 0; i < frames; i++) runtime.fixedUpdate(1 / 60);
  const values = [];
  for (let sample = 0; sample < samples; sample++) {
    const start = performance.now();
    for (let i = 0; i < frames; i++) runtime.fixedUpdate(1 / 60);
    values.push((performance.now() - start) / frames);
  }
  return values.sort((a, b) => a - b)[Math.floor(samples / 2)];
}
const cases = [];
for (const bones of sizes)
  for (const keys of keyCounts) {
    let start = performance.now();
    const js = rig(bones, keys, false),
      javascriptSetupMs = performance.now() - start;
    start = performance.now();
    const wasm = rig(bones, keys, true),
      nativeSetupMs = performance.now() - start;
    try {
      let maxDifference = 0;
      for (let i = 0; i < 125; i++) {
        js.runtime.fixedUpdate(1 / 60);
        wasm.runtime.fixedUpdate(1 / 60);
        for (let b = 0; b < bones; b++)
          for (const path of ["position", "rotationQuaternion", "scaling"]) {
            const a = js.bones[b][path].asArray(),
              c = wasm.bones[b][path].asArray();
            for (let j = 0; j < a.length; j++)
              maxDifference = Math.max(maxDifference, Math.abs(a[j] - c[j]));
          }
      }
      if (maxDifference > 1e-9) throw Error("Animation parity failed");
      const javascriptMs = measure(js.runtime),
        wasmMs = measure(wasm.runtime);
      cases.push({
        bones,
        channels: bones * 3,
        clips: 2,
        keysPerChannel: keys,
        javascriptMs,
        wasmMs,
        ratio: javascriptMs / wasmMs,
        maxDifference,
        javascriptSetupMs,
        nativeSetupMs,
        nativeStats: wasm.runtime.stats(),
      });
    } finally {
      js.dispose();
      wasm.dispose();
    }
  }
console.log(
  JSON.stringify(
    {
      date: new Date().toISOString(),
      node: process.version,
      frames,
      samples,
      scope:
        "Complete fixed-step controller updates, including JS clip selection, cache validity checks, WASM calls and Babylon target writes. No GPU, skeleton skinning, physics or FPS claim; setup includes fixture creation and is measured separately.",
      cases,
    },
    null,
    2,
  ),
);
