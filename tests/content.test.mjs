import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { indexedDB } from "fake-indexeddb";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
let server, store, archive, recovery, storage, validate, prefabMath;
before(async () => {
  globalThis.indexedDB = indexedDB;
  server = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ useEditorStore: store } = await server.ssrLoadModule(
    "/src/store/useEditorStore.ts",
  ));
  archive = await server.ssrLoadModule("/src/utils/projectExport.ts");
  recovery = await server.ssrLoadModule("/src/utils/projectRecovery.ts");
  storage = await server.ssrLoadModule("/src/utils/projectStorage.ts");
  ({ validateProject: validate } = await server.ssrLoadModule(
    "/src/utils/projectValidation.ts",
  ));
  prefabMath = await server.ssrLoadModule("/src/engine/prefabs.ts");
});
after(async () => {
  await server?.close();
});
const state = () => store.getState();
const mesh = (id) => state().nodes.find((n) => n.id === id);
const instance = (root) =>
  Object.values(state().content.prefabInstances).find((i) => i.rootId === root);
function fixture() {
  state().newProject();
  const group = state().addNode("empty", "Enemy"),
    child = state().addNode("mesh", "Body");
  state().setParent(child, group);
  const prefab = state().createPrefab(group),
    root = state().instantiatePrefab(prefab);
  return {
    group,
    child,
    prefab,
    root,
    other: instance(root).nodeMap[mesh(child).prefab.nodeId],
  };
}
function texture(id = "tex", value = 1) {
  state().importTexture(
    { id, name: "texture.png", mime: "image/png", byteLength: 3 },
    new Uint8Array([value, 2, 3]).buffer,
  );
  return id;
}

