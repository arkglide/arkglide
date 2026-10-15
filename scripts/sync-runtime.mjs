import "./sync-wasm.mjs";
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
