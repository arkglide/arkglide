import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { indexedDB } from "fake-indexeddb";
import fs from "node:fs";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
let server, store, archive, recovery, normalize;
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
  ({ normalizeProject: normalize } = await server.ssrLoadModule(
    "/src/utils/projectValidation.ts",
  ));
});
after(async () => server?.close());
const s = () => store.getState(),
  node = (id) => s().nodes.find((n) => n.id === id);
async function fixture() {
  await archive.importProject(
    new File(
      [
        fs.readFileSync(
          new URL("../examples/third-full.arkglide", import.meta.url),
        ),
      ],
      "third-full.arkglide",
    ),
  );
}
const files = () => unzipSync(archive.createProjectArchive()),
  project = () => JSON.parse(strFromU8(files()["project.json"]));
test("advanced components remap references through templates, nested instances, duplicate, copy and undo", async () => {
  await fixture();
  const group = s().addNode("empty", "Actors");
  s().setParent("Player", group);
  s().setParent("Mirror", group);
  const prefab = s().createPrefab(group, "Actors");
  const root = s().instantiatePrefab(prefab),
    inst = Object.values(s().content.prefabInstances).find(
      (i) => i.rootId === root,
    ),
    p = s().content.prefabs[prefab],
    source = p.nodes.find((n) => n.name === "Player"),
    target = p.nodes.find((n) => n.name === "Mirror");
  assert.equal(target.animation.retarget.sourceId, source.id);
  assert.equal(
    node(inst.nodeMap[target.id]).animation.retarget.sourceId,
    inst.nodeMap[source.id],
  );
  const compound = s().addNode("empty", "Compound");
  s().setParent(root, compound);
  const parent = s().createPrefab(compound, "Compound"),
    cloned = s().instantiatePrefab(parent);
  assert.ok(
    Object.values(s().content.prefabInstances).some(
      (i) => i.parentInstanceId && i.rootId !== root,
    ),
  );
  const player = node(inst.nodeMap[source.id]);
  s().updateTransform(player.id, {
    character: { ...player.character, speed: 5 },
  });
  assert.equal(node(player.id).character.speed, 5);
  s().undo();
  assert.equal(node(player.id).character.speed, 2);
  s().redo();
  assert.equal(node(player.id).character.speed, 5);
  s().selectNode(cloned);
  s().copyToClipboard();
  s().pasteFromClipboard();
  const copied = s().selectedNodeId;
  assert.notEqual(copied, cloned);
  const children = s().nodes.filter((n) => n.animation?.retarget);
  for (const n of children)
    assert.equal(
      node(n.animation.retarget.sourceId).name.startsWith("Player"),
      true,
    );
  assert.throws(
    () => s().updateAdvancedContent({ animationControllers: {} }),
    /控制器/,
  );
  assert.throws(
    () => s().updateAdvancedContent({ retargetProfiles: {} }),
    /映射/,
  );
  s().duplicateNode(cloned);
  for (const n of s().nodes.filter((n) => n.animation?.retarget))
    assert.ok(node(n.animation.retarget.sourceId));
});
test("ZIP, IndexedDB and recovery preserve mixer/controllers/layout/default input/binary resources atomically", async () => {
  await fixture();
  const expected = structuredClone(s().content),
    zip = archive.createProjectArchive();
  s().newProject();
  await archive.importProject(new File([zip], "third-roundtrip.arkglide"));
  assert.deepEqual(s().content, expected);
  assert.ok(s().audioBuffers.get("music").byteLength > 500000);
  assert.ok(s().textureBuffers.get("icon").byteLength > 0);
  await s().saveCurrentProject("Third persistence");
  const id = s().currentProjectId;
  s().newProject();
  await s().loadProjectById(id);
  assert.deepEqual(s().content, expected);
  const controller = recovery.startProjectRecovery({
    delay: 100000,
    maxWait: 100000,
  });
  try {
    s().updateAdvancedContent({
      mixer: { ...s().content.mixer, maxVoices: 7 },
    });
    await controller.flush();
    const documentId = s().documentId;
    s().newProject();
    await recovery.restoreRecovery(documentId);
    assert.equal(s().content.mixer.maxVoices, 7);
    assert.deepEqual(
      s().content.animationControllers,
      expected.animationControllers,
    );
    assert.deepEqual(s().content.gameplay, expected.gameplay);
  } finally {
    controller.dispose();
  }
  const before = structuredClone(s().content),
    bad = files(),
    data = project();
  data.content.gameplay.hud.find((h) => h.kind === "image").textureId =
    "missing";
  bad["project.json"] = strToU8(JSON.stringify(data));
  await assert.rejects(
    () => archive.importProject(new File([zipSync(bad)], "invalid.arkglide")),
    /资源/,
  );
  assert.deepEqual(s().content, before);
  assert.throws(() => s().deleteTexture("icon"), /UI.*引用/);
});
test("0.5 migration adds advanced defaults and rejects malformed/cyclic references including instance baselines", async () => {
  const old = JSON.parse(
      fs.readFileSync(
        new URL("../examples/collect-gems.json", import.meta.url),
        "utf8",
      ),
    ),
    upgraded = normalize(old);
  assert.equal(upgraded.version, "0.6");
  assert.equal(upgraded.content.physics.groups[0].name, "Default");
  assert.ok(upgraded.content.mixer.buses.some((b) => b.id === "UI"));
  assert.deepEqual(
    upgraded.content.gameplay.defaults,
    old.content.gameplay.actions,
  );
  await fixture();
  const base = project();
  for (const corrupt of [
    (p) => (p.content.physics.groups[0].mask = 9999),
    (p) =>
      (p.content.mixer.buses.find((b) => b.id === "Music").parentId = "Music"),
    (p) => (p.content.gameplay.hud[0].parentId = p.content.gameplay.hud[0].id),
    (p) =>
      (p.scene.nodes.find((n) => n.id === "Door").joints[0].targetId =
        "missing"),
    (p) =>
      (p.scene.nodes.find(
        (n) => n.id === "Mirror",
      ).animation.retarget.sourceId = "missing"),
    (p) =>
      p.content.animationControllers.locomotion.states[0].blend.children.push({
        ...p.content.animationControllers.locomotion.states[0].blend
          .children[0],
      }),
  ]) {
    const copy = structuredClone(base);
    corrupt(copy);
    assert.throws(() => normalize(copy));
  }
  const copy = structuredClone(base),
    instance = Object.values(copy.content.prefabInstances).find((i) =>
      i.baseline.some((n) => n.physics),
    );
  instance.baseline.find((n) => n.physics).physics.group = "missing";
  assert.throws(() => normalize(copy), /碰撞组/);
});

