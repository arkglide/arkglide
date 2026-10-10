// Shared scene construction for the editor and the opaque-origin runtime.
(function (root) {
  "use strict";
  function primitiveOf(node) {
    return (
      node.primitive ||
      (/sphere/i.test(node.name || "") || node.id === "sphere"
        ? "sphere"
        : "box")
    );
  }
  function createMaterialLibrary(B, scene, options) {
    const materials = new Map(),
      slots = new Map(),
      originals = new WeakMap();
    let content = {},
      buffers = new Map();
    function release(slot) {
      slot.texture?.dispose();
      slot.finish?.();
      if (slot.url) URL.revokeObjectURL(slot.url);
    }
    function texture(materialId, role, definition, textureId) {
      const key = materialId + ":" + role,
        asset = (content.textures || []).find((t) => t.id === textureId),
        buffer =
          buffers instanceof Map ? buffers.get(textureId) : buffers[textureId];
      let old = slots.get(key);
      if (old && (old.id !== textureId || old.buffer !== buffer)) {
        release(old);
        slots.delete(key);
        old = null;
      }
      if (!asset || !buffer) {
        if (old) {
          release(old);
          slots.delete(key);
        }
        return null;
      }
      if (!old) {
        const url = URL.createObjectURL(
          new Blob([buffer], { type: asset.mime }),
        );
        let resolve,
          finished = false;
        const promise = new Promise((r) => (resolve = r)),
          finish = () => {
            if (finished) return;
            finished = true;
            options.onLoading?.(-1);
            resolve();
          };
        options.onLoading?.(1);
        const item = {
          id: textureId,
          buffer,
          promise,
          finish,
          url,
          texture: null,
        };
        slots.set(key, item);
        item.texture = new B.Texture(
          url,
          scene,
          false,
          true,
          B.Texture.TRILINEAR_SAMPLINGMODE,
          finish,
          (message, error) => {
            if (slots.get(key) === item)
              options.onError?.(
                { id: textureId, name: asset.name, type: "texture" },
                error || new Error(message || "贴图解码失败"),
              );
            finish();
          },
          undefined,
          false,
          undefined,
          asset.mime,
        );
        item.texture.name = "arkglide:texture:" + key;
        item.texture.gammaSpace = role === "albedo";
        old = item;
      }
      old.texture.uScale = definition.uvScale.u;
      old.texture.vScale = definition.uvScale.v;
      return old.texture;
    }
    function sync(next = {}, nextBuffers = new Map()) {
      content = next;
      buffers = nextBuffers;
      const definitions = content.materials || {};
      for (const [id, mat] of materials)
        if (!Object.hasOwn(definitions, id)) {
          mat.dispose(false, false);
          materials.delete(id);
          for (const [key, item] of slots)
            if (key.startsWith(id + ":")) {
              release(item);
              slots.delete(key);
            }
        }
      for (const [id, d] of Object.entries(definitions)) {
        let mat = materials.get(id);
        if (!mat) {
          mat = new B.PBRMaterial("arkglide:material:" + id, scene);
          mat.metadata = { arkglideManagedMaterial: true };
          materials.set(id, mat);
        }
        mat.albedoColor = B.Color3.FromHexString(d.baseColor);
        mat.emissiveColor = B.Color3.FromHexString(d.emissiveColor);
        mat.metallic = d.metallic;
        mat.roughness = d.roughness;
        mat.alpha = d.alpha;
        mat.backFaceCulling = !d.doubleSided;
        mat.transparencyMode =
          d.alpha < 1
            ? B.PBRMaterial.PBRMATERIAL_ALPHABLEND
            : B.PBRMaterial.PBRMATERIAL_OPAQUE;
        mat.albedoTexture = texture(id, "albedo", d, d.albedoTextureId);
        mat.bumpTexture = texture(id, "normal", d, d.normalTextureId);
        mat.metallicTexture = texture(
          id,
          "metallicRoughness",
          d,
          d.metallicRoughnessTextureId,
        );
        mat.useRoughnessFromMetallicTextureAlpha = false;
        mat.useRoughnessFromMetallicTextureGreen = true;
        mat.useMetallnessFromMetallicTextureBlue = true;
      }
      return Promise.all([...slots.values()].map((s) => s.promise));
    }
    function restore(mesh) {
      if (mesh.material?.metadata?.arkglideManagedMaterial)
        mesh.material = originals.get(mesh) || null;
    }
    function apply(node, object) {
      const targets =
        node.type === "mesh"
          ? [object]
          : node.type === "model"
            ? object.getChildMeshes(false)
            : [];
      for (const mesh of targets) {
        const mat = materials.get(node.materialId);
        if (mat) {
          if (!mesh.material?.metadata?.arkglideManagedMaterial)
            originals.set(mesh, mesh.material || null);
          mesh.material = mat;
        } else restore(mesh);
      }
    }
    function prepareDestroy(object) {
      if (!object) return;
      restore(object);
      for (const child of object.getChildMeshes?.(false) || []) restore(child);
    }
    function clear() {
      for (const s of slots.values()) release(s);
      slots.clear();
      for (const m of materials.values()) m.dispose(false, false);
      materials.clear();
    }
    return { sync, apply, prepareDestroy, clear, materials };
  }
  function createSceneAdapter(B, scene, options = {}) {
    const nodes = new Map(),
      records = new Map(),
      resources = new Map(),
      pending = new Map();
    let definitions = [],
      disposed = false;
    const materialLibrary = createMaterialLibrary(B, scene, options);
    function disposeContent(id) {
      materialLibrary.prepareDestroy(nodes.get(id));
      pending.delete(id);
      const resource = resources.get(id);
      resources.delete(id);
      if (resource) resource.dispose();
    }
    function decorate(mesh, id) {
      mesh.metadata = { ...(mesh.metadata || {}), arkglideId: id };
    }
    function marker(node, id) {
      if (!options.editor || node.type === "mesh" || node.type === "model")
        return;
      const mesh = B.MeshBuilder.CreateBox(
        id + ":marker",
        { size: 0.2 },
        scene,
      );
      mesh.parent = nodes.get(id);
      decorate(mesh, id);
      const mat = new B.StandardMaterial(id + ":marker-material", scene);
      mat.emissiveColor = B.Color3.FromHexString(
        node.type === "light"
          ? "#FFD166"
          : node.type === "camera"
            ? "#69D2E7"
            : "#B6B6B6",
      );
      mat.wireframe = true;
      mesh.material = mat;
    }
    function make(node) {
      let object;
      if (node.type === "mesh") {
        const builders = {
          box: "CreateBox",
          sphere: "CreateSphere",
          plane: "CreateGround",
          cylinder: "CreateCylinder",
          capsule: "CreateCapsule",
          torus: "CreateTorus",
        };
        object = B.MeshBuilder[builders[primitiveOf(node)] || "CreateBox"](
          node.id,
          {},
          scene,
        );
      } else object = new B.TransformNode(node.id, scene);
      nodes.set(node.id, object);
      object.onDisposeObservable?.add(() => {
        disposeContent(node.id);
        nodes.delete(node.id);
        records.delete(node.id);
      });
      decorate(object, node.id);
      marker(node, node.id);
      if (node.type === "light") {
        const type = node.lightType || "directional";
        const light =
          type === "point"
            ? new B.PointLight(node.id + ":light", B.Vector3.Zero(), scene)
            : type === "hemispheric"
              ? new B.HemisphericLight(
                  node.id + ":light",
                  B.Vector3.Up(),
                  scene,
                )
              : new B.DirectionalLight(
                  node.id + ":light",
                  new B.Vector3(0, -1, 0),
                  scene,
                );
        light.parent = object;
        resources.set(node.id, light);
      } else if (node.type === "camera") {
        const camera = new B.FreeCamera(
          node.id + ":camera",
          B.Vector3.Zero(),
          scene,
        );
        camera.parent = object;
        resources.set(node.id, camera);
      }
      options.onCreate?.(object, node);
      return object;
    }
    function update(node) {
      const object = nodes.get(node.id);
      const p = node.transform || { x: 0, y: 0, z: 0 },
        r = node.rotation || { x: 0, y: 0, z: 0 },
        s = node.scale || { x: 1, y: 1, z: 1 };
      object.position.set(p.x, p.y, p.z);
      object.rotationQuaternion = null;
      object.rotation.set(r.x, r.y, r.z);
      object.scaling.set(s.x, s.y, s.z);
      object.setEnabled(node.visible !== false);
      if (node.type === "mesh" && !node.materialId && node.color) {
        materialLibrary.prepareDestroy(object);
        let mat = object.material;
        if (!mat)
          object.material = mat = new B.StandardMaterial(
            node.id + ":material",
            scene,
          );
        mat.diffuseColor = B.Color3.FromHexString(node.color);
      }
      materialLibrary.apply(node, object);
      const resource = resources.get(node.id);
      if (node.type === "light" && resource) {
        resource.intensity = node.intensity ?? 1;
        resource.diffuse = B.Color3.FromHexString(node.color || "#FFFFFF");
        resource.setEnabled(node.visible !== false);
      } else if (node.type === "camera" && resource) {
        resource.fov = ((node.fov ?? 60) * Math.PI) / 180;
      }
    }
    function linkParents() {
      // All nodes exist first, so scene array order does not affect parenting.
      definitions.forEach((node) => {
        const object = nodes.get(node.id);
        object.parent = nodes.get(node.parentId) || null;
      });
    }
    function activeCamera() {
      const node =
        definitions.find(
          (n) => n.type === "camera" && n.activeCamera && n.visible !== false,
        ) ||
        definitions.find(
          (n) =>
            n.type === "camera" &&
            n.activeCamera === undefined &&
            n.visible !== false,
        );
      return node ? resources.get(node.id) : null;
    }
    function modelExtension(node) {
      return /\.gltf$/i.test(node.modelUrl || "") ? ".gltf" : ".glb";
    }
    async function loadModel(node, buffer) {
      const token = {},
        object = nodes.get(node.id);
      pending.set(node.id, token);
      options.onLoading?.(1);
      const url = URL.createObjectURL(new Blob([buffer]));
      let container;
      try {
        container = await B.SceneLoader.LoadAssetContainerAsync(
          "",
          url,
          scene,
          undefined,
          modelExtension(node),
        );
        if (
          disposed ||
          pending.get(node.id) !== token ||
          object !== nodes.get(node.id)
        ) {
          container.dispose();
          return;
        }
        container.addAllToScene();
        const imported = new Set([
          ...container.meshes,
          ...container.transformNodes,
        ]);
        imported.forEach((mesh) => {
          if (!mesh.parent || !imported.has(mesh.parent)) mesh.parent = object;
          decorate(mesh, node.id);
        });
        resources.set(node.id, container);
        materialLibrary.apply(
          definitions.find((n) => n.id === node.id) || node,
          object,
        );
        options.onLoaded?.(node.id);
      } catch (error) {
        container?.dispose();
        if (!disposed && pending.get(node.id) === token)
          options.onError?.(node, error);
      } finally {
        URL.revokeObjectURL(url);
        if (pending.get(node.id) === token) pending.delete(node.id);
        options.onLoading?.(-1);
      }
    }
    function sync(
      next,
      buffers = new Map(),
      content = {},
      textureBuffers = new Map(),
    ) {
      if (disposed) return Promise.resolve();
      definitions = next;
      const ids = new Set(next.map((n) => n.id));
      // Detach surviving children before deleting/replacing a parent.
      nodes.forEach((object, id) => {
        if (ids.has(id)) object.parent = null;
      });
      nodes.forEach((object, id) => {
        if (!ids.has(id)) {
          disposeContent(id);
          options.onRemove?.(id);
          object.dispose(false, true);
          nodes.delete(id);
          records.delete(id);
        }
      });
      const loads = [materialLibrary.sync(content, textureBuffers)];
      next.forEach((node) => {
        const buffer =
          buffers instanceof Map ? buffers.get(node.id) : buffers[node.id];
        const old = records.get(node.id);
        const kind =
          node.type +
          ":" +
          (node.type === "mesh" ? primitiveOf(node) : node.lightType || "");
        if (old && old.kind !== kind) {
          disposeContent(node.id);
          options.onRemove?.(node.id);
          nodes.get(node.id).dispose(false, true);
          nodes.delete(node.id);
        }
        if (!nodes.has(node.id)) make(node);
        update(node);
        if (
          node.type === "model" &&
          (!old || old.buffer !== buffer || old.url !== node.modelUrl)
        ) {
          disposeContent(node.id);
          if (buffer) loads.push(loadModel(node, buffer));
        }
        records.set(node.id, { kind, buffer, url: node.modelUrl });
      });
      linkParents();
      return Promise.all(loads);
    }
    function clear() {
      definitions = [];
      pending.clear();
      nodes.forEach((object) => {
        object.parent = null;
      });
      [...nodes].forEach(([id, object]) => {
        disposeContent(id);
        options.onRemove?.(id);
        object.dispose(false, true);
      });
      nodes.clear();
      records.clear();
      materialLibrary.clear();
    }
    function dispose() {
      disposed = true;
      clear();
    }
    return {
      nodes,
      resources,
      sync,
      clear,
      dispose,
      activeCamera,
      materials: materialLibrary.materials,
      prepareDestroy: (id) => materialLibrary.prepareDestroy(nodes.get(id)),
    };
  }
  root.ArkGlideScene = { createSceneAdapter, primitiveOf };
})(globalThis);
