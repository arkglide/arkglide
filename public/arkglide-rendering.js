// Babylon lighting resources owned by a scene adapter, shared by all hosts.
(function (root) {
  "use strict";
  function create(B, scene, options = {}) {
    const C = root.ArkGlideRenderingConfig, engine = scene.getEngine(), shadows = new Map();
    let config = C.settings(), content = {}, buffers = new Map(), active = false, dead = false, dirty = true;
    let environment = null, skybox = null, skyboxTexture = null, signature = "";
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
      if (!texture || !config.environment.skybox || skyboxTexture !== texture) disposeSkybox();
      if (texture && config.environment.skybox && !skybox) {
        skybox = scene.createDefaultSkybox(texture, true, 1000, 0, false);
        if (skybox) {
          skybox.isPickable = false;
          skybox.metadata = { arkglideRenderInternal: true };
          skybox.infiniteDistance = true;
          skyboxTexture = texture;
        }
      }
    }
    function releaseEnvironment() {
      disposeSkybox();
      if (!environment) return;
      const slot = environment; environment = null;
      if (scene.environmentTexture === slot.texture) scene.environmentTexture = null;
      slot.texture?.dispose(); slot.finish();
    }
    function syncEnvironment() {
      const id = config.environment.textureId;
      const asset = content.textures?.find(t => t.id === id);
      const buffer = buffers instanceof Map ? buffers.get(id) : buffers[id];
      if (environment && (environment.id !== id || environment.buffer !== buffer)) releaseEnvironment();
      if (!id) { releaseEnvironment(); applyEnvironment(); return Promise.resolve(); }
      if (!asset || !buffer) return Promise.reject(Error("环境贴图数据缺失: " + id));
      if (!environment) {
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
        options.onLoading?.(1); environment = slot;
        const loaded = () => { if (!dead && environment === slot) applyEnvironment(); slot.finish(); };
        const failed = (message) => { const e = Error("环境贴图解码失败: " + (message || id)); slot.finish(e); report(e); };
        try {
          slot.texture = asset.mime === "image/vnd.radiance"
            ? new B.HDRCubeTexture(url, scene, 128, false, true, false, true, loaded, failed)
            : new B.CubeTexture(url, scene, null, false, null, loaded, failed, undefined, true, ".env");
          slot.texture.name = "arkglide:environment:" + id;
          slot.texture.gammaSpace = false;
          // Some engines can finish a cached texture synchronously.
          if (slot.texture.isReady()) loaded();
        } catch (error) { slot.finish(error); releaseEnvironment(); return promise; }
      }
      applyEnvironment();
      return environment?.promise || Promise.resolve();
    }
    function applyColor() {
      const c = scene.imageProcessingConfiguration;
      c.exposure = config.color.exposure;
      c.contrast = config.color.contrast;
      c.toneMappingEnabled = config.color.toneMapping !== "none";
      c.toneMappingType = config.color.toneMapping === "aces" ? B.ImageProcessingConfiguration.TONEMAPPING_ACES : B.ImageProcessingConfiguration.TONEMAPPING_STANDARD;
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
      const lights = s.enabled ? scene.lights.filter(light => {
        const f = flags(light);
        return f && f.castShadows !== false && light.isEnabled() && light.getClassName() !== "HemisphericLight";
      }).slice(0, s.maxLights) : [];
      for (const [light, slot] of shadows) if (!lights.includes(light)) { slot.generator.dispose(); shadows.delete(light); }
      const meshes = scene.meshes.filter(mesh => !mesh.isDisposed() && !mesh.metadata?.arkglideRenderInternal && mesh.getTotalVertices() > 0 && flags(mesh));
      for (const mesh of meshes) mesh.receiveShadows = flags(mesh).receiveShadows !== false;
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
    watch(scene.onBeforeRenderObservable, () => { if (active && dirty && !dead) updateShadows(); });
    function clear() {
      active = false; dirty = true; signature = "";
      clearShadows(); releaseEnvironment();
      content = {}; buffers = new Map();
    }
    return {
      configure(input) { if (dead) throw Error("Rendering disposed"); config = C.settings(input); dirty = true; applyColor(); },
      sync(nextContent = {}, nextBuffers = new Map()) {
        if (dead) return Promise.resolve();
        content = nextContent; buffers = nextBuffers; active = true; dirty = true;
        return syncEnvironment();
      },
      invalidate,
      settings: () => structuredClone(config),
      stats: () => ({ shadowLights: shadows.size, environmentTextures: environment ? 1 : 0, shadowFilters: [...shadows.values()].map(s => s.filter) }),
      clear,
      dispose() { if (dead) return; clear(); dead = true; for (const remove of observers) remove(); },
    };
  }
  root.ArkGlideRendering = { create };
})(globalThis);
