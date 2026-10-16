import test from "node:test";
import assert from "node:assert/strict";
import * as B from "@babylonjs/core";
import factory from "../src/wasm/arkglide_math.js";
import "../public/arkglide-api.js";
import "../src/engine/render-compute.js";

const module = await factory();
const trs = (x = 0) => [x, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0];
function submit(w, rows) {
  w.reserveSync(rows.length);
  for (let i = 0; i < rows.length; i++) {
    w.syncIdsView().set(rows[i].slice(0, 2), i * 2);
    w.syncDataView().set(rows[i][2], i * 11);
  }
  return w.applySync(rows.length);
}
function fixture(threshold = 0) {
  const engine = new B.NullEngine(),
    scene = new B.Scene(engine),
    world = new module.RuntimeWorld();
  const api = ArkGlideRuntime.createEntityAPI(
    B,
    () => scene,
    () => null,
    {
      getWorld: () => world,
      getBatchMinEntities: () => threshold,
    },
  );
  return {
    engine,
    scene,
    world,
    api,
    dispose() {
      engine.dispose();
      world.delete();
    },
  };
}

test("native transform batches validate atomically and reparent against the final hierarchy", () => {
  const w = new module.RuntimeWorld();
  try {
    const a = w.create("a", "A"),
      b = w.create("b", "B"),
      c = w.create("c", "C");
    w.setParent(b, a);
    // Applying a -> b before detaching b -> a used to reject this valid edit.
    assert.equal(
      submit(w, [
        [a, b, trs(2)],
        [b, 0, trs(10)],
        [c, a, trs(3)],
      ]),
      true,
    );
    assert.equal(w.world(c)[12], 15);
    const batches = w.transformBatches(),
      writes = w.transformWrites();
    for (const rows of [
      [[a, c, trs(30)]],
      [
        [a, 0, trs(30)],
        [b, 0, [NaN, ...trs().slice(1)]],
      ],
      [
        [a, 0, trs(30)],
        [a, 0, trs(40)],
      ],
      [
        [a, 0, trs(30)],
        [99999, 0, trs()],
      ],
      [[a, 99999, trs()]],
      [[a, 0, [...trs().slice(0, 10), 2]]],
    ]) {
      assert.equal(submit(w, rows), false);
      assert.equal(w.parent(a), b);
      assert.equal(w.world(c)[12], 15);
      assert.equal(w.transformBatches(), batches);
      assert.equal(w.transformWrites(), writes);
    }
    assert.equal(w.applySync(0x80000000), false);
    assert.equal(w.gatherBounds(0x80000000), false);
    w.erase(a);
    const replacement = w.create("a", "Replacement");
    assert.notEqual(replacement, a);
    assert.equal(submit(w, [[a, 0, trs()]]), false);
  } finally {
    w.delete();
  }
});

test("facade batches sparse renderer writes, preserves quaternion data and retries failed batches", () => {
  const f = fixture();
  try {
    const entities = Array.from({ length: 80 }, (_, i) =>
      f.api.sceneAPI.create("box", "n" + i),
    );
    f.api.sync();
    const calls = {
      transform: 0,
      transformQuaternion: 0,
      setParent: 0,
      applySync: 0,
    };
    for (const name of Object.keys(calls)) {
      const fn = f.world[name].bind(f.world);
      f.world[name] = (...args) => {
        calls[name]++;
        return fn(...args);
      };
    }
    const mesh = f.api.getObject("n1"),
      parent = f.api.getObject("n0");
    parent.position.set(12, 3, -4);
    mesh.parent = parent;
    mesh.position.x = 2;
    mesh.rotationQuaternion = B.Quaternion.FromEulerAngles(
      Math.PI / 2,
      0.2,
      0.4,
    );
    f.api.sync();
    assert.deepEqual(calls, {
      transform: 0,
      transformQuaternion: 0,
      setParent: 0,
      applySync: 1,
    });
    assert.deepEqual(entities[1].getWorldPosition(), { x: 14, y: 3, z: -4 });
    for (let i = 0; i < 10; i++) f.api.sync();
    assert.equal(calls.applySync, 1);
    parent.position.x = 20;
    mesh.position.x = NaN;
    assert.throws(() => f.api.sync(), /transform batch/);
    assert.equal(f.world.world(f.world.find("n0"))[12], 12);
    mesh.position.x = 4;
    f.api.sync();
    assert.equal(entities[1].getWorldPosition().x, 24);
    // Queries after another direct change remain immediately visible.
    parent.position.x = 30;
    assert.equal(entities[1].getWorldPosition().x, 34);
  } finally {
    f.dispose();
  }
});