test("clipboard restores deleted advanced resources and remaps entity references without changing remaining masks", async () => {
  await fixture();
  const actors = s().addNode("empty", "Actors");
  s().setParent("Player", actors);
  s().setParent("Mirror", actors);
  s().selectNode(actors);
  s().copyToClipboard();
  s().removeNode(actors);
  s().updateAdvancedContent({ animationControllers: {}, retargetProfiles: {} });
  s().pasteFromClipboard();
  assert.ok(s().content.animationControllers.locomotion);
  assert.ok(s().content.retargetProfiles.mirror);
  const target = s().nodes.find((n) => n.animation?.retarget);
  assert.ok(node(target.animation.retarget.sourceId));
  s().undo();
  assert.deepEqual(s().content.animationControllers, {});
  s().redo();
  assert.ok(s().content.animationControllers.locomotion);
  const mixer = s().content.mixer;
  s().updateAdvancedContent({
    mixer: {
      ...mixer,
      buses: [
        ...mixer.buses,
        {
          id: "Custom",
          name: "Custom",
          parentId: "SFX",
          volume: 0.5,
          mute: false,
        },
      ],
    },
  });
  s().updateTransform("Trigger", {
    audioSource: {
      assetId: "tone",
      bus: "Custom",
      autoplay: false,
      loop: false,
      volume: 1,
      spatial: false,
      refDistance: 1,
    },
  });
  s().selectNode("Trigger");
  s().copyToClipboard();
  s().removeNode("Trigger");
  s().updateAdvancedContent({
    physics: { groups: [{ name: "Default", mask: 1 }], debug: false },
    mixer: {
      ...s().content.mixer,
      buses: s().content.mixer.buses.filter((b) => b.id !== "Custom"),
    },
  });
  s().pasteFromClipboard();
  assert.ok(s().content.physics.groups.some((g) => g.name === "Trigger"));
  assert.ok(s().content.mixer.buses.some((b) => b.id === "Custom"));
  assert.ok(s().content.physics.groups[0].mask & 2);
  assert.equal(node(s().selectedNodeId).physics.group, "Trigger");
});
