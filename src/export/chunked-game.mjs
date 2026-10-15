import "../vendor/acorn.js";
import "../engine/module-runtime.js";
import "../engine/binary-runtime.js";
import { minify_sync } from "terser";
import { strToU8, zipSync } from "fflate";
const B = globalThis.ArkGlideBinary,
  M = globalThis.ArkGlideModules;
export function createChunkedGame(project, maps, runtime, options, validate) {
  const { files: runtimeFiles, resources } = validate(project, maps, runtime),
    files = { ...runtimeFiles },
    catalog = {};
  function put(raw, folder, extension = "agb") {
    if (extension === "agb" && raw.length > options.maxChunkBytes)
      throw Error("二进制分块超过大小预算: " + folder);
    const hash = B.hash(raw),
      path = `${folder}/${hash}.${extension}`;
    files[path] ??= raw;
    return { path, byteLength: raw.length, hash };
  }
  const record = (value, folder) => put(B.encode(value), folder);
  const ids = new Map(
    Object.keys(project.scripts || {})
      .sort()
      .map((file, i) => [
        file,
        options.protectCode ? `m${i.toString(36)}.js` : file,
      ]),
  );
  const entryFiles = new Set(
    [
      ...project.scene.nodes,
      ...Object.values(project.content.prefabs).flatMap((p) => p.nodes),
    ].flatMap((n) => n.scripts || []),
  );
  for (const [file, source] of Object.entries(project.scripts || {})) {
    const info = M.inspect(source, file),
      legacy = entryFiles.has(file) && !info.hasExports;
    if (legacy)
      for (const node of info.imports)
        for (const binding of node.specifiers)
          if (M.parameters.includes(binding.local.name))
            throw Error("导入名称与注入 API 冲突: " + binding.local.name);
    let code = source;
    if (legacy) {
      const body = M.edits(
        source,
        info.imports.map((n) => [
          n.start,
          n.end,
          M.blank(source.slice(n.start, n.end)),
        ]),
      );
      code =
        info.imports.map((n) => source.slice(n.start, n.end) + ";").join("\n") +
        `\nexport default function(${M.parameters.join(",")}){\n${body}\n}`;
    }
    const dynamic = M.inspect(code, file).dynamic;
    code = M.edits(
      code,
      dynamic.map((n) => [
        n.start,
        n.end,
        `globalThis.__arkglideImport(${JSON.stringify(ids.get(M.resolve(file, n.source.value, project.scripts)))})`,
      ]),
    );
    // Rewrite static specifiers too: runtime URLs alone would leave source paths
    // visible inside the protected module chunks.
    code = M.edits(
      code,
      M.inspect(code, file).references.map((ref) => [
        ref.start,
        ref.end,
        JSON.stringify(ids.get(M.resolve(file, ref.value, project.scripts))),
      ]),
    );
    if (options.protectCode)
      code = minify_sync(code, {
        module: true,
        compress: { passes: 2 },
        mangle: true,
        format: { comments: false },
        sourceMap: false,
      }).code;
    const refs = M.inspect(code, file).references.map((r) => ({
      start: r.start,
      end: r.end,
      id: r.value,
    }));
    catalog["script:" + ids.get(file)] = {
      ...record({ code, refs, module: !legacy }, "modules"),
      kind: "script",
    };
  }
  for (const r of resources) {
    catalog[r.kind + ":" + r.id] = {
      ...put(r.raw, "assets", "bin"),
      kind: r.kind,
      id: r.id,
    };
  }
  const content = project.content;
  for (const category of [
    "materials",
    "animationControllers",
    "retargetProfiles",
  ])
    for (const [id, value] of Object.entries(content[category] || {}))
      catalog[category + ":" + id] = {
        ...record(value, "definitions"),
        kind: category,
        id,
      };
  for (const category of ["textures", "audio"])
    for (const value of content[category] || []) {
      const key =
        (category === "textures" ? "texture" : "audio") + ":" + value.id;
      catalog[key].definition = value;
    }
  function compileNodes(nodes) {
    return nodes.map((n) => {
      const copy = { ...n };
      delete copy.prefab;
      delete copy.modelUrl;
      copy.scripts = (n.scripts || []).map((file) => ids.get(file));
      return copy;
    });
  }
  function chunks(nodes) {
    const result = [];
    for (let i = 0; i < nodes.length; i += options.nodesPerChunk)
      result.push(
        record(
          compileNodes(nodes.slice(i, i + options.nodesPerChunk)),
          "scenes",
        ),
      );
    return result;
  }
  const prefabList = [];
  for (const [id, p] of Object.entries(content.prefabs || {})) {
    const descriptor = {
      id,
      name: p.name,
      revision: p.revision,
      nodeCount: p.nodes.length,
      rootId: p.rootId,
    };
    prefabList.push(descriptor);
    catalog["prefab:" + id] = {
      ...record(
        { ...descriptor, chunks: chunks(p.nodes), modelKeys: p.modelKeys },
        "prefabs",
      ),
      kind: "prefab",
    };
  }
  for (const key of options.preload)
    if (!Object.hasOwn(catalog, key) || key.startsWith("script:"))
      throw Error("预加载资源不存在或类型无效: " + key);
  const indexes = [],
    keys = Object.keys(catalog).sort();
  for (let i = 0; i < keys.length; i += options.indexEntriesPerChunk) {
    const group = keys.slice(i, i + options.indexEntriesPerChunk);
    indexes.push({
      first: group[0],
      last: group.at(-1),
      ...record(Object.fromEntries(group.map((k) => [k, catalog[k]])), "index"),
    });
  }
  const boot = record(
    {
      version: 2,
      projectId: project.projectId || "",
      name: project.name,
      settings: Object.fromEntries(
        Object.entries(project.settings || {}).filter(
          ([key]) => key !== "build",
        ),
      ),
      scene: chunks(project.scene.nodes),
      prefabs: prefabList,
      indexes,
      globals: {
        gameplay: content.gameplay,
        physics: content.physics,
        mixer: content.mixer,
      },
      preload: options.preload,
      limits: {
        maxIndexChunks: options.maxIndexChunks,
        batchNodes: options.batchNodes,
        concurrency: options.concurrency,
        maxChunkBytes: options.maxChunkBytes,
      },
    },
    "boot",
  );
  const runtimeList = Object.entries(runtimeFiles).map(([path, raw]) => ({
    path,
    byteLength: raw.length,
    hash: B.hash(raw),
  }));
  const manifest = {
    format: "arkglide-static-2",
    gameId: project.projectId || "",
    settings: options,
    boot,
    runtime: runtimeList,
    statistics: {
      resources: resources.length,
      prefabs: prefabList.length,
      scripts: ids.size,
      files: Object.keys(files).length + 2,
    },
    wasm: "embedded-single-file",
  };
  files["game-manifest.json"] = strToU8(JSON.stringify(manifest));
  files["DEPLOY-README.txt"] = strToU8(
    "ArkGlide 分块游戏包 v2\n将整个目录部署至 HTTP/HTTPS 静态服务器，打开 index.html 自动运行。不要双击 file://。\n场景/预制体/索引为字典编码二进制；脚本已在构建期转换。资源按需读取，不要删除未在首屏请求的文件。\n代码保护仅为压缩、局部变量改名、去注释与隐藏原脚本路径；客户端代码不能保密。游戏界面日志由打包配置控制。\n",
  );
  return { files, manifest, zip: () => zipSync(files, { level: 6 }) };
}
