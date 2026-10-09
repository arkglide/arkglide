// Renderer adapter for the script-facing API. Loaded as a classic script because
// the runtime iframe has an opaque origin (sandbox="allow-scripts").
(function (root) {
  'use strict';

  function createEntityAPI(Babylon, getScene) {
    const entities = new Map();
    const handles = new WeakMap();

    function meshOf(entity) {
      const handle = handles.get(entity);
      if (!handle || !handle.mesh) throw new Error('Entity has been destroyed: ' + entity.id);
      return handle.mesh;
    }
    function vector(x, y, z) {
      const value = typeof x === 'object' && x !== null ? x : { x, y, z };
      if (![value.x, value.y, value.z].every(Number.isFinite)) {
        throw new TypeError('Expected a Vec3 or three finite numbers');
      }
      return value;
    }
    function vectorView(entity, field) {
      const view = {};
      for (const axis of ['x', 'y', 'z']) {
        Object.defineProperty(view, axis, {
          enumerable: true,
          get() { return meshOf(entity)[field][axis]; },
          set(value) {
            if (!Number.isFinite(value)) throw new TypeError('Expected a finite number');
            meshOf(entity)[field][axis] = value;
          },
        });
      }
      return view;
    }
    function setVector(entity, field, x, y, z) {
      const value = vector(x, y, z);
      const mesh = meshOf(entity);
      // GLB roots can carry quaternions; convert before using the Euler API.
      if (field === 'rotation' && mesh.rotationQuaternion) {
        mesh.rotationQuaternion.toEulerAnglesToRef(mesh.rotation);
        mesh.rotationQuaternion = null;
      }
      mesh[field].set(value.x, value.y, value.z);
    }
    function copyVector(entity, field) {
      const value = meshOf(entity)[field];
      return { x: value.x, y: value.y, z: value.z };
    }

    class EntityHandle {
      constructor(mesh, id, name) {
        handles.set(this, { mesh, id, name: name ?? mesh.name });
        // Keep stable live vector views; never return Babylon Vector3 objects.
        for (const [property, field] of [['position', 'position'], ['rotation', 'rotation'], ['scale', 'scaling']]) {
          const view = vectorView(this, field);
          Object.defineProperty(this, property, {
            enumerable: true,
            get: () => { meshOf(this); return view; },
            set: value => setVector(this, field, value),
          });
        }
      }
      get id() { return handles.get(this).id; }
      get destroyed() { return !handles.get(this).mesh; }
      get name() { meshOf(this); return handles.get(this).name; }
      set name(value) { meshOf(this); handles.get(this).name = String(value); }
      get transform() { return this.position; }
      set transform(value) { this.position = value; }
      get visible() { return meshOf(this).isEnabled() && meshOf(this).isVisible; }
      set visible(value) { const mesh = meshOf(this); mesh.isVisible = !!value; mesh.setEnabled(!!value); }
      getId() { return this.id; }
      getName() { return this.name; }
      setName(value) { this.name = value; }
      getPosition() { return copyVector(this, 'position'); }
      setPosition(x, y, z) { setVector(this, 'position', x, y, z); }
      getRotation() { return copyVector(this, 'rotation'); }
      setRotation(x, y, z) { setVector(this, 'rotation', x, y, z); }
      getScale() { return copyVector(this, 'scaling'); }
      setScale(x, y, z) { setVector(this, 'scaling', x, y, z); }
      translate(x, y, z) {
        const delta = vector(x, y, z), position = this.getPosition();
        this.setPosition(position.x + delta.x, position.y + delta.y, position.z + delta.z);
      }
      rotate(x, y, z) {
        const angles = vector(x, y, z), rotation = this.getRotation();
        this.setRotation(rotation.x + angles.x, rotation.y + angles.y, rotation.z + angles.z);
      }
      isVisible() { return this.visible; }
      setVisible(value) { this.visible = value; }
      destroy() {
        const handle = handles.get(this);
        if (!handle.mesh) return;
        handle.mesh.dispose();
        handle.mesh = null;
        entities.delete(handle.id);
      }
    }

    function register(mesh, id, name) {
      if (entities.has(id)) throw new Error('Duplicate entity ID: ' + id);
      if (mesh.rotationQuaternion) {
        mesh.rotationQuaternion.toEulerAnglesToRef(mesh.rotation);
        mesh.rotationQuaternion = null;
      }
      const entity = new EntityHandle(mesh, id, name);
      entities.set(id, entity);
      return entity;
    }
    const sceneAPI = {
      find(id) { return entities.get(id) || null; },
      findByName(name) { return [...entities.values()].find(entity => entity.name === name) || null; },
      findAllByName(name) { return [...entities.values()].filter(entity => entity.name === name); },
      findAll() { return [...entities.values()]; },
      create(type, id) {
        const builders = {
          box: () => Babylon.MeshBuilder.CreateBox(id, { size: 1 }, getScene()),
          sphere: () => Babylon.MeshBuilder.CreateSphere(id, { diameter: 1 }, getScene()),
          plane: () => Babylon.MeshBuilder.CreateGround(id, { width: 1, height: 1 }, getScene()),
          cylinder: () => Babylon.MeshBuilder.CreateCylinder(id, { height: 1, diameter: 1 }, getScene()),
          capsule: () => Babylon.MeshBuilder.CreateCapsule(id, { height: 1, radius: 0.5 }, getScene()),
          torus: () => Babylon.MeshBuilder.CreateTorus(id, { diameter: 1, thickness: 0.3 }, getScene()),
        };
        if (!Object.hasOwn(builders, type)) throw new TypeError('Unknown primitive type: ' + type);
        if (id !== undefined && (typeof id !== 'string' || !id)) throw new TypeError('Expected a nonempty entity ID');
        if (id === undefined) {
          do { id = type + '_' + Math.random().toString(36).slice(2, 10); } while (entities.has(id));
        }
        if (entities.has(id)) throw new Error('Duplicate entity ID: ' + id);
        return register(builders[type](), id, id);
      },
      destroy(id) { entities.get(id)?.destroy(); },
      destroyAll() { for (const entity of [...entities.values()]) entity.destroy(); },
      getEntityCount() { return entities.size; },
    };
    // The editor/runtime alone receives register and the map. User scripts get
    // only sceneAPI and EntityHandle instances, which hold no renderer fields.
    return { sceneAPI, entities, register };
  }

  function defineScript(script) {
    if (!script || typeof script !== 'object') throw new TypeError('Expected a script object');
    return script;
  }
  root.ArkGlideRuntime = { createEntityAPI, defineScript };
})(globalThis);
