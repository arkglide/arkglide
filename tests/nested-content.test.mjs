import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { indexedDB } from "fake-indexeddb";
import { unzipSync, strFromU8, zipSync, strToU8 } from "fflate";
let server, store, validate, archive;
before(async () => {
  globalThis.indexedDB = indexedDB;
  server = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ useEditorStore: store } = await server.ssrLoadModule(
    "/src/store/useEditorStore.ts",
  ));
  ({ validateProject: validate } = await server.ssrLoadModule(
    "/src/utils/projectValidation.ts",
  ));
  archive = await server.ssrLoadModule("/src/utils/projectExport.ts");
});
after(async () => {
  await server?.close();
});
const s = () => store.getState(),
  node = (id) => s().nodes.find((n) => n.id === id),
  inst = (root) =>
    Object.values(s().content.prefabInstances).find((i) => i.rootId === root);
const check = () => validate({ ...s(), scene: { nodes: s().nodes } });
function fixture() {
  s().newProject();
  const innerRoot = s().addNode("empty", "Weapon"),
    part = s().addNode("mesh", "Barrel");
  s().setParent(part, innerRoot);
  const inner = s().createPrefab(innerRoot);
  const outerRoot = s().addNode("empty", "Soldier");
  s().setParent(innerRoot, outerRoot);
  const outer = s().createPrefab(outerRoot),
    other = s().instantiatePrefab(outer);
  const otherInner = s().nodes.find(
    (n) => n.name === "Weapon" && n.parentId === other,
  ).id;
  const otherPart = s().nodes.find(
    (n) => n.name === "Barrel" && n.parentId === otherInner,
  ).id;
  return {
    innerRoot,
    part,
    inner,
    outerRoot,
    outer,
    other,
    otherInner,
    otherPart,
  };
}
test("nested templates create independent parent/child associations; updates retain local axes", () => {
  const f = fixture();
  check();
  assert.equal(inst(f.otherInner).parentInstanceId, inst(f.other).id);
  s().updateTransform(f.otherPart, { scale: { x: 5, y: 1, z: 1 } });
  s().updateTransform(f.part, { scale: { x: 2, y: 3, z: 4 } });
  s().updatePrefabFromInstance(inst(f.innerRoot).id);
  check();
  assert.deepEqual(node(f.otherPart).scale, { x: 5, y: 3, z: 4 });
  assert.equal(s().content.prefabs[f.outer].revision, 2);
  const fresh = s().instantiatePrefab(f.outer);
  const child = s().nodes.find(
    (n) =>
      n.name === "Barrel" &&
      n.id !== f.part &&
      n.id !== f.otherPart &&
      s().nodes.find((p) => p.id === n.parentId)?.parentId === fresh,
  );
  assert.deepEqual(child.scale, { x: 2, y: 3, z: 4 });
});
test("nested child additions and removals propagate through enclosing templates without duplicated source nodes", () => {
  const f = fixture(),
    added = s().addNode("mesh", "Sight");
  s().setParent(added, f.innerRoot);
  s().updatePrefabFromInstance(inst(f.innerRoot).id);
  check();
  assert.equal(
    s().nodes.filter((n) => n.name === "Sight" && n.parentId === f.innerRoot)
      .length,
    1,
  );
  assert.equal(
    s().nodes.filter((n) => n.name === "Sight" && n.parentId === f.otherInner)
      .length,
    1,
  );
  s().removeNode(f.part);
  s().updatePrefabFromInstance(inst(f.innerRoot).id);
  check();
  assert.ok(!node(f.otherPart));
});
test("nested child local deletion, resets, unpacking and undo retain valid associations", () => {
  const f = fixture();
  s().removeNode(f.otherPart);
  s().updateTransform(f.part, { color: "#FF0000" });
  s().updatePrefabFromInstance(inst(f.innerRoot).id);
  check();
  assert.ok(!node(f.otherPart));
  s().resetPrefabInstance(inst(f.otherInner).id);
  check();
  assert.ok(node(f.otherPart));
  const child = inst(f.otherInner);
  s().unpackPrefabInstance(child.id);
  check();
  assert.ok(!s().content.prefabInstances[child.id]);
  assert.equal(node(f.otherInner).prefab.instanceId, inst(f.other).id);
  s().undo();
  check();
  assert.ok(s().content.prefabInstances[child.id]);
});
test("multi-level nesting propagates updates and prevents cyclic dependencies atomically", () => {
  const f = fixture(),
    grand = s().addNode("empty", "Team");
  s().setParent(f.outerRoot, grand);
  const grandPrefab = s().createPrefab(grand),
    other = s().instantiatePrefab(grandPrefab);
  s().updateTransform(f.part, { color: "#FF0000" });
  s().updatePrefabFromInstance(inst(f.innerRoot).id);
  check();
  const innerCount = Object.values(s().content.prefabInstances).filter(
    (i) => i.prefabId === f.inner,
  ).length;
  assert.equal(innerCount, 3);
  assert.equal(s().content.prefabs[grandPrefab].revision, 2);
  const before = s().nodes;
  assert.throws(() => s().setParent(other, f.innerRoot), /循环/);
  assert.equal(s().nodes, before);
});
test("full nested copies retain associations; copying a child produces a standalone child instance", () => {
  const f = fixture();
  s().duplicateNode(f.outerRoot);
  check();
  const outerCopy = s().selectedNodeId,
    innerCopy = s().nodes.find(
      (n) => n.name.startsWith("Weapon") && n.parentId === outerCopy,
    ).id;
  assert.equal(inst(innerCopy).parentInstanceId, inst(outerCopy).id);
  s().duplicateNode(f.innerRoot);
  check();
  assert.ok(inst(s().selectedNodeId));
});
test("nested templates and per-part materials roundtrip ZIP; missing child templates and cycles reject atomically", async () => {
  const f = fixture();
  const model = s().addNode("model", "Model");
  s().setParent(model, f.innerRoot);
  s().setModelBuffer(model, new Uint8Array([1, 2]).buffer);
  const mat = s().createMaterial("Metal");
  s().setModelSlotMaterial(model, "mesh:1/slot:0", mat);
  s().updatePrefabFromInstance(inst(f.innerRoot).id);
  check();
  const zip = archive.createProjectArchive();
  s().newProject();
  await archive.importProject(new File([zip], "nested.arkglide"));
  check();
  assert.equal(node(model).materialSlots["mesh:1/slot:0"], mat);
  assert.throws(() => s().deleteMaterial(mat), /引用/);
  assert.throws(() => s().deletePrefab(f.inner), /实例|嵌套/);
  const files = unzipSync(zip),
    project = JSON.parse(strFromU8(files["project.json"]));
  delete project.content.prefabs[f.inner];
  files["project.json"] = strToU8(JSON.stringify(project));
  const before = s().documentId;
  await assert.rejects(
    archive.importProject(new File([zipSync(files)], "bad.arkglide")),
    /预制体/,
  );
  assert.equal(s().documentId, before);
});