test("cached native bounds enclose Float32 renderer results through rotated, reflected and large-coordinate hierarchies", () => {
  const f = fixture();
  let seed = 37;
  const random = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32;
  try {
    const root = new B.TransformNode("root", f.scene);
    root.position.set(1e7 + 0.3123, -2e6 + 0.2, 3000.0123);
    f.api.register(root, "root");
    const meshes = [];
    let parent = root;
    for (let i = 0; i < 64; i++) {
      const mesh = B.MeshBuilder.CreateBox("box" + i, {}, f.scene);
      mesh.parent = parent;
      mesh.position.set(random() * 10, random() * 3, random() * 5);
      mesh.scaling.set(
        (i % 3 ? 1 : -1) * (0.9 + random() * 0.2),
        0.9 + random() * 0.2,
        0.9 + random() * 0.2,
      );
      if (i % 2)
        mesh.rotationQuaternion = B.Quaternion.FromEulerAngles(
          random(),
          random(),
          random(),
        );
      else mesh.rotation.set(random(), random(), random());
      f.api.register(mesh, "box" + i);
      meshes.push(mesh);
      parent = mesh;
    }
    const native = f.api.worldBounds(meshes).slice(0, meshes.length * 6);
    for (let i = 0; i < meshes.length; i++) {
      meshes[i].computeWorldMatrix(true);
      const b = meshes[i].getBoundingInfo().boundingBox;
      for (const [axis, name] of ["x", "y", "z"].entries()) {
        assert.ok(
          native[i * 6 + axis] <= b.minimumWorld[name],
          `minimum ${i}/${name}`,
        );
        assert.ok(
          native[i * 6 + axis + 3] >= b.maximumWorld[name],
          `maximum ${i}/${name}`,
        );
      }
    }
    const before = f.world.boundUpdates(),
      matrices = f.world.matrixUpdates();
    f.api.worldBounds(meshes);
    assert.equal(f.world.boundUpdates(), before);
    assert.equal(f.world.matrixUpdates(), matrices);
    root.position.x += 1;
    f.api.worldBounds(meshes);
    assert.equal(f.world.boundUpdates(), before + meshes.length);
    const last = meshes.at(-1),
      updateCount = f.world.boundUpdates();
    last.setVerticesData(
      B.VertexBuffer.PositionKind,
      last.getVerticesData(B.VertexBuffer.PositionKind).map((x) => x * 2),
    );
    f.api.worldBounds(meshes);
    assert.equal(f.world.boundUpdates(), updateCount + 1);
  } finally {
    f.dispose();
  }
});

test("offscreen views reuse C++ transforms and bounds without invoking renderer matrix preparation", () => {
  const f = fixture(),
    render = ArkGlideRenderCompute.create(
      B,
      module,
      { cullMinMeshes: 0 },
      f.api,
    );
  const oldCompute = B.TransformNode.prototype.computeWorldMatrix;
  try {
    const root = new B.TransformNode("root", f.scene);
    f.api.register(root, "root");
    const meshes = Array.from({ length: 64 }, (_, i) => {
      const m = B.MeshBuilder.CreateBox("m" + i, {}, f.scene);
      m.parent = root;
      m.position.x = i ? 10 + i : 0;
      f.api.register(m, "m" + i);
      return m;
    });
    let rendererCalls = 0;
    B.TransformNode.prototype.computeWorldMatrix = function (...args) {
      rendererCalls++;
      return oldCompute.apply(this, args);
    };
    const planes = B.Frustum.GetPlanes(B.Matrix.Identity());
    assert.deepEqual(
      render.select(meshes, planes).map((m) => m.name),
      ["m0"],
    );
    assert.equal(rendererCalls, 0);
    const before = f.world.boundUpdates();
    assert.equal(before, meshes.length);
    assert.equal(render.select(meshes, planes).length, 1);
    assert.equal(f.world.boundUpdates(), before);
    assert.equal(rendererCalls, 0);
    assert.equal(f.world.boundBatches(), 1);
    assert.equal(f.api.stats().nativeBoundsCacheHits, 1);
    assert.deepEqual(
      render.select([meshes[1], meshes[0]], planes).map((m) => m.name),
      ["m0"],
    );
    assert.equal(f.world.boundUpdates(), before);
    render.select(meshes, planes);
    root.position.x = 100;
    assert.equal(render.select(meshes, planes).length, 0);
    assert.equal(f.world.boundUpdates(), before + meshes.length);
    assert.equal(rendererCalls, 0);
    assert.equal(render.stats().renderNativeBounds, meshes.length * 4 + 2);
    const holder = new module.RenderBatch(),
      heap = module.HEAPU8.byteLength;
    try {
      holder.reserveGeometry(Math.ceil(heap / 60) + 100000, 0);
      assert.ok(module.HEAPU8.byteLength > heap);
      root.position.x = 0;
      assert.equal(render.select(meshes, planes).length, 1);
    } finally {
      holder.delete();
    }
    root.dispose();
    const replacement = f.api.sceneAPI.create("box", "m0");
    assert.equal(replacement.destroyed, false);
    assert.equal(render.select([f.api.getObject("m0")], planes).length, 1);
    assert.equal(f.world.count(), 1);
  } finally {
    B.TransformNode.prototype.computeWorldMatrix = oldCompute;
    render.dispose();
    f.dispose();
  }
});

