import test from "node:test";
import assert from "node:assert/strict";
import * as B from "@babylonjs/core";
import factory from "../src/wasm/arkglide_math.js";
import "../src/engine/render-compute.js";
import "../public/arkglide-api.js";
import "../src/engine/spatial-runtime.js";
import "../src/engine/visual-runtime.js";
const module = await factory();
const triangle = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
const near = (a, b) => {
  assert.equal(a.length, b.length);
  a.forEach((v, i) =>
    assert.ok(Math.abs(v - b[i]) < 1e-6, `${i}: ${v} != ${b[i]}`),
  );
};

test("native render normals match Babylon's winding, equal-face weighting and degenerate triangles", () => {
  const native = new module.RenderBatch();
  try {
    const p = [0, 0, 0, 10, 0, 0, 0, 20, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1],
      indices = [0, 1, 2, 0, 3, 1, 4, 4, 5, 3, 2, 0];
    native.reserveGeometry(p.length / 3, indices.length);
    native.positionView().set(p);
    native.indexView().set(indices);
    for (const useRightHandedSystem of [false, true]) {
      const expected = [];
      B.VertexData.ComputeNormals(p, indices, expected, {
        useRightHandedSystem,
      });
      assert.equal(
        native.computeNormals(
          p.length / 3,
          indices.length,
          useRightHandedSystem,
        ),
        true,
      );
      near(native.normalView().subarray(0, p.length), expected);
    }
    native.indexView()[0] = 100;
    assert.equal(
      native.computeNormals(p.length / 3, indices.length, false),
      false,
    );
    native.indexView()[0] = 0;
    native.positionView()[0] = NaN;
    assert.equal(
      native.computeNormals(p.length / 3, indices.length, false),
      false,
    );
    assert.equal(native.computeNormals(1000, indices.length, false), false);
    assert.equal(native.computeNormals(0xaaaaaaab, 0, false), false);
  } finally {
    native.delete();
  }
});

test("native AABB batches match reference frustum planes and preserve unknown or touching bounds", () => {
  const native = new module.RenderBatch();
  let seed = 7;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  try {
    const count = 1000;
    native.reserveBoxes(count);
    const boxes = native.boxView();
    for (let i = 0; i < count; i++)
      for (let axis = 0; axis < 3; axis++) {
        const min = random() * 60 - 30;
        boxes[i * 6 + axis] = min;
        boxes[i * 6 + axis + 3] = min + random() * 8;
      }
    for (const projection of [
      B.Matrix.Identity(),
      B.Matrix.LookAtLH(
        new B.Vector3(3, 5, -8),
        B.Vector3.Zero(),
        B.Axis.Y,
      ).multiply(B.Matrix.PerspectiveFovLH(1.1, 1.6, 0.1, 60)),
    ]) {
      const planes = B.Frustum.GetPlanes(projection),
        input = native.planeView(),
        expected = [];
      planes.forEach((p, i) =>
        input.set([p.normal.x, p.normal.y, p.normal.z, p.d], i * 4),
      );
      for (let i = 0; i < count; i++)
        if (
          planes.every(
            (p) =>
              p.normal.x * boxes[i * 6 + (p.normal.x >= 0 ? 3 : 0)] +
                p.normal.y * boxes[i * 6 + (p.normal.y >= 0 ? 4 : 1)] +
                p.normal.z * boxes[i * 6 + (p.normal.z >= 0 ? 5 : 2)] +
                p.d >=
              0,
          )
        )
          expected.push(i);
      const n = native.cull(count, 0);
      assert.deepEqual(
        Array.from(native.visibleView().subarray(0, n)),
        expected,
      );
    }
    const planes = B.Frustum.GetPlanes(B.Matrix.Identity());
    planes.forEach((p, i) =>
      native.planeView().set([p.normal.x, p.normal.y, p.normal.z, p.d], i * 4),
    );
    native
      .boxView()
      .set([1, -0.2, 0.2, 2, 0.2, 0.8, NaN, 0, 0, 0, 0, 0, 4, 0, 0, 3, 0, 0]);
    assert.equal(native.cull(3, 0), 3);
    assert.equal(native.cull(count + 1, 0), -1);
    assert.equal(native.cull(0x80000000, 0), -1);
  } finally {
    native.delete();
  }
});