test("enclosing template edits retain nested associations, configured child overrides and child template independence", () => {
  const f = fixture();
  s().updateTransform(f.part, { color: "#123456" });
  s().updateTransform(f.innerRoot, { transform: { x: 3, y: 4, z: 5 } });
  s().updatePrefabFromInstance(inst(f.outerRoot).id);
  check();
  assert.equal(node(f.otherPart).color, "#123456");
  assert.deepEqual(node(f.otherInner).transform, { x: 3, y: 4, z: 5 });
  assert.notEqual(
    s().content.prefabs[f.inner].nodes.find((n) => n.name === "Barrel").color,
    "#123456",
  );
  const solo = s().instantiatePrefab(f.inner);
  assert.notEqual(s().nodes.find((n) => n.parentId === solo).color, "#123456");
  s().updateTransform(f.part, { scale: { x: 2, y: 3, z: 4 } });
  s().updatePrefabFromInstance(inst(f.innerRoot).id);
  check();
  assert.equal(node(f.otherPart).color, "#123456");
  assert.equal(node(f.otherPart).scale.y, 3);
});
test("resetting an enclosing instance restores nested mounts; unpacking an outer instance retains linked children", () => {
  const f = fixture();
  s().unpackPrefabInstance(inst(f.otherInner).id);
  check();
  s().resetPrefabInstance(inst(f.other).id);
  check();
  assert.ok(inst(f.otherInner));
  const child = inst(f.innerRoot);
  s().unpackPrefabInstance(inst(f.outerRoot).id);
  check();
  assert.ok(!node(f.outerRoot).prefab);
  assert.equal(inst(f.innerRoot).id, child.id);
  assert.equal(inst(f.innerRoot).parentInstanceId, undefined);
  s().undo();
  check();
  assert.equal(inst(f.innerRoot).parentInstanceId, inst(f.outerRoot).id);
});
test("parent template can remove a nested association; template-only dependency deletion remains guarded", () => {
  const f = fixture();
  s().unpackPrefabInstance(inst(f.innerRoot).id);
  s().updatePrefabFromInstance(inst(f.outerRoot).id);
  check();
  assert.equal(
    Object.keys(s().content.prefabs[f.outer].nestedInstances).length,
    0,
  );
  assert.ok(!inst(f.otherInner));
  assert.equal(node(f.otherInner).prefab.instanceId, inst(f.other).id);
  s().deletePrefab(f.inner);
  check();
  const g = fixture();
  s().removeNode(g.outerRoot);
  s().removeNode(g.other);
  check();
  assert.throws(() => s().deletePrefab(g.inner), /嵌套/);
  s().deletePrefab(g.outer);
  s().deletePrefab(g.inner);
  check();
});
test("clipboard restores deleted nested dependencies, slot materials and texture buffers", () => {
  const f = fixture(),
    model = s().addNode("model", "NestedModel");
  s().setParent(model, f.innerRoot);
  s().setModelBuffer(model, new Uint8Array([9]).buffer);
  const mat = s().createMaterial("Slot"),
    tex = "texture";
  s().importTexture(
    { id: tex, name: "x.png", mime: "image/png", byteLength: 2 },
    new Uint8Array([1, 2]).buffer,
  );
  s().updateMaterial(mat, { albedoTextureId: tex });
  s().setModelSlotMaterial(model, "mesh:0/slot:0", mat);
  s().updatePrefabFromInstance(inst(f.innerRoot).id);
  s().selectNode(f.outerRoot);
  s().copyToClipboard();
  s().removeNode(f.outerRoot);
  s().removeNode(f.other);
  s().deletePrefab(f.outer);
  s().deletePrefab(f.inner);
  s().deleteMaterial(mat);
  s().deleteTexture(tex);
  s().pasteFromClipboard();
  check();
  assert.ok(s().content.prefabs[f.inner]);
  assert.ok(s().content.prefabs[f.outer]);
  assert.ok(s().content.materials[mat]);
  assert.equal(new Uint8Array(s().textureBuffers.get(tex))[1], 2);
  const copied = s().nodes.find((n) => n.name === "NestedModel_copy");
  assert.equal(copied.materialSlots["mesh:0/slot:0"], mat);
  assert.equal(new Uint8Array(s().modelBuffers.get(copied.id))[0], 9);
});
test("script rename/delete and their undo preserve nested baseline bindings and later generated templates", () => {
  const f = fixture();
  s().createScript("weapon.js");
  s().attachScript(f.part, "weapon.js");
  s().updatePrefabFromInstance(inst(f.innerRoot).id);
  s().renameScript("weapon.js", "gun.js");
  check();
  assert.ok(
    Object.values(
      s().content.prefabs[f.outer].nestedInstances,
    )[0].baseline.some((n) => n.scripts?.includes("gun.js")),
  );
  s().deleteScript("gun.js");
  check();
  s().undo();
  check();
  s().undo();
  check();
  s().instantiatePrefab(f.outer);
  check();
});
test("nested snapshots and slot assignments persist in atomic IndexedDB and recovery records", async () => {
  const f = fixture(),
    model = s().addNode("model", "SavedModel");
  s().setParent(model, f.innerRoot);
  s().setModelBuffer(model, new Uint8Array([3, 4]).buffer);
  const mat = s().createMaterial();
  s().setModelSlotMaterial(model, "mesh:0/slot:0", mat);
  s().updatePrefabFromInstance(inst(f.innerRoot).id);
  await s().saveCurrentProject("Nested");
  const projectId = s().currentProjectId;
  s().newProject();
  await s().loadProjectById(projectId);
  check();
  assert.equal(node(model).materialSlots["mesh:0/slot:0"], mat);
  assert.equal(inst(f.innerRoot).parentInstanceId, inst(f.outerRoot).id);
  const recovery = await server.ssrLoadModule("/src/utils/projectRecovery.ts");
  const controller = recovery.startProjectRecovery({
    delay: 100000,
    maxWait: 100000,
  });
  try {
    s().updateTransform(f.otherPart, { color: "#AABBCC" });
    await controller.flush();
    const id = s().documentId;
    s().newProject();
    await recovery.restoreRecovery(id);
    check();
    assert.equal(node(f.otherPart).color, "#AABBCC");
    assert.equal(new Uint8Array(s().modelBuffers.get(model))[0], 3);
  } finally {
    controller.dispose();
  }
});

test("applying a scene-only nested child first to the outer template and then the inner template never duplicates it", () => {
  const f = fixture(),
    added = s().addNode("mesh", "ScopedAddition");
  s().setParent(added, f.innerRoot);
  s().updatePrefabFromInstance(inst(f.outerRoot).id);
  check();
  assert.equal(
    s().nodes.filter(
      (n) => n.name === "ScopedAddition" && n.parentId === f.otherInner,
    ).length,
    1,
  );
  s().updatePrefabFromInstance(inst(f.innerRoot).id);
  check();
  assert.equal(
    s().nodes.filter(
      (n) => n.name === "ScopedAddition" && n.parentId === f.innerRoot,
    ).length,
    1,
  );
  assert.equal(
    s().nodes.filter(
      (n) => n.name === "ScopedAddition" && n.parentId === f.otherInner,
    ).length,
    1,
  );
  assert.equal(
    s().content.prefabs[f.outer].nodes.filter(
      (n) => n.name === "ScopedAddition",
    ).length,
    1,
  );
});
