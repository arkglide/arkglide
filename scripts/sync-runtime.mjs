import './sync-wasm.mjs';
import { copyFileSync } from 'node:fs';
copyFileSync(new URL('../src/engine/scene-runtime.js', import.meta.url), new URL('../public/arkglide-scene.js', import.meta.url));
