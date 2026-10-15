import { createChunkedGame } from "./chunked-game.mjs";
import "../vendor/acorn.js";
import "../engine/module-runtime.js";

// Explicit offline runtime contract, shared by the editor and command-line exporter.
export { RUNTIME_FILES } from "./runtime-files.mjs";
import { RUNTIME_FILES } from "./runtime-files.mjs";
export { exportSettings } from "./export-settings.mjs";
import { exportSettings } from "./export-settings.mjs";
export function validateScriptGraph(scripts, nodes, prefabs = {}) {
  const api = globalThis.ArkGlideModules,
    entries = new Set();
  for (const n of [...nodes, ...Object.values(prefabs).flatMap((p) => p.nodes)])
    for (const file of n.scripts || []) entries.add(file);
  const info = new Map(),
    graph = {};
  for (const [file, source] of Object.entries(scripts)) {
    if (
      !file.endsWith(".js") ||
      /[\\\u0000?#:]/.test(file) ||
      file.startsWith("/") ||
      file.split("/").some((p) => !p || p === "." || p === "..")
    )
      throw Error("脚本必须使用项目内 .js 路径: " + file);
    info.set(file, api.inspect(source, file));
  }
  for (const entry of entries)
    if (!info.has(entry)) throw Error("脚本绑定缺失: " + entry);
  for (const [file, analysis] of info) {
    graph[file] = analysis.references.map((ref) => {
      const target = api.resolve(file, ref.value, scripts),
        dep = info.get(target);
      if (dep.topReturn || (entries.has(target) && !dep.hasExports))
        throw Error("不能导入旧式实体脚本: " + file + " → " + target);
      return target;
    });
  }
  const visiting = new Set(),
    visited = new Set();
  function visit(file) {
    if (visiting.has(file)) throw Error("暂不支持循环模块依赖: " + file);
    if (visited.has(file)) return;
    visiting.add(file);
    graph[file].forEach(visit);
    visiting.delete(file);
    visited.add(file);
  }
  Object.keys(graph).forEach(visit);
  return { entries: [...entries], graph };
}
function bytes(value, label, expected) {
  const result =
    value instanceof Uint8Array
      ? value
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : null;
  if (!result?.byteLength) throw Error("导出资源缺失或为空: " + label);
  if (expected !== undefined && result.byteLength !== expected)
    throw Error("资源大小不一致: " + label);
  return result;
}
function validateModel(raw, label) {
  let gltf,
    binaryContainer = false;
  try {
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    if (raw.length >= 12 && view.getUint32(0, true) === 0x46546c67) {
      binaryContainer = true;
      if (
        view.getUint32(4, true) !== 2 ||
        view.getUint32(8, true) !== raw.length ||
        raw.length < 20 ||
        view.getUint32(16, true) !== 0x4e4f534a
      )
        throw Error("无效 GLB 头部");
      const size = view.getUint32(12, true);
      if (size % 4 || 20 + size > raw.length)
        throw Error("GLB JSON 越界或未对齐");
      gltf = JSON.parse(new TextDecoder().decode(raw.subarray(20, 20 + size)));
      let offset = 20 + size,
        binarySize = null;
      while (offset < raw.length) {
        if (offset + 8 > raw.length) throw Error("GLB 块头不完整");
        const chunkSize = view.getUint32(offset, true),
          type = view.getUint32(offset + 4, true);
        if (chunkSize % 4 || offset + 8 + chunkSize > raw.length)
          throw Error("GLB 块越界或未对齐");
        if (type === 0x4e4f534a) throw Error("GLB JSON 块重复");
        if (type === 0x004e4942) {
          if (binarySize !== null || offset !== 20 + size)
            throw Error("GLB BIN 块顺序无效");
          binarySize = chunkSize;
        }
        offset += 8 + chunkSize;
      }
      for (const [index, buffer] of (gltf.buffers || []).entries()) {
        if (buffer.uri !== undefined) continue;
        if (
          index !== 0 ||
          binarySize === null ||
          !Number.isInteger(buffer.byteLength) ||
          buffer.byteLength <= 0 ||
          binarySize < buffer.byteLength ||
          binarySize > buffer.byteLength + 3
        )
          throw Error("GLB BIN 数据与缓冲区声明不一致");
      }
    } else gltf = JSON.parse(new TextDecoder().decode(raw));
  } catch (error) {
    throw Error("模型不是有效 GLB/glTF: " + label + "；" + error.message);
  }
  if (gltf.asset?.version !== "2.0") throw Error("仅支持 glTF 2.0: " + label);
  for (const buffer of gltf.buffers || []) {
    if (!Number.isInteger(buffer.byteLength) || buffer.byteLength <= 0)
      throw Error("模型缓冲区声明大小无效: " + label);
    if (
      (!binaryContainer || buffer.uri !== undefined) &&
      (typeof buffer.uri !== "string" || !buffer.uri)
    )
      throw Error("模型缓冲区缺少有效 URI: " + label);
  }
  for (const ref of [...(gltf.buffers || []), ...(gltf.images || [])]) {
    if (ref.uri && !/^data:/i.test(ref.uri))
      throw Error(
        "模型包含未打包的外部资源: " +
          label +
          " → " +
          ref.uri +
          "；请重新挂载整个资源文件夹",
      );
    if (ref.uri && /^data:/i.test(ref.uri)) {
      const match = ref.uri.match(/^data:([^,]*),(.*)$/is);
      if (!match) throw Error("模型包含无效 data URI: " + label);
      let decoded = "";
      for (let i = 0; i < match[2].length; i++) {
        if (match[2][i] === "%") {
          const hex = match[2].slice(i + 1, i + 3);
          if (!/^[0-9a-f]{2}$/i.test(hex))
            throw Error("模型包含无效 data URI: " + label);
          decoded += String.fromCharCode(parseInt(hex, 16));
          i += 2;
        } else decoded += match[2][i];
      }
      let length;
      if (/;base64$/i.test(match[1])) {
        try {
          length = atob(decoded).length;
        } catch {
          throw Error("模型包含无效 data URI: " + label);
        }
      } else {
        if (/[^\x00-\x7f]/.test(match[2].replace(/%[0-9a-f]{2}/gi, "")))
          throw Error("模型包含无效 data URI: " + label);
        length = decoded.length;
      }
      if (
        ref.byteLength !== undefined &&
        (!Number.isInteger(ref.byteLength) ||
          ref.byteLength <= 0 ||
          ref.byteLength > length)
      )
        throw Error("模型内嵌资源大小不一致: " + label);
    }
  }
  const unsupported = new Set([
    "KHR_draco_mesh_compression",
    "EXT_meshopt_compression",
    "KHR_texture_basisu",
  ]);
  for (const extension of new Set([
    ...(gltf.extensionsUsed || []),
    ...(gltf.extensionsRequired || []),
  ]))
    if (unsupported.has(extension))
      throw Error("独立包未内置该解码器: " + label + " → " + extension);
}
function collectPackage(project, resourceMaps, runtime) {
  const scripts = project.scripts || {},
    content = project.content || {};
  const modules = validateScriptGraph(
    scripts,
    project.scene.nodes,
    content.prefabs,
  );
  const files = Object.create(null),
    resources = [];
  for (const name of RUNTIME_FILES)
    files[name === "standalone.html" ? "index.html" : name] = bytes(
      runtime[name],
      name,
    );
  const runtimeHTML = new TextDecoder().decode(files["runtime.html"]);
  for (const match of runtimeHTML.matchAll(/<script\s+src="([^"]+)"/g)) {
    const path = match[1].replace(/^\.\//, "");
    if (!Object.hasOwn(files, path)) throw Error("运行时清单遗漏依赖: " + path);
  }
  const modelIds = new Set();
  for (const ref of project.modelRefs || []) {
    if (modelIds.has(ref.assetId)) continue;
    modelIds.add(ref.assetId);
    const raw = bytes(resourceMaps.models.get(ref.assetId), ref.assetId);
    validateModel(raw, ref.assetId);
    resources.push({ kind: "model", id: ref.assetId, raw });
  }
  for (const [kind, list, map] of [
    ["texture", content.textures || [], resourceMaps.textures],
    ["audio", content.audio || [], resourceMaps.audio],
  ])
    for (const asset of list) {
      const raw = bytes(map.get(asset.id), asset.name, asset.byteLength);
      resources.push({ kind, id: asset.id, raw });
    }
  return { files, resources, modules };
}
export function createStaticGame(project, maps, runtime, settings = {}) {
  return createChunkedGame(
    project,
    maps,
    runtime,
    exportSettings({
      title: project.name,
      ...project.settings?.build,
      ...settings,
    }),
    collectPackage,
  );
}
