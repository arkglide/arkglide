// ArkGlide WASM 数学模块加载器
// 动态导入 Emscripten 生成的 ES 模块，调用 factory 获取 WASM 实例

export interface ArkGlideMathVec3 {
  x: number;
  y: number;
  z: number;
  add(other: ArkGlideMathVec3): ArkGlideMathVec3;
  sub(other: ArkGlideMathVec3): ArkGlideMathVec3;
  scale(s: number): ArkGlideMathVec3;
  length(): number;
  normalize(): ArkGlideMathVec3;
}

export interface ArkGlideMathModule {
  Vector3: {
    new (x: number, y: number, z: number): ArkGlideMathVec3;
  };
  addVectors(a: ArkGlideMathVec3, b: ArkGlideMathVec3): ArkGlideMathVec3;
}

/**
 * 加载 ArkGlide WASM 数学模块。
 * 动态导入 src/wasm/arkglide_math.js（Emscripten MODULARIZE + EXPORT_ES6 产物），
 * 调用 default export（factory 函数）获取 WASM 实例。
 *
 * 使用相对路径让 Vite 全权处理模块解析与打包，避免 public 目录限制。
 */
export async function loadMathModule(): Promise<ArkGlideMathModule> {
  const factory = (await import('../../wasm/arkglide_math.js')).default;
  return await factory();
}