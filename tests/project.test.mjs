import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { indexedDB } from "fake-indexeddb";
let server,
  store,
  storage,
  archive,
  validate,
  selection,
  readModelAsset,
  modelImport,
  audioImport,
  scriptImport,
  textureImport,
  recovery,
  normalize;
function request(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
before(async () => {
  globalThis.indexedDB = indexedDB;
  // Reproduce and migrate the old database containing only the projects store.
  const old = indexedDB.open("arkglide-db", 1);
  old.onupgradeneeded = () => old.result.createObjectStore("projects");
  (await request(old)).close();
  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ useEditorStore: store } = await server.ssrLoadModule(
    "/src/store/useEditorStore.ts",
  ));
  storage = await server.ssrLoadModule("/src/utils/projectStorage.ts");
  archive = await server.ssrLoadModule("/src/utils/projectExport.ts");
  recovery = await server.ssrLoadModule("/src/utils/projectRecovery.ts");
  ({ normalizeProject: normalize } = await server.ssrLoadModule(
    "/src/utils/projectValidation.ts",
  ));
  ({ validateProject: validate } = await server.ssrLoadModule(
    "/src/utils/projectValidation.ts",
  ));
  selection = await server.ssrLoadModule("/src/engine/selectionTransform.ts");
  ({ readModelAsset } = await server.ssrLoadModule(
    "/src/engine/modelImport.ts",
  ));
  modelImport = await server.ssrLoadModule("/src/utils/modelImport.ts");
  audioImport = await server.ssrLoadModule("/src/utils/audioImport.ts");
  scriptImport = await server.ssrLoadModule("/src/utils/scriptImport.ts");
  textureImport = await server.ssrLoadModule("/src/utils/textureImport.ts");
});
after(async () => {
  await server?.close();
});
test("module renaming and history preserve import source through IndexedDB and ZIP roundtrip", async () => {
  store.getState().newProject();
  store.getState().createScript("tools.js");
  store.getState().updateScript("tools.js", "export const speed=3;");
  store
    .getState()
    .updateScript(
      "main.js",
      "import {speed} from './tools.js'; return {onStart(){this.entity.position.x=speed;}};",
    );
  store.getState().renameScript("tools.js", "utils.js");
  assert.match(store.getState().scripts["main.js"], /\.\/utils.js/);
  store.getState().undo();
  assert.match(store.getState().scripts["main.js"], /\.\/tools.js/);
  store.getState().redo();
  const expected = structuredClone(store.getState().scripts);
  await store.getState().saveCurrentProject("Modules");
  const id = store.getState().currentProjectId;
  const zip = archive.createProjectArchive();
  store.getState().newProject();
  await store.getState().loadProjectById(id);
  assert.deepEqual({ ...store.getState().scripts }, { ...expected });
  store.getState().newProject();
  await archive.importProject(new File([zip], "modules.arkglide"));
  assert.deepEqual({ ...store.getState().scripts }, { ...expected });
});
test("IndexedDB migrates old schema and isolates models shared by node ID across projects", async () => {
  const data = (id) => ({
    projectId: id,
    name: id,
    version: "0.1",
    updatedAt: 1,
    scene: { nodes: [] },
    scripts: { "main.js": "" },
    activeFileId: "main.js",
    modelRefs: [{ assetId: "same", fileName: "test.glb" }],
  });
  await storage.saveProjectSnapshot(
    data("one"),
    new Map([["same", new Uint8Array([1]).buffer]]),
  );
  await storage.saveProjectSnapshot(
    data("two"),
    new Map([["same", new Uint8Array([2]).buffer]]),
  );
  assert.deepEqual(
    [...new Uint8Array(await storage.loadModelBlob("same", "one"))],
    [1],
  );
  assert.deepEqual(
    [...new Uint8Array(await storage.loadModelBlob("same", "two"))],
    [2],
  );
  await storage.deleteProject("one");
  assert.equal(await storage.loadProject("one"), undefined);
  assert.deepEqual(
    [...new Uint8Array(await storage.loadModelBlob("same", "two"))],
    [2],
  );
});

test("synchronous binary clone failures roll back the whole project snapshot",async()=>{
 store.getState().newProject();const id=store.getState().addNode("model","model"),second=store.getState().addNode("model","second");
 const project=recovery.captureEditorProject(store.getState());project.projectId="atomic-clone-"+crypto.randomUUID();
 await storage.saveProjectSnapshot(project,new Map([[id,new Uint8Array([1]).buffer],[second,new Uint8Array([2]).buffer]]));
 const detached=new ArrayBuffer(4);structuredClone(detached,{transfer:[detached]});
 try {
  await assert.rejects(storage.saveProjectSnapshot({...project,name:"invalid update"},new Map([[id,new Uint8Array([7]).buffer],[second,detached]])),/clone|detached/i);
  assert.equal((await storage.loadProject(project.projectId)).name,project.name);
  assert.deepEqual(new Uint8Array(await storage.loadModelBlob(id,project.projectId)),new Uint8Array([1]));
  assert.deepEqual(new Uint8Array(await storage.loadModelBlob(second,project.projectId)),new Uint8Array([2]));
 } finally {await storage.deleteProject(project.projectId);}
});
test("model copy/paste, duplicate, deletion and undo preserve binary assets and descendants", () => {
  store.getState().newProject();
  const s = store.getState();
  const group = s.addNode("empty", "group"),
    model = s.addNode("model", "model");
  store.getState().setParent(model, group);
  store.getState().setModelBuffer(model, new Uint8Array([1, 2, 3]).buffer);
  store.getState().selectNode(group);
  store.getState().copyToClipboard();
  store.getState().pasteFromClipboard();
  const copied = store
    .getState()
    .nodes.filter((n) => n.name === "model_copy")[0];
  assert.deepEqual(
    [...new Uint8Array(store.getState().modelBuffers.get(copied.id))],
    [1, 2, 3],
  );
  assert.notEqual(copied.parentId, group);
  store.getState().duplicateNode(model);
  const clone = store.getState().selectedNodeId;
  assert.ok(store.getState().modelBuffers.has(clone));
  store.getState().removeNode(clone);
  assert.ok(!store.getState().modelBuffers.has(clone));
  store.getState().undo();
  assert.ok(store.getState().modelBuffers.has(clone));
});
test("ZIP roundtrip is atomic, preserves binaries/settings and clears project history", async () => {
  store.getState().updateSettings({ backgroundColor: "#123456" });
  const bytes = archive.createProjectArchive();
  const models = store
    .getState()
    .nodes.filter((n) => n.type === "model").length;
  store.getState().newProject();
  store.getState().undo();
  assert.equal(store.getState().nodes.length, 4);
  await archive.importProject(new File([bytes], "test.arkglide"));
  assert.equal(
    store.getState().nodes.filter((n) => n.type === "model").length,
    models,
  );
  assert.equal(store.getState().settings.backgroundColor, "#123456");
  assert.equal(store.getState().past.length, 0);
  const before = store.getState().nodes;
  await assert.rejects(
    archive.importProject(
      new File([new Uint8Array([1, 2])], "broken.arkglide"),
    ),
  );
  assert.equal(store.getState().nodes, before);
});
test("script renames/deletes update bindings and undo restores file identity and settings", () => {
  store.getState().newProject();
  store.getState().createScript("player.js");
  store.getState().attachScript("cube", "player.js");
  store.getState().renameScript("player.js", "hero.js");
  assert.ok(
    store
      .getState()
      .nodes.find((n) => n.id === "cube")
      .scripts.includes("hero.js"),
  );
  store.getState().deleteScript("hero.js");
  assert.ok(
    !store
      .getState()
      .nodes.find((n) => n.id === "cube")
      .scripts.includes("hero.js"),
  );
  store.getState().undo();
  assert.equal(store.getState().activeFileId, "hero.js");
  assert.ok(Object.hasOwn(store.getState().scripts, "hero.js"));
  store.getState().updateSettings({ ambientIntensity: 0 });
  store.getState().undo();
  assert.equal(store.getState().settings.ambientIntensity, 0.5);
});
test("invalid hierarchy is rejected before project replacement; new node IDs never collide", () => {
  store.getState().newProject();
  const a = store.getState().addNode("empty"),
    b = store.getState().addNode("empty");
  assert.notEqual(a, b);
  store.getState().setParent(a, b);
  store.getState().setParent(b, a);
  assert.equal(store.getState().nodes.find((n) => n.id === b).parentId, null);
  const nodes = store.getState().nodes.map((n) => ({ ...n, parentId: n.id }));
  assert.throws(
    () => validate({ scene: { nodes }, scripts: { "main.js": "" } }),
    /循环/,
  );
});

test("project validation rejects unsafe or non-JavaScript script paths before loading",()=>{
 for(const name of ["../evil.js","a\\b.js","a.ts","/root.js","__proto__"])
  assert.throws(()=>validate({scene:{nodes:[]},scripts:{"main.js":"",[name]:""}}),/脚本文件路径/);
});
test("script creation and renaming preserve saveable project paths",()=>{
 store.getState().newProject();store.getState().createScript('tools.js');
 for(const name of ['../bad.js','bad.ts','/bad.js','a//bad.js']){
  const before=store.getState();
  assert.throws(()=>store.getState().createScript(name),/脚本文件路径/);
  assert.equal(store.getState().scripts,before.scripts);assert.equal(store.getState().past,before.past);
  assert.throws(()=>store.getState().renameScript('tools.js',name),/脚本文件路径/);
  assert.equal(store.getState().scripts,before.scripts);assert.equal(store.getState().past,before.past);
 }
});
test("project validation rejects model paths that cannot be loaded as GLB or glTF",()=>{
 for(const modelUrl of ["model.txt","../model.glb","/model.gltf","model\\x.glb"])
  assert.throws(()=>validate({scene:{nodes:[{id:'model',name:'model',type:'model',modelUrl,transform:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},visible:true,parentId:null}]},scripts:{"main.js":""}}),/模型文件路径/);
});
test("project normalization rejects model references with non-model filenames",()=>{
 const scene={nodes:[{id:'model',name:'model',type:'model',transform:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},visible:true,parentId:null}]};
 assert.throws(()=>normalize({...scene,scene,scripts:{"main.js":""},modelRefs:[{assetId:'model',fileName:'model.txt'}]}),/重复的模型引用/);
});
test("multi-selection applies rotation/scale around pivot and skips selected descendants", async () => {
  const B = await import("@babylonjs/core");
  const engine = new B.NullEngine(),
    scene = new B.Scene(engine);
  try {
    const a = new B.TransformNode("a", scene),
      b = new B.TransformNode("b", scene),
      child = new B.TransformNode("child", scene);
    a.position.x = -1;
    b.position.x = 1;
    child.parent = a;
    assert.deepEqual(selection.selectionRoots([a, b, child]), [a, b]);
    const initial = new Map(
      [a, b].map((n) => [n, n.computeWorldMatrix(true).clone()]),
    );
    const pivot = B.Matrix.Compose(
      new B.Vector3(2, 2, 2),
      B.Quaternion.RotationAxis(B.Vector3.Up(), Math.PI / 2),
      B.Vector3.Zero(),
    );
    selection.applySelectionDelta(initial, B.Matrix.Identity(), pivot);
    assert.ok(Math.abs(a.position.z - 2) < 1e-5);
    assert.ok(Math.abs(b.position.z + 2) < 1e-5);
    assert.equal(a.scaling.x, 2);
  } finally {
    engine.dispose();
  }
});

