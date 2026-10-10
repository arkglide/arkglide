import test from "node:test";
import assert from "node:assert/strict";
import * as B from "@babylonjs/core";
import "../public/arkglide-scene.js";
import "../public/arkglide-api.js";
const node = (id, type = "mesh", extra = {}) => ({
  id,
  name: "Cube",
  type,
  transform: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  visible: true,
  ...extra,
});
function setup(options = {}) {
  const engine = new B.NullEngine(),
    scene = new B.Scene(engine);
  const adapter = globalThis.ArkGlideScene.createSceneAdapter(
    B,
    scene,
    options,
  );
  return {
    engine,
    scene,
    adapter,
    dispose() {
      adapter.dispose();
      engine.dispose();
    },
  };
}
test("scene construction preserves primitive shape, unordered hierarchy and zero light intensity", async () => {
  const t = setup();
  try {
    await t.adapter.sync([
      node("child", "mesh", {
        primitive: "box",
        parentId: "group",
        transform: { x: 2, y: 0, z: 0 },
      }),
      node("group", "empty", { transform: { x: 10, y: 0, z: 0 } }),
      node("sun", "light", { intensity: 0, lightType: "point" }),
      node("view", "camera", { fov: 90, activeCamera: true }),
    ]);
    const child = t.adapter.nodes.get("child");
    child.computeWorldMatrix(true);
    assert.equal(child.getTotalVertices(), 24);
    assert.equal(child.getAbsolutePosition().x, 12);
    assert.equal(t.adapter.resources.get("sun").intensity, 0);
    assert.ok(Math.abs(t.adapter.activeCamera().fov - Math.PI / 2) < 1e-8);
    await t.adapter.sync([
      node("child", "mesh", { primitive: "box", name: "Sphere renamed" }),
    ]);
    assert.equal(t.adapter.nodes.get("child").getTotalVertices(), 24);
    assert.equal(t.scene.lights.length, 0);
    assert.equal(t.scene.cameras.length, 0);
  } finally {
    t.dispose();
  }
});
test("all node types can have entity handles and parent destruction removes descendant handles", async () => {
  const engine = new B.NullEngine(),
    scene = new B.Scene(engine),
    api = globalThis.ArkGlideRuntime.createEntityAPI(B, () => scene);
  const adapter = globalThis.ArkGlideScene.createSceneAdapter(B, scene, {
    onCreate: (object, n) => api.register(object, n.id, n.name),
    onRemove: (id) => api.sceneAPI.destroy(id),
  });
  try {
    await adapter.sync([
      node("group", "empty"),
      node("child", "light", { parentId: "group" }),
      node("camera", "camera"),
    ]);
    assert.equal(api.entities.size, 3);
    assert.equal(api.sceneAPI.find("group").visible, true);
    api.sceneAPI.find("group").destroy();
    assert.equal(api.entities.size, 1);
    assert.equal(api.sceneAPI.find("child"), null);
  } finally {
    adapter.dispose();
    engine.dispose();
  }
});
test("late model containers are disposed after stop or replacement and URLs are revoked", async () => {
  const engine = new B.NullEngine(),
    scene = new B.Scene(engine),
    resolvers = [];
  const fake = {
    ...B,
    SceneLoader: {
      LoadAssetContainerAsync: () =>
        new Promise((resolve) => resolvers.push(resolve)),
    },
  };
  const adapter = globalThis.ArkGlideScene.createSceneAdapter(fake, scene);
  let disposed = 0,
    added = 0;
  const container = () => ({
    meshes: [],
    transformNodes: [],
    addAllToScene() {
      added++;
    },
    dispose() {
      disposed++;
    },
  });
  try {
    const first = adapter.sync(
      [node("model", "model")],
      new Map([["model", new ArrayBuffer(4)]]),
    );
    adapter.clear();
    resolvers.shift()(container());
    await first;
    assert.equal(added, 0);
    assert.equal(disposed, 1);
    assert.equal(adapter.nodes.size, 0);
    const old = adapter.sync(
      [node("model", "model")],
      new Map([["model", new ArrayBuffer(4)]]),
    );
    const newer = adapter.sync(
      [node("model", "model")],
      new Map([["model", new ArrayBuffer(8)]]),
    );
    resolvers.shift()(container());
    await old;
    assert.equal(added, 0);
    resolvers.shift()(container());
    await newer;
    assert.equal(added, 1);
    assert.equal(disposed, 2);
  } finally {
    adapter.dispose();
    engine.dispose();
  }
});

