import fs from "node:fs";
import { zipSync, strToU8 } from "fflate";
import "../src/engine/scene-runtime.js";
const root = new URL("../examples/", import.meta.url);
fs.mkdirSync(root, { recursive: true });
// Two authored glTF clips, rather than renaming one animation for an artificial test.
const arrays = [
  new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0]),
  new Float32Array([0, 0.5, 1]),
  new Float32Array([0, 0, 0, 0, 0.25, 0, 0, 0, 0]),
  new Float32Array([0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, -1]),
];
const binary = Buffer.concat(arrays.map((a) => Buffer.from(a.buffer)));
let offset = 0;
const views = arrays.map((a) => {
  const v = { buffer: 0, byteOffset: offset, byteLength: a.byteLength };
  offset += a.byteLength;
  return v;
});
const gltf = {
  asset: { version: "2.0" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: "AnimatedGem" }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
  materials: [
    {
      doubleSided: true,
      pbrMetallicRoughness: {
        baseColorFactor: [1, 0.65, 0.05, 1],
        metallicFactor: 0.1,
        roughnessFactor: 0.4,
      },
    },
  ],
  buffers: [{ byteLength: binary.length }],
  bufferViews: views,
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: "VEC3",
      min: [-0.5, 0, 0],
      max: [0.5, 1, 0],
    },
    {
      bufferView: 1,
      componentType: 5126,
      count: 3,
      type: "SCALAR",
      min: [0],
      max: [1],
    },
    { bufferView: 2, componentType: 5126, count: 3, type: "VEC3" },
    { bufferView: 3, componentType: 5126, count: 3, type: "VEC4" },
  ],
  animations: [
    {
      name: "Idle",
      samplers: [{ input: 1, output: 2, interpolation: "LINEAR" }],
      channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
    },
    {
      name: "Move",
      samplers: [{ input: 1, output: 3, interpolation: "LINEAR" }],
      channels: [{ sampler: 0, target: { node: 0, path: "rotation" } }],
    },
  ],
};
const json = Buffer.from(JSON.stringify(gltf)),
  n = Math.ceil(json.length / 4) * 4,
  glb = Buffer.alloc(28 + n + binary.length);
glb.writeUInt32LE(0x46546c67, 0);
glb.writeUInt32LE(2, 4);
glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(n, 12);
glb.writeUInt32LE(0x4e4f534a, 16);
glb.fill(32, 20, 20 + n);
json.copy(glb, 20);
glb.writeUInt32LE(binary.length, 20 + n);
glb.writeUInt32LE(0x004e4942, 24 + n);
binary.copy(glb, 28 + n);
const wav = Buffer.alloc(44 + 4410 * 2);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(22050, 24);
wav.writeUInt32LE(44100, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < 4410; i++)
  wav.writeInt16LE(
    Math.round(
      Math.sin((i * 2 * Math.PI * 880) / 22050) * (1 - i / 4410) * 12000,
    ),
    44 + i * 2,
  );