test("pause before play is ignored and resume preserves the original play snapshot", () => {
  store.getState().newProject();
  store.getState().pause();
  assert.equal(store.getState().playState, "stopped");
  store.getState().play();
  const snapshot = store.getState().prePlaySnapshot,
    project = store.getState().project;
  store.getState().pause();
  store.getState().play();
  assert.equal(store.getState().playState, "playing");
  assert.equal(store.getState().prePlaySnapshot, snapshot);
  assert.equal(store.getState().project, project);
  store.getState().stop();
  assert.equal(store.getState().project, null);
});

test("glTF sidecars are embedded before storing and missing resources fail explicitly", async () => {
  const json = {
    asset: { version: "2.0" },
    buffers: [{ uri: "mesh.bin", byteLength: 3 }],
    images: [{ uri: "../textures/test.png" }],
  };
  const model = {
    name: "scene.gltf",
    path: "models/scene.gltf",
    file: new File([JSON.stringify(json)], "scene.gltf"),
  };
  const bin = {
    path: "models/mesh.bin",
    file: new File([new Uint8Array([1, 2, 3])], "mesh.bin"),
  };
  const image = {
    path: "textures/test.png",
    file: new File([new Uint8Array([4, 5, 6])], "test.png"),
  };
  const packed = JSON.parse(
    new TextDecoder().decode(await readModelAsset(model, [model, bin, image])),
  );
  assert.match(packed.buffers[0].uri, /^data:/);
  assert.match(packed.images[0].uri, /^data:/);
  await assert.rejects(readModelAsset(model, [model]), /缺少关联资源/);
});

test("glTF sidecars cannot resolve above the mounted asset root", async () => {
 const model={name:"scene.gltf",path:"scene.gltf",file:new File([JSON.stringify({asset:{version:"2.0"},buffers:[{uri:"../mesh.bin",byteLength:3}]})],"scene.gltf")};
 const bin={path:"mesh.bin",file:new File([new Uint8Array([1,2,3])],"mesh.bin")};
 await assert.rejects(readModelAsset(model,[model,bin]),/根目录/);
});

test("ZIP keeps a missing model missing when another model has the same filename", async () => {
  store.getState().newProject();
  const missing = store.getState().addNode("model", "missing"),
    valid = store.getState().addNode("model", "valid");
  store.getState().updateTransform(missing, { modelUrl: "same.glb" });
  store.getState().updateTransform(valid, { modelUrl: "same.glb" });
  store.getState().setModelBuffer(valid, new Uint8Array([7, 8, 9]).buffer);
  const zip = archive.createProjectArchive();
  await archive.importProject(new File([zip], "test.arkglide"));
  assert.ok(store.getState().missingModelIds.has(missing));
  assert.ok(!store.getState().modelBuffers.has(missing));
  assert.deepEqual(
    [...new Uint8Array(store.getState().modelBuffers.get(valid))],
    [7, 8, 9],
  );
});

test("legacy project migration adds time defaults; future versions and invalid references leave current project untouched", async () => {
  store.getState().newProject();
  const before = store.getState().nodes;
  const old = {
    version: "0.1",
    scene: { nodes: before },
    scripts: { "main.js": "" },
  };
  const upgraded = normalize(old);
  assert.equal(upgraded.version, "0.6");
  assert.equal(upgraded.settings.fixedTimeStep, 1 / 60);
  assert.equal(upgraded.settings.timeScale, 1);
  assert.throws(() => normalize({ ...old, version: "0.7" }), /版本/);
  const { zipSync, strToU8 } = await import("fflate");
  const bytes = zipSync({
    "project.json": strToU8(JSON.stringify({ ...old, version: "0.7" })),
  });
  await assert.rejects(
    archive.importProject(new File([bytes], "future.arkglide")),
    /版本/,
  );
  assert.equal(store.getState().nodes, before);
  const model = { ...before[0], id: "model", type: "model" };
  assert.throws(
    () =>
      normalize({
        ...old,
        scene: { nodes: [model] },
        modelRefs: [{ assetId: "model", fileName: "../outside.glb" }],
      }),
    /引用/,
  );
  assert.throws(
    () => normalize({ ...old, settings: { fixedTimeStep: 0 } }),
    /时间/,
  );
});
test("automatic recovery atomically stores script, scene and binary data without overwriting the saved project", async () => {
  store.getState().newProject();
  await store.getState().saveCurrentProject("manual");
  const projectId = store.getState().currentProjectId;
  const controller = recovery.startProjectRecovery({
    delay: 100000,
    maxWait: 100000,
  });
  try {
    const model = store.getState().addNode("model", "draft");
    store.getState().setModelBuffer(model, new Uint8Array([3, 4, 5]).buffer);
    store.getState().updateScript("main.js", "return {onUpdate(){}};");
    const id = store.getState().documentId;
    await controller.flush();
    const draft = await storage.loadRecovery(id);
    assert.ok(draft);
    assert.equal(draft.project.version, "0.6");
    assert.deepEqual([...new Uint8Array(draft.buffers.get(model))], [3, 4, 5]);
    assert.ok(
      !(await storage.loadProject(projectId)).scene.nodes.some(
        (n) => n.id === model,
      ),
    );
    store.getState().newProject();
    await recovery.restoreRecovery(id);
    assert.equal(store.getState().documentId, id);
    assert.equal(store.getState().currentProjectId, projectId);
    assert.equal(store.getState().past.length, 0);
    assert.deepEqual(
      [...new Uint8Array(store.getState().modelBuffers.get(model))],
      [3, 4, 5],
    );
    await store.getState().saveCurrentProject();
    await controller.flush();
    assert.equal(await storage.loadRecovery(id), undefined);
  } finally {
    controller.dispose();
  }
});
test("failed auto save is visible, leaves editing data intact and can be retried", async () => {
  store.getState().newProject();
  let fail = true;
  const controller = recovery.startProjectRecovery({
    delay: 100000,
    maxWait: 100000,
    write: async (record) => {
      if (fail) throw new DOMException("full", "QuotaExceededError");
      await storage.saveRecovery(record);
    },
  });
  try {
    store.getState().renameNode("cube", "unsaved");
    const nodes = store.getState().nodes;
    await controller.flush();
    assert.equal(store.getState().recoveryStatus, "error");
    assert.match(store.getState().recoveryError, /QuotaExceededError/);
    assert.equal(store.getState().nodes, nodes);
    fail = false;
    await controller.flush();
    assert.equal(store.getState().recoveryStatus, "saved");
  } finally {
    controller.dispose();
  }
});
test("autosave switches documents safely and a queued stale save cannot overwrite newer edits", async () => {
  store.getState().newProject();
  let unlock, entered;
  const began = new Promise((r) => (entered = r)),
    blocked = new Promise((r) => (unlock = r)),
    writes = [];
  const controller = recovery.startProjectRecovery({
    delay: 100000,
    maxWait: 100000,
    write: async (record) => {
      writes.push(record);
      if (writes.length === 1) {
        entered();
        await blocked;
      }
    },
  });
  try {
    store.getState().renameNode("cube", "older");
    const first = controller.flush();
    await began;
    store.getState().renameNode("cube", "latest");
    const next = controller.flush();
    unlock();
    await Promise.all([first, next]);
    assert.equal(
      writes.at(-1).project.scene.nodes.find((n) => n.id === "cube").name,
      "latest",
    );
    assert.equal(store.getState().recoveryStatus, "saved");
    store.getState().renameNode("cube", "before switch");
    const id = store.getState().documentId;
    store.getState().newProject();
    await controller.flush();
    assert.ok(
      writes.some(
        (r) =>
          r.recoveryId === id &&
          r.project.scene.nodes.find((n) => n.id === "cube").name ===
            "before switch",
      ),
    );
  } finally {
    controller.dispose();
  }
});
test("restoring damaged data is atomic and missing binary data is reported", async () => {
  store.getState().newProject();
  const before = store.getState().nodes;
  await storage.saveRecovery({
    recoveryId: "broken",
    project: { version: "999" },
    buffers: new Map(),
    updatedAt: 1,
  });
  await assert.rejects(recovery.restoreRecovery("broken"), /版本/);
  assert.equal(store.getState().nodes, before);
  const model = store.getState().addNode("model", "missing");
  const project = recovery.captureEditorProject(store.getState());
  await storage.saveRecovery({
    recoveryId: "missing",
    project,
    buffers: new Map(),
    updatedAt: 2,
  });
  await recovery.restoreRecovery("missing");
  assert.ok(store.getState().missingModelIds.has(model));
  assert.ok(
    store.getState().consoleLogs.some((log) => log.text.includes("资源丢失")),
  );
});
test("unchanged playback does not create a recovery draft and draft retention is bounded", async () => {
  store.getState().newProject();
  const writes = [];
  const controller = recovery.startProjectRecovery({
    delay: 100000,
    maxWait: 100000,
    write: async (r) => writes.push(r),
  });
  try {
    store.getState().play();
    store.getState().pause();
    store.getState().play();
    store.getState().stop();
    await controller.flush();
    assert.equal(writes.length, 0);
  } finally {
    controller.dispose();
  }
  const project = recovery.captureEditorProject(store.getState());
  for (let i = 0; i < 22; i++)
    await storage.saveRecovery({
      recoveryId: "retention-" + i,
      project,
      buffers: new Map(),
      updatedAt: 1000 + i,
    });
  assert.equal((await storage.listRecoveries()).length, 20);
  assert.ok(await storage.loadRecovery("retention-21"));
  assert.equal(await storage.loadRecovery("retention-0"), undefined);
});

