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
import "../src/engine/atmosphere-runtime.js";
import "../src/engine/render-view-budget.js";
import "../src/engine/reflection-runtime.js";
import "../src/engine/rendering-runtime.js";
import "../src/engine/scene-runtime.js";
const C = globalThis.ArkGlideRenderingConfig;
test("atmosphere settings reject invalid drafts, preserve old defaults and restore owned sky/fog", async () => {
  assert.equal(C.settings().fog.mode, "none"); assert.equal(C.settings().sky.enabled, false); assert.equal(C.settings().dof.enabled, false);
  for (const input of [{fog:{mode:"height"}},{fog:{start:50,end:40}},{sky:{sunElevation:91}},{dof:{fStop:0}},{dof:{quality:3}}]) assert.throws(()=>C.settings(input));
  const engine=new B.NullEngine(),scene=new B.Scene(engine),manager=globalThis.ArkGlideRendering.create(B,scene);
  try {
    manager.configure({fog:{mode:"exp2",density:.1},sky:{enabled:true,sunElevation:12}}); await manager.sync(); manager.prepareFrame();
    assert.equal(scene.fogMode,B.Scene.FOGMODE_EXP2); assert.equal(manager.stats().atmosphereSky,true);
    assert.equal(scene.meshes.filter(m=>m.name==='arkglide:atmosphere').length,1);
    manager.configure({sky:{enabled:true,sunElevation:70}});manager.prepareFrame();
    assert.equal(scene.meshes.filter(m=>m.name==='arkglide:atmosphere').length,1);
    manager.clear(); assert.equal(scene.fogMode,B.Scene.FOGMODE_NONE);assert.equal(manager.stats().atmosphereSky,false);
  } finally {manager.dispose();scene.dispose();engine.dispose();}
});
test("planar captures obey budgets, isolate shared materials and follow transformed planes", async () => {
  const engine=new B.NullEngine({renderWidth:160,renderHeight:128}),scene=new B.Scene(engine),camera=new B.FreeCamera('main',new B.Vector3(0,4,-6),scene);camera.setTarget(B.Vector3.Zero());
  let captures=0;class Mirror extends B.MirrorTexture {render(){captures++;}}
  const manager=globalThis.ArkGlideRendering.create({...B,MirrorTexture:Mirror},scene);
  const source=new B.PBRMaterial('shared',scene);source.metadata={arkglideManagedMaterial:true};
  const a=B.MeshBuilder.CreateGround('a',{width:5,height:5},scene),b=B.MeshBuilder.CreateGround('b',{width:2,height:2},scene);b.position.x=8;
  for(const mesh of [a,b]){mesh.material=source;mesh.metadata={arkglideRendering:{planarReflection:{enabled:true,axis:'y'}}};}
  try{
    manager.configure({reflections:{planar:{enabled:true,maxMirrors:1,maxPixels:5000,scale:1}}});await manager.sync();scene.render();
    assert.equal(captures,1);assert.equal(manager.stats().planarReflections,1);assert.ok(manager.stats().planarRenderedPixels<=5000);
    assert.notEqual(a.material,source);assert.equal(b.material,source);assert.equal(source.reflectionTexture,null);
    a.position.y=.4;a.rotation.z=.2;scene.render();assert.ok(a.material.reflectionTexture.mirrorPlane.normal.x>.1);
    a.setEnabled(false);b.setEnabled(false);scene.render();assert.equal(manager.stats().planarReflections,0);assert.equal(a.material,source);
    manager.clear();assert.equal(manager.stats().planarRenderedPixels,0);
  }finally{manager.dispose();scene.dispose();engine.dispose();}
  assert.throws(()=>C.settings({reflections:{planar:{maxPixels:NaN}}}));
  assert.throws(()=>C.validateNode({type:'mesh',planarReflection:{enabled:true,axis:'bad'}}));
});
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
    await adapter.sync([node("legacy", "mesh")]); scene.render();
    assert.equal(adapter.nodes.get("legacy").receiveShadows, false);
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
test("probe selection has deterministic overlap priorities and inclusive box boundaries", () => {
  const probe = (id, x, size, priority = 0) => ({ id, name: id, textureId: "env", position: { x, y: 0, z: 0 }, size: { x: size, y: size, z: size }, priority });
  const probes = C.settings({ probes: [probe("large", 0, 10), probe("small", 0, 2), probe("priority", 2, 4, 1)] }).probes;
  assert.equal(C.selectProbe({ x: -1, y: 0, z: 0 }, probes), 1);
  assert.equal(C.selectProbe({ x: 0, y: 0, z: 0 }, probes), 2);
  assert.equal(C.selectProbe({ x: 20, y: 0, z: 0 }, probes), -1);
  assert.throws(() => C.settings({ probes: [probe("same", 0, 2), probe("same", 1, 2)] }), /探针/);
  assert.throws(() => C.settings({ probes: [{ ...probe("bad", 0, 2), size: { x: 0, y: 1, z: 1 } }] }), /probe size/);
});
test("quality presets preserve scene look choices, validate atomically and stop expired scripts from changing quality", async () => {
  const input = { color: { toneMapping: "aces", exposure: 1.7 }, environment: { intensity: 0.8 }, views: { maxPixels: 40000 } };
  const high = C.preset(input, "high"), low = C.preset(high, "low");
  assert.equal(high.color.exposure, 1.7); assert.equal(low.environment.intensity, 0.8);
  assert.ok(high.views.maxPixels > low.views.maxPixels);
  const engine = new B.NullEngine(), scene = new B.Scene(engine);
  let scale = 1;
  engine.setHardwareScalingLevel = value => { scale = value; };
  engine.getHardwareScalingLevel = () => scale;
  const manager = globalThis.ArkGlideRendering.create(B, scene);
  const owner = { record: { active: true } }, api = manager.forOwner(owner);
  try {
    manager.configure(high); await manager.sync();
    api.setQuality("low"); assert.equal(api.getStats().renderQuality, "low");
    assert.ok(Math.abs(engine.getHardwareScalingLevel() - 1 / 0.75) < 1e-8);
    const copy = api.getSettings(); copy.shadows.mapSize = 4096;
    assert.equal(api.getSettings().shadows.mapSize, 512);
    owner.record.active = false; assert.throws(() => api.setQuality("high"), /expired/);
    manager.clear(); assert.equal(engine.getHardwareScalingLevel(), 1);
  } finally { manager.dispose(); scene.dispose(); engine.dispose(); }
  const s = () => store.getState(); s().newProject();
  const before = s().settings;
  assert.throws(() => s().updateSettings({ rendering: { views: { maxPixels: NaN } } }), /预算|参数/);
  assert.ok(s().settings === before);
});
test("local probes isolate shared managed materials, follow moving meshes and dispose variants without disposing source textures", async () => {
  const engine = new B.NullEngine(), scene = new B.Scene(engine);
  let disposedClones = 0;
  class Cube {
    constructor(_url, _scene, _ext, _mip, _files, load) { queueMicrotask(load); }
    isReady() { return false; }
    dispose() {}
    clone() { return { rotationY: this.rotationY, dispose() { disposedClones++; } }; }
  }
  const manager = globalThis.ArkGlideRendering.create({ ...B, CubeTexture: Cube }, scene);
  const source = new B.PBRMaterial("shared", scene); source.metadata = { arkglideManagedMaterial: true };
  const a = B.MeshBuilder.CreateBox("a", {}, scene), b = B.MeshBuilder.CreateBox("b", {}, scene);
  for (const m of [a, b]) { m.material = source; m.metadata = { arkglideRendering: {} }; }
  b.position.x = 8;
  manager.configure({ environment: { textureId: "env", rotation: 1.25 }, probes: [{ id: "room", name: "room", textureId: "env", position: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 4, z: 4 } }] });
  try {
    await manager.sync({ textures: [{ id: "env", mime: "application/x-babylon-env" }] }, { env: new ArrayBuffer(1) });
    scene.onBeforeRenderObservable.notifyObservers(scene);
    assert.ok(a.material !== source, "a should use a probe variant");
    assert.ok(b.material === source, "b should retain its original material");
    assert.deepEqual(a.material.reflectionTexture.boundingBoxSize.asArray(), [4, 4, 4]);
    assert.equal(a.material.reflectionTexture.rotationY, 0);
    a.position.x = 10; scene.onBeforeRenderObservable.notifyObservers(scene);
    assert.ok(a.material === source, "a should restore its original material outside the probe");
    b.position.x = 0; scene.onBeforeRenderObservable.notifyObservers(scene);
    assert.ok(b.material !== source, "b should use a probe variant");
    manager.clear();
    assert.ok(b.material === source, "b should retain its original material");
    assert.equal(disposedClones, 1);
    assert.equal(scene.materials.includes(source), true);
    assert.equal(manager.stats().probeMaterialVariants, 0);
  } finally { manager.dispose(); scene.dispose(); engine.dispose(); }
});
test("baked texture dependencies participate in validation, clipboard restoration and static resource acquisition", async () => {
  const s = () => store.getState(); s().newProject();
  for (const id of ["ao", "baked", "emissive"])
    s().importTexture({ id, name: id + ".png", mime: "image/png", byteLength: 3 }, new Uint8Array([1, 2, 3]).buffer);
  const id = s().createMaterial("Baked");
  s().updateMaterial(id, { aoTextureId: "ao", lightmapTextureId: "baked", lightmapUV: 1, lightmapIntensity: 2, emissiveTextureId: "emissive", emissiveIntensity: 4 });
  s().setNodeMaterial("cube", id);
  assert.throws(() => s().deleteTexture("ao"), /引用/);
  assert.throws(() => s().updateMaterial(id, { lightmapUV: 2 }), /UV/);
  assert.throws(() => s().updateMaterial(id, { aoStrength: -1 }), /强度/);
  assert.throws(() => s().updateMaterial(id, { emissiveIntensity: 101 }), /自发光强度/);
  assert.throws(() => s().deleteTexture("emissive"), /引用/);
  s().selectNode("cube"); s().copyToClipboard(); s().removeNode("cube"); s().deleteMaterial(id); s().deleteTexture("ao"); s().deleteTexture("baked"); s().deleteTexture("emissive"); s().pasteFromClipboard();
  assert.ok(s().textureBuffers.has("baked"));
  assert.ok(s().textureBuffers.has("ao"));
  assert.ok(s().textureBuffers.has("emissive"));
  const files = unzipSync(archive.createProjectArchive());
  assert.equal(files["textures/baked.bin"].length, 3);
  const runtime = Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async p => [p, new Uint8Array(await readFile(new URL("../public/" + p, import.meta.url)))])));
  const game = createStaticGame({ ...s(), scene: { nodes: s().nodes } }, { models: s().modelBuffers, textures: s().textureBuffers, audio: s().audioBuffers }, runtime);
  const client = globalThis.ArkGlidePackage.create({ read: async d => game.files[d.path].slice(), importModule: async () => ({ default() {} }) });
  try {
    const result = await client.initialize(game.manifest.boot);
    assert.equal(result.textureData.baked.byteLength, 3);
    assert.equal(result.textureData.ao.byteLength, 3);
    assert.equal(result.textureData.emissive.byteLength, 3);
  } finally { client.dispose(); }
});
