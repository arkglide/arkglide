import { deflateSync } from "node:zlib";
import "../src/engine/rendering-config.js";
// Small procedural fixture textures; no external assets or decoders are needed.
export function png(width, height, pixel) {
  const be = n => { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, n); return out; };
  const concat = parts => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
  const chunk = (name, data) => {
    const raw = concat([new TextEncoder().encode(name), data]); let crc = 0xffffffff;
    for (const value of raw) { crc ^= value; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
    return concat([be(data.length), raw, be((crc ^ 0xffffffff) >>> 0)]);
  };
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
  return concat([new Uint8Array([137,80,78,71,13,10,26,10]), chunk("IHDR", concat([be(width), be(height), new Uint8Array([8,6,0,0,0])])), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]);
}
export function renderingProject() {
  const header = new TextEncoder().encode("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 4 +X 8\n"), hdr = new Uint8Array(header.length + 8 * 4 * 4); hdr.set(header);
  for (let i = header.length; i < hdr.length; i += 4) hdr.set([110, 140, 200, 128], i);
  const textures = new Map([
    ["studio", hdr.buffer],
    ["emitter", png(16, 4, (x, y) => [60 + x * 12, 200, 255, 255]).buffer],
    ["baked", png(32, 32, (x, y) => { const v = Math.round(35 + Math.max(0, 1 - Math.hypot(x - 16, y - 16) / 22) * 50); return [v, v, v + 6, 255]; }).buffer],
    ["ao", png(32, 32, (x, y) => { const v = Math.min(255, 110 + Math.min(x, y, 31 - x, 31 - y) * 18); return [v, v, v, 255]; }).buffer],
  ]);
  const material = (id, baseColor, extra = {}) => ({ id, name: id, baseColor, emissiveColor: "#000000", metallic: 0, roughness: 0.6, alpha: 1, doubleSided: false, uvScale: { u: 1, v: 1 }, ...extra });
  const node = (id, type, p, s = [1, 1, 1], extra = {}) => ({ id, name: id, type, transform: { x: p[0], y: p[1], z: p[2] }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: s[0], y: s[1], z: s[2] }, visible: true, ...extra });
  const nodes = [
    node("Floor", "mesh", [0, 0, 2], [14, 1, 14], { primitive: "plane", materialId: "floor" }),
    node("BackWall", "mesh", [0, 2.5, 8], [14, 5, 0.2], { materialId: "wall" }),
    node("SideWall", "mesh", [-7, 2.5, 2], [0.2, 5, 12], { materialId: "wall" }),
    node("Metal", "mesh", [-1.8, 1, 1.8], [1.8, 1.8, 1.8], { primitive: "sphere", materialId: "metal" }),
    node("Rough", "mesh", [0.3, 1, 2.4], [1.8, 1.8, 1.8], { primitive: "sphere", materialId: "rough" }),
    node("Rotating", "mesh", [2.7, 0.9, 2.3], [1.3, 1.3, 1.3], { materialId: "metal", scripts: ["spin.js"] }),
    node("LampA", "mesh", [-3.5, 2.5, 5.3], [0.12, 3, 0.12], { materialId: "light" }),
    node("LampB", "mesh", [3.5, 2.5, 5.3], [0.12, 3, 0.12], { materialId: "light" }),
    node("LampTop", "mesh", [0, 4, 5.3], [7, 0.12, 0.12], { materialId: "light" }),
    node("Sun", "light", [-3, 6, -4], [1, 1, 1], { lightType: "directional", intensity: 2.5, color: "#FFF3DF", rotation: { x: 0.3, y: 0, z: -0.4 } }),
    node("Camera", "camera", [0, 2.5, -9], [1, 1, 1], { activeCamera: true, fov: 60, rotation: { x: 0.12, y: 0, z: 0 } }),
    node("Demo", "empty", [0, 0, 0], [1, 1, 1], { scripts: ["main.js"] }),
  ];
  const rendering = globalThis.ArkGlideRenderingConfig.preset({ environment: { textureId: "studio", intensity: 0.7 }, color: { toneMapping: "aces", exposure: 1.1 }, bloom: { threshold: 0.3, weight: 0.25 } }, "medium");
  const project = {
    version: "0.6", name: "Rendering Lab", projectId: "arkglide-rendering-lab", updatedAt: 0, activeFileId: "main.js", assets: [], scene: { nodes },
    settings: { gravity: { x: 0, y: -9.8, z: 0 }, backgroundColor: "#101720", ambientIntensity: 0.15, ambientColor: "#9DB9FF", fixedTimeStep: 1 / 60, maxSubSteps: 8, timeScale: 1, fpsCap: 60, rendering },
    content: {
      materials: { floor: material("floor", "#636D80", { lightmapTextureId: "baked", lightmapUV: 0, lightmapIntensity: 0.4, aoTextureId: "ao" }), wall: material("wall", "#8B98AB"), metal: material("metal", "#B7C9DF", { metallic: 1, roughness: 0.18 }), rough: material("rough", "#E8A168", { metallic: 0.1, roughness: 0.7 }), light: material("light", "#080808", { emissiveColor: "#FFFFFF", emissiveTextureId: "emitter", emissiveIntensity: 5 }) },
      textures: [...textures].map(([id, data]) => ({ id, name: id === "studio" ? "studio.hdr" : id + ".png", mime: id === "studio" ? "image/vnd.radiance" : "image/png", byteLength: data.byteLength })), prefabs: {}, prefabInstances: {},
    },
    scripts: {
      "main.js": `return defineScript({
  onStart() {
    const a = portals.create({id:'near',shape:'rectangle',width:1.8,height:2.8,position:{x:3.9,y:1.5,z:0},rotation:{x:0,y:1,z:0,w:0}});
    const b = portals.create({id:'far',shape:'rectangle',width:1.8,height:2.8,position:{x:-3.9,y:1.5,z:3}});
    a.link(b);
    console.log('Rendering Lab: 1 low / 2 medium / 3 high');
  },
  onUpdate() {
    if(input.wasKeyPressed('1')) rendering.setQuality('low');
    if(input.wasKeyPressed('2')) rendering.setQuality('medium');
    if(input.wasKeyPressed('3')) rendering.setQuality('high');
  }
});`,
      "spin.js": "return defineScript({onUpdate(){this.entity.rotation.y += time.deltaTime * 0.4;}});",
    },
  };
  return { project, textures };
}