test("third batch components, audio bytes and action/HUD configuration persist in ZIP, IndexedDB and recovery", async () => {
  store.getState().newProject();
  const s = () => store.getState();
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
  s().importAudio(
    { id: "audio", name: "test.wav", mime: "audio/wav", byteLength: 4 },
    bytes,
  );
  const physics = {
    motion: "dynamic",
    shape: "box",
    size: { x: 1, y: 2, z: 1 },
    mass: 2,
    friction: 0.4,
    restitution: 0.2,
    sensor: false,
    lockRotation: true,
  };
  s().updateTransform("cube", {
    physics,
    audioSource: {
      assetId: "audio",
      autoplay: false,
      loop: false,
      volume: 0.5,
      spatial: true,
      refDistance: 1,
    },
  });
  const gameplay = {
    actions: [{ name: "walk", positive: ["KeyD"], negative: ["KeyA"] }],
    hud: [
      {
        id: "score",
        kind: "text",
        text: "分数：0",
        x: 2,
        y: 3,
        color: "#FFFFFF",
        background: "#222222",
        fontSize: 20,
      },
    ],
    captureInput: true,
  };
  s().updateGameplay(gameplay);
  await s().saveCurrentProject("third batch");
  const projectId = s().currentProjectId;
  assert.deepEqual(
    new Uint8Array(await storage.loadAudioBlob("audio", projectId)),
    new Uint8Array(bytes),
  );
  const zip = archive.createProjectArchive();
  s().newProject();
  await archive.importProject({
    arrayBuffer: async () =>
      zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength),
  });
  assert.equal(s().nodes.find((n) => n.id === "cube").physics.mass, 2);
  assert.equal(s().content.gameplay.hud[0].text, "分数：0");
  assert.deepEqual(
    new Uint8Array(s().audioBuffers.get("audio")),
    new Uint8Array(bytes),
  );
  const drafts = [],
    controller = recovery.startProjectRecovery({
      write: async (r) => drafts.push(r),
      remove: async () => {},
    });
  try {
    s().updateScript("main.js", "return {};");
    await controller.flush();
    assert.equal(drafts.at(-1).audioBuffers.get("audio").byteLength, 4);
    await storage.saveRecovery(drafts.at(-1));
    s().newProject();
    await recovery.restoreRecovery(drafts.at(-1).recoveryId);
    assert.equal(s().audioBuffers.get("audio").byteLength, 4);
  } finally {
    controller.dispose();
  }
  s().newProject();
  await s().loadProjectById(projectId);
  assert.equal(
    s().nodes.find((n) => n.id === "cube").audioSource.spatial,
    true,
  );
  assert.equal(s().audioBuffers.get("audio").byteLength, 4);
});
test("invalid gameplay imports are atomic; missing audio warns; audio replacement and deletion undo correctly", async () => {
  store.getState().newProject();
  const s = () => store.getState();
  s().importAudio(
    { id: "a", name: "a.wav", mime: "audio/wav", byteLength: 2 },
    new Uint8Array([1, 2]).buffer,
  );
  s().importAudio(
    { id: "a", name: "b.wav", mime: "audio/wav", byteLength: 3 },
    new Uint8Array([3, 4, 5]).buffer,
  );
  s().undo();
  assert.equal(s().audioBuffers.get("a").byteLength, 2);
  s().redo();
  assert.equal(s().audioBuffers.get("a").byteLength, 3);
  const data = recovery.captureEditorProject(s());
  const bad = structuredClone(data);
  bad.scene.nodes[0].physics = {
    motion: "dynamic",
    shape: "box",
    size: { x: -1, y: 1, z: 1 },
    mass: 1,
    friction: 0,
    restitution: 0,
    sensor: false,
    lockRotation: false,
  };
  const before = s().nodes;
  assert.throws(() => s().replaceProject(bad, new Map(), new Set()), /刚体/);
  assert.equal(s().nodes, before);
  const badHUD = structuredClone(data);
  badHUD.content.gameplay.hud = [
    {
      id: "x",
      kind: "button",
      text: "x",
      x: 1,
      y: 1,
      color: "#FFFFFF",
      background: "#000000",
      fontSize: 20,
      action: "absent",
    },
  ];
  assert.throws(() => normalize(badHUD), /HUD/);
  s().deleteAudio("a");
  s().undo();
  assert.equal(s().audioBuffers.get("a").byteLength, 3);
  s().replaceProject(data, new Map(), new Set(), true);
  assert.ok(s().consoleLogs.some((l) => l.text.includes("音频丢失")));
});
test("prefab snapshots and clipboard preserve gameplay components and referenced audio", () => {
  store.getState().newProject();
  const s = () => store.getState();
  s().importAudio(
    { id: "sound", name: "sound.wav", mime: "audio/wav", byteLength: 2 },
    new Uint8Array([1, 2]).buffer,
  );
  s().updateTransform("cube", {
    audioSource: {
      assetId: "sound",
      autoplay: true,
      loop: false,
      volume: 1,
      spatial: false,
      refDistance: 1,
    },
  });
  const id = s().createPrefab("cube", "sound prefab");
  const clone = s().instantiatePrefab(id);
  assert.equal(
    s().nodes.find((n) => n.id === clone).audioSource.assetId,
    "sound",
  );
  assert.throws(() => s().deleteAudio("sound"), /引用/);
  s().selectNode(clone);
  s().copyToClipboard();
  s().removeNodes(["cube", clone]);
  s().deletePrefab(id);
  s().deleteAudio("sound");
  s().pasteFromClipboard();
  assert.equal(s().audioBuffers.get("sound").byteLength, 2);
  assert.ok(s().nodes.some((n) => n.audioSource?.assetId === "sound"));
  validate(recovery.captureEditorProject(s()));
});

test("project replacement clears model part catalogs from the previous document", () => {
  store.getState().newProject();
  const model = store.getState().addNode("model", "model");
  const project = recovery.captureEditorProject(store.getState());
  store.getState().setModelParts(model, [{ key: "mesh:7/slot:2", name: "Old model" }]);
  store.getState().setModelAnimations(model, ["Old clip"]);
  store.getState().replaceProject(project, new Map(), new Set([model]));
  assert.deepEqual(store.getState().modelParts, {});
  assert.deepEqual(store.getState().modelAnimations, {});
  store.getState().setModelParts(model, [{ key: "mesh:0/slot:0", name: "Reloaded model" }]);
  assert.equal(store.getState().modelParts[model][0].name, "Reloaded model");
});

test("overlapping first saves use one project ID and retain the later snapshot", async () => {
  store.getState().newProject();
  const name = "overlapping-" + crypto.randomUUID();
  const first = store.getState().saveCurrentProject(name);
  store.getState().renameNode("cube", "latest cube");
  const second = store.getState().saveCurrentProject(name);
  await Promise.all([first, second]);
  const projects = (await storage.listProjects()).filter(p => p.name === name);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].projectId, store.getState().currentProjectId);
  assert.equal(projects[0].scene.nodes.find(n => n.id === "cube").name, "latest cube");
  await storage.deleteProject(projects[0].projectId);
});

test("overlapping saves from different documents keep separate IDs and current state", async () => {
  const prefix = "separate-" + crypto.randomUUID();
  store.getState().newProject();
  const first = store.getState().saveCurrentProject(prefix + "-old");
  store.getState().newProject();
  const documentId = store.getState().documentId;
  const second = store.getState().saveCurrentProject(prefix + "-new");
  await Promise.all([first, second]);
  const projects = (await storage.listProjects()).filter(p => p.name.startsWith(prefix));
  assert.equal(projects.length, 2);
  assert.notEqual(projects[0].projectId, projects[1].projectId);
  assert.equal(store.getState().documentId, documentId);
  assert.equal(store.getState().currentProjectName, prefix + "-new");
  const currentId = store.getState().currentProjectId;
  await store.getState().saveCurrentProject();
  assert.equal(store.getState().currentProjectId, currentId);
  for (const project of projects) await storage.deleteProject(project.projectId);
});

test("a delayed file import cannot overwrite a document opened while reading", async () => {
  store.getState().newProject();
  const bytes = archive.createProjectArchive();
  let release;
  const reading = new Promise(resolve => { release = resolve; });
  const pending = archive.importProject({ arrayBuffer: () => reading });
  const rejected = assert.rejects(pending, /当前项目已切换/);
  store.getState().newProject();
  store.getState().renameNode("cube", "keep this document");
  const current = store.getState();
  release(bytes.slice().buffer);
  await rejected;
  assert.equal(store.getState().documentId, current.documentId);
  assert.equal(store.getState().nodes, current.nodes);
  assert.equal(store.getState().nodes.find(n => n.id === "cube").name, "keep this document");
});

test("delayed model import and relink cannot modify a replacement document", async () => {
  for (const relink of [false, true]) {
    store.getState().newProject();
    const id = store.getState().addNode("model", "existing");
    const project = recovery.captureEditorProject(store.getState());
    let release;
    const reading = new Promise(resolve => { release = resolve; });
    const file = { name: "new.glb", arrayBuffer: () => reading };
    const asset = { id: "asset", name: file.name, path: file.name, type: "model", file };
    const pending = relink ? modelImport.relinkModelFile(id, file) : modelImport.importModelAsset(asset, [asset]);
    const rejected = assert.rejects(pending, /项目已切换/);
    store.getState().replaceProject(project, new Map(), new Set([id]));
    const current = store.getState();
    release(new ArrayBuffer(8));
    await rejected;
    assert.equal(store.getState().nodes, current.nodes);
    assert.equal(store.getState().modelBuffers, current.modelBuffers);
    assert.ok(store.getState().missingModelIds.has(id));
  }
});

test("normal model import and relink retain bytes, names and missing-resource cleanup", async () => {
  store.getState().newProject();
  const file = new File([new Uint8Array([1, 2, 3])], "normal.glb");
  const asset = { id: "asset", name: file.name, path: file.name, type: "model", file };
  const id = await modelImport.importModelAsset(asset, [asset]);
  assert.equal(store.getState().nodes.find(n => n.id === id).name, "normal");
  assert.deepEqual(new Uint8Array(store.getState().modelBuffers.get(id)), new Uint8Array([1, 2, 3]));
  store.setState({ missingModelIds: new Set([id]) });
  await modelImport.relinkModelFile(id, new File([new Uint8Array([4, 5])], "replacement.glb"));
  assert.equal(store.getState().nodes.find(n => n.id === id).modelUrl, "replacement.glb");
  assert.deepEqual(new Uint8Array(store.getState().modelBuffers.get(id)), new Uint8Array([4, 5]));
  assert.equal(store.getState().missingModelIds.has(id), false);
});
test("one undo restores the filename and binary from before model relinking",async()=>{
 store.getState().newProject();
 const file=new File([new Uint8Array([1,2,3])],'old.glb');
 const id=await modelImport.importModelAsset({id:'asset',name:file.name,path:file.name,type:'model',file},[]);
 const before=store.getState();
 await modelImport.relinkModelFile(id,new File([new Uint8Array([4,5])],'new.glb'));
 assert.equal(store.getState().past.length,before.past.length+1);
 store.getState().undo();
 assert.equal(store.getState().nodes.find(n=>n.id===id).modelUrl,'old.glb');
 assert.deepEqual(new Uint8Array(store.getState().modelBuffers.get(id)),new Uint8Array([1,2,3]));
 store.getState().redo();
 assert.equal(store.getState().nodes.find(n=>n.id===id).modelUrl,'new.glb');
 assert.deepEqual(new Uint8Array(store.getState().modelBuffers.get(id)),new Uint8Array([4,5]));
});
test("invalid model filenames are rejected before import or relink changes the document",async()=>{
 store.getState().newProject();const id=store.getState().addNode('model','existing');
 const before=store.getState(),file=new File([new Uint8Array([1,2])],'invalid.txt');
 await assert.rejects(modelImport.importModelAsset({id:'asset',name:file.name,path:file.name,type:'model',file},[]),/模型文件路径/);
 await assert.rejects(modelImport.relinkModelFile(id,file),/模型文件路径/);
 assert.equal(store.getState().nodes,before.nodes);assert.equal(store.getState().past,before.past);
 assert.equal(store.getState().modelBuffers,before.modelBuffers);
});

