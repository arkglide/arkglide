// Babylon lighting resources owned by a scene adapter, shared by all hosts.
(function (root) {
  "use strict";
  function create(B, scene, options = {}) {
    const C = root.ArkGlideRenderingConfig, engine = scene.getEngine(), shadows = new Map();
    const atmosphere = root.ArkGlideAtmosphere?.create(B, scene);
    const baseHardwareScale = engine.getHardwareScalingLevel(), instrumentation = new B.SceneInstrumentation(scene);
    let gpu = null, gpuStartCount = 0, frameOpen = false, frameStarted = 0, offscreenDraws = 0, drawCalls = 0, mainTriangles = 0, cpuSubmitMs = 0;
    let config = C.settings(), content = {}, buffers = new Map(), active = false, dead = false, dirty = true;
    let environment = null, skybox = null, skyboxTexture = null, signature = "", syncGeneration = 0;
    const cubes = new Map(), probeTextures = new Map(), variants = new Map(), assignments = new Map(), variantSources = new WeakMap();
    let probeMeshes = [], probesReady = false, ao = null, pipeline = null, byteColor = null, postCamera = null, postSignature = "", dofDepth = null;
    const observers = [];
    function watch(observable, fn) { const token = observable.add(fn); observers.push(() => observable.remove(token)); }
    function invalidate() { dirty = true; }
    function report(error) { options.onError?.({ id: "rendering", name: "场景渲染", type: "rendering" }, error); }
    function flags(node) {
      for (let n = node; n; n = n.parent) if (n.metadata?.arkglideRendering) return n.metadata.arkglideRendering;
      return null;
    }
    function disposeSkybox() {
      skybox?.dispose(false, true); skybox = null; skyboxTexture = null;
    }
    function applyEnvironment() {
      const texture = environment?.texture || null;
      scene.environmentTexture = texture;
      scene.environmentIntensity = config.environment.intensity;
      if (texture) texture.rotationY = config.environment.rotation;
      if (!texture || !config.environment.skybox || config.sky.enabled || skyboxTexture !== texture) disposeSkybox();
      if (texture && config.environment.skybox && !config.sky.enabled && !skybox) {
        skybox = scene.createDefaultSkybox(texture, true, 1000, 0, false);
        if (skybox) {
          skybox.isPickable = false;
          skybox.metadata = { arkglideRenderInternal: true };
          skybox.infiniteDistance = true;
          skyboxTexture = texture;
        }
      }
      if (skybox?.material?.reflectionTexture) skybox.material.reflectionTexture.rotationY = config.environment.rotation;
    }
    function releaseCube(id, slot) {
      cubes.delete(id);
      if (environment === slot) { disposeSkybox(); scene.environmentTexture = null; environment = null; }
      slot.texture?.dispose(); slot.finish();
    }
    function cube(id) {
      const asset = content.textures?.find(t => t.id === id);
      const buffer = buffers instanceof Map ? buffers.get(id) : buffers[id];
      let old = cubes.get(id);
      if (old && old.buffer !== buffer) { releaseCube(id, old); old = null; }
      if (!asset || !buffer) throw Error("环境贴图数据缺失: " + id);
      if (!old) {
        let resolve, reject, settled = false;
        const promise = new Promise((a, b) => { resolve = a; reject = b; });
        promise.catch(() => {});
        const url = URL.createObjectURL(new Blob([buffer], { type: asset.mime }));
        const slot = { id, buffer, texture: null, promise, finish(error) {
          if (settled) return; settled = true;
          URL.revokeObjectURL(url);
          options.onLoading?.(-1);
          if (error) reject(error); else resolve();
        } };
        options.onLoading?.(1); cubes.set(id, slot);
        const loaded = () => { if (!dead && cubes.get(id) === slot && environment === slot) applyEnvironment(); slot.finish(); };
        const failed = (message) => { const e = Error("环境贴图解码失败: " + (message || id)); slot.finish(e); report(e); };
        try {
          slot.texture = asset.mime === "image/vnd.radiance"
            ? new B.HDRCubeTexture(url, scene, 128, false, true, false, true, loaded, failed)
            : new B.CubeTexture(url, scene, null, false, null, loaded, failed, undefined, true, ".env");
          slot.texture.name = "arkglide:environment:" + id;
          slot.texture.gammaSpace = false;
          // Some engines can finish a cached texture synchronously.
          if (slot.texture.isReady()) loaded();
        } catch (error) { slot.finish(error); }
        old = slot;
      }
      return old;
    }
    function clearVariants() {
      for (const [mesh, record] of assignments) if (!mesh.isDisposed() && mesh.material === record.assigned) mesh.material = record.base;
      for (const mesh of scene.meshes) if (variantSources.has(mesh.material)) mesh.material = variantSources.get(mesh.material);
      assignments.clear();
      for (const map of variants.values()) for (const material of map.values()) material.dispose(false, false);
      variants.clear();
    }
    function clearProbes() {
      probesReady = false; clearVariants();
      for (const texture of probeTextures.values()) texture.dispose();
      probeTextures.clear(); probeMeshes = [];
    }
    async function syncCubes() {
      const generation = ++syncGeneration;
      clearProbes();
      const ids = new Set(config.probes.map(p => p.textureId));
      if (config.environment.textureId) ids.add(config.environment.textureId);
      for (const [id, slot] of cubes) if (!ids.has(id)) releaseCube(id, slot);
      const slots = [...ids].map(cube);
      environment = config.environment.textureId ? cubes.get(config.environment.textureId) : null;
      applyEnvironment();
      await Promise.all(slots.map(slot => slot.promise));
      if (dead || generation !== syncGeneration) return;
      for (const p of config.probes) {
        const texture = cubes.get(p.textureId).texture.clone();
        texture.name = "arkglide:probe:" + p.id;
        texture.rotationY = 0;
        texture.boundingBoxPosition = new B.Vector3(p.position.x, p.position.y, p.position.z);
        texture.boundingBoxSize = new B.Vector3(p.size.x, p.size.y, p.size.z);
        texture.level = p.intensity;
        probeTextures.set(p.id, texture);
      }
      probesReady = true; dirty = true;
    }
    function variant(base, probeId) {
      base = variantSources.get(base) || base;
      if (!base || (!base.subMaterials && !base.metadata?.arkglideManagedMaterial)) return base;
      let map = variants.get(base);
      if (!map) { map = new Map(); variants.set(base, map); }
      if (map.has(probeId)) return map.get(probeId);
      let material;
      if (base.subMaterials) {
        const parts = base.subMaterials.map(m => variant(m, probeId));
        if (parts.every((m, i) => m === base.subMaterials[i])) return base;
        material = new B.MultiMaterial(base.name + ":probe:" + probeId, scene);
        material.subMaterials = parts;
      } else {
        // Instanciate shares source textures instead of allocating copies per probe.
        material = B.SerializationHelper.Instanciate(() => new B.PBRMaterial(base.name + ":probe:" + probeId, scene), base);
        material.reflectionTexture = probeTextures.get(probeId);
      }
      material.metadata = { ...base.metadata, arkglideProbeVariant: true };
      variantSources.set(material, base);
      map.set(probeId, material);
      return material;
    }
    function updateProbes() {
      if (!probesReady || !config.probes.length) return;
      for (const mesh of probeMeshes) {
        if (mesh.isDisposed()) { assignments.delete(mesh); continue; }
        mesh.computeWorldMatrix(!mesh.isSynchronized());
        const point = mesh.getBoundingInfo().boundingBox.centerWorld;
        const index = C.selectProbe(point, config.probes);
        const record = assignments.get(mesh);
        const base = record && mesh.material === record.assigned ? record.base : variantSources.get(mesh.material) || mesh.material;
        const material = index < 0 ? base : variant(base, config.probes[index].id);
        if (mesh.material !== material) mesh.material = material;
        if (material !== base) assignments.set(mesh, { base, assigned: material }); else assignments.delete(mesh);
      }
    }
    function clearPost() {
      byteColor?.dispose(postCamera); byteColor = null;
      pipeline?.dispose(); pipeline = null;
      if (dofDepth && scene._depthRenderer?.[dofDepth.camera.uniqueId] === dofDepth.renderer) scene.disableDepthRenderer(dofDepth.camera);
      dofDepth = null;
      ao?.dispose(true); ao = null; postCamera = null; postSignature = "";
      scene.imageProcessingConfiguration.applyByPostProcess = false;
    }
    function updatePost() {
      const needsPost = config.dof.enabled || config.antialiasing !== "none" || config.bloom.enabled || config.ao.enabled || config.color.toneMapping !== "none" || config.color.exposure !== 1 || config.color.contrast !== 1 || config.color.saturation !== 0 || config.color.tint !== 0;
      const camera = scene.activeCamera, key = JSON.stringify([config.ao, config.bloom, config.dof, needsPost, config.antialiasing, config.samples]);
      if (postCamera === camera && postSignature === key) return;
      clearPost(); postCamera = camera; postSignature = key;
      if (config.ao.enabled && camera && engine.webGLVersion >= 2 && engine.getCaps().drawBuffersExtension) {
        ao = new B.SSAO2RenderingPipeline("arkglide:ao", scene, { ssaoRatio: config.ao.ratio, blurRatio: 1 }, [camera], true);
        ao.radius = config.ao.radius; ao.totalStrength = config.ao.strength; ao.samples = config.ao.samples;
      }
      if (needsPost && camera) {
        const caps = engine.getCaps(), hdr = !!(caps.textureHalfFloatRender || caps.textureFloatRender);
        pipeline = new B.DefaultRenderingPipeline("arkglide:picture", true, scene, [camera], false);
        pipeline.imageProcessingEnabled = hdr;
        pipeline.samples = config.antialiasing === "msaa" ? Math.min(config.samples, caps.maxMSAASamples || 1) : 1;
        pipeline.fxaaEnabled = config.antialiasing === "fxaa" || (config.antialiasing === "msaa" && pipeline.samples === 1);
        pipeline.bloomEnabled = config.bloom.enabled;
        pipeline.bloomThreshold = config.bloom.threshold; pipeline.bloomWeight = config.bloom.weight;
        pipeline.bloomKernel = config.bloom.kernel; pipeline.bloomScale = config.bloom.scale;
        pipeline.depthOfFieldBlurLevel = config.dof.quality;
        pipeline.depthOfFieldEnabled = config.dof.enabled;
        pipeline.depthOfField.focusDistance = config.dof.focusDistance * 1000;
        pipeline.depthOfField.focalLength = config.dof.focalLength;
        pipeline.depthOfField.lensSize = config.dof.focalLength;
        pipeline.depthOfField.fStop = config.dof.fStop;
        const previousDepth = scene._depthRenderer?.[camera.uniqueId];
        pipeline.prepare();
        if (config.dof.enabled && !previousDepth && scene._depthRenderer?.[camera.uniqueId]) {
          dofDepth = { camera, renderer: scene._depthRenderer[camera.uniqueId] };
          dofDepth.renderer.useOnlyInActiveCamera = true;
        }
        if (!hdr) byteColor = new B.ImageProcessingPostProcess("arkglide:color", 1, camera, B.Texture.BILINEAR_SAMPLINGMODE, engine, false, B.Constants.TEXTURETYPE_UNSIGNED_BYTE, scene.imageProcessingConfiguration);
        scene.imageProcessingConfiguration.applyByPostProcess = true;
      }
    }
    function applyColor() {
      const c = scene.imageProcessingConfiguration;
      c.exposure = config.color.exposure;
      c.contrast = config.color.contrast;
      c.toneMappingEnabled = config.color.toneMapping !== "none";
      c.toneMappingType = config.color.toneMapping === "aces" ? B.ImageProcessingConfiguration.TONEMAPPING_ACES : B.ImageProcessingConfiguration.TONEMAPPING_STANDARD;
      if (!c.colorCurves) c.colorCurves = new B.ColorCurves();
      c.colorCurves.globalSaturation = config.color.saturation;
      c.colorCurves.globalHue = config.color.hue;
      c.colorCurves.globalDensity = config.color.tint;
      c.colorCurvesEnabled = config.color.saturation !== 0 || config.color.tint !== 0;
    }
    function clearShadows() {
      for (const slot of shadows.values()) slot.generator.dispose();
      shadows.clear();
    }
    function updateShadows() {
      dirty = false;
      const s = config.shadows, caps = engine.getCaps();
      const key = JSON.stringify(s);
      if (signature !== key) { clearShadows(); signature = key; }
      const lights = shadowLights();
      for (const [light, slot] of shadows) if (!lights.includes(light)) { slot.generator.dispose(); shadows.delete(light); }
      if (!s.enabled && !config.probes.length) { probeMeshes = []; return; }
      const meshes = scene.meshes.filter(mesh => !mesh.isDisposed() && !mesh.metadata?.arkglideRenderInternal && mesh.getTotalVertices() > 0 && flags(mesh));
      probeMeshes = meshes;
      if (s.enabled) for (const mesh of meshes) mesh.receiveShadows = flags(mesh).receiveShadows !== false;
      const casters = meshes.filter(mesh => flags(mesh).castShadows !== false);
      for (const light of lights) {
        let slot = shadows.get(light);
        if (!slot) {
          const generator = new B.ShadowGenerator(Math.min(s.mapSize, caps.maxTextureSize || s.mapSize), light);
          const cube = light.needCube();
          const filter = cube || engine.webGLVersion < 2 ? "poisson" : s.filter;
          generator.usePoissonSampling = filter === "poisson";
          generator.usePercentageCloserFiltering = filter === "pcf";
          generator.useContactHardeningShadow = filter === "pcss";
          generator.filteringQuality = B.ShadowGenerator.QUALITY_MEDIUM;
          generator.bias = s.bias; generator.normalBias = s.normalBias;
          generator.setDarkness(s.darkness);
          slot = { generator, filter }; shadows.set(light, slot);
        }
        light.shadowMinZ = 0.1; light.shadowMaxZ = s.maxDistance;
        slot.generator.getShadowMap().renderList = casters;
      }
    }
    watch(scene.onNewMeshAddedObservable, invalidate);
    watch(scene.onMeshRemovedObservable, invalidate);
    watch(scene.onNewLightAddedObservable, invalidate);
    watch(scene.onLightRemovedObservable, invalidate);
    function shadowLights() {
      return config.shadows.enabled ? scene.lights.filter(light => {
        const f = flags(light);
        return f && f.castShadows !== false && light.isEnabled() && typeof light.needCube === "function" && light.getClassName() !== "HemisphericLight";
      }).slice(0, config.shadows.maxLights) : [];
    }
    function prepareFrame() {
      if (!active || dead) return;
      if (!frameOpen) beginFrame();
      if (!dirty && config.shadows.enabled) {
        const lights = shadowLights();
        if (lights.length !== shadows.size || lights.some(light => !shadows.has(light))) dirty = true;
      }
      if (dirty) updateShadows();
      updateProbes(); updatePost(); atmosphere?.configure(config, !!pipeline);
    }
    function beginFrame() { frameOpen = true; frameStarted = performance.now(); offscreenDraws = 0; }
    function finishFrame() {
      if (!active || !frameOpen) return;
      drawCalls = instrumentation.drawCallsCounter.current + offscreenDraws;
      mainTriangles = Math.floor(scene.getActiveIndices() / 3);
      cpuSubmitMs = performance.now() - frameStarted; frameOpen = false;
    }
    function configure(input) {
      if (dead) throw Error("Rendering disposed");
      config = C.settings(input); dirty = true; applyColor();
      if (engine.getHardwareScalingLevel() !== baseHardwareScale / config.resolutionScale) engine.setHardwareScalingLevel(baseHardwareScale / config.resolutionScale);
      if (config.gpuProfiling && engine.getCaps().timerQuery && !gpu) { gpu = new B.EngineInstrumentation(engine); gpuStartCount = gpu.gpuFrameTimeCounter.count; gpu.captureGPUFrameTime = true; }
      if (!config.gpuProfiling && gpu) { gpu.captureGPUFrameTime = false; gpu.dispose(); gpu = null; }
    }
    watch(scene.onBeforeRenderObservable, prepareFrame);
    watch(scene.onAfterRenderObservable, finishFrame);
    function clear() {
      active = false; dirty = true; signature = "";
      syncGeneration++; clearProbes(); clearPost(); clearShadows();
      atmosphere?.clear();
      for (const [id, slot] of cubes) releaseCube(id, slot);
      if (gpu) { gpu.captureGPUFrameTime = false; gpu.dispose(); gpu = null; }
      engine.setHardwareScalingLevel(baseHardwareScale);
      frameOpen = false; drawCalls = mainTriangles = cpuSubmitMs = offscreenDraws = 0;
      content = {}; buffers = new Map();
    }
    const api = {
      configure,
      sync(nextContent = {}, nextBuffers = new Map()) {
        if (dead) return Promise.resolve();
        configure(config);
        content = nextContent; buffers = nextBuffers; active = true; dirty = true;
        return syncCubes();
      },
      invalidate,
      prepareFrame,
      beginFrame,
      recordOffscreenDraws(count) { offscreenDraws += Math.max(0, count); },
      viewSettings: () => ({ ...config.views }),
      linearOutput: () => !!pipeline,
      settings: () => structuredClone(config),
      stats: () => ({ ...atmosphere?.stats(), dofEnabled: !!pipeline && config.dof.enabled, shadowLights: shadows.size, environmentTextures: cubes.size, shadowFilters: [...shadows.values()].map(s => s.filter), reflectionProbes: probeTextures.size, probeMaterialVariants: [...variants.values()].reduce((n, m) => n + m.size, 0), aoEnabled: !!ao, aoSupported: engine.webGLVersion >= 2 && !!engine.getCaps().drawBuffersExtension, bloomEnabled: !!pipeline && config.bloom.enabled, picturePipelines: pipeline ? 1 : 0, hdrOutput: !!pipeline && !!(engine.getCaps().textureHalfFloatRender || engine.getCaps().textureFloatRender), renderQuality: config.quality, renderResolutionScale: config.resolutionScale, renderDrawCalls: drawCalls, renderMainTriangles: mainTriangles, renderSubmitMs: cpuSubmitMs, gpuTimerSupported: !!engine.getCaps().timerQuery, gpuTimeMs: gpu && gpu.gpuFrameTimeCounter.count > gpuStartCount ? gpu.gpuFrameTimeCounter.current / 1000000 : null }),
      forOwner(owner) {
        const check = () => { if (dead || !owner.record.active || owner.record.destroying) throw Error("Rendering owner expired"); };
        return Object.freeze({ getSettings() { check(); return api.settings(); }, setQuality(name) { check(); configure(C.preset(config, name)); }, getStats() { check(); return api.stats(); } });
      },
      clear,
      dispose() { if (dead) return; clear(); dead = true; instrumentation.dispose(); for (const remove of observers) remove(); if (scene._arkglideRendering === api) delete scene._arkglideRendering; },
    };
    scene._arkglideRendering = api;
    return api;
  }
  root.ArkGlideRendering = { create };
})(globalThis);
