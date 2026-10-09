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
  cross(other: ArkGlideMathVec3): ArkGlideMathVec3;
  dot(other: ArkGlideMathVec3): number;
  lerp(other: ArkGlideMathVec3, t: number): ArkGlideMathVec3;
  distance(other: ArkGlideMathVec3): number;
  equals(other: ArkGlideMathVec3, epsilon: number): boolean;
  delete(): void;
}

export interface ArkGlideMathMatrix {
  get(index: number): number; set(index: number, value: number): void;
  multiply(other: ArkGlideMathMatrix): ArkGlideMathMatrix; delete(): void;
}
export interface ArkGlideMathQuaternion {
  x: number; y: number; z: number; w: number;
  normalize(): ArkGlideMathQuaternion;
  slerp(other: ArkGlideMathQuaternion, t: number): ArkGlideMathQuaternion;
  toMatrix(): ArkGlideMathMatrix; delete(): void;
}
export interface ArkGlideMathModule {
  Matrix4: {
    new (): ArkGlideMathMatrix;
    identity(): ArkGlideMathMatrix;
    translate(x:number,y:number,z:number): ArkGlideMathMatrix;
    rotate(angle:number,x:number,y:number,z:number): ArkGlideMathMatrix;
    scale(x:number,y:number,z:number): ArkGlideMathMatrix;
  };
  Quaternion: {
    new (x:number,y:number,z:number,w:number): ArkGlideMathQuaternion;
    fromEuler(x:number,y:number,z:number): ArkGlideMathQuaternion;
  };
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
let loaded: Promise<ArkGlideMathModule> | undefined;
export function loadMathModule(): Promise<ArkGlideMathModule> {
  return loaded ??= load().catch(error => { loaded = undefined; throw error; });
}
async function load(): Promise<ArkGlideMathModule> {
  const factory = (await import('../../wasm/arkglide_math.js')).default;
  return (await factory()) as ArkGlideMathModule;
}