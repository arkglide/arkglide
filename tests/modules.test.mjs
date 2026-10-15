import test from "node:test";
import assert from "node:assert/strict";
import "../src/vendor/acorn.js";
import "../src/engine/module-runtime.js";
const M = globalThis.ArkGlideModules;
function loader(sources, entries, extra = {}) {
  let serial = 0;
  const codes = [],
    revoked = [];
  const result = M.createLoader(sources, entries, {
    createURL(code) {
      codes.push(code);
      return (
        "data:text/javascript;base64," +
        Buffer.from(
          code + "\n// graph " + ++serial + ":" + Math.random(),
        ).toString("base64")
      );
    },
    revokeURL(url) {
      revoked.push(url);
    },
    ...extra,
  });
  return { ...result, codes, revoked };
}

test("native imports support live bindings, default, aliases, namespace, reexports and side effects", async () => {
  globalThis.moduleEffect = 0;
  const l = loader(
    {
      "effect.js": "globalThis.moduleEffect++;",
      "utils.js":
        "import './effect.js'; export let counter = 0; export const speed = 3; export function inc(){ counter++; } export default x => x * 2;",
      "barrel.js":
        "export {default, speed as velocity, counter, inc} from './utils.js'; export * from './utils.js';",
      "main.js":
        "import double, {velocity, counter, inc} from './barrel.js'; import * as utils from './utils.js'; let local=0; return {run(){local++; inc(); return [double(velocity), counter, utils.counter, local];}};",
    },
    ["main.js"],
  );
  await l.prepare();
  const factory = l.get("main.js").factory,
    a = factory(),
    b = factory();
  assert.deepEqual(a.run(), [6, 1, 1, 1]);
  assert.deepEqual(b.run(), [6, 2, 2, 1]);
  assert.equal(globalThis.moduleEffect, 1);
  l.dispose();
  assert.equal(l.revoked.length, 4);
  assert.equal(l.stats().modules, 0);
  delete globalThis.moduleEffect;
});

test("exported factories receive isolated API contexts; literal dynamic imports use the project graph", async () => {
  const l = loader(
    {
      "utils.js": "export const value = 7;",
      "main.js":
        "export default function({entity, timers}) { let n=0; return {id:entity.id, run(){n++; timers.after(1,()=>{}); return n;}, async load(){return (await import('./utils.js')).value;}}; }",
    },
    ["main.js"],
  );
  await l.prepare();
  const prepared = l.get("main.js");
  assert.equal(prepared.module, true);
  const calls = [],
    a = prepared.factory({
      entity: { id: "a" },
      timers: {
        after() {
          calls.push("a");
        },
      },
    }),
    b = prepared.factory({
      entity: { id: "b" },
      timers: {
        after() {
          calls.push("b");
        },
      },
    });
  assert.equal(a.run(), 1);
  assert.equal(b.run(), 1);
  assert.deepEqual(calls, ["a", "b"]);
  assert.equal(await a.load(), 7);
  l.dispose();
});

test("invalid graphs report actionable file diagnostics without breaking unrelated entry scripts", async () => {
  for (const [source, pattern] of [
    ["import './missing.js'; return {};", /模块不存在/],
    ["import 'https://example.com/a.js'; return {};", /相对/],
    ["import '../escape.js'; return {};", /根目录/],
    ["import './utils'; return {};", /\.js/],
    ["import {value as entity} from './utils.js'; return {};", /API 冲突/],
    ["return {load(path){return import(path);}};", /字符串字面量/],
    ["export default {};", /工厂函数/],
    ["export const value=1; return {};", /顶层 return/],
    [
      "await Promise.resolve(); export default function(){return {};}",
      /顶层 await/,
    ],
    [
      "for await (const item of []) {} export default function(){return {};}",
      /顶层 await/,
    ],
    [
      "import {unknown} from './utils.js'; return {};",
      /export named 'unknown'|export named|does not provide/,
    ],
  ]) {
    const l = loader(
      {
        "main.js": source,
        "utils.js": "export const value=1;",
        "good.js": "export default function(){return {ok:true};}",
      },
      ["main.js", "good.js"],
    );
    await l.prepare();
    assert.throws(() => l.get("main.js"), pattern);
    assert.equal(l.get("good.js").factory().ok, true);
    l.dispose();
  }
  const cycle = loader(
    {
      "main.js": "import './a.js'; return {};",
      "a.js": "import './b.js';",
      "b.js": "import './a.js';",
    },
    ["main.js"],
  );
  await cycle.prepare();
  assert.throws(() => cycle.get("main.js"), /循环模块依赖.*a.js.*b.js.*a.js/);
  cycle.dispose();
});

test("async iteration inside a script factory remains supported", async () => {
  const l = loader({"main.js":"export default function(){return {async run(){let sum=0;for await (const item of [1,2]) sum+=item;return sum;}};}"}, ["main.js"]);
  await l.prepare();
  assert.equal(await l.get("main.js").factory().run(), 3);
  l.dispose();
});

test("native module errors map rewritten import paths and factory headers to original line and column", async () => {
  for (const source of [
    "import {value} from './utils.js'; export default function(){ throw new Error('mapped'); }",
    "import {value} from './utils.js'; return {run(){ throw new Error('mapped'); }};",
  ]) {
    const l = loader(
      { "main.js": source, "utils.js": "export const value=1;" },
      ["main.js"],
    );
    await l.prepare();
    let error;
    try {
      const prepared = l.get("main.js"),
        instance = prepared.factory();
      instance?.run();
    } catch (e) {
      error = e;
    }
    const location = l.locate(error);
    assert.equal(location.file, "main.js");
    assert.equal(location.line, 1);
    assert.equal(location.column, source.indexOf("new Error") + 1);
    l.dispose();
  }
});

