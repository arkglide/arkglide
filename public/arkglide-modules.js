// Native ES modules for project JavaScript, shared by the runtime and editor.
// Acorn is vendored locally; user source is never transpiled to TypeScript.
(function (root) {
  "use strict";
  const parameters = [
    "entity",
    "input",
    "scene",
    "time",
    "console",
    "defineScript",
    "math",
    "events",
    "timers",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "prefabs",
    "physics",
    "audio",
    "ui",
    "animation",
  ];
  function failure(file, message, node) {
    const error = new Error(message);
    error.arkglideFile = file;
    error.arkglideLine = node?.loc?.start?.line || node?.lineNumber || null;
    error.arkglideColumn = node?.loc?.start ? node.loc.start.column + 1 : null;
    return error;
  }
  function inspect(source, file = "") {
    let ast;
    try {
      ast = root.acorn.parse(source, {
        ecmaVersion: 2022,
        sourceType: "module",
        allowReturnOutsideFunction: true,
        locations: true,
      });
    } catch (error) {
      throw failure(file, "JavaScript 语法错误: " + error.message, {
        loc: { start: error.loc },
      });
    }
    const imports = [],
      references = [],
      dynamic = [];
    let hasExports = false,
      topReturn = false;
    for (const node of ast.body) {
      if (node.type.startsWith("Export")) hasExports = true;
      if (node.type === "ImportDeclaration") imports.push(node);
      if (
        node.source &&
        (node.type === "ImportDeclaration" || node.type.startsWith("Export"))
      )
        references.push(node.source);
    }
    function walk(node, functionDepth = 0) {
      if (!node || typeof node !== "object" || !node.type) return;
      const isFunction =
        /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(
          node.type,
        );
      if (node.type === "ReturnStatement" && !functionDepth) topReturn = true;
      if (
        (node.type === "AwaitExpression" ||
          (node.type === "ForOfStatement" && node.await)) &&
        !functionDepth
      )
        throw failure(
          file,
          "暂不支持顶层 await；请在脚本启动后的异步函数中使用 await",
          node,
        );
      if (node.type === "ImportExpression") {
        if (
          node.source.type !== "Literal" ||
          typeof node.source.value !== "string"
        )
          throw failure(
            file,
            "import() 必须使用项目内的字符串字面量路径，例如 import('./utils.js')",
            node,
          );
        references.push(node.source);
        dynamic.push(node);
      }
      for (const [key, value] of Object.entries(node)) {
        if (["loc", "start", "end"].includes(key)) continue;
        if (Array.isArray(value))
          value.forEach((child) =>
            walk(child, functionDepth + Number(isFunction)),
          );
        else if (value && typeof value === "object")
          walk(value, functionDepth + Number(isFunction));
      }
    }
    walk(ast);
    if (hasExports && topReturn)
      throw failure(
        file,
        "export 模块不能包含顶层 return；请使用 export default function(context) { return ... }",
        ast,
      );
    return { imports, references, dynamic, hasExports, topReturn };
  }
  function resolve(from, specifier, sources) {
    if (
      typeof specifier !== "string" ||
      !/^(\.\/|\.\.\/)/.test(specifier) ||
      /[\\?#\u0000]/.test(specifier)
    )
      throw failure(from, "仅支持项目内相对 JavaScript 路径: " + specifier);
    const parts = from.split("/").slice(0, -1);
    for (const part of specifier.split("/")) {
      if (part === "." || !part) continue;
      if (part === "..") {
        if (!parts.length)
          throw failure(from, "模块路径不能越过项目脚本根目录: " + specifier);
        parts.pop();
      } else parts.push(part);
    }
    const path = parts.join("/");
    if (!path.endsWith(".js"))
      throw failure(from, "模块路径必须明确包含 .js 后缀: " + specifier);
    if (sources && !Object.hasOwn(sources, path))
      throw failure(from, "模块不存在: " + specifier + "（来自 " + from + "）");
    return path;
  }
  function edits(source, replacements) {
    for (const [start, end, text] of replacements.sort((a, b) => b[0] - a[0]))
      source = source.slice(0, start) + text + source.slice(end);
    return source;
  }
  function blank(text) {
    return text.replace(/[^\r\n]/g, " ");
  }
  // Tolerant lexical analysis keeps completions working while the final line is
  // incomplete. Import declarations retain their original offset mappings.
  function languageInfo(source) {
    try {
      return inspect(source);
    } catch {}
    const imports = [],
      references = [],
      history = [];
    let hasExports = false,
      depth = 0,
      start = null,
      exportStart = null;
    try {
      const tokens = root.acorn.tokenizer(source, {
        ecmaVersion: 2022,
        sourceType: "module",
      });
      for (;;) {
        const token = tokens.getToken(),
          label = token.type.label;
        if (label === "eof") break;
        if (!depth && label === "export") {
          hasExports = true;
          exportStart = token.start;
        }
        if (
          label === "string" && history.at(-1) === "(" &&
          history.at(-2) === "import" && ![".", "?."].includes(history.at(-3))
        )
          references.push({ value: token.value, start: token.start, end: token.end });
        if (exportStart !== null && label === "string" && history.at(-1) === "name") {
          try {
            const node = root.acorn.parse(source.slice(exportStart, token.end), {
              ecmaVersion: 2022,
              sourceType: "module",
            }).body[0];
            if (node.source)
              references.push({
                ...node.source,
                start: exportStart + node.source.start,
                end: exportStart + node.source.end,
              });
          } catch {}
          exportStart = null;
        }
        if (!depth && label === ";") exportStart = null;
        if (!depth && label === "import") start = token.start;
        else if (start !== null) {
          if (label === "(" || label === ".") start = null;
          else if (label === "string") {
            const text = source.slice(start, token.end);
            try {
              const node = root.acorn.parse(text, {
                ecmaVersion: 2022,
                sourceType: "module",
              }).body[0];
              if (node.type === "ImportDeclaration") {
                imports.push({ ...node, start, end: token.end });
                references.push({
                  ...node.source,
                  start: start + node.source.start,
                  end: start + node.source.end,
                });
              }
            } catch {}
            start = null;
          }
        }
        if (["{", "(", "[", "${"].includes(label)) depth++;
        if (["}", ")", "]"].includes(label)) depth--;
        history.push(label);
        if (history.length > 3) history.shift();
      }
    } catch {}
    return { imports, hasExports, references };
  }
  function rewriteRename(sources, oldName, newName) {
    const result = {};
    function relative(from, to) {
      const a = from.split("/").slice(0, -1),
        b = to.split("/");
      while (a.length && b.length && a[0] === b[0]) {
        a.shift();
        b.shift();
      }
      const path = [...a.map(() => ".."), ...b].join("/");
      return path.startsWith("../") ? path : "./" + path;
    }
    for (const [file, source] of Object.entries(sources)) {
      const moved = file === oldName ? newName : file;
      let references;
      try {
        references = inspect(source, file).references;
      } catch {
        references = languageInfo(source).references;
      }
      const replacements = [];
      for (const ref of references) {
        try {
          const target = resolve(file, ref.value);
          if (file === oldName || target === oldName)
            replacements.push([
              ref.start,
              ref.end,
              JSON.stringify(
                relative(moved, target === oldName ? newName : target),
              ),
            ]);
        } catch {}
      }
      result[moved] = edits(source, replacements);
    }
    return result;
  }
  function createLoader(sources, entryFiles, options = {}) {
    const entries = new Set(entryFiles),
      analyses = new Map(),
      urls = new Map(),
      offsets = new Map(),
      bodyMaps = new Map(),
      factories = new Map(),
      errors = new Map();
    const createURL =
      options.createURL ||
      ((code) =>
        URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
    const revokeURL = options.revokeURL || ((url) => URL.revokeObjectURL(url));
    const importModule =
      options.importModule || ((url) => import(/* @vite-ignore */ url));
    let disposed = false;
    function analyze(file) {
      if (!Object.hasOwn(sources, file))
        throw failure(file, "脚本不存在: " + file);
      if (!file.endsWith(".js"))
        throw failure(file, "运行脚本仅支持 JavaScript (.js): " + file);
      if (!analyses.has(file)) analyses.set(file, inspect(sources[file], file));
      return analyses.get(file);
    }
    function build(file, chain = []) {
      if (chain.includes(file))
        throw failure(
          file,
          "暂不支持循环模块依赖: " + [...chain, file].join(" → "),
        );
      if (urls.has(file)) return urls.get(file);
      const info = analyze(file),
        source = sources[file],
        replacements = [];
      for (const ref of info.references) {
        const target = resolve(file, ref.value, sources),
          dependency = analyze(target);
        if (
          dependency.topReturn ||
          (entries.has(target) && !dependency.hasExports)
        )
          throw failure(
            file,
            "不能导入旧式实体脚本 " +
              target +
              "；请把公共代码提取为 export 工具模块",
            ref,
          );
        replacements.push([
          ref.start,
          ref.end,
          JSON.stringify(build(target, [...chain, file])),
        ]);
      }
      let code = edits(source, replacements),
        offset = 0;
      let bodyReplacements = replacements;
      if (entries.has(file) && !info.hasExports) {
        // Imports remain native bindings. The per-entity factory closes over the
        // module namespace while API parameters stay owned by its script instance.
        const transformed = inspect(code, file);
        for (const node of info.imports)
          for (const binding of node.specifiers)
            if (parameters.includes(binding.local.name))
              throw failure(
                file,
                "导入名称 " +
                  binding.local.name +
                  " 与注入 API 冲突，请使用 as 别名",
                binding,
              );
        const header =
          transformed.imports
            .map((n) => code.slice(n.start, n.end) + ";\n")
            .join("") +
          "export default function(" +
          parameters.join(",") +
          ") {\n";
        bodyReplacements = replacements.filter(
          ([start]) =>
            !info.imports.some((n) => start >= n.start && start < n.end),
        );
        bodyReplacements.push(
          ...info.imports.map((n) => [
            n.start,
            n.end,
            blank(source.slice(n.start, n.end)),
          ]),
        );
        const body = edits(source, bodyReplacements);
        code = header + body + "\n}";
        bodyMaps.set(file, {
          source,
          body,
          replacements: [...bodyReplacements].sort((a, b) => a[0] - b[0]),
        });
        offset = header.split("\n").length - 1;
      } else
        bodyMaps.set(file, {
          source,
          body: code,
          replacements: [...bodyReplacements].sort((a, b) => a[0] - b[0]),
        });
      code += "\n//# sourceURL=arkglide-module:///" + encodeURIComponent(file);
      const url = createURL(code);
      urls.set(file, url);
      offsets.set(file, offset);
      return url;
    }
    async function prepare() {
      if (disposed) return;
      await Promise.all(
        [...entries].map(async (file) => {
          if (disposed) return;
          try {
            const info = analyze(file);
            if (!info.hasExports && !info.references.length) return;
            const namespace = await importModule(build(file));
            if (disposed) return;
            if (typeof namespace.default !== "function")
              throw failure(
                file,
                "挂载的 ES 模块必须 export default 一个脚本工厂函数",
              );
            factories.set(file, {
              factory: namespace.default,
              module: info.hasExports,
            });
          } catch (error) {
            if (!disposed) errors.set(file, error);
          }
        }),
      );
    }
    function get(file) {
      if (disposed) throw failure(file, "脚本模块加载已取消");
      if (errors.has(file)) throw errors.get(file);
      return factories.get(file) || null;
    }
    function locate(error) {
      if (error?.arkglideFile)
        return {
          file: error.arkglideFile,
          line: error.arkglideLine,
          column: error.arkglideColumn,
        };
      const stack = String(error?.stack || "");
      const match = stack.match(/arkglide-module:\/\/\/([^\s:]+):(\d+):(\d+)/);
      if (match) {
        const file = decodeURIComponent(match[1]);
        return originalLocation(file, Number(match[2]), Number(match[3]));
      }
      for (const [file, url] of urls) {
        const index = stack.indexOf(url + ":");
        if (index < 0) continue;
        const location = stack.slice(index + url.length).match(/^:(\d+):(\d+)/);
        if (location)
          return originalLocation(
            file,
            Number(location[1]),
            Number(location[2]),
          );
      }
      return null;
    }
    function originalLocation(file, generatedLine, generatedColumn) {
      const line = Math.max(1, generatedLine - (offsets.get(file) || 0)),
        map = bodyMaps.get(file);
      if (!map) return { file, line, column: generatedColumn };
      const lines = map.body.split("\n");
      let position =
        lines.slice(0, line - 1).reduce((sum, s) => sum + s.length + 1, 0) +
        generatedColumn -
        1;
      let delta = 0;
      for (const [start, end, text] of map.replacements) {
        const generatedStart = start + delta;
        if (position < generatedStart) break;
        if (position < generatedStart + text.length) {
          position = start + Math.min(position - generatedStart, end - start);
          delta = 0;
          break;
        }
        delta += text.length - (end - start);
      }
      position = Math.max(0, position - delta);
      const before = map.source.slice(0, position),
        originalLines = before.split("\n");
      return {
        file,
        line: originalLines.length,
        column: originalLines.at(-1).length + 1,
      };
    }
    function dispose() {
      disposed = true;
      for (const url of urls.values()) revokeURL(url);
      urls.clear();
      factories.clear();
      errors.clear();
      analyses.clear();
      offsets.clear();
      bodyMaps.clear();
    }
    return {
      prepare,
      get,
      locate,
      dispose,
      stats: () => ({ modules: urls.size, factories: factories.size }),
    };
  }
  root.ArkGlideModules = {
    parameters,
    inspect,
    languageInfo,
    resolve,
    blank,
    rewriteRename,
    createLoader,
  };
})(globalThis);
