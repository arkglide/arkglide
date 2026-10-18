import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import * as B from "@babylonjs/core";
import { createServer } from "vite";
import { indexedDB } from "fake-indexeddb";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { createStaticGame, RUNTIME_FILES } from "../src/export/static-game.mjs";
import "../src/engine/package-runtime.js";
import "../src/engine/rendering-config.js";
import "../src/engine/rendering-runtime.js";
import "../src/engine/scene-runtime.js";
const C = globalThis.ArkGlideRenderingConfig;
let server, store, archive, validate;
before(async () => {
  globalThis.indexedDB = indexedDB;
  server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  ({ useEditorStore: store } = await server.ssrLoadModule("/src/store/useEditorStore.ts"));
  archive = await server.ssrLoadModule("/src/utils/projectExport.ts");
  ({ validateProject: validate } = await server.ssrLoadModule("/src/utils/projectValidation.ts"));
});
after(async () => { await server?.close(); });
test("rendering configuration rejects malformed values and keeps old projects opt-in", () => {
  assert.equal(C.settings().shadows.enabled, false);
  for (const v of [null, [], { bad: 1 }, { shadows: { enabled: 1 } }, { shadows: { mapSize: 1000 } }, { color: { exposure: NaN } }, { color: { toneMapping: "other" } }, { environment: { textureId: 4 } }]) assert.throws(() => C.settings(v));
  store.getState().newProject();
  const state = store.getState();
  assert.equal(validate({ ...state, scene: { nodes: state.nodes } }).settings.rendering, undefined);
  assert.throws(() => validate({ ...state, scene: { nodes: state.nodes }, settings: { ...state.settings, rendering: { environment: { textureId: "missing" } } } }), /环境资源/);
});
test("environment references survive project persistence and prohibit deleting or replacing an in-use environment with an image", async () => {
  const s = () => store.getState();
  s().newProject();
  s().importTexture({ id: "env", name: "room.env", mime: "application/x-babylon-env", byteLength: 3 }, new Uint8Array([1, 2, 3]).buffer);
  s().updateSettings({ rendering: { environment: { textureId: "env", intensity: 1.5 }, shadows: { enabled: true }, color: { toneMapping: "aces" } } });
  assert.throws(() => s().deleteTexture("env"), /环境光照引用/);
  assert.throws(() => s().importTexture({ id: "env", name: "room.png", mime: "image/png", byteLength: 3 }, new Uint8Array([1, 2, 3]).buffer), /环境资源/);
  const before = s().settings.rendering;
  await s().saveCurrentProject("Lighting");
  const id = s().currentProjectId;
  s().newProject(); await s().loadProjectById(id);
  assert.equal(s().settings.rendering.environment.textureId, "env");
  assert.equal(s().textureBuffers.get("env").byteLength, 3);
  assert.equal(s().settings.rendering.color.toneMapping, before.color.toneMapping);
  const files = unzipSync(archive.createProjectArchive());
  assert.equal(JSON.parse(strFromU8(files["project.json"])).settings.rendering.environment.textureId, "env");
  assert.equal(files["textures/env.bin"].length, 3);
  const runtime = Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async p => [p, new Uint8Array(await readFile(new URL("../public/" + p, import.meta.url)))])));
  const game = createStaticGame({ ...s(), scene: { nodes: s().nodes } }, { models: s().modelBuffers, textures: s().textureBuffers, audio: s().audioBuffers }, runtime);
  const client = globalThis.ArkGlidePackage.create({ read: async d => game.files[d.path].slice(), importModule: async () => ({ default() {} }) });
  try {
    const result = await client.initialize(game.manifest.boot);
    assert.equal(result.project.settings.rendering.environment.textureId, "env");
    assert.equal(result.textureData.env.byteLength, 3);
  } finally { client.dispose(); }
});
test("replacing or cancelling an environment settles pending loads without reviving disposed resources", async () => {
  const engine = new B.NullEngine(), scene = new B.Scene(engine), pending = [];
  let balance = 0;
  class Texture {
    constructor(_url, _scene, _extensions, _noMipmap, _files, loaded) { this.loaded = loaded; this.disposed = false; pending.push(this); }
    isReady() { return false; }
    dispose() { this.disposed = true; }
  }
  const manager = globalThis.ArkGlideRendering.create({ ...B, CubeTexture: Texture }, scene, { onLoading: n => { balance += n; } });
  const content = { textures: [{ id: "one", mime: "application/x-babylon-env" }, { id: "two", mime: "application/x-babylon-env" }] };
  const buffers = { one: new ArrayBuffer(1), two: new ArrayBuffer(1) };
  try {
    manager.configure({ environment: { textureId: "one" } });
    const first = manager.sync(content, buffers);
    manager.configure({ environment: { textureId: "two" } });
    const second = manager.sync(content, buffers);
    await first;
    assert.equal(pending[0].disposed, true);
    pending[0].loaded();
    assert.equal(scene.environmentTexture, pending[1]);
    manager.clear(); await second; pending[1].loaded();
    assert.equal(scene.environmentTexture, null);
    assert.equal(balance, 0);
  } finally { manager.dispose(); scene.dispose(); engine.dispose(); }
});
test("shared scene adapter owns shadow maps, honors flags, updates models and releases all maps on clear", async () => {
  const engine = new B.NullEngine(), scene = new B.Scene(engine);
  scene.activeCamera = new B.FreeCamera("camera", new B.Vector3(0, 3, -5), scene);
  const adapter = globalThis.ArkGlideScene.createSceneAdapter(B, scene);
  const node = (id, type, extra = {}) => ({ id, name: id, type, transform: { x: 0, y: 0, z: 0 }, ...extra });
  try {
    adapter.rendering.configure({ shadows: { enabled: true }, color: { toneMapping: "aces", exposure: 1.8 } });
    await adapter.sync([node("ground", "mesh", { receiveShadows: false }), node("box", "mesh", { castShadows: false }), node("sun", "light")]);
    scene.render();
    const light = adapter.resources.get("sun"), map = light.getShadowGenerator().getShadowMap();
    assert.equal(map.renderList.includes(adapter.nodes.get("ground")), true);
    assert.equal(map.renderList.includes(adapter.nodes.get("box")), false);
    assert.equal(adapter.nodes.get("ground").receiveShadows, false);
    assert.equal(scene.imageProcessingConfiguration.exposure, 1.8);
    assert.equal(adapter.rendering.stats().shadowLights, 1);
    adapter.clear(); scene.render();
    assert.equal(adapter.rendering.stats().shadowLights, 0);
    assert.equal(scene.textures.some(t => t.name.startsWith("sun")), false);
  } finally { adapter.dispose(); scene.dispose(); engine.dispose(); }
});