test("delayed model relink rejects deleted nodes and playback without writing bytes", async () => {
  for (const playing of [false, true]) {
    store.getState().newProject();
    const id = store.getState().addNode("model", "existing");
    let release;
    const reading = new Promise(resolve => { release = resolve; });
    const pending = modelImport.relinkModelFile(id, { name: "new.glb", arrayBuffer: () => reading });
    const rejected = assert.rejects(pending, playing ? /停止运行/ : /已删除/);
    if (playing) store.getState().play();
    else store.getState().removeNode(id);
    release(new ArrayBuffer(8));
    await rejected;
    assert.equal(store.getState().modelBuffers.has(id), false);
    store.getState().stop();
  }
});

test("delayed audio import cannot write resources into a replacement document", async () => {
  store.getState().newProject();
  let release;
  const reading = new Promise(resolve => { release = resolve; });
  const pending = audioImport.importAudioFile({ name: "tone.wav", size: 4, arrayBuffer: () => reading });
  const rejected = assert.rejects(pending, /项目已切换/);
  store.getState().newProject();
  const current = store.getState();
  release(new ArrayBuffer(4));
  await rejected;
  assert.equal(store.getState().content, current.content);
  assert.equal(store.getState().audioBuffers, current.audioBuffers);
});

test("audio import and replacement preserve IDs and reject resources deleted during reading", async () => {
  store.getState().newProject();
  await audioImport.importAudioFile(new File([new Uint8Array([1, 2])], "tone.wav"));
  const id = store.getState().content.audio[0].id;
  await audioImport.importAudioFile(new File([new Uint8Array([3, 4, 5])], "next.wav"), id);
  assert.equal(store.getState().content.audio.length, 1);
  assert.equal(store.getState().content.audio[0].id, id);
  assert.deepEqual(new Uint8Array(store.getState().audioBuffers.get(id)), new Uint8Array([3, 4, 5]));
  let release;
  const reading = new Promise(resolve => { release = resolve; });
  const pending = audioImport.importAudioFile({ name: "late.wav", size: 4, arrayBuffer: () => reading }, id);
  const rejected = assert.rejects(pending, /音频已删除/);
  store.getState().deleteAudio(id);
  release(new ArrayBuffer(4));
  await rejected;
  assert.equal(store.getState().audioBuffers.has(id), false);
  assert.equal(store.getState().content.audio.length, 0);
});

test("delayed script import rejects document switches and preserves concurrently created scripts", async () => {
  for (const switching of [true, false]) {
    store.getState().newProject();
    let release;
    const reading = new Promise(resolve => { release = resolve; });
    const asset = { id: "script", name: "late.js", path: "late.js", type: "script", file: { text: () => reading } };
    const pending = scriptImport.importScriptAsset(asset);
    const result = switching ? assert.rejects(pending, /项目已切换/) : pending;
    if (switching) store.getState().newProject();
    else {
      store.getState().createScript(asset.name);
      store.getState().updateScript(asset.name, "keep edits");
    }
    release("imported code");
    await result;
    if (switching) assert.equal(Object.hasOwn(store.getState().scripts, asset.name), false);
    else assert.equal(store.getState().scripts[asset.name], "keep edits");
  }
});

test("normal script imports load contents and existing scripts open without rereading", async () => {
  store.getState().newProject();
  const asset = { id: "script", name: "normal.js", path: "normal.js", type: "script", file: new File(["return {};"], "normal.js") };
  await scriptImport.importScriptAsset(asset);
  assert.equal(store.getState().scripts[asset.name], "return {};");
  store.getState().updateScript(asset.name, "edited");
  await scriptImport.importScriptAsset({ ...asset, file: { text() { throw Error("should not read"); } } });
  assert.equal(store.getState().scripts[asset.name], "edited");
  assert.equal(store.getState().activeFileId, asset.name);
});
test('script import is one complete undo and redo operation',async()=>{
 store.getState().newProject();const before=store.getState();
 await scriptImport.importScriptAsset({id:'import',name:'imported.js',path:'imported.js',type:'script',file:new File(['return {onStart(){}};'],'imported.js')});
 assert.equal(store.getState().past.length,before.past.length+1);
 store.getState().undo();assert.equal(Object.hasOwn(store.getState().scripts,'imported.js'),false);
 store.getState().redo();assert.equal(store.getState().scripts['imported.js'],'return {onStart(){}};');
});

test("script imports finishing after playback starts preserve the editor script snapshot",async()=>{
 store.getState().newProject();let release;
 const reading=new Promise(resolve=>{release=resolve;});
 const asset={id:"script",name:"late.js",path:"late.js",type:"script",file:{text:()=>reading}};
 const pending=scriptImport.importScriptAsset(asset),rejected=assert.rejects(pending,/停止运行/);
 store.getState().play();const current=store.getState();release("return {};");
 try {await rejected;assert.equal(store.getState().scripts,current.scripts);assert.equal(store.getState().past,current.past);}
 finally {store.getState().stop();}
});

test("recovery rejects truncated texture binaries before replacing the current document", async () => {
  store.getState().newProject();
  store.getState().importTexture({ id: "texture", name: "image.png", mime: "image/png", byteLength: 3 }, new Uint8Array([1, 2, 3]).buffer);
  const project = recovery.captureEditorProject(store.getState());
  const id = "broken-texture-" + crypto.randomUUID();
  await storage.saveRecovery({ recoveryId: id, project, buffers: new Map(), textureBuffers: new Map([["texture", new ArrayBuffer(1)]]), updatedAt: Date.now() });
  store.getState().newProject();
  store.getState().renameNode("cube", "keep current");
  const current = store.getState();
  try {
    await assert.rejects(recovery.restoreRecovery(id), /贴图大小不一致/);
    assert.equal(store.getState().documentId, current.documentId);
    assert.equal(store.getState().nodes, current.nodes);
  } finally {
    await storage.deleteRecovery(id);
  }
});
test("recovery rejects present resources with invalid binary types atomically",async()=>{
 for(const kind of ['model','texture','audio']){
  store.getState().newProject();let assetId='binary';
  if(kind==='model')assetId=store.getState().addNode('model','model');
  else {
   const asset={id:assetId,name:kind,mime:kind==='texture'?'image/png':'audio/wav',byteLength:3};
   if(kind==='texture')store.getState().importTexture(asset,new ArrayBuffer(3));
   else store.getState().importAudio(asset,new ArrayBuffer(3));
  }
  const project=recovery.captureEditorProject(store.getState()),id='invalid-recovery-'+crypto.randomUUID();
  const record={recoveryId:id,project,buffers:new Map(),updatedAt:Date.now()};
  record[kind==='model'?'buffers':kind==='texture'?'textureBuffers':'audioBuffers']=new Map([[assetId,'broken']]);
  await storage.saveRecovery(record);store.getState().newProject();const current=store.getState();
  try {
   await assert.rejects(recovery.restoreRecovery(id),/资源损坏/);
   assert.equal(store.getState().documentId,current.documentId);assert.equal(store.getState().nodes,current.nodes);
  } finally {await storage.deleteRecovery(id);}
 }
});

test("stored projects with truncated texture or audio data fail before document replacement", async () => {
  for (const audio of [false, true]) {
    store.getState().newProject();
    const asset = { id: "binary", name: audio ? "tone.wav" : "image.png", mime: audio ? "audio/wav" : "image/png", byteLength: 3 };
    if (audio) store.getState().importAudio(asset, new ArrayBuffer(3));
    else store.getState().importTexture(asset, new ArrayBuffer(3));
    const project = recovery.captureEditorProject(store.getState());
    project.projectId = "truncated-" + crypto.randomUUID();
    const broken = new Map([[asset.id, new ArrayBuffer(1)]]);
    await storage.saveProjectSnapshot(project, new Map(), audio ? new Map() : broken, audio ? broken : new Map());
    store.getState().newProject();
    const current = store.getState();
    try {
      await assert.rejects(store.getState().loadProjectById(project.projectId), /大小不一致/);
      assert.equal(store.getState().documentId, current.documentId);
      assert.equal(store.getState().nodes, current.nodes);
    } finally {
      await storage.deleteProject(project.projectId);
    }
  }
});

test("stored projects with invalid model binary types preserve the current document",async()=>{
 store.getState().newProject();const id=store.getState().addNode("model","model");
 const project=recovery.captureEditorProject(store.getState());project.projectId="invalid-model-"+crypto.randomUUID();
 await storage.saveProjectSnapshot(project,new Map([[id,"broken binary"]]));
 store.getState().newProject();const current=store.getState();
 try {
  await assert.rejects(store.getState().loadProjectById(project.projectId),/模型资源损坏/);
  assert.equal(store.getState().documentId,current.documentId);assert.equal(store.getState().nodes,current.nodes);
 } finally {await storage.deleteProject(project.projectId);}
});

test("texture file handle reads retain the document identity from the initial click", async () => {
  store.getState().newProject();
  let release;
  const reading = new Promise(resolve => { release = resolve; });
  let bytesRead = false;
  const file = { name: "late.png", size: 4, arrayBuffer() { bytesRead = true; throw Error("must not read"); } };
  const pending = textureImport.importTextureAsset({ id: "asset", name: "late.png", path: "late.png", type: "texture", fileHandle: { getFile: () => reading } });
  const rejected = assert.rejects(pending, /项目已切换/);
  store.getState().newProject();
  release(file);
  await rejected;
  assert.equal(bytesRead, false);
  assert.equal(store.getState().content.textures.length, 0);
});

