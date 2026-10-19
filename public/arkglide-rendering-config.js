// Shared, renderer-independent validation for editor, runtime and static export.
(function (root) {
  "use strict";
  const defaults = {
    quality: "custom",
    resolutionScale: 1,
    antialiasing: "none",
    samples: 4,
    gpuProfiling: false,
    views: { depth: 2, scale: 1, recursiveScale: 0.75, samples: 4, maxViews: 24, maxPixels: 16777216, minArea: 0.0001, minResolution: 32, particles: false },
    shadows: { enabled: false, mapSize: 1024, filter: "pcf", bias: 0.0005, normalBias: 0.02, darkness: 0, maxDistance: 100, maxLights: 2 },
    environment: { textureId: null, intensity: 1, rotation: 0, skybox: false },
    color: { toneMapping: "none", exposure: 1, contrast: 1, saturation: 0, hue: 30, tint: 0 },
    bloom: { enabled: false, threshold: 1, weight: 0.3, kernel: 32, scale: 0.5 },
    ao: { enabled: false, ratio: 0.5, radius: 1, strength: 1, samples: 8 },
    fog: { mode: "none", color: "#A8BDD0", density: 0.01, start: 10, end: 100 },
    sky: { enabled: false, sunAzimuth: 0, sunElevation: 35, turbidity: 2, rayleigh: 2, mie: 0.005, luminance: 1 },
    dof: { enabled: false, focusDistance: 10, focalLength: 50, fStop: 2.8, quality: 1 },
    reflections: {
      ssr: { enabled: false, maxSteps: 64, step: 1, maxDistance: 100, thickness: 0.2, strength: 1, roughnessFactor: 0, blur: 0.03, downsample: 1 },
      planar: { enabled: false, maxMirrors: 2, maxPixels: 2097152, scale: 0.5 },
    },
    probes: [],
  };
  const environmentMimes = ["application/x-babylon-env", "image/vnd.radiance"];
  const imageMimes = ["image/png", "image/jpeg", "image/webp"];
  function object(v) { return v && typeof v === "object" && !Array.isArray(v); }
  function merge(template, input = {}, path = "rendering") {
    if (!object(input) || Object.keys(input).some(k => !Object.hasOwn(template, k))) throw Error("无效渲染配置: " + path);
    const out = {};
    for (const [key, value] of Object.entries(template)) {
      const next = input[key] === undefined ? value : input[key];
      out[key] = object(value) ? merge(value, next, path + "." + key) : next;
    }
    return out;
  }
  function number(v, min, max, label) {
    if (!Number.isFinite(v) || v < min || v > max) throw Error("无效渲染参数: " + label);
  }
  function settings(input) {
    const c = merge(defaults, input);
    if (!["custom", "low", "medium", "high"].includes(c.quality) || !["none", "fxaa", "msaa"].includes(c.antialiasing) || ![1, 2, 4, 8].includes(c.samples) || typeof c.gpuProfiling !== "boolean") throw Error("无效画质配置");
    number(c.resolutionScale, 0.5, 1.5, "resolution scale");
    if (![1, 2, 3, 4, 5].includes(c.views.depth) || ![1, 2, 4, 8].includes(c.views.samples) || !Number.isInteger(c.views.maxViews) || !Number.isInteger(c.views.maxPixels) || !Number.isInteger(c.views.minResolution) || typeof c.views.particles !== "boolean") throw Error("无效离屏视图预算");
    number(c.views.maxViews, 1, 64, "view count"); number(c.views.maxPixels, 1024, 67108864, "view pixels");
    number(c.views.minResolution, 1, 512, "view minimum resolution"); number(c.views.minArea, 0, 0.1, "view minimum area");
    number(c.views.scale, 0.1, 2, "view scale"); number(c.views.recursiveScale, 0.1, 1, "view recursive scale");
    if (typeof c.shadows.enabled !== "boolean" || typeof c.environment.skybox !== "boolean" ||
        ![256, 512, 1024, 2048, 4096].includes(c.shadows.mapSize) ||
        !["pcf", "pcss", "poisson"].includes(c.shadows.filter) ||
        !Number.isInteger(c.shadows.maxLights) ||
        !["none", "standard", "aces"].includes(c.color.toneMapping) ||
        (c.environment.textureId !== null && (typeof c.environment.textureId !== "string" || !c.environment.textureId))) throw Error("无效渲染配置");
    number(c.shadows.bias, 0, 0.1, "shadow bias");
    number(c.shadows.normalBias, 0, 1, "shadow normal bias");
    number(c.shadows.darkness, 0, 1, "shadow darkness");
    number(c.shadows.maxDistance, 1, 10000, "shadow distance");
    number(c.shadows.maxLights, 1, 8, "shadow lights");
    number(c.environment.intensity, 0, 20, "IBL intensity");
    number(c.environment.rotation, -Math.PI * 2, Math.PI * 2, "IBL rotation");
    number(c.color.exposure, 0.01, 20, "exposure");
    number(c.color.contrast, 0, 4, "contrast");
    number(c.color.saturation, -100, 100, "saturation"); number(c.color.hue, 0, 360, "hue"); number(c.color.tint, 0, 100, "tint");
    if (typeof c.bloom.enabled !== "boolean") throw Error("无效 Bloom 配置");
    number(c.bloom.threshold, 0, 20, "Bloom threshold"); number(c.bloom.weight, 0, 1, "Bloom weight");
    number(c.bloom.kernel, 8, 128, "Bloom kernel"); number(c.bloom.scale, 0.25, 1, "Bloom scale");
    if (typeof c.ao.enabled !== "boolean" || ![4, 8, 16, 32].includes(c.ao.samples)) throw Error("无效 AO 配置");
    number(c.ao.ratio, 0.25, 1, "AO ratio"); number(c.ao.radius, 0.01, 10, "AO radius"); number(c.ao.strength, 0, 5, "AO strength");
    if (!["none", "linear", "exp", "exp2"].includes(c.fog.mode) || !/^#[\da-f]{6}$/i.test(c.fog.color)) throw Error("无效大气雾配置");
    number(c.fog.density, 0, 1, "fog density"); number(c.fog.start, 0, 100000, "fog start"); number(c.fog.end, 0.001, 1000000, "fog end");
    if (c.fog.end <= c.fog.start) throw Error("雾结束距离必须大于开始距离");
    if (typeof c.sky.enabled !== "boolean" || typeof c.dof.enabled !== "boolean" || ![0, 1, 2].includes(c.dof.quality)) throw Error("无效天空或景深配置");
    number(c.sky.sunAzimuth, -360, 360, "sun azimuth"); number(c.sky.sunElevation, -90, 90, "sun elevation");
    number(c.sky.turbidity, 1, 20, "sky turbidity"); number(c.sky.rayleigh, 0, 8, "sky Rayleigh"); number(c.sky.mie, 0, 0.1, "sky Mie"); number(c.sky.luminance, 0, 10, "sky luminance");
    number(c.dof.focusDistance, 0.01, 100000, "focus distance"); number(c.dof.focalLength, 1, 300, "focal length"); number(c.dof.fStop, 0.1, 32, "f-stop");
    const {ssr,planar}=c.reflections;
    if (typeof ssr.enabled!=="boolean" || typeof planar.enabled!=="boolean" || !Number.isInteger(ssr.maxSteps) || !Number.isInteger(ssr.step) || ![0,1,2,3].includes(ssr.downsample) || !Number.isInteger(planar.maxMirrors) || !Number.isInteger(planar.maxPixels)) throw Error("无效反射配置");
    number(ssr.maxSteps,8,256,"SSR steps");number(ssr.step,1,8,"SSR pixel step");number(ssr.maxDistance,.1,10000,"SSR distance");number(ssr.thickness,.001,10,"SSR thickness");number(ssr.strength,0,2,"SSR strength");number(ssr.roughnessFactor,0,1,"SSR roughness");number(ssr.blur,0,.2,"SSR blur");
    number(planar.maxMirrors,1,8,"mirror count");number(planar.maxPixels,1024,67108864,"mirror pixels");number(planar.scale,.1,1,"mirror scale");
    if (!Array.isArray(c.probes) || c.probes.length > 32) throw Error("反射探针数量超过上限");
    const ids = new Set();
    c.probes = c.probes.map(p => {
      if (!object(p) || Object.keys(p).some(k => !["id", "name", "textureId", "position", "size", "priority", "intensity"].includes(k)) ||
          typeof p.id !== "string" || !p.id || ids.has(p.id) || typeof p.name !== "string" || typeof p.textureId !== "string" || !p.textureId) throw Error("无效反射探针");
      ids.add(p.id);
      for (const [key, min] of [["position", -1000000], ["size", 0.001]]) {
        if (!object(p[key]) || Object.keys(p[key]).some(k => !["x", "y", "z"].includes(k))) throw Error("无效反射探针范围");
        for (const axis of ["x", "y", "z"]) number(p[key][axis], min, 1000000, "probe " + key);
      }
      number(p.priority ?? 0, -1000, 1000, "probe priority"); number(p.intensity ?? 1, 0, 20, "probe intensity");
      return { ...p, position: { ...p.position }, size: { ...p.size }, priority: p.priority ?? 0, intensity: p.intensity ?? 1 };
    });
    return c;
  }
  function validateResources(c, content) {
    const id = c.environment.textureId;
    if (id && !(content.textures || []).some(t => t.id === id && environmentMimes.includes(t.mime))) throw Error("IBL 引用的环境资源不存在或格式不正确");
    for (const p of c.probes)
      if (!(content.textures || []).some(t => t.id === p.textureId && t.mime === "application/x-babylon-env")) throw Error("局部反射探针需要预过滤 .env 环境贴图");
  }
  function validateNode(node) {
    for (const key of ["castShadows", "receiveShadows"])
      if (node[key] !== undefined && typeof node[key] !== "boolean") throw Error("无效节点阴影开关");
    if (node.planarReflection !== undefined) {
      const p=node.planarReflection;
      if (!object(p) || !["mesh","model"].includes(node.type) || Object.keys(p).some(k=>!["enabled","axis","offset","blur","intensity"].includes(k)) || typeof p.enabled!=="boolean" || !["x","y","z"].includes(p.axis??"y")) throw Error("无效节点平面反射");
      number(p.offset??0,-100000,100000,"mirror offset");number(p.blur??0,0,64,"mirror blur");number(p.intensity??1,0,20,"mirror intensity");
    }
  }
  const materialDefaults = {
    normalScale: 1, alphaMode: "auto", alphaCutoff: 0.5, uvOffset: {u:0,v:0}, uvRotation: 0,
    clearCoat: {enabled:false,intensity:1,roughness:0.1,normalScale:1},
    sheen: {enabled:false,color:"#FFFFFF",intensity:1,roughness:0.5},
    anisotropy: {enabled:false,intensity:0.5,rotation:0},
    transmission: {enabled:false,intensity:1,ior:1.5,thickness:0.1,tintColor:"#FFFFFF",tintDistance:1},
    detail: {enabled:false,scale:8,diffuse:1,normal:1,roughness:1},
  };
  function material(input={}) {
    if(!object(input))throw Error("无效扩展材质");
    const c=merge(materialDefaults,Object.fromEntries(Object.keys(materialDefaults).filter(k=>input[k]!==undefined).map(k=>[k,input[k]])),"material");
    if(!["auto","opaque","mask","blend"].includes(c.alphaMode))throw Error("无效材质透明模式");
    number(c.normalScale,0,10,"normal scale");number(c.alphaCutoff,0,1,"alpha cutoff");number(c.uvRotation,-Math.PI*2,Math.PI*2,"UV rotation");
    for(const axis of ['u','v'])number(c.uvOffset[axis],-10000,10000,"UV offset");
    for(const key of ['clearCoat','sheen','anisotropy','transmission','detail'])if(typeof c[key].enabled!=="boolean")throw Error("无效扩展材质开关");
    for(const key of ['clearCoat','sheen','anisotropy','transmission'])number(c[key].intensity,0,1,key+" intensity");
    for(const key of ['clearCoat','sheen'])number(c[key].roughness,0,1,key+" roughness");
    number(c.clearCoat.normalScale,0,10,"coat normal scale");number(c.anisotropy.rotation,-Math.PI*2,Math.PI*2,"anisotropy rotation");
    if(!/^#[\da-f]{6}$/i.test(c.sheen.color)||!/^#[\da-f]{6}$/i.test(c.transmission.tintColor))throw Error("无效扩展材质颜色");
    number(c.transmission.ior,1,3,"IOR");number(c.transmission.thickness,0,1000,"material thickness");number(c.transmission.tintDistance,.001,100000,"absorption distance");
    number(c.detail.scale,.01,1000,"detail scale");for(const key of ['diffuse','normal','roughness'])number(c.detail[key],0,5,"detail "+key);
    return c;
  }
  function selectProbe(point, probes) {
    let selected = -1, priority = -Infinity, volume = Infinity;
    for (let i = 0; i < probes.length; i++) {
      const p = probes[i], v = p.size.x * p.size.y * p.size.z;
      if (["x", "y", "z"].some(axis => Math.abs(point[axis] - p.position[axis]) > p.size[axis] / 2)) continue;
      if (p.priority > priority || (p.priority === priority && (v < volume || (v === volume && (selected < 0 || p.id < probes[selected].id))))) {
        selected = i; priority = p.priority; volume = v;
      }
    }
    return selected;
  }
  function preset(input, name) {
    if (!["low", "medium", "high", "custom"].includes(name)) throw Error("无效画质档位");
    const c = settings(input); c.quality = name;
    if (name === "custom") return c;
    const low = name === "low", high = name === "high";
    c.resolutionScale = low ? 0.75 : 1;
    c.antialiasing = high ? "msaa" : "fxaa"; c.samples = high ? 4 : 1;
    Object.assign(c.shadows, { enabled: true, mapSize: low ? 512 : high ? 2048 : 1024, filter: high ? "pcss" : "pcf", maxLights: low ? 1 : high ? 4 : 2 });
    Object.assign(c.ao, { enabled: !low, ratio: high ? 1 : 0.5, samples: high ? 16 : 8 });
    Object.assign(c.bloom, { enabled: !low, scale: high ? 0.5 : 0.25 });
    c.dof.quality = high ? 2 : low ? 0 : 1;
    Object.assign(c.reflections.ssr,{enabled:high,maxSteps:high?128:32,downsample:high?0:1});
    Object.assign(c.reflections.planar,{enabled:!low,maxMirrors:high?4:1,maxPixels:high?4194304:524288,scale:high?1:.5});
    Object.assign(c.views, { depth: low ? 1 : 2, scale: low ? 0.5 : high ? 1 : 0.75, samples: high ? 4 : 1, maxViews: low ? 4 : high ? 16 : 8, maxPixels: low ? 1048576 : high ? 8388608 : 3145728, particles: high });
    return c;
  }
  const materialTextureFields = ["albedoTextureId", "normalTextureId", "metallicRoughnessTextureId", "aoTextureId", "lightmapTextureId", "emissiveTextureId", "clearCoatTextureId", "clearCoatNormalTextureId", "sheenTextureId", "anisotropyTextureId", "thicknessTextureId", "transmissionTextureId", "detailTextureId"];
  root.ArkGlideRenderingConfig = { settings, preset, validateResources, validateNode, selectProbe, material, materialTextureFields, environmentMimes, imageMimes };
})(globalThis);