test("materials and textures share references, preserve IDs on replacement and undo all resource edits", () => {
  state().newProject();
  const tex = texture(),
    mat = state().createMaterial("Gold");
  state().updateMaterial(mat, {
    metallic: 1,
    roughness: 0.2,
    albedoTextureId: tex,
  });
  state().setNodeMaterial("cube", mat);
  state().setNodeMaterial("sphere", mat);
  assert.equal(mesh("cube").materialId, mesh("sphere").materialId);
  assert.throws(() => state().deleteMaterial(mat), /引用/);
  assert.throws(() => state().deleteTexture(tex), /引用/);
  texture(tex, 9);
  assert.equal(state().content.materials[mat].albedoTextureId, tex);
  assert.equal(new Uint8Array(state().textureBuffers.get(tex))[0], 9);
  state().undo();
  assert.equal(new Uint8Array(state().textureBuffers.get(tex))[0], 1);
  state().redo();
  assert.equal(new Uint8Array(state().textureBuffers.get(tex))[0], 9);
  state().updateMaterial(mat, { albedoTextureId: undefined });
  state().deleteTexture(tex);
  assert.ok(!state().textureBuffers.has(tex));
  state().undo();
  assert.ok(state().textureBuffers.has(tex));
  state().setNodeMaterial("cube");
  state().setNodeMaterial("sphere");
  state().deleteMaterial(mat);
  assert.ok(!state().content.materials[mat]);
});
test("unique material copies let instances change appearance without changing shared definitions", () => {
  const { group, child, prefab, root, other } = fixture(),
    mat = state().createMaterial("Shared");
  state().setNodeMaterial(child, mat);
  state().updatePrefabFromInstance(instance(group).id);
  assert.equal(mesh(other).materialId, mat);
  const unique = state().createMaterial("Unique", mat);
  state().setNodeMaterial(other, unique);
  state().updateMaterial(unique, { baseColor: "#FF0000" });
  assert.equal(state().content.materials[mat].baseColor, "#FFFFFF");
  assert.equal(state().content.materials[unique].baseColor, "#FF0000");
  state().updateTransform(child, { scale: { x: 2, y: 2, z: 2 } });
  state().updatePrefabFromInstance(instance(group).id);
  assert.equal(mesh(other).materialId, unique);
  assert.equal(mesh(other).scale.x, 2);
});
test("prefab snapshots outlive their source model and generate independent IDs and binary buffers", () => {
  state().newProject();
  const model = state().addNode("model", "Robot");
  state().updateTransform(model, { modelUrl: "robot.glb" });
  const b = new Uint8Array([1, 2, 3]).buffer;
  state().setModelBuffer(model, b);
  const id = state().createPrefab(model);
  state().removeNode(model);
  assert.equal(Object.keys(state().content.prefabInstances).length, 0);
  const a = state().instantiatePrefab(id),
    c = state().instantiatePrefab(id);
  assert.notEqual(a, c);
  assert.notEqual(state().modelBuffers.get(a), state().modelBuffers.get(c));
  assert.deepEqual([...new Uint8Array(state().modelBuffers.get(a))], [1, 2, 3]);
  assert.equal(Object.values(state().content.prefabInstances).length, 2);
});
test("template updates merge individual transform axes, preserve placement and keep local property overrides", () => {
  const { group, child, root, other } = fixture();
  state().updateTransform(root, { transform: { x: 10, y: 3, z: 1 } });
  state().updateTransform(other, {
    scale: { x: 4, y: 1, z: 1 },
    color: "#FF0000",
  });
  state().updateTransform(child, {
    scale: { x: 2, y: 3, z: 4 },
    color: "#00FF00",
  });
  state().renameNode(child, "UpdatedBody");
  state().updatePrefabFromInstance(instance(group).id);
  assert.deepEqual(mesh(other).scale, { x: 4, y: 3, z: 4 });
  assert.equal(mesh(other).color, "#FF0000");
  assert.equal(mesh(other).name, "UpdatedBody");
  assert.deepEqual(mesh(root).transform, { x: 10, y: 3, z: 1 });
  assert.equal(instance(root).revision, 2);
  state().resetPrefabInstance(instance(root).id);
  assert.deepEqual(mesh(other).scale, { x: 2, y: 3, z: 4 });
  assert.equal(mesh(other).color, "#00FF00");
  assert.equal(
    prefabMath.instanceOverrides(instance(root), state().nodes).changed,
    0,
  );
  assert.equal(mesh(root).transform.x, 10);
  state().undo();
  assert.equal(mesh(other).color, "#FF0000");
});
test("new template children propagate; removed inherited children stay removed until reset", () => {
  const { group, child, root, other } = fixture();
  state().removeNode(other);
  const added = state().addNode("mesh", "Weapon");
  state().setParent(added, group);
  state().updatePrefabFromInstance(instance(group).id);
  assert.ok(!mesh(other));
  assert.ok(
    state().nodes.some((n) => n.name === "Weapon" && n.parentId === root),
  );
  assert.equal(
    prefabMath.instanceOverrides(instance(root), state().nodes).removed,
    1,
  );
  state().updateTransform(child, { visible: false });
  state().updatePrefabFromInstance(instance(group).id);
  assert.ok(!mesh(other));
  state().resetPrefabInstance(instance(root).id);
  assert.ok(mesh(other));
  assert.equal(mesh(other).visible, false);
});
test("template deletion preserves scene-only children and reattaches them to the instance root", () => {
  const { group, child, root, other } = fixture(),
    local = state().addNode("mesh", "Local child");
  state().setParent(local, other);
  state().removeNode(child);
  state().updatePrefabFromInstance(instance(group).id);
  assert.ok(!mesh(other));
  assert.equal(mesh(local).parentId, root);
  assert.equal(
    prefabMath.instanceOverrides(instance(root), state().nodes).added,
    1,
  );
  state().resetPrefabInstance(instance(root).id);
  assert.equal(mesh(local).parentId, root);
});
test("duplicate and clipboard preserve full-instance associations; partial subtree copies are ordinary nodes", () => {
  const { group, child, prefab } = fixture();
  state().duplicateNode(group);
  const root = state().selectedNodeId;
  assert.ok(instance(root));
  assert.notEqual(instance(root).id, instance(group).id);
  assert.equal(instance(root).prefabId, prefab);
  state().selectNode(group);
  state().copyToClipboard();
  state().removeNode(group);
  state().pasteFromClipboard();
  const pasteRoot = state().nodes.find((n) => n.id === state().selectedNodeId);
  assert.ok(pasteRoot.prefab);
  assert.ok(instance(pasteRoot.id));
  const inside = state().nodes.find((n) => n.parentId === root);
  state().duplicateNode(inside.id);
  assert.equal(mesh(state().selectedNodeId).prefab, undefined);
  validate({ ...state(), scene: { nodes: state().nodes } });
});
test("rename/delete scripts updates templates, instance baselines and copied bindings", () => {
  const { group, child, prefab } = fixture();
  state().createScript("enemy.js");
  state().attachScript(child, "enemy.js");
  state().updatePrefabFromInstance(instance(group).id);
  state().selectNode(group);
  state().copyToClipboard();
  state().renameScript("enemy.js", "monster.js");
  assert.ok(
    state().content.prefabs[prefab].nodes.some((n) =>
      n.scripts?.includes("monster.js"),
    ),
  );
  state().pasteFromClipboard();
  assert.ok(
    state().nodes.some(
      (n) => n.name === "Body_copy" && n.scripts.includes("monster.js"),
    ),
  );
  state().deleteScript("monster.js");
  for (const p of Object.values(state().content.prefabs))
    assert.ok(p.nodes.every((n) => !n.scripts?.includes("monster.js")));
  validate({ ...state(), scene: { nodes: state().nodes } });
  state().undo();
  assert.ok(state().scripts["monster.js"] !== undefined);
});
test("binary model replacements propagate through templates while retaining a local replacement override", () => {
  state().newProject();
  const model = state().addNode("model", "Model");
  state().setModelBuffer(model, new Uint8Array([1]).buffer);
  const prefab = state().createPrefab(model),
    a = state().instantiatePrefab(prefab),
    b = state().instantiatePrefab(prefab);
  state().relinkModel(a, new Uint8Array([9]).buffer);
  state().relinkModel(model, new Uint8Array([2]).buffer);
  state().updatePrefabFromInstance(instance(model).id);
  assert.equal(new Uint8Array(state().modelBuffers.get(a))[0], 9);
  assert.equal(new Uint8Array(state().modelBuffers.get(b))[0], 2);
  state().resetPrefabInstance(instance(a).id);
  assert.equal(new Uint8Array(state().modelBuffers.get(a))[0], 2);
});
test("unpack retains the subtree and resources, template deletion is guarded, and undo restores links", () => {
  const { group, prefab, root } = fixture();
  assert.throws(() => state().deletePrefab(prefab), /实例/);
  state().unpackPrefabInstance(instance(root).id);
  assert.equal(mesh(root).prefab, undefined);
  state().undo();
  assert.ok(mesh(root).prefab);
  state().unpackPrefabInstance(instance(root).id);
  state().unpackPrefabInstance(instance(group).id);
  state().deletePrefab(prefab);
  assert.equal(state().content.prefabs[prefab], undefined);
  assert.ok(mesh(group));
  state().undo();
  assert.ok(state().content.prefabs[prefab]);
});
test("project ZIP, IndexedDB and recovery preserve template-only models, textures and instance overrides", async () => {
  state().newProject();
  const tex = texture(),
    mat = state().createMaterial("Textured");
  state().updateMaterial(mat, { albedoTextureId: tex });
  const model = state().addNode("model", "Portable");
  state().setModelBuffer(model, new Uint8Array([4, 5]).buffer);
  state().setNodeMaterial(model, mat);
  const prefab = state().createPrefab(model);
  state().removeNode(model);
  const zip = archive.createProjectArchive();
  state().newProject();
  await archive.importProject(new File([zip], "portable.arkglide"));
  assert.ok(state().content.prefabs[prefab]);
  assert.deepEqual(
    [...new Uint8Array(state().textureBuffers.get(tex))],
    [1, 2, 3],
  );
  const root = state().instantiatePrefab(prefab);
  state().updateTransform(root, { visible: false });
  await state().saveCurrentProject("Portable");
  const saved = state().currentProjectId;
  state().newProject();
  await state().loadProjectById(saved);
  assert.equal(mesh(root).visible, false);
  assert.equal(instance(root).prefabId, prefab);
  assert.equal(new Uint8Array(state().modelBuffers.get(root))[0], 4);
  const controller = recovery.startProjectRecovery({
    delay: 100000,
    maxWait: 100000,
  });
  try {
    state().updateMaterial(mat, { alpha: 0.5 });
    texture(tex, 8);
    await controller.flush();
    const id = state().documentId;
    state().newProject();
    await recovery.restoreRecovery(id);
    assert.equal(state().content.materials[mat].alpha, 0.5);
    assert.equal(new Uint8Array(state().textureBuffers.get(tex))[0], 8);
  } finally {
    controller.dispose();
  }
});
test("invalid resource parameters and damaged references fail atomically before replacing the document", async () => {
  state().newProject();
  const mat = state().createMaterial();
  const before = state().content;
  assert.throws(() => state().updateMaterial(mat, { roughness: NaN }), /材质/);
  assert.equal(state().content, before);
  const valid = JSON.parse(
    strFromU8(unzipSync(archive.createProjectArchive())["project.json"]),
  );
  valid.scene.nodes[0].materialId = "missing";
  const zip = zipSync({ "project.json": strToU8(JSON.stringify(valid)) });
  await assert.rejects(
    archive.importProject(new File([zip], "bad.arkglide")),
    /材质/,
  );
  assert.equal(state().content, before);
  const { group, child } = fixture();
  assert.throws(() => state().setParent(child, null), /解除/);
  assert.equal(mesh(child).parentId, group);
  state().play();
  assert.throws(() => state().createMaterial(), /停止/);
  assert.throws(
    () => state().instantiatePrefab(Object.keys(state().content.prefabs)[0]),
    /停止/,
  );
  state().stop();
});
test("missing texture binaries retain the editable metadata and can be relinked by the same ID", async () => {
  state().newProject();
  const tex = texture(),
    mat = state().createMaterial();
  state().updateMaterial(mat, { albedoTextureId: tex });
  const files = unzipSync(archive.createProjectArchive());
  for (const path of Object.keys(files))
    if (path.startsWith("textures/")) delete files[path];
  await archive.importProject(new File([zipSync(files)], "missing.arkglide"));
  assert.ok(state().content.textures.some((t) => t.id === tex));
  assert.equal(state().textureBuffers.get(tex), undefined);
  texture(tex, 7);
  assert.equal(state().content.materials[mat].albedoTextureId, tex);
});

