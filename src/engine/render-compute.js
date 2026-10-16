// Shared CPU render preparation for procedural geometry and offscreen views.
(function (root) {
  "use strict";
  const defaults = {
    enabled: true,
    normalsMinVertices: 256,
    cullMinMeshes: 32,
    maxBatchMeshes: 65536,
    epsilon: 1e-7,
  };
  const boundedMaterials = new Set([
    "StandardMaterial",
    "PBRMaterial",
    "PBRMetallicRoughnessMaterial",
    "PBRSpecularGlossinessMaterial",
    "BackgroundMaterial",
  ]);
  function settings(input = {}) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some((k) => !Object.hasOwn(defaults, k))
    )
      throw Error("Invalid render compute settings");
    const result = { ...defaults, ...input };
    if (
      typeof result.enabled !== "boolean" ||
      !["normalsMinVertices", "cullMinMeshes", "maxBatchMeshes"].every(
        (k) => Number.isSafeInteger(result[k]) && result[k] >= 0,
      ) ||
      result.maxBatchMeshes < 1 ||
      !Number.isFinite(result.epsilon) ||
      result.epsilon < 0
    )
      throw Error("Invalid render compute budget");
    return result;
  }
  function create(B, module, options) {
    const config = settings(options),
      native =
        config.enabled && module?.RenderBatch ? new module.RenderBatch() : null;
    let dead = false,
      selecting = false,
      boxCapacity = 0,
      vertexCapacity = 0,
      indexCapacity = 0,
      boxes,
      planes,
      positions,
      indices,
      output;
    const counters = {
      renderCullBatches: 0,
      renderCullCandidates: 0,
      renderCulledMeshes: 0,
      renderNormalBatches: 0,
      renderNormalVertices: 0,
    };
    const live = () => {
      if (dead) throw Error("Render compute disposed");
    };
    function normalData(p, triangles) {
      live();
      const vertices = p.length / 3;
      if (!native || vertices < config.normalsMinVertices) return null;
      if (vertices > vertexCapacity || triangles.length > indexCapacity) {
        vertexCapacity = Math.max(vertices, vertexCapacity * 2);
        indexCapacity = Math.max(triangles.length, indexCapacity * 2);
        native.reserveGeometry(vertexCapacity, indexCapacity);
        positions = indices = output = null;
      }
      if (!positions?.buffer.byteLength) positions = native.positionView();
      if (!indices?.buffer.byteLength) indices = native.indexView();
      positions.set(p);
      indices.set(triangles);
      if (!native.computeNormals(vertices, triangles.length, false))
        throw Error("Invalid render geometry");
      if (!output?.buffer.byteLength) output = native.normalView();
      counters.renderNormalBatches++;
      counters.renderNormalVertices += vertices;
      return output.slice(0, p.length);
    }
    function select(meshes, frustum, length = meshes.length) {
      live();
      if (
        !native ||
        selecting ||
        length < config.cullMinMeshes ||
        length > config.maxBatchMeshes ||
        !frustum ||
        frustum.length !== 6
      )
        return null;
      selecting = true;
      try {
        if (length > boxCapacity) {
          boxCapacity = Math.min(
            config.maxBatchMeshes,
            Math.max(length, boxCapacity * 2),
          );
          native.reserveBoxes(boxCapacity);
          boxes = null;
        }
        for (let i = 0; i < length; i++) {
          const mesh = meshes[i];
          // Deforming bounds, instance batches, camera-dependent transforms and
          // custom activation/LOD stay on the renderer's conservative path.
          let cameraDependent = false;
          for (let node = mesh; node; node = node.parent)
            if (
              node.isWorldMatrixCameraDependent?.() ||
              node.onAfterWorldMatrixUpdateObservable?.hasObservers()
            ) {
              cameraDependent = true;
              break;
            }
          const material = mesh.material || mesh.getScene().defaultMaterial,
            plugins = material?.pluginManager,
            customPlugins =
              plugins &&
              (!Array.isArray(plugins._activePlugins) ||
                plugins._activePlugins.length > 0);
          const bypass =
            mesh.alwaysSelectAsActiveMesh ||
            mesh.skeleton ||
            mesh.morphTargetManager ||
            mesh.hasThinInstances ||
            mesh.hasInstances ||
            mesh.isAnInstance ||
            mesh.actionManager ||
            mesh.getLODLevels?.().length ||
            mesh.getScene().customLODSelector ||
            cameraDependent ||
            mesh.doNotSyncBoundingInfo ||
            !boundedMaterials.has(material?.getClassName()) ||
            customPlugins ||
            material?.onBindObservable?.hasObservers() ||
            mesh.onBeforeRenderObservable?.hasObservers() ||
            mesh.onAfterRenderObservable?.hasObservers() ||
            mesh.onBeforeBindObservable?.hasObservers() ||
            mesh.onBeforeDrawObservable?.hasObservers();
          let bounds;
          if (!bypass && !mesh.isDisposed()) {
            mesh.computeWorldMatrix(!mesh.isSynchronized());
            bounds = mesh.getBoundingInfo()?.boundingBox;
          }
          if (!boxes?.buffer.byteLength) boxes = native.boxView();
          const at = i * 6;
          if (!bounds) {
            boxes[at] = NaN;
            continue;
          }
          boxes[at] = bounds.minimumWorld.x;
          boxes[at + 1] = bounds.minimumWorld.y;
          boxes[at + 2] = bounds.minimumWorld.z;
          boxes[at + 3] = bounds.maximumWorld.x;
          boxes[at + 4] = bounds.maximumWorld.y;
          boxes[at + 5] = bounds.maximumWorld.z;
        }
        if (!planes?.buffer.byteLength) planes = native.planeView();
        for (let i = 0; i < 6; i++) {
          const p = frustum[i],
            at = i * 4;
          planes[at] = p.normal.x;
          planes[at + 1] = p.normal.y;
          planes[at + 2] = p.normal.z;
          planes[at + 3] = p.d;
        }
        const count = native.cull(length, config.epsilon);
        if (count < 0) throw Error("Invalid render visibility batch");
        const selected = native.visibleView(),
          result = new Array(count);
        for (let i = 0; i < count; i++) result[i] = meshes[selected[i]];
        counters.renderCullBatches++;
        counters.renderCullCandidates += length;
        counters.renderCulledMeshes += length - count;
        return result;
      } finally {
        selecting = false;
      }
    }
    return {
      normalData,
      select,
      stats: () => ({
        renderComputeBackend: native && !dead ? "cpp-wasm" : "javascript",
        ...counters,
      }),
      dispose() {
        if (dead) return;
        dead = true;
        native?.delete();
        boxes = planes = positions = indices = output = null;
      },
    };
  }
  root.ArkGlideRenderCompute = { create, settings };
})(globalThis);