test("PBR material parameters are shared, updated live and restored to node colors on unassignment", async () => {
  const t = setup(),
    definition = {
      id: "m",
      name: "PBR",
      baseColor: "#123456",
      emissiveColor: "#001100",
      metallic: 0.7,
      roughness: 0.2,
      alpha: 0.6,
      doubleSided: true,
      uvScale: { u: 2, v: 3 },
    },
    content = { materials: { m: definition }, textures: [] };
  try {
    const defs = [
      node("a", "mesh", { color: "#FF0000" }),
      node("b", "mesh", { color: "#00FF00" }),
    ];
    await t.adapter.sync(defs);
    await t.adapter.sync(
      defs.map((n) => ({ ...n, materialId: "m" })),
      new Map(),
      content,
    );
    const a = t.adapter.nodes.get("a"),
      b = t.adapter.nodes.get("b");
    assert.equal(a.material, b.material);
    assert.equal(a.material.metallic, 0.7);
    assert.equal(a.material.alpha, 0.6);
    assert.equal(a.material.backFaceCulling, false);
    content.materials.m = { ...definition, roughness: 0.9 };
    await t.adapter.sync(
      defs.map((n) => ({ ...n, materialId: "m" })),
      new Map(),
      content,
    );
    assert.equal(a.material.roughness, 0.9);
    await t.adapter.sync(defs, new Map(), content);
    assert.equal(a.material.diffuseColor.toHexString(), "#FF0000");
    assert.equal(b.material.diffuseColor.toHexString(), "#00FF00");
    t.adapter.clear();
    assert.equal(t.scene.materials.length, 0);
  } finally {
    t.dispose();
  }
});
test("removing a mesh using a shared PBR material cannot dispose the surviving mesh material", async () => {
  const t = setup(),
    m = {
      id: "m",
      name: "Shared",
      baseColor: "#FFFFFF",
      emissiveColor: "#000000",
      metallic: 0,
      roughness: 1,
      alpha: 1,
      doubleSided: false,
      uvScale: { u: 1, v: 1 },
    },
    content = { materials: { m }, textures: [] };
  try {
    await t.adapter.sync(
      [
        node("a", "mesh", { materialId: "m" }),
        node("b", "mesh", { materialId: "m" }),
      ],
      new Map(),
      content,
    );
    const shared = t.adapter.nodes.get("b").material;
    await t.adapter.sync(
      [node("b", "mesh", { materialId: "m" })],
      new Map(),
      content,
    );
    assert.equal(t.adapter.nodes.get("b").material, shared);
    assert.ok(t.scene.materials.includes(shared));
    t.adapter.clear();
    assert.equal(t.scene.materials.length, 0);
  } finally {
    t.dispose();
  }
});
test("model material override applies after async loading and restores original imported materials", async () => {
  const engine = new B.NullEngine(),
    scene = new B.Scene(engine);
  let resolve;
  const fake = {
      ...B,
      SceneLoader: {
        LoadAssetContainerAsync: () => new Promise((r) => (resolve = r)),
      },
    },
    adapter = globalThis.ArkGlideScene.createSceneAdapter(fake, scene);
  const m = {
      id: "m",
      name: "Override",
      baseColor: "#FFFFFF",
      emissiveColor: "#000000",
      metallic: 0,
      roughness: 1,
      alpha: 1,
      doubleSided: false,
      uvScale: { u: 1, v: 1 },
    },
    content = { materials: { m }, textures: [] },
    buffer = new ArrayBuffer(3);
  try {
    const load = adapter.sync(
        [node("model", "model", { materialId: "m" })],
        new Map([["model", buffer]]),
        content,
      ),
      mesh = B.MeshBuilder.CreateBox("part", {}, scene),
      original = new B.StandardMaterial("original", scene);
    mesh.material = original;
    resolve({
      meshes: [mesh],
      transformNodes: [],
      addAllToScene() {},
      dispose() {
        mesh.dispose(false, true);
      },
    });
    await load;
    assert.equal(mesh.material, adapter.materials.get("m"));
    await adapter.sync(
      [node("model", "model")],
      new Map([["model", buffer]]),
      content,
    );
    assert.equal(mesh.material, original);
    adapter.clear();
    assert.equal(scene.materials.length, 0);
  } finally {
    adapter.dispose();
    engine.dispose();
  }
});

