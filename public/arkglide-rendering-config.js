// Shared, renderer-independent validation for editor, runtime and static export.
(function (root) {
  "use strict";
  const defaults = {
    shadows: { enabled: false, mapSize: 1024, filter: "pcf", bias: 0.0005, normalBias: 0.02, darkness: 0, maxDistance: 100, maxLights: 2 },
    environment: { textureId: null, intensity: 1, rotation: 0, skybox: false },
    color: { toneMapping: "none", exposure: 1, contrast: 1 },
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
    return c;
  }
  function validateResources(c, content) {
    const id = c.environment.textureId;
    if (id && !(content.textures || []).some(t => t.id === id && environmentMimes.includes(t.mime))) throw Error("IBL 引用的环境资源不存在或格式不正确");
  }
  function validateNode(node) {
    for (const key of ["castShadows", "receiveShadows"])
      if (node[key] !== undefined && typeof node[key] !== "boolean") throw Error("无效节点阴影开关");
  }
  root.ArkGlideRenderingConfig = { settings, validateResources, validateNode, environmentMimes, imageMimes };
})(globalThis);