test('relinking glTF with unavailable sidecars preserves the existing model',async()=>{
 store.getState().newProject();const id=store.getState().addNode('model','existing');
 store.getState().setModelBuffer(id,new Uint8Array([1,2,3]).buffer);
 const before=store.getState();
 const file=new File([JSON.stringify({asset:{version:'2.0'},buffers:[{uri:'missing.bin',byteLength:4}]})],'replacement.gltf');
 await assert.rejects(modelImport.relinkModelFile(id,file),/缺少关联资源/);
 assert.equal(store.getState().nodes,before.nodes);assert.equal(store.getState().modelBuffers,before.modelBuffers);
 assert.equal(store.getState().past,before.past);
});

test('relinking self-contained glTF preserves its embedded model data',async()=>{
 store.getState().newProject();const id=store.getState().addNode('model','existing');
 const model={asset:{version:'2.0'},buffers:[{uri:'data:application/octet-stream;base64,AQID',byteLength:3}]};
 await modelImport.relinkModelFile(id,new File([JSON.stringify(model)],'replacement.gltf'));
 assert.deepEqual(JSON.parse(new TextDecoder().decode(store.getState().modelBuffers.get(id))),model);
 assert.equal(store.getState().nodes.find(n=>n.id===id).modelUrl,'replacement.gltf');
});

test('truncated glTF sidecar buffers fail before model import mutates the scene',async()=>{
 store.getState().newProject();const before=store.getState();
 const model={id:'model',name:'scene.gltf',path:'scene.gltf',type:'model',file:new File([JSON.stringify({asset:{version:'2.0'},buffers:[{uri:'mesh.bin',byteLength:4}]})],'scene.gltf')};
 const bin={path:'mesh.bin',file:new File([new Uint8Array([1,2])],'mesh.bin')};
 await assert.rejects(modelImport.importModelAsset(model,[model,bin]),/缓冲区.*不足/);
 assert.equal(store.getState().nodes,before.nodes);assert.equal(store.getState().modelBuffers,before.modelBuffers);
 assert.equal(store.getState().past,before.past);
});

test('script imports preserve directory paths and distinct same-name modules',async()=>{
 store.getState().newProject();
 for(const dir of ['first','second']){
  await scriptImport.importScriptAsset({id:dir,name:'utils.js',path:dir+'/utils.js',type:'script',file:new File(['export const name="'+dir+'";'],'utils.js')});
 }
 assert.equal(store.getState().scripts['first/utils.js'],'export const name="first";');
 assert.equal(store.getState().scripts['second/utils.js'],'export const name="second";');
 assert.equal(store.getState().activeFileId,'second/utils.js');
 await scriptImport.importScriptAsset({id:'entry',name:'entry.js',path:'first/entry.js',type:'script',file:new File(["export {name} from './utils.js';"],'entry.js')});
 assert.equal(globalThis.ArkGlideModules.resolve('first/entry.js','./utils.js',store.getState().scripts),'first/utils.js');
 const expected={...store.getState().scripts},zip=archive.createProjectArchive();
 store.getState().newProject();await archive.importProject(new File([zip],'modules.arkglide'));
 assert.deepEqual({...store.getState().scripts},expected);
});

test('glTF local sidecar URI queries do not become part of the mounted filename',async()=>{
 const model={name:'scene.gltf',path:'models/scene.gltf',file:new File([JSON.stringify({asset:{version:'2.0'},buffers:[{uri:'mesh.bin?v=1#buffer',byteLength:3}]})],'scene.gltf')};
 const bin={path:'models/mesh.bin',file:new File([new Uint8Array([1,2,3])],'mesh.bin')};
 const packed=JSON.parse(new TextDecoder().decode(await readModelAsset(model,[model,bin])));
 assert.equal(packed.buffers[0].uri,'data:application/octet-stream;base64,AQID');
});

test('encoded URI delimiters remain part of local glTF sidecar filenames',async()=>{
 const model={name:'scene.gltf',path:'scene.gltf',file:new File([JSON.stringify({asset:{version:'2.0'},buffers:[{uri:'mesh%23v%3F.bin?cache=1',byteLength:3}]})],'scene.gltf')};
 const bin={path:'mesh#v?.bin',file:new File([new Uint8Array([1,2,3])],'mesh#v?.bin')};
 const packed=JSON.parse(new TextDecoder().decode(await readModelAsset(model,[model,bin])));
 assert.equal(packed.buffers[0].uri,'data:application/octet-stream;base64,AQID');
});

test('script mutations during playback and pause preserve the project and history',()=>{
 for(const paused of [false,true]){
  store.getState().newProject();store.getState().createScript('tools.js');store.getState().attachScript('cube','tools.js');
  store.getState().play();if(paused)store.getState().pause();const before=store.getState();
  try {
   for(const mutate of [
    ()=>store.getState().createScript('late.js'),()=>store.getState().deleteScript('tools.js'),
    ()=>store.getState().renameScript('tools.js','renamed.js'),()=>store.getState().updateScript('tools.js','changed'),
    ()=>store.getState().setScript('changed'),()=>store.getState().detachScript('cube','tools.js'),
    ()=>store.getState().attachScript('cube','main.js'),
   ])assert.throws(mutate,/停止运行/);
   assert.equal(store.getState().scripts,before.scripts);assert.equal(store.getState().nodes,before.nodes);
   assert.equal(store.getState().past,before.past);
  } finally {store.getState().stop();}
 }
});

test('project validation rejects non-string parent references instead of treating them as roots',()=>{
 store.getState().newProject();
 for(const parentId of [0,false,{},[]]){
  const project=recovery.captureEditorProject(store.getState());project.scene.nodes=structuredClone(project.scene.nodes);
  project.scene.nodes[0].parentId=parentId;
  assert.throws(()=>validate(project),/父节点/);
 }
});

test('deep scene subtree deletion avoids recursive stack overflow and remains undoable',()=>{
 store.getState().newProject();const sample=store.getState().nodes.find(n=>n.id==='cube');
 const nodes=Array.from({length:3000},(_,i)=>({...structuredClone(sample),id:'deep-'+i,parentId:i?'deep-'+(i-1):null}));
 store.setState({nodes,selectedNodeId:'deep-0',selectedNodeIds:['deep-0'],past:[],future:[]});
 assert.doesNotThrow(()=>store.getState().removeNode('deep-0'));
 assert.equal(store.getState().nodes.length,0);store.getState().undo();
 assert.equal(store.getState().nodes.length,3000);assert.equal(store.getState().nodes.at(-1).parentId,'deep-2998');
});

test('deep scene subtree duplication preserves hierarchy without recursive stack overflow',()=>{
 store.getState().newProject();const sample=store.getState().nodes.find(n=>n.id==='cube');
 const nodes=Array.from({length:3000},(_,i)=>({...structuredClone(sample),id:'deep-'+i,parentId:i?'deep-'+(i-1):null}));
 store.setState({nodes,selectedNodeId:'deep-0',selectedNodeIds:['deep-0'],past:[],future:[]});
 assert.doesNotThrow(()=>store.getState().duplicateNode('deep-0'));
 const copies=store.getState().nodes.slice(3000);
 assert.equal(copies.length,3000);assert.equal(copies[0].parentId,null);
 for(let i=1;i<copies.length;i++)assert.equal(copies[i].parentId,copies[i-1].id);
 store.getState().undo();assert.equal(store.getState().nodes.length,3000);
});

test('late audio file replacement cannot overwrite a newer completed replacement',async()=>{
 store.getState().newProject();await audioImport.importAudioFile(new File([new Uint8Array([1])],'original.wav'));
 const id=store.getState().content.audio[0].id;let release;
 const reading=new Promise(resolve=>{release=resolve;});
 const old=audioImport.importAudioFile({name:'old.wav',size:1,arrayBuffer:()=>reading},id);
 const rejected=assert.rejects(old,/替换.*取消/);
 await audioImport.importAudioFile(new File([new Uint8Array([3])],'latest.wav'),id);
 release(new Uint8Array([2]).buffer);await rejected;
 assert.equal(store.getState().content.audio[0].name,'latest.wav');
 assert.deepEqual(new Uint8Array(store.getState().audioBuffers.get(id)),new Uint8Array([3]));
});

test('late texture replacement preserves the newest file and closes decoded bitmaps',async()=>{
 const original=globalThis.createImageBitmap;let closed=0,release;
 globalThis.createImageBitmap=async()=>({close(){closed++;}});
 try {
  store.getState().newProject();const bytes=new Uint8Array([137,80,78,71,1]);
  const id=await textureImport.importTextureFile(new File([bytes],'original.png'));
  const reading=new Promise(resolve=>{release=resolve;});
  const old=textureImport.importTextureFile({name:'old.png',size:5,arrayBuffer:()=>reading},id);
  const rejected=assert.rejects(old,/替换.*取消/);
  const latest=new Uint8Array([137,80,78,71,3]);
  await textureImport.importTextureFile(new File([latest],'latest.png'),id);
  release(bytes.buffer);await rejected;
  assert.equal(store.getState().content.textures[0].name,'latest.png');
  assert.deepEqual(new Uint8Array(store.getState().textureBuffers.get(id)),latest);
  assert.equal(closed,3);
 } finally {if(original===undefined)delete globalThis.createImageBitmap;else globalThis.createImageBitmap=original;}
});

test('late model relinking cannot overwrite a newer completed replacement',async()=>{
 store.getState().newProject();const id=store.getState().addNode('model','existing');let release;
 const reading=new Promise(resolve=>{release=resolve;});
 const old=modelImport.relinkModelFile(id,{name:'old.glb',size:1,arrayBuffer:()=>reading});
 const rejected=assert.rejects(old,/替换.*取消/);
 await modelImport.relinkModelFile(id,new File([new Uint8Array([3])],'latest.glb'));
 release(new Uint8Array([2]).buffer);await rejected;
 assert.equal(store.getState().nodes.find(n=>n.id===id).modelUrl,'latest.glb');
 assert.deepEqual(new Uint8Array(store.getState().modelBuffers.get(id)),new Uint8Array([3]));
});

test('model filenames rejected by persistence are also rejected before import',async()=>{
 store.getState().newProject();const before=store.getState();
 const file=new File([new Uint8Array([1])],'revision:one.glb');
 await assert.rejects(modelImport.importModelAsset({id:'colon',name:file.name,path:file.name,type:'model',file},[]),/模型文件路径/);
 assert.equal(store.getState().nodes,before.nodes);assert.equal(store.getState().past,before.past);
});

