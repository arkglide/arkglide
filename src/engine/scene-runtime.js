// Shared scene construction for the editor and the opaque-origin runtime.
(function (root) {
  'use strict';
  function primitiveOf(node) {
    return node.primitive || (/sphere/i.test(node.name || '') || node.id === 'sphere' ? 'sphere' : 'box');
  }
  function createSceneAdapter(B, scene, options = {}) {
    const nodes = new Map(), records = new Map(), resources = new Map(), pending = new Map();
    let definitions = [], disposed = false;
    function disposeContent(id) {
      pending.delete(id);
      const resource = resources.get(id);
      if (resource) resource.dispose();
      resources.delete(id);
    }
    function decorate(mesh, id) {
      mesh.metadata = { ...(mesh.metadata || {}), arkglideId: id };
    }
    function marker(node, id) {
      if (!options.editor || node.type === 'mesh' || node.type === 'model') return;
      const mesh = B.MeshBuilder.CreateBox(id + ':marker', { size: 0.2 }, scene);
      mesh.parent = nodes.get(id);
      decorate(mesh, id);
      const mat = new B.StandardMaterial(id + ':marker-material', scene);
      mat.emissiveColor = B.Color3.FromHexString(node.type === 'light' ? '#FFD166' : node.type === 'camera' ? '#69D2E7' : '#B6B6B6');
      mat.wireframe = true;
      mesh.material = mat;
    }
    function make(node) {
      let object;
      if (node.type === 'mesh') {
        const builders = { box: 'CreateBox', sphere: 'CreateSphere', plane: 'CreateGround', cylinder: 'CreateCylinder', capsule: 'CreateCapsule', torus: 'CreateTorus' };
        object = B.MeshBuilder[builders[primitiveOf(node)] || 'CreateBox'](node.id, {}, scene);
      } else object = new B.TransformNode(node.id, scene);
      nodes.set(node.id, object);
      decorate(object, node.id);
      marker(node, node.id);
      if (node.type === 'light') {
        const type = node.lightType || 'directional';
        const light = type === 'point' ? new B.PointLight(node.id + ':light', B.Vector3.Zero(), scene)
          : type === 'hemispheric' ? new B.HemisphericLight(node.id + ':light', B.Vector3.Up(), scene)
          : new B.DirectionalLight(node.id + ':light', new B.Vector3(0, -1, 0), scene);
        light.parent = object;
        resources.set(node.id, light);
      } else if (node.type === 'camera') {
        const camera = new B.FreeCamera(node.id + ':camera', B.Vector3.Zero(), scene);
        camera.parent = object;
        resources.set(node.id, camera);
      }
      options.onCreate?.(object, node);
      return object;
    }
    function update(node) {
      const object = nodes.get(node.id);
      const p = node.transform || { x: 0, y: 0, z: 0 }, r = node.rotation || { x: 0, y: 0, z: 0 }, s = node.scale || { x: 1, y: 1, z: 1 };
      object.position.set(p.x, p.y, p.z);
      object.rotationQuaternion = null;
      object.rotation.set(r.x, r.y, r.z);
      object.scaling.set(s.x, s.y, s.z);
      object.setEnabled(node.visible !== false);
      if (node.type === 'mesh' && node.color) {
        let mat = object.material;
        if (!mat) object.material = mat = new B.StandardMaterial(node.id + ':material', scene);
        mat.diffuseColor = B.Color3.FromHexString(node.color);
      }
      const resource = resources.get(node.id);
      if (node.type === 'light' && resource) {
        resource.intensity = node.intensity ?? 1;
        resource.diffuse = B.Color3.FromHexString(node.color || '#FFFFFF');
        resource.setEnabled(node.visible !== false);
      } else if (node.type === 'camera' && resource) {
        resource.fov = (node.fov ?? 60) * Math.PI / 180;
      }
    }
    function linkParents() {
      // All nodes exist first, so scene array order does not affect parenting.
      definitions.forEach(node => {
        const object = nodes.get(node.id);
        object.parent = nodes.get(node.parentId) || null;
      });
    }
    function activeCamera() {
      const node = definitions.find(n => n.type === 'camera' && n.activeCamera && n.visible !== false)
        || definitions.find(n => n.type === 'camera' && n.activeCamera === undefined && n.visible !== false);
      return node ? resources.get(node.id) : null;
    }
    function modelExtension(node) { return /\.gltf$/i.test(node.modelUrl || '') ? '.gltf' : '.glb'; }
    async function loadModel(node, buffer) {
      const token = {}, object = nodes.get(node.id);
      pending.set(node.id, token);
      options.onLoading?.(1);
      const url = URL.createObjectURL(new Blob([buffer]));
      let container;
      try {
        container = await B.SceneLoader.LoadAssetContainerAsync('', url, scene, undefined, modelExtension(node));
        if (disposed || pending.get(node.id) !== token || object !== nodes.get(node.id)) {
          container.dispose(); return;
        }
        container.addAllToScene();
        const imported = new Set([...container.meshes, ...container.transformNodes]);
        imported.forEach(mesh => {
          if (!mesh.parent || !imported.has(mesh.parent)) mesh.parent = object;
          decorate(mesh, node.id);
        });
        resources.set(node.id, container);
        options.onLoaded?.(node.id);
      } catch (error) {
        container?.dispose();
        if (!disposed && pending.get(node.id) === token) options.onError?.(node, error);
      } finally {
        URL.revokeObjectURL(url);
        if (pending.get(node.id) === token) pending.delete(node.id);
        options.onLoading?.(-1);
      }
    }
    function sync(next, buffers = new Map()) {
      if (disposed) return Promise.resolve();
      definitions = next;
      const ids = new Set(next.map(n => n.id));
      // Detach surviving children before deleting/replacing a parent.
      nodes.forEach((object, id) => { if (ids.has(id)) object.parent = null; });
      nodes.forEach((object, id) => {
        if (!ids.has(id)) {
          disposeContent(id); options.onRemove?.(id); object.dispose(); nodes.delete(id); records.delete(id);
        }
      });
      const loads = [];
      next.forEach(node => {
        const buffer = buffers instanceof Map ? buffers.get(node.id) : buffers[node.id];
        const old = records.get(node.id);
        const kind = node.type + ':' + (node.type === 'mesh' ? primitiveOf(node) : node.lightType || '');
        if (old && old.kind !== kind) {
          disposeContent(node.id); options.onRemove?.(node.id); nodes.get(node.id).dispose(); nodes.delete(node.id);
        }
        if (!nodes.has(node.id)) make(node);
        update(node);
        if (node.type === 'model' && (!old || old.buffer !== buffer || old.url !== node.modelUrl)) {
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
      nodes.forEach(object => { object.parent = null; });
      [...nodes].forEach(([id, object]) => { disposeContent(id); options.onRemove?.(id); object.dispose(); });
      nodes.clear(); records.clear();
    }
    function dispose() { disposed = true; clear(); }
    return { nodes, resources, sync, clear, dispose, activeCamera };
  }
  root.ArkGlideScene = { createSceneAdapter, primitiveOf };
})(globalThis);