const body = (motion = "dynamic", sensor = false) => ({
  motion,
  shape: "box",
  size: { x: 1, y: 1, z: 1 },
  mass: 1,
  friction: 0.5,
  restitution: 0,
  sensor,
  lockRotation: true,
});
const node = (id, type, pos, extra = {}) => ({
  id,
  name: id,
  type,
  transform: { x: pos[0], y: pos[1], z: pos[2] },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  visible: true,
  ...extra,
});
const nodes = [
  node("Player", "mesh", [0, 2, 0], {
    primitive: "box",
    color: "#58A6FF",
    physics: body(),
    scripts: ["main.js"],
  }),
  node("Floor", "mesh", [0, -0.5, 0], {
    primitive: "box",
    scale: { x: 12, y: 1, z: 12 },
    color: "#263B31",
    physics: body("static"),
  }),
  node("Wall", "mesh", [4, 1, 0], {
    primitive: "box",
    scale: { x: 1, y: 3, z: 8 },
    color: "#A35445",
    physics: body("static"),
  }),
  node("Gem", "model", [2, 0.5, 0], {
    modelUrl: "animated-gem.glb",
    physics: body("static", true),
    animation: { clip: "Idle", autoplay: true, loop: true, speed: 1 },
  }),
  node("Camera", "camera", [0, 7, -11], {
    rotation: { x: 0.5, y: 0, z: 0 },
    activeCamera: true,
    fov: 60,
  }),
];
const script = `// WASD / 方向键移动，空格跳跃；触屏按钮映射同一动作。
// 走近黄色宝石可加分并播放音效；物理每个固定步推进一次。
return defineScript({
  score: 0, grounded: false, contacts: new Set(), gemMode: '',
  onStart() {
    physics.onContact(this.entity, event => {
      if (event.other.name === 'Floor') {
        if (event.phase === 'enter') this.contacts.add(event.other.id);
        else this.contacts.delete(event.other.id);
      }
      if (event.phase === 'enter' && event.other.name === 'Gem') {
        this.score++; ui.get('score').setText('分数：' + this.score);
        audio.play('coin', {entity:this.entity,spatial:true,volume:.8});
        event.other.destroy();
        ui.get('hint').setText('收集成功！停止再播放可重新开始');
      }
    });
  },
  onFixedUpdate() {
    const v=physics.getVelocity(this.entity);
    physics.setVelocity(this.entity,{x:input.getAction('moveX')*3,y:v.y,z:input.getAction('moveZ')*3});
    if(input.isActionDown('jump') && this.contacts.size && v.y<.1)physics.addImpulse(this.entity,{x:0,y:5,z:0});
    if(this.entity.position.y < -8)physics.teleport(this.entity,{x:0,y:3,z:0});
  },
  onUpdate() {
    const gem=scene.findByName('Gem');
    if(gem){const mode=input.isActionDown('moveX')||input.isActionDown('moveZ')?'Move':'Idle';
      if(mode!==this.gemMode){animation.play(gem,mode,{loop:true,fade:.2});this.gemMode=mode;}}
  }
});`;
const hud = (id, text, x, y, kind = "text", action, direction) => ({
  id,
  text,
  x,
  y,
  kind,
  action,
  direction,
  color: "#FFFFFF",
  background: "#253044",
  fontSize: 18,
});
const project = {
  version: "0.5",
  projectId: "",
  name: "第三批示例：收集宝石",
  scene: { nodes },
  scripts: { "main.js": script },
  activeFileId: "main.js",
  modelRefs: [{ assetId: "Gem", fileName: "animated-gem.glb" }],
  settings: {
    gravity: { x: 0, y: -9.8, z: 0 },
    backgroundColor: "#0D1724",
    ambientIntensity: 0.8,
    ambientColor: "#FFFFFF",
    fpsCap: 60,
    fixedTimeStep: 1 / 60,
    maxSubSteps: 8,
    timeScale: 1,
  },
  content: {
    materials: {},
    textures: [],
    prefabs: {},
    prefabInstances: {},
    audio: [
      {
        id: "coin",
        name: "收集音效.wav",
        mime: "audio/wav",
        byteLength: wav.length,
      },
    ],
    gameplay: {
      captureInput: true,
      actions: [
        {
          name: "moveX",
          positive: ["KeyD", "ArrowRight"],
          negative: ["KeyA", "ArrowLeft"],
        },
        {
          name: "moveZ",
          positive: ["KeyW", "ArrowUp"],
          negative: ["KeyS", "ArrowDown"],
        },
        { name: "jump", positive: ["Space"], negative: [] },
      ],
      hud: [
        hud("score", "分数：0", 3, 3),
        hud("hint", "WASD 移动 / 空格跳跃 / 收集黄色宝石", 3, 11),
        hud("left", "←", 3, 80, "button", "moveX", -1),
        hud("right", "→", 18, 80, "button", "moveX", 1),
        hud("forward", "↑", 10, 65, "button", "moveZ", 1),
        hud("back", "↓", 10, 85, "button", "moveZ", -1),
        hud("jump", "跳跃", 80, 80, "button", "jump", 1),
      ],
    },
  },
};
const archive = zipSync({
  "project.json": strToU8(JSON.stringify(project, null, 2)),
  "assets/animated-gem.glb": glb,
  "audio/coin.bin": wav,
});
fs.writeFileSync(new URL("collect-gems.arkglide", root), archive);
fs.writeFileSync(
  new URL("collect-gems.json", root),
  JSON.stringify(project, null, 2),
);
fs.writeFileSync(new URL("coin.wav", root), wav);
fs.writeFileSync(new URL("animated-gem.glb", root), glb);
console.log("Created playable example", archive.length);
