import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { createServer } from "vite";
import { createStaticGame, RUNTIME_FILES } from "../src/export/static-game.mjs";
import "../src/engine/package-runtime.js";
const B = globalThis.ArkGlideBinary;
let project, maps, runtime, game, server, normalize;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const { normalizeProject } = await server.ssrLoadModule(
    "/src/utils/projectValidation.ts",
  );
  normalize = normalizeProject;
  const zip = unzipSync(
    new Uint8Array(
      await fs.readFile(
        new URL("../examples/fourth-static.arkglide", import.meta.url),
      ),
    ),
  );
  project = normalizeProject(JSON.parse(strFromU8(zip["project.json"])));
  maps = {
    models: new Map(
      project.modelRefs.map((r) => [
        r.assetId,
        zip["assets/" + r.fileName].slice().buffer,
      ]),
    ),
    textures: new Map(
      project.content.textures.map((t) => [
        t.id,
        zip["textures/" + encodeURIComponent(t.id) + ".bin"].slice().buffer,
      ]),
    ),
    audio: new Map(
      project.content.audio.map((t) => [
        t.id,
        zip["audio/" + encodeURIComponent(t.id) + ".bin"].slice().buffer,
      ]),
    ),
  };
  runtime = Object.fromEntries(
    await Promise.all(
      RUNTIME_FILES.map(async (p) => [
        p,
        new Uint8Array(
          await fs.readFile(new URL("../public/" + p, import.meta.url)),
        ),
      ]),
    ),
  );
  game = createStaticGame(project, maps, runtime, {
    nodesPerChunk: 3,
    indexEntriesPerChunk: 4,
  });
});
after(() => server.close());
const decode = (d) => B.decode(game.files[d.path]);
function client(onRead = () => {}, extra = {}) {
  return ArkGlidePackage.create({
    read: async (d) => {
      onRead(d);
      return game.files[d.path].slice();
    },
    importModule: async () => ({ default: () => ({}) }),
    createURL: (code) =>
      "data:text/javascript;base64," + Buffer.from(code).toString("base64"),
    revokeURL() {},
    ...extra,
  });
}