test("cancellation revokes blobs and never retains late module factories", async () => {
  let finish;
  const l = loader(
    { "main.js": "export default function(){return {}; }" },
    ["main.js"],
    {
      importModule: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
  );
  const loading = l.prepare();
  l.dispose();
  finish({ default: () => ({}) });
  await loading;
  assert.equal(l.stats().factories, 0);
  assert.equal(l.revoked.length, 1);
  assert.throws(() => l.get("main.js"), /取消/);
});

test("preparing a disposed loader does not create or import modules", async () => {
  let imports=0;
  const l=loader({"main.js":"export default function(){return {}; }"},["main.js"],{
    importModule:async()=>{imports++;return {default:()=>({})};},
  });
  l.dispose();await l.prepare();
  assert.equal(imports,0);assert.equal(l.codes.length,0);assert.equal(l.stats().modules,0);
});

test("renaming modules rewrites static imports, reexports, literal dynamic imports and moved relative dependencies", () => {
  const sources = {
    "utils.js": "export const speed=3;",
    "main.js":
      "import {speed} from './utils.js'; return {load(){return import('./utils.js');}};",
    "lib/barrel.js": "export * from '../utils.js';",
  };
  const moved = M.rewriteRename(sources, "utils.js", "lib/math.js");
  assert.match(moved["main.js"], /\.\/lib\/math.js/g);
  assert.match(moved["lib/barrel.js"], /\.\/math.js/);
  assert.equal(moved["utils.js"], undefined);
  const movedEntry = M.rewriteRename(sources, "main.js", "game/player.js");
  assert.equal(
    (movedEntry["game/player.js"].match(/\.\.\/utils.js/g) || []).length,
    2,
  );
  const incomplete = M.rewriteRename(
    {
      "utils.js": sources["utils.js"],
      "main.js": "import {speed} from './utils.js';\nentity.",
    },
    "utils.js",
    "math.js",
  );
  assert.match(incomplete["main.js"], /\.\/math.js/);
});

test("renaming modules retains dynamic imports and reexports while code is incomplete", () => {
 const moved=M.rewriteRename({
   "utils.js":"export const value=1;",
   "main.js":"const load=()=>import('./utils.js');\nentity.",
   "barrel.js":"export {value} from './utils.js';\nconst unfinished =",
 },"utils.js","lib/math.js");
 assert.match(moved["main.js"],/import\("\.\/lib\/math.js"\)/);
 assert.match(moved["barrel.js"],/from "\.\/lib\/math.js"/);
 const incomplete="// import('./utils.js')\nconst text=\"import('./utils.js')\"; const pattern=/import\('utils'\)/;\nobject.import('./utils.js'); object?.import('./utils.js');\nconst load=()=>import('./utils.js');\nentity.";
 const result=M.rewriteRename({"utils.js":"export const value=1;","main.js":incomplete},"utils.js","math.js");
 assert.equal(result["main.js"],incomplete.replace("const load=()=>import('./utils.js')",'const load=()=>import("./math.js")'));
});

test("parser ignores imports in comments, strings and regexes; diagnostics preserve original module line", async () => {
  const l = loader(
    {
      "main.js":
        "// import './missing.js'\nconst s = \"export import('./bad.js')\"; const re=/import\\('bad'\\)/;\nreturn {};",
    },
    ["main.js"],
  );
  await l.prepare();
  assert.equal(l.get("main.js"), null);
  assert.equal(l.stats().modules, 0);
  l.dispose();
  const syntax = loader({ "main.js": "export const x=1;\nconst broken = ;" }, [
    "main.js",
  ]);
  await syntax.prepare();
  let error;
  try {
    syntax.get("main.js");
  } catch (e) {
    error = e;
  }
  assert.deepEqual(syntax.locate(error), {
    file: "main.js",
    line: 2,
    column: 16,
  });
  syntax.dispose();
});

test('renaming incomplete modules preserves reexports with string export names',()=>{
 const sources={
  'tools.js':'export const value=1;',
  'barrel.js':`export {value as "public-value"} from './tools.js';\nconst unfinished =`,
 };
 const moved=M.rewriteRename(sources,'tools.js','math.js');
 assert.equal(moved['barrel.js'],`export {value as "public-value"} from "./math.js";\nconst unfinished =`);
});

test('renaming incomplete modules preserves imports with string binding names',()=>{
 const sources={
  'tools.js':'const value=1;export {value as "public-value"};',
  'main.js':`import {"public-value" as value} from './tools.js';\nentity.`,
 };
 const moved=M.rewriteRename(sources,'tools.js','math.js');
 assert.equal(moved['main.js'],`import {"public-value" as value} from "./math.js";\nentity.`);
});

test('tolerant renaming handles string namespace reexport aliases',()=>{
 const sources={'tools.js':'export const value=1;','barrel.js':`export * as "public-tools" from './tools.js';\nconst unfinished =`};
 const moved=M.rewriteRename(sources,'tools.js','math.js');
 assert.equal(moved['barrel.js'],`export * as "public-tools" from "./math.js";\nconst unfinished =`);
});