test("render adapter refreshes views after WASM growth, returns owned normal snapshots and releases resources", () => {
  const render = ArkGlideRenderCompute.create(B, module, {
      normalsMinVertices: 0,
      cullMinMeshes: 0,
    }),
    holder = new module.RenderBatch();
  const engine = new B.NullEngine(),
    scene = new B.Scene(engine),
    mesh = B.MeshBuilder.CreateBox("box", {}, scene),
    planes = B.Frustum.GetPlanes(B.Matrix.Identity());
  try {
    const first = render.normalData(triangle.positions, triangle.indices);
    assert.equal(render.select([mesh], planes).length, 1);
    const before = module.HEAPU8.byteLength;
    holder.reserveGeometry(Math.ceil(before / 60) + 100000, 0);
    assert.ok(module.HEAPU8.byteLength > before);
    near(
      render.normalData(triangle.positions, [0, 2, 1]),
      first.map((v) => -v),
    );
    assert.deepEqual(Array.from(first), [0, 0, -1, 0, 0, -1, 0, 0, -1]);
    mesh.position.x = 20;
    assert.equal(render.select([mesh], planes).length, 0);
    render.dispose();
    render.dispose();
    assert.throws(
      () => render.normalData(triangle.positions, triangle.indices),
      /disposed/,
    );
  } finally {
    render.dispose();
    holder.delete();
    engine.dispose();
  }
});

test("offscreen selection retains deforming, instanced, custom and camera-dependent renderers", () => {
  const render = ArkGlideRenderCompute.create(B, module, { cullMinMeshes: 0 }),
    engine = new B.NullEngine(),
    scene = new B.Scene(engine),
    planes = B.Frustum.GetPlanes(B.Matrix.Identity());
  try {
    const box = (name) => {
      const m = B.MeshBuilder.CreateBox(name, {}, scene);
      m.position.x = 30;
      return m;
    };
    const outside = box("outside"),
      kept = box("always"),
      animated = box("animated"),
      billboard = box("billboard"),
      shader = box("shader"),
      source = box("source"),
      callback = box("callback"),
      multi = box("multi");
    outside.material = new B.StandardMaterial("standard", scene);
    kept.alwaysSelectAsActiveMesh = true;
    animated.skeleton = new B.Skeleton("skeleton", "skeleton", scene);
    billboard.parent = new B.TransformNode("parent", scene);
    billboard.parent.billboardMode = B.Mesh.BILLBOARDMODE_ALL;
    shader.material = new B.ShaderMaterial(
      "custom",
      scene,
      { vertex: "default", fragment: "default" },
      {},
    );
    const instance = source.createInstance("instance");
    callback.onBeforeBindObservable.add(() => {});
    multi.material = new B.MultiMaterial("multiple", scene);
    const selected = render.select(
      [
        outside,
        kept,
        animated,
        billboard,
        shader,
        source,
        instance,
        callback,
        multi,
      ],
      planes,
    );
    assert.deepEqual(
      selected.map((m) => m.name),
      [
        kept,
        animated,
        billboard,
        shader,
        source,
        instance,
        callback,
        multi,
      ].map((m) => m.name),
    );
    outside.position.x = 0;
    assert.ok(render.select([outside], planes).includes(outside));
  } finally {
    render.dispose();
    engine.dispose();
  }
});

test("procedural visual geometry consumes native normals and keeps its existing ownership contract", () => {
  const render = ArkGlideRenderCompute.create(B, module, {
      normalsMinVertices: 0,
    }),
    engine = new B.NullEngine(),
    scene = new B.Scene(engine),
    api = ArkGlideRuntime.createEntityAPI(B, () => scene),
    cleanup = new Set(),
    owner = {
      record: { active: true },
      track(fn) {
        cleanup.add(fn);
        return () => cleanup.delete(fn);
      },
    };
  const visuals = ArkGlideVisuals.create(B, {
    scene,
    renderCompute: render,
    find: api.sceneAPI.find,
    getObject: api.getObject,
    register: api.register,
  });
  try {
    const handle = visuals.forOwner(owner).createMesh(triangle),
      mesh = api.getObject(handle.entity.id);
    near(
      mesh.getVerticesData(B.VertexBuffer.NormalKind),
      [0, 0, -1, 0, 0, -1, 0, 0, -1],
    );
    handle.updateGeometry({ ...triangle, indices: [0, 2, 1] });
    assert.equal(render.stats().renderNormalBatches, 2);
    handle.destroy();
    assert.equal(visuals.stats().visualResources, 0);
    assert.equal(api.sceneAPI.getEntityCount(), 0);
  } finally {
    visuals.dispose();
    render.dispose();
    engine.dispose();
  }
});

test("render budgets are configurable and invalid settings cannot enable unchecked batches", () => {
  for (const bad of [
    null,
    [],
    { enabled: 1 },
    { epsilon: -1 },
    { maxBatchMeshes: 0 },
    { normalsMinVertices: 1.5 },
    { extra: 1 },
  ])
    assert.throws(() => ArkGlideRenderCompute.settings(bad));
  const render = ArkGlideRenderCompute.create(B, module, { enabled: false });
  try {
    assert.equal(render.normalData(triangle.positions, triangle.indices), null);
    assert.equal(render.select([], []), null);
  } finally {
    render.dispose();
  }
});