test('undo and redo retain all currently selected nodes that still exist',()=>{
 store.getState().newProject();const ids=store.getState().nodes.slice(0,2).map(n=>n.id);
 store.getState().selectNodes(ids);store.getState().updateSettings({backgroundColor:'#123456'});
 store.getState().undo();assert.deepEqual(store.getState().selectedNodeIds,ids);
 assert.equal(store.getState().selectedNodeId,ids[0]);
 store.getState().redo();assert.deepEqual(store.getState().selectedNodeIds,ids);
});

test('deleting absent scene nodes preserves undo and redo history',()=>{
 store.getState().newProject();store.getState().renameNode('cube','renamed');store.getState().undo();
 const before=store.getState();
 store.getState().removeNodes([]);store.getState().removeNode('missing');
 assert.equal(store.getState().past,before.past);assert.equal(store.getState().future,before.future);
 assert.equal(store.getState().nodes,before.nodes);
 store.getState().redo();assert.equal(store.getState().nodes.find(n=>n.id==='cube').name,'renamed');
});

test('unchanged node renames preserve pending redo operations',()=>{
 store.getState().newProject();store.getState().renameNode('cube','changed');store.getState().undo();
 const before=store.getState(),name=before.nodes.find(n=>n.id==='cube').name;
 store.getState().renameNode('cube',name);store.getState().renameNode('missing','unused');
 assert.equal(store.getState().past,before.past);assert.equal(store.getState().future,before.future);
 assert.equal(store.getState().nodes,before.nodes);
 store.getState().redo();assert.equal(store.getState().nodes.find(n=>n.id==='cube').name,'changed');
});

test('reparenting to the current parent preserves pending redo history',()=>{
 store.getState().newProject();store.getState().renameNode('cube','changed');store.getState().undo();
 const before=store.getState(),node=before.nodes.find(n=>n.id==='cube');
 store.getState().setParent(node.id,node.parentId);
 assert.equal(store.getState().past,before.past);assert.equal(store.getState().future,before.future);
 assert.equal(store.getState().nodes,before.nodes);
 store.getState().redo();assert.equal(store.getState().nodes.find(n=>n.id==='cube').name,'changed');
});

test('absent script binding operations preserve redo history',()=>{
 store.getState().newProject();store.getState().renameNode('cube','changed');store.getState().undo();
 const before=store.getState();
 store.getState().detachScript('cube','missing.js');store.getState().detachScript('missing','main.js');
 store.getState().attachScript('missing','main.js');
 assert.equal(store.getState().past,before.past);assert.equal(store.getState().future,before.future);
 assert.equal(store.getState().nodes,before.nodes);store.getState().redo();
 assert.equal(store.getState().nodes.find(n=>n.id==='cube').name,'changed');
});

test('synchronizing unchanged script contents preserves redo history',()=>{
 store.getState().newProject();store.getState().renameNode('cube','changed');store.getState().undo();
 const before=store.getState();store.getState().updateScript(before.activeFileId,before.scripts[before.activeFileId]);
 assert.equal(store.getState().past,before.past);assert.equal(store.getState().future,before.future);
 assert.equal(store.getState().scripts,before.scripts);store.getState().redo();
 assert.equal(store.getState().nodes.find(n=>n.id==='cube').name,'changed');
});

test('transform updates targeting missing nodes preserve the running camera and history',()=>{
 store.getState().newProject();const camera=store.getState().nodes.find(n=>n.type==='camera');
 store.getState().updateTransform(camera.id,{activeCamera:true});
 store.getState().renameNode('cube','changed');store.getState().undo();const before=store.getState();
 store.getState().updateTransform('deleted-camera',{activeCamera:true});
 assert.equal(store.getState().nodes,before.nodes);assert.equal(store.getState().past,before.past);
 assert.equal(store.getState().future,before.future);
 assert.equal(store.getState().nodes.find(n=>n.id===camera.id).activeCamera,true);
});

test('camera activation rejects non-camera targets without changing scene or history',()=>{
 store.getState().newProject();const before=store.getState();
 assert.throws(()=>store.getState().updateTransform('cube',{activeCamera:true}),/相机/);
 assert.equal(store.getState().nodes,before.nodes);assert.equal(store.getState().past,before.past);
});

test('pasting into a missing parent preserves scene and redo history',()=>{
 store.getState().newProject();store.getState().selectNode('cube');store.getState().copyToClipboard();
 store.getState().renameNode('cube','changed');store.getState().undo();const before=store.getState();
 assert.throws(()=>store.getState().pasteFromClipboard('missing-parent'),/父节点/);
 assert.equal(store.getState().nodes,before.nodes);assert.equal(store.getState().past,before.past);
 assert.equal(store.getState().future,before.future);
});

test('duplicating or pasting the running camera preserves its exclusive activation',()=>{
 for(const paste of [false,true]){
  store.getState().newProject();const camera=store.getState().nodes.find(n=>n.type==='camera');
  store.getState().updateTransform(camera.id,{activeCamera:true});
  if(paste){store.getState().selectNode(camera.id);store.getState().copyToClipboard();store.getState().pasteFromClipboard();}
  else store.getState().duplicateNode(camera.id);
  assert.deepEqual(store.getState().nodes.filter(n=>n.type==='camera'&&n.activeCamera).map(n=>n.id),[camera.id]);
 }
});

test('instantiating a camera prefab preserves the existing running camera',()=>{
 store.getState().newProject();const camera=store.getState().nodes.find(n=>n.type==='camera');
 store.getState().updateTransform(camera.id,{activeCamera:true});
 const prefab=store.getState().createPrefab(camera.id,'Camera');
 store.getState().instantiatePrefab(prefab);
 assert.deepEqual(store.getState().nodes.filter(n=>n.type==='camera'&&n.activeCamera).map(n=>n.id),[camera.id]);
});

test('unchanged material assignments preserve pending redo history',()=>{
 store.getState().newProject();const material=store.getState().createMaterial('material');
 store.getState().setNodeMaterial('cube',material);store.getState().renameNode('cube','changed');store.getState().undo();
 const before=store.getState();store.getState().setNodeMaterial('cube',material);
 assert.equal(store.getState().nodes,before.nodes);assert.equal(store.getState().past,before.past);
 assert.equal(store.getState().future,before.future);
});

test('material assignment rejects non-renderable nodes before changing history',()=>{
 store.getState().newProject();const material=store.getState().createMaterial('material'),before=store.getState();
 const camera=before.nodes.find(n=>n.type==='camera');
 assert.throws(()=>store.getState().setNodeMaterial(camera.id,material),/网格或模型/);
 store.getState().setNodeMaterial('missing',material);
 assert.equal(store.getState().nodes,before.nodes);assert.equal(store.getState().past,before.past);
});

test('empty material identifiers are rejected while undefined clears an assignment',()=>{
 store.getState().newProject();const material=store.getState().createMaterial('material');
 store.getState().setNodeMaterial('cube',material);const before=store.getState();
 assert.throws(()=>store.getState().setNodeMaterial('cube',''),/材质不存在/);
 assert.equal(store.getState().nodes,before.nodes);assert.equal(store.getState().past,before.past);
 store.getState().setNodeMaterial('cube',undefined);
 assert.equal(store.getState().nodes.find(n=>n.id==='cube').materialId,undefined);
 validate(recovery.captureEditorProject(store.getState()));
});

test('unchanged model material slot assignments preserve redo history',()=>{
 for(const assigned of ['material',null,undefined]){
  store.getState().newProject();const material=store.getState().createMaterial('material'),id=store.getState().addNode('model','model');
  const value=assigned==='material'?material:assigned;
  if(value!==undefined)store.getState().setModelSlotMaterial(id,'mesh:0/slot:0',value);
  store.getState().renameNode('cube','changed');store.getState().undo();const before=store.getState();
  store.getState().setModelSlotMaterial(id,'mesh:0/slot:0',value);
  assert.equal(store.getState().nodes,before.nodes);assert.equal(store.getState().past,before.past);
  assert.equal(store.getState().future,before.future);
 }
});

test('applying unchanged project settings preserves redo history',()=>{
 store.getState().newProject();store.getState().renameNode('cube','changed');store.getState().undo();
 const before=store.getState();
 store.getState().updateSettings(structuredClone(before.settings));store.getState().updateSettings({});
 assert.equal(store.getState().settings,before.settings);assert.equal(store.getState().past,before.past);
 assert.equal(store.getState().future,before.future);store.getState().redo();
 assert.equal(store.getState().nodes.find(n=>n.id==='cube').name,'changed');
});

test('resetting a camera prefab preserves the scene running camera',()=>{
 store.getState().newProject();const camera=store.getState().nodes.find(n=>n.type==='camera');
 const prefab=store.getState().createPrefab(camera.id,'Camera');
 const root=store.getState().instantiatePrefab(prefab);
 const instance=Object.values(store.getState().content.prefabInstances).find(i=>i.rootId===root);
 store.getState().resetPrefabInstance(instance.id);
 assert.deepEqual(store.getState().nodes.filter(n=>n.type==='camera'&&n.activeCamera).map(n=>n.id),[camera.id]);
});

test('camera prefab reset and updates retain an explicitly selected instance camera',()=>{
 const s=()=>store.getState();s().newProject();
 const camera=s().nodes.find(n=>n.type==='camera');
 const prefab=s().createPrefab(camera.id,'Camera'),root=s().instantiatePrefab(prefab);
 const instance=Object.values(s().content.prefabInstances).find(i=>i.rootId===root);
 s().updateTransform(root,{activeCamera:true});
 s().resetPrefabInstance(instance.id);
 const active=()=>s().nodes.filter(n=>n.type==='camera'&&n.activeCamera).map(n=>n.id);
 assert.deepEqual(active(),[root]);s().undo();assert.deepEqual(active(),[root]);
 s().redo();assert.deepEqual(active(),[root]);
 s().updatePrefabFromInstance(instance.id);assert.deepEqual(active(),[root]);
});

test('unchanged transform and scalar edits preserve redo history',()=>{
 store.getState().newProject();store.getState().renameNode('cube','changed');store.getState().undo();
 const before=store.getState(),cube=before.nodes.find(n=>n.id==='cube');
 for(const patch of [{},{transform:{...cube.transform}},{rotation:{...cube.rotation}},{scale:{...cube.scale}},{visible:cube.visible}]){
  store.getState().updateTransform('cube',patch);
  assert.equal(store.getState().nodes,before.nodes);
  assert.equal(store.getState().past,before.past);assert.equal(store.getState().future,before.future);
 }
});

test('unchanged material edits retain redo including cloned UV values',()=>{
 const s=()=>store.getState();s().newProject();const id=s().createMaterial('Material');
 s().renameNode('cube','changed');s().undo();const before=s(),material=before.content.materials[id];
 for(const patch of [{},{roughness:material.roughness},{uvScale:{...material.uvScale}},{...structuredClone(material)}]){
  s().updateMaterial(id,patch);
  assert.equal(s().content,before.content);assert.equal(s().past,before.past);assert.equal(s().future,before.future);
 }
});

