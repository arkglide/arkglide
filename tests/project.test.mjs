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
    server: { middlewareMode: true },
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
  assert.equal(upgraded.version, "0.5");
  assert.equal(upgraded.settings.fixedTimeStep, 1 / 60);
  assert.equal(upgraded.settings.timeScale, 1);
  assert.throws(() => normalize({ ...old, version: "0.6" }), /版本/);
  const { zipSync, strToU8 } = await import("fflate");
  const bytes = zipSync({
    "project.json": strToU8(JSON.stringify({ ...old, version: "0.6" })),
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
    assert.equal(draft.project.version, "0.5");
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
