import "./sync-wasm.mjs";
import "./sync-ktx2.mjs";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
copyFileSync(
  new URL("../src/engine/scene-runtime.js", import.meta.url),
  new URL("../public/arkglide-scene.js", import.meta.url),
);
copyFileSync(
  new URL("../src/engine/lifecycle-runtime.js", import.meta.url),
  new URL("../public/arkglide-lifecycle.js", import.meta.url),
);

copyFileSync(
  new URL("../src/engine/prefab-runtime.js", import.meta.url),
  new URL("../public/arkglide-prefabs.js", import.meta.url),
);

for (const [source, target] of [
  ["rendering-config", "rendering-config"],
  ["atmosphere-runtime", "atmosphere"],
  ["volumetric-runtime", "volumetric"],
  ["lighting-uv", "lighting-uv"],
  ["baked-lighting", "baked-lighting"],
  ["geometry-cluster", "geometry-cluster"],
  ["scene-optimization", "scene-optimization"],
  ["static-instances", "static-instances"],
  ["ktx2-runtime", "ktx2"],
  ["scene-benchmark-metrics", "scene-benchmark-metrics"],
  ["realtime-probes", "realtime-probes"],
  ["temporal-runtime", "temporal"],
  ["transmission-runtime", "transmission"],
  ["reflection-runtime", "reflections"],
  ["render-view-budget", "render-view-budget"],
  ["rendering-runtime", "rendering"],
  ["timing-runtime", "timing"],
  ["render-compute", "render-compute"],
  ["ui-style-runtime", "ui-styles"],
  ["binary-runtime", "binary"],
  ["package-runtime", "package"],
  ["state-runtime", "state"],
  ["storage-host", "storage-host"],
  ["visual-runtime", "visuals"],
  ["surface-runtime", "surfaces"],
  ["field-runtime", "fields"],
  ["trigger-runtime", "triggers"],
  ["signal-runtime", "signals"],
  ["motion-runtime", "motion"],
  ["optics-runtime", "optics"],
  ["level-runtime", "levels"],
  ["checkpoint-runtime", "checkpoints"],
  ["portal-projection", "portal-projection"],
  ["spatial-runtime", "spatial"],
  ["camera-runtime", "cameras"],
  ["portal-runtime", "portals"],
  ["interaction-runtime", "interaction"],
  ["physics-runtime", "physics"],
  ["physics-advanced", "physics-tools"],
  ["input-ui-runtime", "input-ui"],
  ["audio-runtime", "audio"],
  ["audio-stretch", "audio-stretch"],
  ["animation-runtime", "animation"],
  ["animation-compute", "animation-compute"],
  ["animation-advanced", "animation-tools"],
])
  copyFileSync(
    new URL("../src/engine/" + source + ".js", import.meta.url),
    new URL("../public/arkglide-" + target + ".js", import.meta.url),
  );

copyFileSync(
  new URL("../src/vendor/acorn.js", import.meta.url),
  new URL("../public/lib/acorn.js", import.meta.url),
);
copyFileSync(
  new URL("../src/vendor/ACORN_LICENSE.txt", import.meta.url),
  new URL("../public/lib/ACORN_LICENSE.txt", import.meta.url),
);
copyFileSync(
  new URL("../src/engine/module-runtime.js", import.meta.url),
  new URL("../public/arkglide-modules.js", import.meta.url),
);

// Licenses must travel with independent static games.
copyFileSync(new URL("../LICENSE", import.meta.url), new URL("../public/lib/arkglide-LICENSE.txt", import.meta.url));
writeFileSync(
  new URL("../public/lib/babylon-LICENSE.md", import.meta.url),
  readFileSync(new URL("../node_modules/@babylonjs/core/license.md", import.meta.url), "utf8").replace(/\r\n/g, "\n"),
);