test('material edits own nested UV data independently of caller objects',()=>{
 const s=()=>store.getState();s().newProject();const id=s().createMaterial('Material'),uvScale={u:2,v:3};
 s().updateMaterial(id,{uvScale});s().renameNode('cube','changed');
 uvScale.u=99;
 assert.deepEqual(s().content.materials[id].uvScale,{u:2,v:3});
 s().undo();assert.deepEqual(s().content.materials[id].uvScale,{u:2,v:3});
});

test('transform edits own vector and component data independently of caller objects',()=>{
 const s=()=>store.getState();s().newProject();
 const transform={x:2,y:3,z:4},physics={motion:'dynamic',shape:'box',size:{x:1,y:1,z:1},mass:1,friction:0.5,restitution:0,sensor:false,lockRotation:false};
 s().updateTransform('cube',{transform,physics});transform.x=99;physics.size.x=99;
 const cube=s().nodes.find(n=>n.id==='cube');
 assert.equal(cube.transform.x,2);assert.equal(cube.physics.size.x,1);
});

test('project settings own gravity values independently of caller objects',()=>{
 const s=()=>store.getState();s().newProject();const gravity={x:1,y:-8,z:2};
 s().updateSettings({gravity});gravity.y=99;
 assert.equal(s().settings.gravity.y,-8);
});

test('imported audio and textures own metadata and bytes independently of caller objects',()=>{
 const s=()=>store.getState();
 for(const kind of ['audio','texture']){
  s().newProject();const asset={id:'asset',name:kind==='audio'?'tone.wav':'image.png',mime:kind==='audio'?'audio/wav':'image/png',byteLength:3},bytes=new Uint8Array([1,2,3]);
  if(kind==='audio')s().importAudio(asset,bytes.buffer);else s().importTexture(asset,bytes.buffer);
  asset.name='changed';bytes[0]=99;
  const saved=kind==='audio'?s().content.audio[0]:s().content.textures[0];
  assert.notEqual(saved.name,'changed');
  const buffer=(kind==='audio'?s().audioBuffers:s().textureBuffers).get('asset');
  assert.deepEqual([...new Uint8Array(buffer)],[1,2,3]);
 }
});

test('model buffers own imported bytes independently of caller memory',()=>{
 const s=()=>store.getState();s().newProject();const bytes=new Uint8Array([1,2,3]);
 s().setModelBuffer('model',bytes.buffer);bytes[0]=99;
 assert.deepEqual([...new Uint8Array(s().modelBuffers.get('model'))],[1,2,3]);
});

test('project replacement owns resource maps, missing IDs and binary data',()=>{
 const s=()=>store.getState();s().newProject();
 const data={...s(),version:'0.6',projectId:'loaded',name:'Loaded',updatedAt:1,scene:{nodes:s().nodes},modelRefs:[]};
 const bytes=new Uint8Array([1,2,3]),models=new Map([['model',bytes.buffer]]),textures=new Map([['texture',bytes.buffer]]),audio=new Map([['audio',bytes.buffer]]),missing=new Set(['absent']);
 s().replaceProject(data,models,missing,false,undefined,textures,audio);
 models.clear();textures.clear();audio.clear();missing.clear();bytes[0]=99;
 for(const [map,id] of [[s().modelBuffers,'model'],[s().textureBuffers,'texture'],[s().audioBuffers,'audio']])
  assert.deepEqual([...new Uint8Array(map.get(id))],[1,2,3]);
 assert.deepEqual([...s().missingModelIds],['absent']);
});

test('project replacement rejects detached resources before changing the current document',()=>{
 const s=()=>store.getState();s().newProject();s().renameNode('cube','Keep');
 const before=s(),data={...before,version:'0.6',projectId:'loaded',name:'Loaded',updatedAt:1,scene:{nodes:before.nodes},modelRefs:[]};
 const bytes=new ArrayBuffer(3);structuredClone(bytes,{transfer:[bytes]});
 assert.throws(()=>s().replaceProject(data,new Map([['model',bytes]]),new Set()));
 assert.equal(s(),before);
});

test('playback project and restore snapshot isolate nested scene components and settings',()=>{
 const s=()=>store.getState();s().newProject();
 s().updateTransform('cube',{physics:{motion:'dynamic',shape:'box',size:{x:1,y:1,z:1},mass:1,friction:0.5,restitution:0,sensor:false,lockRotation:false}});
 s().play();const runtime=s().project,original=s().nodes.find(n=>n.id==='cube');
 runtime.scene.nodes.find(n=>n.id==='cube').physics.size.x=99;
 runtime.settings.gravity.y=99;runtime.scripts['main.js']='changed';
 assert.equal(original.physics.size.x,1);assert.notEqual(s().settings.gravity.y,99);
 assert.notEqual(s().scripts['main.js'],'changed');
 original.physics.size.x=42;s().stop();
 assert.equal(s().nodes.find(n=>n.id==='cube').physics.size.x,1);
});

test('model relinking owns its bytes and rejects detached input before history changes',()=>{
 const s=()=>store.getState();s().newProject();const id=s().addNode('model','Model'),bytes=new Uint8Array([1,2,3]);
 s().relinkModel(id,bytes.buffer,'model.glb');bytes[0]=99;
 assert.deepEqual([...new Uint8Array(s().modelBuffers.get(id))],[1,2,3]);
 const detached=new ArrayBuffer(3);structuredClone(detached,{transfer:[detached]});
 const before=s();assert.throws(()=>s().relinkModel(id,detached,'other.glb'));
 assert.equal(s(),before);
});

test('normalized projects isolate node components and bindings from input documents',()=>{
 const s=()=>store.getState();s().newProject();
 s().updateTransform('cube',{physics:{motion:'dynamic',shape:'box',size:{x:1,y:1,z:1},mass:1,friction:0.5,restitution:0,sensor:false,lockRotation:false}});
 const input={...s(),version:'0.6',projectId:'load',name:'Load',updatedAt:1,scene:{nodes:structuredClone(s().nodes)},modelRefs:[]};
 const normalized=normalize(input);
 input.scene.nodes[0].physics.size.x=99;input.scene.nodes[0].scripts.push('other.js');
 assert.equal(normalized.scene.nodes[0].physics.size.x,1);
 assert.deepEqual(normalized.scene.nodes[0].scripts,['main.js']);
});

test('deep hierarchy validation reuses ancestor paths and still rejects distant cycles and missing parents',()=>{
 const nodes=Array.from({length:20000},(_,i)=>({id:String(i),name:'Node',type:'empty',parentId:i?String(i-1):null}));
 const project={scene:{nodes},scripts:{'main.js':''}};
 assert.equal(validate(project).nodes.length,nodes.length);
 nodes.reverse();assert.equal(validate(project).nodes.length,nodes.length);
 nodes.at(-1).parentId='19999';assert.throws(()=>validate(project),/层级/);
 nodes.at(-1).parentId='missing';assert.throws(()=>validate(project),/层级/);
});

test('failed paste of a deleted external joint reference preserves scene and redo history',()=>{
 const s=()=>store.getState();s().newProject();
 const physics={motion:'dynamic',shape:'box',size:{x:1,y:1,z:1},mass:1,friction:0.5,restitution:0,sensor:false,lockRotation:false};
 s().updateTransform('sphere',{physics});
 s().updateTransform('cube',{physics,joints:[{id:'joint',kind:'fixed',targetId:'sphere',anchor:{x:0,y:0,z:0},anchor2:{x:0,y:0,z:0},axis:{x:1,y:0,z:0},min:0,max:0}]});
 s().selectNode('cube');s().copyToClipboard();s().removeNode('sphere');
 s().renameNode('cube','changed');s().undo();const before=s();
 assert.throws(()=>s().pasteFromClipboard(),/关节/);
 assert.equal(s(),before);
});

test('copying deep reverse-stored subtrees includes overlapping selections once in source order',()=>{
 const s=()=>store.getState();s().newProject();const base=s().nodes[0];
 const chain=Array.from({length:20000},(_,i)=>({...structuredClone(base),id:String(i),parentId:i?String(i-1):null})).reverse();
 const extra={...structuredClone(base),id:'extra',parentId:null};
 store.setState({nodes:[extra,...chain],selectedNodeIds:['0','100','extra'],selectedNodeId:'0'});
 s().copyToClipboard();assert.deepEqual(s().clipboard.map(n=>n.id),['extra',...chain.map(n=>n.id)]);
 s().clipboard[1].transform.x=99;assert.equal(s().nodes[1].transform.x,base.transform.x);
});

test('duplicated missing models retain resource warnings through undo and redo',()=>{
 const s=()=>store.getState();s().newProject();const id=s().addNode('model','Missing');
 s().updateTransform(id,{modelUrl:'missing.glb'});store.setState({missingModelIds:new Set([id])});
 s().duplicateNode(id);const copy=s().selectedNodeId;
 assert.equal(s().modelBuffers.has(copy),false);assert.ok(s().missingModelIds.has(copy));
 s().undo();assert.deepEqual([...s().missingModelIds],[id]);
 s().redo();assert.ok(s().missingModelIds.has(copy));
 s().relinkModel(copy,new Uint8Array([1,2,3]).buffer,'restored.glb');
 assert.equal(s().missingModelIds.has(copy),false);assert.ok(s().missingModelIds.has(id));
});

test('creating a prefab accounts for missing template model resources until replacement',()=>{
 const s=()=>store.getState();s().newProject();const id=s().addNode('model','Missing');
 s().updateTransform(id,{modelUrl:'missing.glb'});store.setState({missingModelIds:new Set([id])});
 const prefab=s().createPrefab(id,'Missing template'),key=Object.values(s().content.prefabs[prefab].modelKeys)[0];
 assert.ok(s().missingModelIds.has(key));assert.ok(s().missingModelIds.has(id));
 s().undo();assert.deepEqual([...s().missingModelIds],[id]);s().redo();assert.ok(s().missingModelIds.has(key));
 s().relinkModel(id,new Uint8Array([1,2,3]).buffer,'restored.glb');
 assert.ok(s().missingModelIds.has(key));
 const instance=Object.values(s().content.prefabInstances).find(i=>i.rootId===id);
 s().updatePrefabFromInstance(instance.id);assert.equal(s().missingModelIds.size,0);
});

