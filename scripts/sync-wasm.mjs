import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/wasm/arkglide_math.js', import.meta.url), 'utf8');
// A classic-script copy is needed inside sandbox=allow-scripts (opaque origin).
const classic = 'globalThis.ArkGlideMathScriptURL = document.currentScript.src;\n' + source
  .replaceAll('import.meta.url', 'globalThis.ArkGlideMathScriptURL')
  .replace(/export default (\w+);?\s*$/, 'globalThis.createArkGlideMath = $1;\n');
writeFileSync(new URL('../public/lib/arkglide_math.js', import.meta.url), classic);
