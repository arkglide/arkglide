// Shared, renderer-independent validation for editor, runtime and static export.
(function (root) {
  "use strict";
  const defaults = {
    shadows: { enabled: false, mapSize: 1024, filter: "pcf", bias: 0.0005, normalBias: 0.02, darkness: 0, maxDistance: 100, maxLights: 2 },
    environment: { textureId: null, intensity: 1, rotation: 0, skybox: false },
    color: { toneMapping: "none", exposure: 1, contrast: 1, saturation: 0, hue: 30, tint: 0 },
    bloom: { enabled: false, threshold: 1, weight: 0.3, kernel: 32, scale: 0.5 },
    ao: { enabled: false, ratio: 0.5, radius: 1, strength: 1, samples: 8 },
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
  const materialTextureFields = ["albedoTextureId", "normalTextureId", "metallicRoughnessTextureId", "aoTextureId", "lightmapTextureId", "emissiveTextureId"];
  root.ArkGlideRenderingConfig = { settings, validateResources, validateNode, selectProbe, materialTextureFields, environmentMimes, imageMimes };
})(globalThis);