test('scene drag ancestry checks handle deep chains, unrelated roots and malformed loops',async()=>{
 const {isSceneDescendant}=await server.ssrLoadModule('/src/utils/sceneHierarchy.ts');
 const parents=new Map(Array.from({length:20000},(_,i)=>[String(i),i?String(i-1):null]));
 assert.equal(isSceneDescendant(parents,'19999','0'),true);
 assert.equal(isSceneDescendant(parents,'0','19999'),false);
 assert.equal(isSceneDescendant(parents,'19999','unrelated'),false);
 assert.equal(isSceneDescendant(parents,'missing','0'),false);
 parents.set('0','19999');assert.equal(isSceneDescendant(parents,'19999','unrelated'),false);
});

test('copy with no scene selection preserves the existing clipboard',()=>{
 const s=()=>store.getState();s().newProject();s().selectNode('cube');s().copyToClipboard();
 s().clearSelection();const before=s();s().copyToClipboard();
 assert.equal(s().clipboard,before.clipboard);assert.equal(s().clipboardContent,before.clipboardContent);
 s().pasteFromClipboard();assert.ok(s().nodes.some(n=>n.name==='Cube_copy'));
});

test('cleared model catalogs release node entries after model disposal',()=>{
 const s=()=>store.getState();s().newProject();
 for(let i=0;i<100;i++){
  const id=s().addNode('model',`Model ${i}`);
  s().setModelAnimations(id,['Idle']);s().setModelParts(id,[{key:'mesh:0/slot:0',name:'Body'}]);
  assert.deepEqual(s().modelAnimations[id],['Idle']);assert.equal(s().modelParts[id].length,1);
  s().setModelAnimations(id,[]);s().setModelParts(id,[]);
 }
 assert.deepEqual(s().modelAnimations,{});assert.deepEqual(s().modelParts,{});
});

test('late model catalog callbacks do not recreate entries for deleted nodes',()=>{
 const s=()=>store.getState();s().newProject();const id=s().addNode('model','Model');
 s().removeNode(id);
 s().setModelAnimations(id,['Idle']);s().setModelParts(id,[{key:'mesh:0/slot:0',name:'Body'}]);
 assert.equal(Object.hasOwn(s().modelAnimations,id),false);
 assert.equal(Object.hasOwn(s().modelParts,id),false);
});

test('deleting a model subtree immediately clears its catalogs while retaining other models',()=>{
 const s=()=>store.getState();s().newProject();const root=s().addNode('empty','Root'),child=s().addNode('model','Child'),other=s().addNode('model','Other');
 s().setParent(child,root);
 for(const id of [child,other]){s().setModelAnimations(id,['Idle']);s().setModelParts(id,[{key:'mesh:0/slot:0',name:'Body'}]);}
 s().removeNode(root);
 assert.equal(Object.hasOwn(s().modelAnimations,child),false);assert.equal(Object.hasOwn(s().modelParts,child),false);
 assert.deepEqual(s().modelAnimations[other],['Idle']);assert.equal(s().modelParts[other].length,1);
});

test('relinking a model clears catalogs belonging to its previous binary',()=>{
 const s=()=>store.getState();s().newProject();const id=s().addNode('model','Model');
 s().setModelAnimations(id,['Old clip']);s().setModelParts(id,[{key:'mesh:0/slot:0',name:'Old part'}]);
 s().relinkModel(id,new Uint8Array([1,2,3]).buffer,'replacement.glb');
 assert.equal(Object.hasOwn(s().modelAnimations,id),false);assert.equal(Object.hasOwn(s().modelParts,id),false);
});

test('visibility changes for missing nodes preserve pending redo',()=>{
 const s=()=>store.getState();s().newProject();s().renameNode('cube','Changed');s().undo();
 const before=s();s().toggleVisibility('deleted');
 assert.equal(s(),before);
 s().toggleVisibility('cube');assert.equal(s().nodes.find(n=>n.id==='cube').visible,false);
 s().undo();assert.equal(s().nodes.find(n=>n.id==='cube').visible,true);
});

test('deleting absent resources preserves scene history and pending redo',()=>{
 const s=()=>store.getState();s().newProject();s().renameNode('cube','Changed');s().undo();const before=s();
 for(const action of ['deleteAudio','deleteTexture','deleteMaterial','deletePrefab']){
  s()[action]('absent');assert.equal(s(),before,action);
 }
});

test('unchanged prefab names preserve pending redo after trimming',()=>{
 const s=()=>store.getState();s().newProject();const id=s().createPrefab('cube','Template');
 s().renameNode('sphere','Changed');s().undo();const before=s();
 s().renamePrefab(id,'  Template  ');assert.equal(s(),before);
});

test('unchanged advanced and gameplay configurations retain pending redo',()=>{
 const s=()=>store.getState();s().newProject();s().renameNode('cube','Changed');s().undo();const before=s();
 s().updateAdvancedContent({});assert.equal(s(),before);
 s().updateAdvancedContent({mixer:structuredClone(before.content.mixer),physics:structuredClone(before.content.physics)});assert.equal(s(),before);
 s().updateGameplay(structuredClone(before.content.gameplay));assert.equal(s(),before);
});

test('configuration comparisons ignore object key order and retain ordered array changes',()=>{
 const s=()=>store.getState();s().newProject();s().renameNode('cube','Changed');s().undo();const before=s();
 const physics=before.content.physics;
 s().updateAdvancedContent({physics:{debug:physics.debug,groups:physics.groups.map(({name,mask})=>({mask,name}))}});
 assert.equal(s(),before);
 const gameplay=structuredClone(before.content.gameplay);gameplay.actions.reverse();s().updateGameplay(gameplay);
 assert.deepEqual(s().content.gameplay.actions,gameplay.actions);assert.equal(s().past.length,before.past.length+1);
 s().undo();assert.deepEqual(s().content.gameplay.actions,before.content.gameplay.actions);
});

test('unchanged nested node components preserve pending redo',()=>{
 const s=()=>store.getState();s().newProject();
 const physics={motion:'dynamic',shape:'box',size:{x:1,y:1,z:1},mass:1,friction:0.5,restitution:0,sensor:false,lockRotation:false};
 s().updateTransform('cube',{physics});s().renameNode('sphere','Changed');s().undo();const before=s();
 s().updateTransform('cube',{physics:structuredClone(physics)});assert.equal(s(),before);
 const changed=structuredClone(physics);changed.size.x=2;s().updateTransform('cube',{physics:changed});
 assert.equal(s().nodes.find(n=>n.id==='cube').physics.size.x,2);s().undo();assert.equal(s().nodes.find(n=>n.id==='cube').physics.size.x,1);
});

test('storage saves capture metadata before asynchronous database access',async()=>{
 store.getState().newProject();const data=recovery.captureEditorProject(store.getState());data.projectId='captured-save';data.name='Original';
 const pending=storage.saveProjectSnapshot(data,new Map());
 data.name='Mutated';data.scene.nodes[0].name='Mutated node';
 await pending;const saved=await storage.loadProject('captured-save');
 assert.equal(saved.name,'Original');assert.equal(saved.scene.nodes[0].name,'Cube');
});

test('recovery storage captures metadata and binary resources before awaiting the database',async()=>{
 store.getState().newProject();const project=structuredClone(recovery.captureEditorProject(store.getState()));project.name='Original recovery';
 const bytes=new Uint8Array([1,2,3]),record={recoveryId:'captured-recovery',project,buffers:new Map([['model',bytes.buffer]]),updatedAt:Date.now()};
 const pending=storage.saveRecovery(record);project.name='Mutated';bytes[0]=99;record.buffers.clear();
 await pending;const saved=await storage.loadRecovery('captured-recovery');
 assert.equal(saved.project.name,'Original recovery');assert.deepEqual([...new Uint8Array(saved.buffers.get('model'))],[1,2,3]);
});

test('stale file selection preserves the active script and its derived text',()=>{
 const s=()=>store.getState();s().newProject();s().createScript('other.js','Other');s().setActiveFile('other.js');
 s().deleteScript('other.js');const before=s();s().setActiveFile('other.js');assert.equal(s(),before);
 assert.equal(s().script,s().scripts[s().activeFileId]);
});

test('late script edits do not resurrect deleted files or consume redo history',()=>{
 const s=()=>store.getState();s().newProject();s().createScript('old.js','Original');s().deleteScript('old.js');
 s().renameNode('cube','Changed');s().undo();const before=s();
 s().updateScript('old.js','Late editor event');assert.equal(s(),before);assert.equal(Object.hasOwn(s().scripts,'old.js'),false);
});

test('render compute budgets round-trip and invalid native settings are rejected before replacing the project',()=>{
 const project=recovery.captureEditorProject(store.getState());
 project.settings.renderCompute={enabled:true,normalsMinVertices:64,transformsMinEntities:16,worldBounds:false,boundsMinChangedFraction:.5,cullMinMeshes:8,viewsMinPortals:8,maxBatchMeshes:4096,epsilon:1e-6};
 const result=normalize(project);
 assert.deepEqual({...result.settings.renderCompute},project.settings.renderCompute);
 const legacy=normalize({...project,settings:{...project.settings,renderCompute:{normalsMinVertices:64}}});
 assert.equal(legacy.settings.renderCompute.worldBounds,true);
 assert.equal(legacy.settings.renderCompute.transformsMinEntities,32);
 assert.equal(legacy.settings.renderCompute.boundsMinChangedFraction,.25);
 assert.equal(legacy.settings.renderCompute.viewsMinPortals,8);
 for(const bad of [{enabled:'yes'},{worldBounds:'yes'},{transformsMinEntities:-1},{maxBatchMeshes:0},{epsilon:-1},{cullMinMeshes:NaN},{extra:1}])assert.throws(()=>normalize({...project,settings:{...project.settings,renderCompute:bad}}),/render compute/i);
});

test('animation compute budgets survive normalization, recovery and archive roundtrip',async()=>{
 const s=()=>store.getState(); s().newProject();
 const settings={enabled:true,minTracks:12,maxTracks:4096,maxKeys:120000};
 store.setState({settings:{...s().settings,animationCompute:settings}});
 const project=recovery.captureEditorProject(s());
 assert.deepEqual({...normalize(project).settings.animationCompute},settings);
 const partial=normalize({...project,settings:{...project.settings,animationCompute:{minTracks:0}}});
 assert.equal(partial.settings.animationCompute.maxTracks,8192);
 const bytes=archive.createProjectArchive();s().newProject();
 await archive.importProject(new File([bytes],'animation.arkglide'));
 assert.deepEqual({...s().settings.animationCompute},settings);
 for(const bad of [{enabled:'yes'},{minTracks:-1},{maxKeys:0},{maxTracks:65537},{extra:1}])
   assert.throws(()=>normalize({...project,settings:{...project.settings,animationCompute:bad}}),/animation compute/i);
});