test("binary records preserve exact numbers and Unicode, deduplicate keys and reject malformed input", () => {
  const value = {
    name: "中文",
    array: [null, false, true, -0, 1.25, Number.MAX_SAFE_INTEGER],
    nested: { hello: "中文" },
  };
  assert.deepEqual(B.decode(B.encode(value)), value);
  for (const size of [0, 1, 3, 5, 10])
    assert.throws(() => B.decode(B.encode(value).slice(0, size)));
  assert.throws(() => B.decode(new Uint8Array([...B.encode(value), 0])));
  assert.throws(() => B.decode(B.encode(value), { maxItems: 2 }));
  const prototype = Object.fromEntries([["__proto__", { polluted: true }]]),
    result = B.decode(B.encode(prototype));
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal({}.polluted, undefined);
  assert.equal(result.__proto__.polluted, true);
});
test("SHA-256 matches standard vectors and binary assets across block boundaries", () => {
  for (const size of [0, 1, 55, 56, 64, 65, 10000]) {
    const raw = Uint8Array.from({ length: size }, (_, i) => i % 251);
    assert.equal(B.hash(raw), createHash("sha256").update(raw).digest("hex"));
  }
});
test("default package has no project JSON and only an entry manifest; nodes and indexes are bounded binary chunks", () => {
  assert.equal(game.manifest.format, "arkglide-static-2");
  assert.equal(game.files["project.json"], undefined);
  assert.deepEqual(
    Object.keys(game.files).filter((p) => p.endsWith(".json")),
    ["game-manifest.json"],
  );
  const boot = decode(game.manifest.boot);
  assert.ok(boot.scene.length > 1);
  assert.ok(boot.indexes.length > 1);
  assert.equal(
    boot.scene.flatMap((d) => decode(d)).length,
    project.scene.nodes.length,
  );
  for (const d of boot.scene) assert.ok(decode(d).length <= 3);
  for (const d of boot.indexes) assert.ok(Object.keys(decode(d)).length <= 4);
  assert.equal(boot.globals.prefabInstances, undefined);
  assert.equal(boot.globals.prefabs, undefined);
  for (const d of game.manifest.runtime)
    assert.equal(B.hash(game.files[d.path]), d.hash);
});
test("protected scripts are precompiled, omit comments and original filenames, and do not rename public properties", () => {
  const p = structuredClone(project);
  p.scripts = {
    "private-game.js":
      "// PRIVATE_SOURCE_MARKER\nimport {amount} from './private-bridge.js'; export default function({entity}) { const privateLocalCounter = amount; return {onStart(){entity.position.x=privateLocalCounter;},later(){return import('./private-later.js');}}; }",
    "private-bridge.js": "export {amount} from './private-helper.js';",
    "private-helper.js": "export const amount=17;",
    "private-later.js": "export const loaded=true;",
  };
  for (const n of p.scene.nodes) n.scripts = [];
  p.scene.nodes[0].scripts = ["private-game.js"];
  for (const template of Object.values(p.content.prefabs))
    for (const n of template.nodes) n.scripts = [];
  const built = createStaticGame(p, maps, runtime),
    boot = B.decode(built.files[built.manifest.boot.path]),
    chunks = Object.keys(built.files)
      .filter((p) => p.startsWith("modules/"))
      .map((p) => B.decode(built.files[p]));
  assert.equal(
    boot.scene
      .flatMap((d) => B.decode(built.files[d.path]))
      .flatMap((n) => n.scripts)
      .includes("private-game.js"),
    false,
  );
  const text = chunks.map((c) => c.code).join("\n");
  assert.doesNotMatch(
    text,
    /PRIVATE_SOURCE_MARKER|privateLocalCounter|private-(game|bridge|helper|later)\.js|sourceMappingURL/,
  );
  assert.match(text, /position\.x/);
});
test("entry load does not fetch prefab bodies or prefab-only model bytes; releases undo their resources", async () => {
  const requested = [],
    c = client((d) => requested.push(d.path));
  try {
    const loaded = await c.initialize(game.manifest.boot),
      initialResources = c.stats().packageResources;
    assert.ok(!requested.some((p) => p.startsWith("prefabs/")));
    const template =
        project.content.prefabs[Object.keys(project.content.prefabs)[0]],
      key = Object.values(template.modelKeys)[0];
    if (key) assert.equal(loaded.modelData[key], undefined);
    const first = await c.preparePrefab(template.id),
      second = await c.preparePrefab(template.id);
    assert.ok(loaded.project.content.prefabs[template.id].nodes.length);
    if (key) assert.ok(loaded.modelData[key]);
    first.release();
    if (key) assert.ok(loaded.modelData[key]);
    second.release();
    if (key) assert.equal(loaded.modelData[key], undefined);
    assert.equal(c.stats().packageResources, initialResources);
    assert.equal(loaded.project.content.prefabs[template.id].nodes.length, 0);
  } finally {
    c.dispose();
    assert.equal(c.stats().packageResources, 0);
  }
});
test("same-length corruption fails hash validation, and a disposed delayed read cannot install resources", async () => {
  const c = client(() => {}, {
    read: async (d) => {
      const raw = game.files[d.path].slice();
      raw[raw.length - 1] ^= 1;
      return raw;
    },
  });
  await assert.rejects(c.initialize(game.manifest.boot), /校验/);
  c.dispose();
  let release;
  const gate = new Promise((r) => (release = r)),
    slow = client(() => {}, {
      read: async (d) => {
        await gate;
        return game.files[d.path].slice();
      },
    });
  const pending = slow.initialize(game.manifest.boot);
  slow.dispose();
  release();
  await assert.rejects(pending, /canceled/);
  assert.equal(slow.stats().packageResources, 0);
});
test("precompiled module factories keep native import bindings and legacy per-entity API ownership", async () => {
  const p = structuredClone(project);
  p.scripts = {
    "main.js":
      "import {value} from './helper.js';return {onStart(){entity.position.x=value;},later(){return import('./later.js')}}",
    "helper.js": "export const value=9;",
    "later.js": "export const value=27;",
  };
  for (const n of p.scene.nodes) n.scripts = [];
  p.scene.nodes[0].scripts = ["main.js"];
  for (const template of Object.values(p.content.prefabs))
    for (const n of template.nodes) n.scripts = [];
  const built = createStaticGame(p, maps, runtime);
  const c = ArkGlidePackage.create({
    read: async (d) => built.files[d.path].slice(),
    createURL: (code) =>
      "data:text/javascript;base64," + Buffer.from(code).toString("base64"),
    revokeURL() {},
  });
  globalThis.__arkglideImport = (id) => c.importModule(id);
  try {
    const loaded = await c.initialize(built.manifest.boot),
      file = loaded.project.scene.nodes[0].scripts[0],
      entry = c.moduleLoader.get(file),
      entity = { position: { x: 0 } };
    assert.equal(entry.module, false);
    const instance = entry.factory(entity);
    instance.onStart();
    assert.equal(entity.position.x, 9);
    assert.equal((await instance.later()).value, 27);
  } finally {
    c.dispose();
    delete globalThis.__arkglideImport;
  }
});