test("model part and sub-material overrides preserve original slots, isolate models and release only managed wrappers", async () => {
  const engine = new B.NullEngine(),
    scene = new B.Scene(engine),
    resolves = [];
  const fake = {
      ...B,
      SceneLoader: {
        LoadAssetContainerAsync: () => new Promise((r) => resolves.push(r)),
      },
    },
    parts = [];
  const adapter = globalThis.ArkGlideScene.createSceneAdapter(fake, scene, {
    onParts: (id, list) => parts.push({ id, list }),
  });
  const definition = (id) => ({
    id,
    name: id,
    baseColor: "#FFFFFF",
    emissiveColor: "#000000",
    metallic: 0,
    roughness: 1,
    alpha: 1,
    doubleSided: false,
    uvScale: { u: 1, v: 1 },
  });
  const content = {
      materials: { m: definition("m"), n: definition("n") },
      textures: [],
    },
    buffers = new Map([
      ["a", new ArrayBuffer(4)],
      ["b", new ArrayBuffer(4)],
    ]);
  function container(label) {
    const multi = B.MeshBuilder.CreateBox(label + ":multi", {}, scene),
      single = B.MeshBuilder.CreateBox(label + ":single", {}, scene);
    const original = new B.MultiMaterial(label + ":original", scene),
      first = new B.StandardMaterial(label + ":first", scene),
      second = new B.StandardMaterial(label + ":second", scene),
      third = new B.StandardMaterial(label + ":third", scene);
    original.subMaterials = [first, second];
    multi.material = original;
    single.material = third;
    return {
      meshes: [multi, single],
      transformNodes: [],
      multi,
      single,
      original,
      first,
      second,
      third,
      addAllToScene() {},
      dispose() {
        multi.dispose(false, true);
        single.dispose(false, true);
        first.dispose();
        second.dispose();
      },
    };
  }
  try {
    let defs = [
      node("a", "model", {
        materialId: "m",
        materialSlots: { "mesh:0/slot:1": null, "mesh:1/slot:0": "n" },
      }),
      node("b", "model"),
    ];
    const ready = adapter.sync(defs, buffers, content),
      a = container("a"),
      b = container("b");
    resolves.shift()(a);
    resolves.shift()(b);
    await ready;
    assert.equal(a.multi.material.subMaterials[0], adapter.materials.get("m"));
    assert.equal(a.multi.material.subMaterials[1], a.second);
    assert.equal(a.single.material, adapter.materials.get("n"));
    assert.equal(b.multi.material, b.original);
    assert.ok(parts.some((p) => p.id === "a" && p.list.length === 3));
    const wrapper = a.multi.material;
    defs = [
      node("a", "model"),
      node("b", "model", { materialSlots: { "mesh:0/slot:0": "m" } }),
    ];
    await adapter.sync(defs, buffers, content);
    assert.equal(a.multi.material, a.original);
    assert.equal(a.single.material, a.third);
    assert.ok(!scene.multiMaterials.includes(wrapper));
    const shared = adapter.materials.get("m");
    await adapter.sync([defs[1]], buffers, content);
    assert.ok(scene.materials.includes(shared));
    assert.equal(b.multi.material.subMaterials[0], shared);
    adapter.clear();
    assert.equal(scene.multiMaterials.length, 0);
    assert.equal(scene.materials.length, 0);
  } finally {
    adapter.dispose();
    engine.dispose();
  }
});

test("reloading an enclosing model preserves independently owned child-model material overrides", async () => {
  const engine = new B.NullEngine(),
    scene = new B.Scene(engine),
    resolvers = [];
  const fake = {
      ...B,
      SceneLoader: {
        LoadAssetContainerAsync: () => new Promise((r) => resolvers.push(r)),
      },
    },
    adapter = globalThis.ArkGlideScene.createSceneAdapter(fake, scene);
  const material = {
      id: "m",
      name: "Shared",
      baseColor: "#FFFFFF",
      emissiveColor: "#000000",
      metallic: 0,
      roughness: 1,
      alpha: 1,
      doubleSided: false,
      uvScale: { u: 1, v: 1 },
    },
    content = { materials: { m: material }, textures: [] };
  function imported(name) {
    const mesh = B.MeshBuilder.CreateBox(name, {}, scene);
    mesh.material = new B.StandardMaterial(name + ":original", scene);
    return {
      meshes: [mesh],
      transformNodes: [],
      mesh,
      addAllToScene() {},
      dispose() {
        mesh.dispose(false, true);
      },
    };
  }
  try {
    const definitions = [
        node("child", "model", { parentId: "parent", materialId: "m" }),
        node("parent", "model"),
      ],
      buffers = new Map([
        ["child", new ArrayBuffer(4)],
        ["parent", new ArrayBuffer(4)],
      ]);
    const load = adapter.sync(definitions, buffers, content),
      child = imported("childPart"),
      parent = imported("parentPart");
    resolvers.shift()(child);
    resolvers.shift()(parent);
    await load;
    assert.equal(child.mesh.material, adapter.materials.get("m"));
    buffers.set("parent", new ArrayBuffer(8));
    const reload = adapter.sync(definitions, buffers, content);
    assert.equal(child.mesh.material, adapter.materials.get("m"));
    resolvers.shift()(imported("parentReplacement"));
    await reload;
    assert.equal(child.mesh.material, adapter.materials.get("m"));
  } finally {
    adapter.dispose();
    engine.dispose();
  }
});
