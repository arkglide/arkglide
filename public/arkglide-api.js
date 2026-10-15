// Renderer adapter for the script-facing API. Loaded as a classic script because
// the runtime iframe has an opaque origin (sandbox="allow-scripts").
(function (root) {
  "use strict";

  function createEntityAPI(
    Babylon,
    getScene,
    getMath = () => null,
    options = {},
  ) {
    const entities = new Map();
    const handles = new WeakMap();
    const nativeEntities = new Map();
    function syncEntity(entity) {
      const h = handles.get(entity);
      if (!h?.native || !h.mesh) return;
      const n = h.mesh,
        angles = n.rotationQuaternion?.toEulerAngles() || n.rotation;
      h.native.transform(
        h.nativeId,
        n.position.x,
        n.position.y,
        n.position.z,
        angles.x,
        angles.y,
        angles.z,
        n.scaling.x,
        n.scaling.y,
        n.scaling.z,
      );
      const parent = entities.get(n.parent?.metadata?.arkglideId),
        p = parent && handles.get(parent);
      if (
        !h.native.setParent(h.nativeId, p?.mesh === n.parent ? p.nativeId : 0)
      )
        throw Error("Invalid logical scene hierarchy");
    }
    function sync() {
      for (const e of entities.values()) syncEntity(e);
    }
    function releaseNative(h) {
      if (h.native) {
        h.native.erase(h.nativeId);
        nativeEntities.delete(h.nativeId);
      }
    }

    function meshOf(entity) {
      const handle = handles.get(entity);
      if (
        !handle ||
        !handle.mesh ||
        (handle.native && !handle.native.alive(handle.nativeId))
      )
        throw new Error("Entity has been destroyed: " + entity.id);
      return handle.mesh;
    }
    function vector(x, y, z) {
      const value = typeof x === "object" && x !== null ? x : { x, y, z };
      if (![value.x, value.y, value.z].every(Number.isFinite)) {
        throw new TypeError("Expected a Vec3 or three finite numbers");
      }
      return value;
    }
    function vectorView(entity, field) {
      const view = {};
      for (const axis of ["x", "y", "z"]) {
        Object.defineProperty(view, axis, {
          enumerable: true,
          get() {
            return copyVector(entity, field)[axis];
          },
          set(value) {
            if (!Number.isFinite(value))
              throw new TypeError("Expected a finite number");
            setVector(entity, field, {
              ...copyVector(entity, field),
              [axis]: value,
            });
          },
        });
      }
      return view;
    }
    function setVector(entity, field, x, y, z) {
      options.onBeforeMutate?.();
      const value = vector(x, y, z);
      const mesh = meshOf(entity);
      // GLB roots can carry quaternions; convert before using the Euler API.
      if (field === "rotation" && mesh.rotationQuaternion) {
        mesh.rotationQuaternion.toEulerAnglesToRef(mesh.rotation);
        mesh.rotationQuaternion = null;
      }
      mesh[field].set(value.x, value.y, value.z);
      syncEntity(entity);
    }
    function copyVector(entity, field) {
      const mesh = meshOf(entity);
      const value =
        field === "rotation" && mesh.rotationQuaternion
          ? mesh.rotationQuaternion.toEulerAngles()
          : mesh[field];
      return { x: value.x, y: value.y, z: value.z };
    }

    class EntityHandle {
      constructor(mesh, id, name) {
        const native = options.getWorld?.(),
          displayName = name ?? mesh.name,
          nativeId = native?.create(id, displayName) || 0;
        if (native && !nativeId)
          throw Error("Native entity allocation failed: " + id);
        handles.set(this, { mesh, id, name: displayName, native, nativeId });
        if (native) nativeEntities.set(nativeId, this);
        // Keep stable live vector views; never return Babylon Vector3 objects.
        for (const [property, field] of [
          ["position", "position"],
          ["rotation", "rotation"],
          ["scale", "scaling"],
        ]) {
          const view = vectorView(this, field);
          Object.defineProperty(this, property, {
            enumerable: true,
            get: () => {
              meshOf(this);
              return view;
            },
            set: (value) => setVector(this, field, value),
          });
        }
      }
      get id() {
        return handles.get(this).id;
      }
      get destroyed() {
        const h = handles.get(this);
        return !h.mesh || (!!h.native && !h.native.alive(h.nativeId));
      }
      get name() {
        meshOf(this);
        const h = handles.get(this);
        return h.native ? h.native.name(h.nativeId) : h.name;
      }
      set name(value) {
        options.onBeforeMutate?.();
        meshOf(this);
        const h = handles.get(this);
        h.name = String(value);
        h.native?.rename(h.nativeId, h.name);
      }
      get transform() {
        return this.position;
      }
      set transform(value) {
        this.position = value;
      }
      get visible() {
        const mesh = meshOf(this);
        return mesh.isEnabled() && mesh.isVisible !== false;
      }
      set visible(value) {
        options.onBeforeMutate?.();
        const mesh = meshOf(this);
        mesh.isVisible = !!value;
        mesh.setEnabled(!!value);
      }
      getId() {
        return this.id;
      }
      getName() {
        return this.name;
      }
      setName(value) {
        this.name = value;
      }
      getPosition() {
        return copyVector(this, "position");
      }
      setPosition(x, y, z) {
        setVector(this, "position", x, y, z);
      }
      getRotation() {
        return copyVector(this, "rotation");
      }
      setRotation(x, y, z) {
        setVector(this, "rotation", x, y, z);
      }
      getWorldMatrix() {
        const math = getMath(),
          mesh = meshOf(this);
        const h = handles.get(this);
        if (h.native) {
          const chain = [];
          let node = mesh,
            foreign = false;
          while (node && node.position) {
            const e = entities.get(node.metadata?.arkglideId);
            if (!e || handles.get(e).mesh !== node) {
              foreign = true;
              break;
            }
            chain.push(e);
            node = node.parent;
          }
          if (!foreign) {
            for (let i = chain.length - 1; i >= 0; i--) syncEntity(chain[i]);
            return Array.from(h.native.world(h.nativeId));
          }
        }
        if (!math) return Array.from(mesh.computeWorldMatrix(true).m);
        function world(node) {
          const angles =
            node.rotationQuaternion?.toEulerAngles() || node.rotation;
          const local = math.mat4.compose(node.position, angles, node.scaling);
          return node.parent && node.parent.position
            ? math.mat4.multiply(world(node.parent), local)
            : local;
        }
        return world(mesh);
      }
      getWorldPosition() {
        const matrix = this.getWorldMatrix();
        return { x: matrix[12], y: matrix[13], z: matrix[14] };
      }
      getScale() {
        return copyVector(this, "scaling");
      }
      setScale(x, y, z) {
        setVector(this, "scaling", x, y, z);
      }
      translate(x, y, z) {
        const delta = vector(x, y, z),
          position = this.getPosition();
        const math = getMath();
        this.setPosition(
          math
            ? math.vec3.add(position, delta)
            : {
                x: position.x + delta.x,
                y: position.y + delta.y,
                z: position.z + delta.z,
              },
        );
      }
      rotate(x, y, z) {
        const angles = vector(x, y, z),
          rotation = this.getRotation();
        const math = getMath();
        this.setRotation(
          math
            ? math.vec3.add(rotation, angles)
            : {
                x: rotation.x + angles.x,
                y: rotation.y + angles.y,
                z: rotation.z + angles.z,
              },
        );
      }
      isVisible() {
        return this.visible;
      }
      setVisible(value) {
        this.visible = value;
      }
      destroy() {
        const handle = handles.get(this);
        if (!handle.mesh) return;
        options.onBeforeMutate?.();
        const mesh = handle.mesh;
        if (handle.destroying) return;
        handle.destroying = true;
        let failure,
          failed = false;
        const captureFailure = (error) => {
          if (!failed) {
            failed = true;
            failure = error;
          }
        };
        // Logical descendants are owned by C++; renderer-only children remain
        // part of the browser adapter's disposal contract.
        const logical = handle.native
          ? Array.from(handle.native.descendants(handle.nativeId))
              .map((h) => nativeEntities.get(h))
              .filter(Boolean)
          : [];
        for (const child of logical)
          try {
            child.destroy();
          } catch (error) {
            captureFailure(error);
          }
        for (const child of mesh.getDescendants?.() || []) {
          const id = child.metadata?.arkglideId;
          const entity = entities.get(id);
          if (entity && entity !== this) {
            try {
              entity.destroy();
            } catch (error) {
              captureFailure(error);
            }
          }
        }
        try {
          options.onBeforeDestroy?.(handle.id);
        } catch (error) {
          captureFailure(error);
        } finally {
          try {
            mesh.dispose(false, false);
          } finally {
            releaseNative(handle);
            handle.mesh = null;
            if (entities.get(handle.id) === this) entities.delete(handle.id);
          }
        }
        if (failed) throw failure;
      }
    }

    function register(mesh, id, name) {
      if (entities.has(id)) throw new Error("Duplicate entity ID: " + id);
      mesh.metadata = { ...mesh.metadata, arkglideId: id };
      if (mesh.rotationQuaternion) {
        mesh.rotationQuaternion.toEulerAnglesToRef(mesh.rotation);
        mesh.rotationQuaternion = null;
      }
      const entity = new EntityHandle(mesh, id, name);
      mesh.onDisposeObservable?.add(() => {
        const handle = handles.get(entity);
        try {
          if (!handle.destroying) {
            handle.destroying = true;
            options.onBeforeDestroy?.(id);
          }
        } finally {
          releaseNative(handle);
          handle.mesh = null;
          if (entities.get(id) === entity) entities.delete(id);
        }
      });
      entities.set(id, entity);
      syncEntity(entity);
      return entity;
    }
    const sceneAPI = {
      find(id) {
        if (typeof id !== "string") return null;
        const core = options.getWorld?.();
        return core
          ? nativeEntities.get(core.find(id)) || null
          : entities.get(id) || null;
      },
      findByName(name) {
        if (typeof name !== "string") return null;
        const core = options.getWorld?.();
        return core
          ? nativeEntities.get(core.named(name)[0]) || null
          : [...entities.values()].find((entity) => entity.name === name) ||
              null;
      },
      findAllByName(name) {
        if (typeof name !== "string") return [];
        const core = options.getWorld?.();
        return core
          ? Array.from(core.named(name))
              .map((id) => nativeEntities.get(id))
              .filter(Boolean)
          : [...entities.values()].filter((entity) => entity.name === name);
      },
      findAll() {
        return [...entities.values()];
      },
      create(type, id) {
        options.onBeforeMutate?.();
        const builders = {
          box: () => Babylon.MeshBuilder.CreateBox(id, { size: 1 }, getScene()),
          sphere: () =>
            Babylon.MeshBuilder.CreateSphere(id, { diameter: 1 }, getScene()),
          plane: () =>
            Babylon.MeshBuilder.CreateGround(
              id,
              { width: 1, height: 1 },
              getScene(),
            ),
          cylinder: () =>
            Babylon.MeshBuilder.CreateCylinder(
              id,
              { height: 1, diameter: 1 },
              getScene(),
            ),
          capsule: () =>
            Babylon.MeshBuilder.CreateCapsule(
              id,
              { height: 1, radius: 0.5 },
              getScene(),
            ),
          torus: () =>
            Babylon.MeshBuilder.CreateTorus(
              id,
              { diameter: 1, thickness: 0.3 },
              getScene(),
            ),
        };
        if (!Object.hasOwn(builders, type))
          throw new TypeError("Unknown primitive type: " + type);
        if (id !== undefined && (typeof id !== "string" || !id))
          throw new TypeError("Expected a nonempty entity ID");
        if (id === undefined) {
          do {
            id = type + "_" + Math.random().toString(36).slice(2, 10);
          } while (entities.has(id));
        }
        if (entities.has(id)) throw new Error("Duplicate entity ID: " + id);
        return register(builders[type](), id, id);
      },
      destroy(id) {
        entities.get(id)?.destroy();
      },
      destroyAll() {
        let failed = false,
          failure;
        for (const entity of [...entities.values()]) {
          try {
            entity.destroy();
          } catch (error) {
            if (!failed) {
              failed = true;
              failure = error;
            }
          }
        }
        if (failed) throw failure;
      },
      getEntityCount() {
        return options.getWorld?.()?.count() ?? entities.size;
      },
    };
    // The editor/runtime alone receives register and the map. User scripts get
    // only sceneAPI and EntityHandle instances, which hold no renderer fields.
    return {
      sceneAPI,
      entities,
      register,
      sync,
      stats() {
        const core = options.getWorld?.();
        return {
          sceneBackend: core ? "cpp-wasm" : "javascript",
          nativeEntities: core?.count() || 0,
          nativeSceneSlots: core?.capacity() || 0,
          nativeMatrixUpdates: core?.matrixUpdates() || 0,
        };
      },
      getObject: (id) => {
        const entity = entities.get(id);
        return entity ? handles.get(entity).mesh : null;
      },
    };
  }

  function defineScript(script) {
    if (!script || typeof script !== "object")
      throw new TypeError("Expected a script object");
    return script;
  }
  root.ArkGlideRuntime = { createEntityAPI, defineScript };
})(globalThis);
