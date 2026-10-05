// Emscripten MODULARIZE + EXPORT_ES6 产物类型声明
// default export 为 factory 函数，调用返回 Promise<WASM 实例>
const factory: () => Promise<any>;
export default factory;