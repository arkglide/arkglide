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
    const transformScratch = new Float64Array(11),
      pendingSync = [];
    let syncCore,
      syncCapacity = 0,
      syncIds,
      syncData;
    let boundsCore,
      boundsCapacity = 0,
      boundsIds,
      boundsData,
      boundsOutput,
      boundsLength = -1,
      boundsRevision = -1,
      boundsEpoch = 0,
      boundsCacheHits = 0;
    let boundsDecisionFrame = -1,
      boundsDecisionThreshold = -1,
      boundsUseNative = true,
      boundsLastMatrices = 0;
    const compatibleNodes = new WeakMap(),
      compatibleChain = [];
    function readTransform(n, t, at = 0) {
      const p = n.position,
        r = n.rotationQuaternion || n.rotation,
        s = n.scaling;
      t[at] = p.x;
      t[at + 1] = p.y;
      t[at + 2] = p.z;
      t[at + 3] = r.x;
      t[at + 4] = r.y;
      t[at + 5] = r.z;
      t[at + 6] = n.rotationQuaternion ? r.w : 0;
      t[at + 7] = s.x;
      t[at + 8] = s.y;
      t[at + 9] = s.z;
      t[at + 10] = n.rotationQuaternion ? 1 : 0;
    }
    function changedTransform(h) {
      const t = h.syncedTransform,
        n = h.mesh,
        p = n.position,
        r = n.rotationQuaternion || n.rotation,
        s = n.scaling;
      return (
        !t ||
        t[0] !== p.x ||
        t[1] !== p.y ||
        t[2] !== p.z ||
        t[3] !== r.x ||
        t[4] !== r.y ||
        t[5] !== r.z ||
        t[6] !== (n.rotationQuaternion ? r.w : 0) ||
        t[7] !== s.x ||
        t[8] !== s.y ||
        t[9] !== s.z ||
        t[10] !== (n.rotationQuaternion ? 1 : 0)
      );
    }
    function rememberTransform(h, t, at = 0) {
      const cache =
        h.syncedTransform || (h.syncedTransform = new Float64Array(11));
      for (let i = 0; i < 11; i++) cache[i] = t[at + i];
    }
    function parentId(h) {
      const parent = entities.get(h.mesh.parent?.metadata?.arkglideId),
        p = parent && handles.get(parent);
      return p && p.mesh === h.mesh.parent && p.native === h.native
        ? p.nativeId
        : 0;
    }
    function syncEntity(entity) {
      const h = handles.get(entity);
      if (!h?.native || !h.mesh) return;
      const t = transformScratch;
      // Physics and animation can mutate Babylon objects without the facade.
      // Compare live values on every query, but cross into WASM only if dirty.
      if (changedTransform(h)) {
        readTransform(h.mesh, t);
        const ok = t[10]
          ? h.native.transformQuaternion(
              h.nativeId,
              t[0],
              t[1],
              t[2],
              t[3],
              t[4],
              t[5],
              t[6],
              t[7],
              t[8],
              t[9],
            )
          : h.native.transform(
              h.nativeId,
              t[0],
              t[1],
              t[2],
              t[3],
              t[4],
              t[5],
              t[7],
              t[8],
              t[9],
            );
        if (!ok) throw Error("Invalid logical entity transform");
        rememberTransform(h, t);
      }
      const parent = parentId(h);
      if (h.syncedParent !== parent) {
        if (!h.native.setParent(h.nativeId, parent))
          throw Error("Invalid logical scene hierarchy");
        h.syncedParent = parent;
      }
    }
    function sync() {
      const core = options.getWorld?.();
      if (
        !core?.applySync ||
        entities.size < (options.getBatchMinEntities?.() ?? 32)
      ) {
        for (const e of entities.values()) syncEntity(e);
        return;
      }
      if (syncCore !== core) {
        syncCore = core;
        syncCapacity = 0;
        syncIds = syncData = null;
      }
      if (entities.size > syncCapacity) {
        syncCapacity = Math.max(entities.size, syncCapacity * 2);
        core.reserveSync(syncCapacity);
        syncIds = syncData = null;
      }
      if (!syncIds?.buffer.byteLength) syncIds = core.syncIdsView();
      if (!syncData?.buffer.byteLength) syncData = core.syncDataView();
      pendingSync.length = 0;
      for (const entity of entities.values()) {
        const h = handles.get(entity);
        if (h.native !== core || !h.mesh) {
          syncEntity(entity);
          if (!syncIds.buffer.byteLength) syncIds = core.syncIdsView();
          if (!syncData.buffer.byteLength) syncData = core.syncDataView();
          continue;
        }
        const at = pendingSync.length * 11,
          parent = parentId(h);
        if (!changedTransform(h) && h.syncedParent === parent) continue;
        readTransform(h.mesh, syncData, at);
        syncIds[pendingSync.length * 2] = h.nativeId;
        syncIds[pendingSync.length * 2 + 1] = parent;
        pendingSync.push(h);
      }
      if (pendingSync.length) {
        if (!core.applySync(pendingSync.length)) {
          pendingSync.length = 0;
          throw Error("Invalid logical scene transform batch");
        }
        // Native validation/hierarchy allocations can grow the WASM heap.
        if (!syncIds.buffer.byteLength) syncIds = core.syncIdsView();
        if (!syncData.buffer.byteLength) syncData = core.syncDataView();
        for (let i = 0; i < pendingSync.length; i++) {
          rememberTransform(pendingSync[i], syncData, i * 11);
          pendingSync[i].syncedParent = syncIds[i * 2 + 1];
        }
        pendingSync.length = 0;
      }
      core.update();
    }
    function compatibleTransform(node) {
      compatibleChain.length = 0;
      let current = node,
        valid = true;
      while (current && compatibleNodes.get(current)?.epoch !== boundsEpoch) {
        const entity = entities.get(current.metadata?.arkglideId),
          h = entity && handles.get(entity),
          proto = Babylon.TransformNode.prototype;
        if (
          !h?.native ||
          h.native !== boundsCore ||
          h.mesh !== current ||
          current.isDisposed() ||
          current.computeWorldMatrix !== proto.computeWorldMatrix ||
          (current._afterComputeWorldMatrix !==
            proto._afterComputeWorldMatrix &&
            current._afterComputeWorldMatrix !==
              Babylon.AbstractMesh.prototype._afterComputeWorldMatrix &&
            current._afterComputeWorldMatrix !==
              Babylon.Mesh.prototype._afterComputeWorldMatrix) ||
          (current._getEffectiveParent !== proto._getEffectiveParent &&
            current._getEffectiveParent !==
              Babylon.AbstractMesh.prototype._getEffectiveParent) ||
          current.isWorldMatrixFrozen ||
          current._masterMesh ||
          current._transformToBoneReferal ||
          current.isUsingPivotMatrix() ||
          current.isWorldMatrixCameraDependent() ||
          current.scalingDeterminant !== 1 ||
          current.reIntegrateRotationIntoRotationQuaternion ||
          current.onAfterWorldMatrixUpdateObservable?.hasObservers()
        ) {
          const entry = compatibleNodes.get(current) || {};
          entry.epoch = boundsEpoch;
          entry.valid = false;
          compatibleNodes.set(current, entry);
          valid = false;
          break;
        }
        compatibleChain.push(current);
        current = current.parent;
      }
      if (current && compatibleNodes.get(current)?.epoch === boundsEpoch)
        valid = compatibleNodes.get(current).valid;
      for (const item of compatibleChain) {
        const entry = compatibleNodes.get(item) || {};
        entry.epoch = boundsEpoch;
        entry.valid = valid;
        compatibleNodes.set(item, entry);
      }
      return valid;
    }
    // Engine-only batch query. No native views or renderer objects are exposed
    // through the script-facing scene API. Unknown transforms return NaN boxes.
    function worldBounds(
      meshes,
      length = meshes.length,
      minChangedFraction = 0,
      frame = -1,
    ) {
      const core = options.getWorld?.();
      if (!core?.gatherBounds) return null;
      if (boundsCore !== core) {
        boundsCore = core;
        boundsCapacity = 0;
        boundsIds = boundsData = boundsOutput = null;
        boundsLength = -1;
        boundsRevision = -1;
        boundsDecisionFrame = -1;
        boundsLastMatrices = 0;
      }
      const decisionValid =
        boundsCore === core &&
        boundsDecisionFrame === frame &&
        boundsDecisionThreshold === minChangedFraction;
      // A fallback decision can serve every view in this frame: Babylon still
      // checks live transforms, including changes made between two views.
      if (minChangedFraction > 0 && decisionValid && !boundsUseNative)
        return null;
      sync();
      if (minChangedFraction > 0 && !decisionValid) {
        core.update();
        const matrices = core.matrixUpdates();
        boundsUseNative =
          (matrices - boundsLastMatrices) / Math.max(1, entities.size) >=
          minChangedFraction;
        boundsLastMatrices = matrices;
        boundsDecisionFrame = frame;
        boundsDecisionThreshold = minChangedFraction;
        if (!boundsUseNative) return null;
      }
      if (length > boundsCapacity) {
        boundsCapacity = Math.max(length, boundsCapacity * 2);
        core.reserveBounds(boundsCapacity);
        boundsIds = boundsData = boundsOutput = null;
      }
      if (!boundsIds?.buffer.byteLength) boundsIds = core.boundsIdsView();
      if (!boundsData?.buffer.byteLength) boundsData = core.boundsDataView();
      boundsEpoch++;
      try {
        let known = 0;
        const revision = core.changeRevision();
        let dirty =
          boundsLength !== length ||
          boundsRevision !== revision ||
          !boundsOutput;
        for (let i = 0; i < length; i++) {
          const mesh = meshes[i],
            info = mesh?._boundingInfo;
          if (
            !info ||
            info.isLocked ||
            mesh._masterMesh ||
            mesh.skeleton ||
            mesh.morphTargetManager ||
            mesh.hasThinInstances ||
            mesh.hasInstances ||
            mesh.isAnInstance ||
            mesh.doNotSyncBoundingInfo ||
            mesh.getBoundingInfo !==
              Babylon.AbstractMesh.prototype.getBoundingInfo ||
            mesh._updateBoundingInfo !==
              Babylon.AbstractMesh.prototype._updateBoundingInfo ||
            !compatibleTransform(mesh)
          ) {
            if (boundsIds[i] !== 0) dirty = true;
            boundsIds[i] = 0;
            continue;
          }
          const entity = entities.get(mesh.metadata?.arkglideId),
            h = handles.get(entity),
            box = info.boundingBox,
            at = i * 6;
          if (boundsIds[i] !== h.nativeId) dirty = true;
          boundsIds[i] = h.nativeId;
          known++;
          const min = box.minimum,
            max = box.maximum;
          if (
            boundsData[at] !== min.x ||
            boundsData[at + 1] !== min.y ||
            boundsData[at + 2] !== min.z ||
            boundsData[at + 3] !== max.x ||
            boundsData[at + 4] !== max.y ||
            boundsData[at + 5] !== max.z
          ) {
            dirty = true;
            boundsData[at] = min.x;
            boundsData[at + 1] = min.y;
            boundsData[at + 2] = min.z;
            boundsData[at + 3] = max.x;
            boundsData[at + 4] = max.y;
            boundsData[at + 5] = max.z;
          }
        }
        if (!known) return null;
        if (dirty) {
          if (!core.gatherBounds(length))
            throw Error("Invalid logical bounds batch");
          boundsOutput = core.boundsOutputView();
          boundsLength = length;
          boundsRevision = revision;
        } else {
          if (!boundsOutput.buffer.byteLength)
            boundsOutput = core.boundsOutputView();
          boundsCacheHits++;
        }
        return boundsOutput;
      } finally {
        compatibleChain.length = 0;
      }
    }
    function releaseNative(h) {
      if (h.native) {
        h.native.erase(h.nativeId);
        nativeEntities.delete(h.nativeId);
        if (!nativeEntities.size) {
          boundsCacheHits = 0;
          boundsLength = -1;
          boundsRevision = -1;
          boundsDecisionFrame = -1;
          boundsLastMatrices = 0;
        }
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

    // The native view stays private and is consumed before any other WASM
    // allocation. Position queries copy three scalars instead of a 16-value
    // matrix; getWorldMatrix still returns an independent script-owned array.
    function worldMatrix(entity) {
      const math = getMath(),
        mesh = meshOf(entity),
        h = handles.get(entity);
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
          return h.native.world(h.nativeId);
        }
      }
      if (!math) return mesh.computeWorldMatrix(true).m;
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
        return Array.from(worldMatrix(this));
      }
      getWorldPosition() {
        const matrix = worldMatrix(this);
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
      worldBounds,
      stats() {
        const core = options.getWorld?.();
        return {
          sceneBackend: core ? "cpp-wasm" : "javascript",
          nativeEntities: core?.count() || 0,
          nativeSceneSlots: core?.capacity() || 0,
          nativeMatrixUpdates: core?.matrixUpdates() || 0,
          nativeTransformBatches: core?.transformBatches() || 0,
          nativeTransformWrites: core?.transformWrites() || 0,
          nativeBoundsBatches: core?.boundBatches() || 0,
          nativeBoundsUpdates: core?.boundUpdates() || 0,
          nativeBoundsEntries: core?.boundEntries() || 0,
          nativeBoundsCacheHits: boundsCacheHits,
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