test("saved build settings survive project normalization and control default exports, with early preload validation", () => {
  const p = structuredClone(project);
  p.settings.build = {
    protectCode: false,
    showLogs: true,
    nodesPerChunk: 2,
    preload: ["audio:music"],
  };
  const saved = normalize(JSON.parse(JSON.stringify(p))),
    built = createStaticGame(saved, maps, runtime);
  assert.equal(built.manifest.settings.protectCode, false);
  assert.equal(built.manifest.settings.showLogs, true);
  const b = B.decode(built.files[built.manifest.boot.path]);
  assert.ok(b.scene.every((d) => B.decode(built.files[d.path]).length <= 2));
  assert.equal(b.settings.build, undefined);
  assert.throws(
    () => createStaticGame(p, maps, runtime, { preload: ["audio:missing"] }),
    /预加载/,
  );
  assert.throws(
    () => createStaticGame(p, maps, runtime, { preload: ["script:main.js"] }),
    /预加载/,
  );
  assert.throws(
    () =>
      normalize({
        ...p,
        settings: { ...p.settings, build: { concurrency: 0 } },
      }),
    /budget/,
  );
});
test("explicit prefab preloads pin shared dependencies until session disposal", async () => {
  const id = Object.keys(project.content.prefabs)[0],
    built = createStaticGame(project, maps, runtime, {
      preload: ["prefab:" + id],
    });
  const c = ArkGlidePackage.create({
    read: async (d) => built.files[d.path].slice(),
    importModule: async () => ({ default: () => ({}) }),
    createURL: (code) =>
      "data:text/javascript;base64," + Buffer.from(code).toString("base64"),
    revokeURL() {},
  });
  try {
    const loaded = await c.initialize(built.manifest.boot),
      initial = c.stats().packageResources;
    assert.ok(loaded.project.content.prefabs[id].nodes.length);
    const lease = await c.preparePrefab(id);
    lease.release();
    assert.ok(loaded.project.content.prefabs[id].nodes.length);
    assert.equal(c.stats().packageResources, initial);
  } finally {
    c.dispose();
    assert.equal(c.stats().packageResources, 0);
  }
});
test("a failed parallel startup cannot install a late audio resource after releasing its group", async () => {
  const p = structuredClone(project);
  p.content.materials["broken"] = { id: "broken", albedoTextureId: "absent" };
  const built = createStaticGame(p, maps, runtime, {
      preload: ["audio:music", "materials:broken"],
    }),
    boot = B.decode(built.files[built.manifest.boot.path]);
  const catalog = Object.assign(
      {},
      ...boot.indexes.map((d) => B.decode(built.files[d.path])),
    ),
    path = catalog["audio:music"].path;
  let release, reached;
  const gate = new Promise((r) => (release = r)),
    requested = new Promise((r) => (reached = r)),
    loaded = [];
  const c = ArkGlidePackage.create({
    read: async (d) => {
      if (d.path === path) {
        reached();
        await gate;
      }
      return built.files[d.path].slice();
    },
    onAudioLoad: (a) => loaded.push(a.id),
  });
  try {
    const pending = c.initialize(built.manifest.boot);
    const rejection = assert.rejects(pending, /不存在/);
    await requested;
    await rejection;
    release();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(c.stats().packageResources, 0);
    assert.equal(c.stats().packageGroups, 0);
    assert.equal(loaded.includes("music"), false);
  } finally {
    release();
    c.dispose();
  }
});

test("a large catalog keeps entry reads bounded and shared template chunks deduplicated", async () => {
  const p = structuredClone(project);
  const node = {
    id: "root",
    name: "Root",
    type: "empty",
    transform: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    scripts: [],
  };
  p.scripts = {};
  p.modelRefs = [];
  p.settings.build = { preload: [] };
  p.content.gameplay.hud = [];
  p.scene.nodes = Array.from({ length: 10000 }, (_, i) => ({
    ...node,
    id: "entry" + i,
    transform: { x: i, y: 0, z: 0 },
  }));
  p.content.prefabs = Object.fromEntries(
    Array.from({ length: 500 }, (_, i) => [
      "level" + i,
      {
        id: "level" + i,
        name: "Level " + i,
        revision: 1,
        rootId: "root",
        nodes: [node],
        modelKeys: {},
      },
    ]),
  );
  const built = createStaticGame(p, maps, runtime, {
      nodesPerChunk: 128,
      indexEntriesPerChunk: 64,
    }),
    boot = B.decode(built.files[built.manifest.boot.path]);
  assert.equal(boot.scene.length, 79);
  assert.ok(boot.indexes.length > 7);
  const requested = [],
    c = ArkGlidePackage.create({
      read: async (d) => {
        requested.push(d.path);
        return built.files[d.path].slice();
      },
    });
  try {
    const loaded = await c.initialize(built.manifest.boot);
    assert.equal(loaded.project.scene.nodes.length, 10000);
    assert.equal(requested.length, 80);
    const lease = await c.preparePrefab("level499");
    assert.equal(loaded.project.content.prefabs.level499.nodes.length, 1);
    lease.release();
    assert.equal(loaded.project.content.prefabs.level499.nodes.length, 0);
    // Five hundred equal template node arrays share one physical scene chunk.
    assert.equal(
      Object.keys(built.files).filter((path) => path.startsWith("scenes/"))
        .length,
      80,
    );
  } finally {
    c.dispose();
  }
});
