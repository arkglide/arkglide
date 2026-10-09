import factory from '../src/wasm/arkglide_math.js';
import '../public/arkglide-math.js';
import '../public/math-benchmark.js';
const module=await factory();
const wasm=globalThis.ArkGlideMath.createMathAPI(module);
const javascript=globalThis.ArkGlideMath.createMathAPI(null);
const report=globalThis.ArkGlideBenchmark.runMathBenchmark(wasm,javascript,Number(process.env.BENCH_ITERATIONS || 2000));
console.log(JSON.stringify({runtime:process.version,...report},null,2));
