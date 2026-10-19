// Renderer-independent script handles; Babylon resources stay private and owned.
(function (root) {
  'use strict';
  function create(B, o) {
    const S = root.ArkGlideSpatial, resources = new Set(), materials = new WeakMap(), textures = new WeakMap(), particleRecords = new Map();
    let dead = false, serial = 0, particleScale = 1;
    let limits = { maxVertices: 100000, maxIndices: 600000, maxParticles: 10000, ...o.limits };
    const guard = owner => { if (dead || !owner.record.active || owner.record.destroying) throw Error('Visual resource owner expired'); };
    const object = e => { const m = e && !e.destroyed && o.find(e.id) === e && o.getObject(e.id); if (!m) throw Error('Visual entity absent'); return m; };
    const color = hex => { if (typeof hex !== 'string' || !/^#[\da-f]{6}$/i.test(hex)) throw Error('Expected #RRGGBB color'); return B.Color3.FromHexString(hex); };
    function owned(owner, dispose) {
      guard(owner);
      const r = { live: true, dispose: null };
      const destroy = () => { if (!r.live) return; r.live = false; resources.delete(r); dispose(); off?.(); };
      let off = owner.track(destroy);
      r.dispose = destroy; resources.add(r);
      return { destroy, check() { guard(owner); if (!r.live) throw Error('Visual resource destroyed'); }, get live() { return r.live; } };
    }
    function geometry(data) {
      if (!data || !Array.isArray(data.positions) || !Array.isArray(data.indices) || data.positions.length % 3 || data.indices.length % 3 || data.positions.length < 9 || !data.indices.length || data.positions.length / 3 > limits.maxVertices || data.indices.length > limits.maxIndices || !data.positions.every(Number.isFinite) || !data.indices.every(i => Number.isInteger(i) && i >= 0 && i < data.positions.length / 3)) throw Error('Invalid mesh geometry or geometry budget exceeded');
      for (const [k, n] of [['normals', data.positions.length], ['uvs', data.positions.length / 3 * 2]]) if (data[k] && (!Array.isArray(data[k]) || data[k].length !== n || !data[k].every(Number.isFinite))) throw Error('Invalid mesh ' + k);
      const result = new B.VertexData();
      result.positions = [...data.positions]; result.indices = [...data.indices];
      result.normals = data.normals ? [...data.normals] : [];
      if (!data.normals) {
        const normals = o.renderCompute?.normalData(result.positions, result.indices);
        if (normals) result.normals = normals;
        else B.VertexData.ComputeNormals(result.positions, result.indices, result.normals);
      }
      if (data.uvs) result.uvs = [...data.uvs];
      return result;
    }
    function material(owner, config = {}) {
      guard(owner);
      const native = new B.StandardMaterial('visual:material:' + ++serial, o.scene), assigned = new Map();
      let resource;
      const restore = mesh => {
        const old = assigned.get(mesh);
        if (mesh.material === native) mesh.material = old;
        // If another owned material replaced this one, repair its restoration chain.
        for (const r of materialRecords) for (const [target, previous] of r.assigned) if (target === mesh && previous === native) r.assigned.set(target, old);
        assigned.delete(mesh);
      };
      const record = { native, assigned }; materialRecords.add(record);
      resource = owned(owner, () => { for (const mesh of [...assigned.keys()]) restore(mesh); materialRecords.delete(record); native.dispose(false, false); });
      function update(c) {
        resource.check();
        const allowed = ['color', 'emissive', 'alpha', 'unlit', 'doubleSided', 'wireframe', 'texture', 'emissiveTexture'];
        if (!c || Object.keys(c).some(k => !allowed.includes(k))) throw Error('Unknown material property');
        const prepared = {};
        for (const k of ['color', 'emissive']) if (c[k] !== undefined) prepared[k] = color(c[k]);
        if (c.alpha !== undefined) S.number(c.alpha, 0, 1, 'Invalid material alpha');
        for (const k of ['unlit', 'doubleSided', 'wireframe']) if (c[k] !== undefined && typeof c[k] !== 'boolean') throw Error('Invalid material boolean');
        for (const k of ['texture', 'emissiveTexture']) if (c[k] && !textures.has(c[k])) throw Error('Texture belongs to another session');
        for (const k of ['texture', 'emissiveTexture']) if (c[k]) textures.get(c[k]).check();
        if (prepared.color) native.diffuseColor = prepared.color;
        if (prepared.emissive) native.emissiveColor = prepared.emissive;
        if (c.alpha !== undefined) native.alpha = c.alpha;
        if (c.unlit !== undefined) native.disableLighting = c.unlit;
        if (c.doubleSided !== undefined) native.backFaceCulling = !c.doubleSided;
        if (c.wireframe !== undefined) native.wireframe = c.wireframe;
        for (const [k, field] of [['texture', 'diffuseTexture'], ['emissiveTexture', 'emissiveTexture']]) if (c[k] !== undefined) native[field] = c[k] ? textures.get(c[k]).native : null;
      }
      const handle = Object.freeze({
        get active() { return resource.live; }, update, destroy: resource.destroy,
        apply(e, options = {}) {
          resource.check(); const m = object(e), targets = options.includeChildren ? [m, ...(m.getChildMeshes?.() || [])] : [m];
          for (const target of targets) {
            if (!assigned.has(target)) { assigned.set(target, target.material); target.onDisposeObservable?.addOnce(() => assigned.delete(target)); }
            target.material = native;
          }
        },
        detach(e) { resource.check(); const m = object(e); for (const target of [m, ...(m.getChildMeshes?.() || [])]) if (assigned.has(target)) restore(target); },
      });
      materials.set(handle, { native, resource });
      try { update(config); } catch (error) { resource.destroy(); throw error; }
      return handle;
    }
    const materialRecords = new Set();
    function texture(owner, config) {
      guard(owner);
      const asset = (o.getTextures?.() || []).find(a => a.id === config?.assetId), buffers = o.getTextureBuffers?.(), buffer = buffers instanceof Map ? buffers.get(config?.assetId) : buffers?.[config?.assetId];
      if (!asset || !buffer) throw Error('Project texture asset missing');
      const url = URL.createObjectURL(new Blob([buffer], { type: asset.mime }));
      let native, resolve, reject, settled = false;
      const ready = new Promise((a, b) => { resolve = a; reject = b; }); ready.catch(() => {});
      const settle = error => { if (settled) return; settled = true; URL.revokeObjectURL(url); error ? reject(error) : resolve(handle); };
      const r = owned(owner, () => {
        for (const item of materialRecords) for (const field of ['diffuseTexture', 'emissiveTexture']) if (item.native[field] === native) item.native[field] = null;
        for (const [system,record] of particleRecords) if (system.particleTexture === native) record.destroy();
        native?.dispose(); settle(new Error('Texture load canceled'));
      });
      const handle = Object.freeze({ ready, get active() { return r.live; }, destroy: r.destroy });
      try {
        native = new B.Texture(url, o.scene, false, config.invertY ?? true, B.Texture.TRILINEAR_SAMPLINGMODE,
          () => settle(), message => { settle(Error(message || 'Texture decode failed')); r.destroy(); }, undefined, false, undefined, asset.mime);
        textures.set(handle, { native, check: r.check });
        if (!r.live) native.dispose();
      } catch (error) { r.destroy(); throw error; }
      return handle;
    }
    function meshHandle(owner, native, config = {}) {
      let entity;
      try { if (config.parent) native.parent = object(config.parent); native.metadata={...native.metadata,arkglideTransient:true}; entity = o.register(native, config.id || 'visual:' + ++serial, config.name || native.name); }
      catch (error) { native.dispose(false, false); throw error; }
      const r = owned(owner, () => entity.destroy());
      native.onDisposeObservable?.addOnce(r.destroy);
      const check = () => { r.check(); object(entity); };
      const handle = Object.freeze({ entity, get active() { return r.live && !entity.destroyed; },
        updateGeometry(data) { check(); const g = geometry(data); g.applyToMesh(native, true); },
        setMaterial(m) { check(); if (!materials.has(m)) throw Error('Invalid material handle'); m.apply(entity); },
        setPose(pose) { check(); S.vec(pose.position); S.quat(pose.rotation); S.write(B, native, pose.position, pose.rotation); }, destroy: r.destroy });
      try { if (config.material) handle.setMaterial(config.material); if (config.pose) handle.setPose(config.pose); }
      catch (error) { r.destroy(); throw error; }
      return handle;
    }
    function mesh(owner, data, config = {}) { guard(owner); const g = geometry(data), native = new B.Mesh(config.name || 'visual:mesh', o.scene); g.applyToMesh(native, true); return meshHandle(owner, native, config); }
    function beamData(options) {
      const radius = S.number(options.radius, Number.MIN_VALUE, Infinity, 'Beam radius must be positive'), sides = options.sides ?? 12;
      if (!Number.isInteger(sides) || sides < 3 || !Array.isArray(options.segments) || !options.segments.length || options.segments.length * sides * 2 > limits.maxVertices) throw Error('Invalid beam segments or budget');
      const positions = [], indices = [];
      for (const segment of options.segments) {
        S.vec(segment.origin); S.vec(segment.end);
        const start = new B.Vector3(segment.origin.x, segment.origin.y, segment.origin.z), end = new B.Vector3(segment.end.x, segment.end.y, segment.end.z), direction = end.subtract(start);
        if (direction.lengthSquared() === 0) continue;
        direction.normalize(); const u = B.Vector3.Cross(direction, Math.abs(direction.y) < 0.9 ? B.Axis.Y : B.Axis.X).normalize(), v = B.Vector3.Cross(direction, u), base = positions.length / 3;
        for (const p of [start, end]) for (let i = 0; i < sides; i++) { const a = i / sides * Math.PI * 2, point = p.add(u.scale(Math.cos(a) * radius)).add(v.scale(Math.sin(a) * radius)); positions.push(point.x, point.y, point.z); }
        for (let i = 0; i < sides; i++) { const n = (i + 1) % sides; indices.push(base+i, base+n, base+sides+i, base+n, base+sides+n, base+sides+i); }
        for (let i = 1; i < sides - 1; i++) indices.push(base, base+i+1, base+i, base+sides, base+sides+i, base+sides+i+1);
      }
      if (!indices.length) throw Error('Beam needs a nonzero segment');
      return { positions, indices };
    }
    function beam(owner, options) {
      guard(owner);
      const data = beamData(options); geometry(data);
      const m = options.material || material(owner, { color: options.color, emissive: options.color, unlit: true });
      let handle;
      try { handle = mesh(owner,data,{...options,material:m}); }
      catch(error) { if(!options.material)m.destroy(); throw error; }
      if(!options.material)object(handle.entity).onDisposeObservable?.addOnce(m.destroy);
      let config = { ...options };
      return Object.freeze({ entity: handle.entity, get active() { return handle.active; }, update(patch) { const next = { ...config, ...patch }, data = beamData(next); if (patch.color !== undefined) m.update({ color: patch.color, emissive: patch.color }); handle.updateGeometry(data); config = next; }, destroy() { handle.destroy(); if (!options.material) m.destroy(); } });
    }
    function decal(owner, entity, options) {
      guard(owner); const target = object(entity); S.vec(options.position); S.vec(options.normal); S.vec(options.size);
      if ([options.size.x, options.size.y, options.size.z].some(v => v <= 0) || !Number.isFinite(options.angle ?? 0)) throw Error('Invalid decal dimensions');
      const native = B.MeshBuilder.CreateDecal('visual:decal', target, { position: new B.Vector3(options.position.x, options.position.y, options.position.z), normal: new B.Vector3(options.normal.x, options.normal.y, options.normal.z), size: new B.Vector3(options.size.x, options.size.y, options.size.z), angle: options.angle ?? 0 });
      // Preserve its initial world pose while attaching to the moving host.
      const world = native.computeWorldMatrix(true).clone(); native.parent = target;
      const scale = new B.Vector3(), rotation = new B.Quaternion(), position = new B.Vector3(); world.multiply(B.Matrix.Invert(target.computeWorldMatrix(true))).decompose(scale, rotation, position);
      native.position.copyFrom(position); native.rotationQuaternion = rotation; native.scaling.copyFrom(scale);
      const handle = meshHandle(owner, native, options);
      target.onDisposeObservable?.addOnce(handle.destroy);
      return handle;
    }
    function particles(owner, options) {
      guard(owner);
      if (!Number.isInteger(options.capacity) || options.capacity < 1 || options.capacity > limits.maxParticles || !Number.isFinite(options.rate) || options.rate < 0) throw Error('Invalid particle budget/rate');
      for (const k of ['lifetime', 'size']) if (!Array.isArray(options[k]) || options[k].length !== 2 || !options[k].every(v => Number.isFinite(v) && v > 0) || options[k][0] > options[k][1]) throw Error('Invalid particle ' + k);
      S.vec(options.velocity?.min); S.vec(options.velocity?.max);
      if (['x','y','z'].some(k => options.velocity.min[k] > options.velocity.max[k])) throw Error('Invalid particle velocity range');
      const colors = options.colors.map(color); if (colors.length !== 2) throw Error('Particles need two colors');
      if (options.texture && !textures.has(options.texture)) throw Error('Invalid particle texture');
      if (!['cpu','gpu','auto'].includes(options.backend ?? 'cpu') || !['standard','additive','multiply'].includes(options.blendMode ?? 'additive')) throw Error('Invalid particle backend or blend mode');
      if (options.gravity) S.vec(options.gravity);
      if (options.emitBox) { S.vec(options.emitBox.min); S.vec(options.emitBox.max); if (['x','y','z'].some(k=>options.emitBox.min[k]>options.emitBox.max[k])) throw Error('Invalid particle emitter box'); }
      if (options.angularSpeed && (!Array.isArray(options.angularSpeed) || options.angularSpeed.length!==2 || !options.angularSpeed.every(Number.isFinite) || options.angularSpeed[0]>options.angularSpeed[1])) throw Error('Invalid particle angular speed');
      const gpu = options.backend !== undefined && options.backend !== 'cpu' && o.scene.getEngine().webGLVersion >= 2 && B.GPUParticleSystem?.IsSupported;
      const backend = gpu ? 'gpu' : 'cpu';
      const system = gpu ? new B.GPUParticleSystem('visual:particles:' + ++serial, {capacity:options.capacity,randomTextureSize:256}, o.scene)
        : new B.ParticleSystem('visual:particles:' + ++serial, options.capacity, o.scene);
      let white;
      try {
        if (options.texture) { textures.get(options.texture).check(); system.particleTexture = textures.get(options.texture).native; }
        else system.particleTexture = white = B.RawTexture.CreateRGBATexture(new Uint8Array([255,255,255,255]), 1, 1, o.scene, false, false, B.Texture.NEAREST_SAMPLINGMODE);
        system.emitter = options.entity ? object(options.entity) : new B.Vector3(options.position?.x || 0, options.position?.y || 0, options.position?.z || 0);
        if (options.position) S.vec(options.position);
        system.emitRate = options.rate; [system.minLifeTime,system.maxLifeTime] = options.lifetime; [system.minSize,system.maxSize] = options.size;
        system.color1 = new B.Color4(colors[0].r,colors[0].g,colors[0].b,1); system.color2 = new B.Color4(colors[1].r,colors[1].g,colors[1].b,1);
        const vec = p => new B.Vector3(p.x,p.y,p.z);
        const emitter = system.createBoxEmitter(vec(options.velocity.min),vec(options.velocity.max));
        emitter.minEmitBox = options.emitBox ? vec(options.emitBox.min) : B.Vector3.Zero();
        emitter.maxEmitBox = options.emitBox ? vec(options.emitBox.max) : B.Vector3.Zero();
        system.gravity.copyFrom(options.gravity ? vec(options.gravity) : B.Vector3.Zero());
        system.blendMode = {standard:B.ParticleSystem.BLENDMODE_STANDARD,additive:B.ParticleSystem.BLENDMODE_ADD,multiply:B.ParticleSystem.BLENDMODE_MULTIPLY}[options.blendMode ?? 'additive'];
        if (options.angularSpeed) [system.minAngularSpeed,system.maxAngularSpeed]=options.angularSpeed;
        // Existing scripts used world-space velocity callbacks. Explicit new backends
        // use the native emitter space, including emitter rotation, on both paths.
        if (!gpu && options.backend === undefined) {
          system.startDirectionFunction = (_matrix,direction) => { for (const k of ['x','y','z']) direction[k]=options.velocity.min[k]+Math.random()*(options.velocity.max[k]-options.velocity.min[k]); };
        }
      } catch (error) { system.dispose(false); white?.dispose(); throw error; }
      const r = owned(owner, () => { particleRecords.delete(system); system.dispose(false); white?.dispose(); });
      const speed = system.updateSpeed;
      particleRecords.set(system, {destroy:r.destroy,speed}); system.updateSpeed = speed * particleScale;
      const handle = Object.freeze({ backend, get active() { return r.live; }, start() { r.check(); system.start(); }, stop() { r.check(); system.stop(); }, destroy: r.destroy });
      if (options.entity) object(options.entity).onDisposeObservable?.addOnce(r.destroy);
      system.start(); return handle;
    }
    return { forOwner(owner) { guard(owner); return Object.freeze({ createMaterial: c => material(owner,c), createTexture: c => texture(owner,c), createMesh: (d,c) => mesh(owner,d,c), createBeam: c => beam(owner,c), createDecal: (e,c) => decal(owner,e,c), createParticles: c => particles(owner,c), setLimits(patch) { guard(owner); const next = { ...limits,...patch }; if (Object.keys(patch).some(k => !Object.hasOwn(limits,k)) || !Object.values(next).every(n => Number.isInteger(n) && n > 0)) throw Error('Invalid visual budgets'); limits = next; } }); }, setScale(value) { if (!Number.isFinite(value) || value < 0) throw Error('Invalid particle time scale'); particleScale = value; for (const [system,record] of particleRecords) system.updateSpeed = record.speed * value; }, stats: () => ({ visualResources: resources.size, gpuParticleSystems: [...particleRecords.keys()].filter(p=>p.getClassName()==='GPUParticleSystem').length, cpuParticleSystems: [...particleRecords.keys()].filter(p=>p.getClassName()!=='GPUParticleSystem').length }), dispose() { if (dead) return; for (const r of [...resources]) r.dispose(); dead = true; } };
  }
  root.ArkGlideVisuals = { create };
})(globalThis);