test("clipboard can restore deleted templates, materials and texture bytes without overwriting still-existing resources", () => {
  state().newProject();
  const tex = texture(),
    mat = state().createMaterial("Clipboard");
  state().updateMaterial(mat, { albedoTextureId: tex });
  state().setNodeMaterial("cube", mat);
  const prefab = state().createPrefab("cube");
  state().selectNode("cube");
  state().copyToClipboard();
  state().removeNode("cube");
  state().deletePrefab(prefab);
  state().deleteMaterial(mat);
  state().deleteTexture(tex);
  state().pasteFromClipboard();
  const root = state().selectedNodeId;
  assert.ok(mesh(root).prefab);
  assert.equal(mesh(root).materialId, mat);
  assert.ok(state().content.prefabs[prefab]);
  assert.equal(new Uint8Array(state().textureBuffers.get(tex))[0], 1);
  validate({ ...state(), scene: { nodes: state().nodes } });
  state().updateMaterial(mat, { baseColor: "#FF0000" });
  state().pasteFromClipboard();
  assert.equal(state().content.materials[mat].baseColor, "#FF0000");
});
test("moving linked roots into other instances is rejected without changing the hierarchy", () => {
  const { group, root } = fixture();
  assert.throws(() => state().setParent(root, group), /嵌套/);
  assert.ok(!mesh(root).parentId);
});

test("undo/redo of script renames and deletion keeps clipboard template bindings valid, including a later copy", () => {
  state().newProject();
  state().createScript("enemy.js");
  state().attachScript("cube", "enemy.js");
  state().createPrefab("cube");
  state().selectNode("cube");
  state().copyToClipboard();
  state().renameScript("enemy.js", "hero.js");
  state().undo();
  assert.ok(state().clipboard[0].scripts.includes("enemy.js"));
  state().redo();
  assert.ok(state().clipboard[0].scripts.includes("hero.js"));
  state().undo();
  state().pasteFromClipboard();
  validate({ ...state(), scene: { nodes: state().nodes } });
  state().deleteScript("enemy.js");
  state().undo();
  state().pasteFromClipboard();
  assert.ok(mesh(state().selectedNodeId).scripts.includes("enemy.js"));
  state().renameScript("enemy.js", "hero.js");
  state().selectNode("cube");
  state().copyToClipboard();
  state().undo();
  state().pasteFromClipboard();
  assert.ok(mesh(state().selectedNodeId).scripts.includes("enemy.js"));
  validate({ ...state(), scene: { nodes: state().nodes } });
});