test("native bounds fall back for pivot, frozen, foreign, locked, custom and camera-dependent transforms", () => {
  const f = fixture();
  try {
    const mesh = B.MeshBuilder.CreateBox("mesh", {}, f.scene);
    f.api.register(mesh, "mesh");
    assert.ok(Number.isFinite(f.api.worldBounds([mesh])[0]));
    const checks = [
      () => mesh.setPivotPoint(new B.Vector3(1, 0, 0)),
      () => mesh.freezeWorldMatrix(),
      () => {
        mesh.parent = new B.TransformNode("foreign", f.scene);
      },
      () => {
        mesh.getBoundingInfo().isLocked = true;
      },
      () => {
        mesh.computeWorldMatrix = mesh.computeWorldMatrix.bind(mesh);
      },
      () => {
        mesh.billboardMode = B.Mesh.BILLBOARDMODE_ALL;
      },
      () => {
        mesh._afterComputeWorldMatrix = () => {};
      },
      () => {
        mesh._updateBoundingInfo = () => mesh;
      },
    ];
    for (const change of checks) {
      const oldCompute = mesh.computeWorldMatrix;
      const oldAfter = mesh._afterComputeWorldMatrix,
        oldBounds = mesh._updateBoundingInfo;
      change();
      assert.equal(f.api.worldBounds([mesh]), null);
      mesh.computeWorldMatrix = oldCompute;
      mesh._afterComputeWorldMatrix = oldAfter;
      mesh._updateBoundingInfo = oldBounds;
      mesh.unfreezeWorldMatrix();
      mesh.setPivotMatrix(B.Matrix.Identity());
      mesh.parent = null;
      mesh.getBoundingInfo().isLocked = false;
      mesh.billboardMode = 0;
    }
    const id = f.world.find("mesh");
    f.world.reserveBounds(1);
    f.world.boundsIdsView()[0] = id;
    f.world.boundsDataView().set([NaN, 0, 0, 1, 1, 1]);
    assert.equal(f.world.gatherBounds(1), true);
    assert.ok(Number.isNaN(f.world.boundsOutputView()[0]));
    f.world.erase(id);
    assert.equal(f.world.gatherBounds(1), true);
    assert.ok(Number.isNaN(f.world.boundsOutputView()[0]));
    f.world.clear();
    assert.equal(f.world.boundUpdates(), 0);
    assert.equal(f.world.transformBatches(), 0);
  } finally {
    f.dispose();
  }
});

test("adaptive bounds keep static scenes on the renderer path and still see changes between views", () => {
  const f = fixture(),
    render = ArkGlideRenderCompute.create(
      B,
      module,
      { cullMinMeshes: 0 },
      f.api,
    );
  try {
    const meshes = Array.from({ length: 64 }, (_, i) => {
      const m = B.MeshBuilder.CreateBox("m" + i, {}, f.scene);
      m.position.x = i ? 30 : 0;
      f.api.register(m, m.name);
      return m;
    });
    const planes = B.Frustum.GetPlanes(B.Matrix.Identity());
    render.beginFrame();
    assert.equal(render.select(meshes, planes).length, 1);
    const native = render.stats().renderNativeBounds;
    render.beginFrame();
    assert.equal(render.select(meshes, planes).length, 1);
    assert.equal(render.stats().renderNativeBounds, native);
    meshes[0].position.x = 30;
    assert.equal(render.select(meshes, planes).length, 0);
    assert.equal(f.api.sceneAPI.find("m0").getWorldPosition().x, 30);
    for (const mesh of meshes) mesh.position.x = 0;
    render.beginFrame();
    assert.equal(render.select(meshes, planes).length, 64);
    assert.equal(render.stats().renderNativeBounds, native + 64);
  } finally {
    render.dispose();
    f.dispose();
  }
});
