import fs from "node:fs";
import { zipSync, strToU8 } from "fflate";
import { createServer } from "vite";
const dir = new URL("../examples/", import.meta.url);
fs.mkdirSync(dir, { recursive: true });
function glb(gltf, binary) {
  const json = Buffer.from(JSON.stringify(gltf)),
    n = Math.ceil(json.length / 4) * 4,
    m = Math.ceil(binary.length / 4) * 4,
    out = Buffer.alloc(28 + n + m);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(n, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  out.fill(32, 20, 20 + n);
  json.copy(out, 20);
  out.writeUInt32LE(m, 20 + n);
  out.writeUInt32LE(0x004e4942, 24 + n);
  binary.copy(out, 28 + n);
  return out;
}
function rig(target = false) {
  const chunks = [],
    views = [],
    accessors = [];
  let offset = 0;
  const put = (array, type, componentType = 5126, extra = {}) => {
    const raw = Buffer.from(array.buffer),
      padded = Buffer.alloc(Math.ceil(raw.length / 4) * 4);
    raw.copy(padded);
    const view = views.length;
    views.push({ buffer: 0, byteOffset: offset, byteLength: raw.length });
    chunks.push(padded);
    offset += padded.length;
    const components = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type],
      index = accessors.length;
    accessors.push({
      bufferView: view,
      componentType,
      count: array.length / components,
      type,
      ...extra,
    });
    return index;
  };
  const positions = [],
    joints = [],
    weights = [];
  for (const [joint, x, y, w, h] of [
    [1, 0, 0.25, 0.35, 0.8],
    [2, -0.22, -0.5, 0.18, 0.65],
    [3, 0.22, -0.5, 0.18, 0.65],
  ]) {
    for (const p of [
      [x - w / 2, y - h / 2, 0],
      [x + w / 2, y - h / 2, 0],
      [x + w / 2, y + h / 2, 0],
      [x - w / 2, y - h / 2, 0],
      [x + w / 2, y + h / 2, 0],
      [x - w / 2, y + h / 2, 0],
    ]) {
      positions.push(...p);
      joints.push(joint, 0, 0, 0);
      weights.push(1, 0, 0, 0);
    }
  }
  const pos = put(new Float32Array(positions), "VEC3", 5126, {
      min: [-0.5, -0.9, 0],
      max: [0.5, 0.9, 0],
    }),
    j = put(new Uint16Array(joints), "VEC4", 5123),
    w = put(new Float32Array(weights), "VEC4"),
    inverse = put(
      new Float32Array(
        Array.from({ length: 4 }, () => [
          1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
        ]).flat(),
      ),
      "MAT4",
    );
  const names = target
    ? ["OtherRoot", "OtherSpine", "OtherLeft", "OtherRight"]
    : ["Root", "Spine", "LeftLeg", "RightLeg"];
  const g = {
    asset: { version: "2.0", generator: "ArkGlide third-batch example" },
    scene: 0,
    scenes: [{ nodes: [0, 4] }],
    nodes: [
      { name: names[0], children: [1, 2, 3] },
      ...names.slice(1).map((name) => ({ name })),
      { name: target ? "MirrorBody" : "PlayerBody", mesh: 0, skin: 0 },
    ],
    skins: [
      { joints: [0, 1, 2, 3], skeleton: 0, inverseBindMatrices: inverse },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: pos, JOINTS_0: j, WEIGHTS_0: w },
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor: target ? [1, 0.55, 0.2, 1] : [0.15, 0.7, 1, 1],
          metallicFactor: 0,
          roughnessFactor: 0.8,
        },
      },
    ],
    accessors,
    bufferViews: views,
    buffers: [],
    animations: [],
  };
  if (!target) {
    const times = put(new Float32Array([0, 0.5, 1]), "SCALAR", 5126, {
      min: [0],
      max: [1],
    });
    for (const [name, delta] of [
      ["Idle", [0, 0, 0]],
      ["Forward", [0, 0, 2]],
      ["Back", [0, 0, -2]],
      ["Left", [-2, 0, 0]],
      ["Right", [2, 0, 0]],
      ["Jump", [0, 0, 0]],
    ]) {
      const samplers = [],
        channels = [];
      const channel = (node, path, values, type) => {
        samplers.push({
          input: times,
          output: put(new Float32Array(values), type),
          interpolation: "LINEAR",
        });
        channels.push({ sampler: samplers.length - 1, target: { node, path } });
      };
      channel(
        0,
        "translation",
        [0, 0, 0, ...delta.map((v) => v / 2), ...delta],
        "VEC3",
      );
      for (const node of [2, 3]) {
        const angle = name === "Idle" ? 0 : node === 2 ? 0.3 : -0.3;
        channel(
          node,
          "rotation",
          [
            Math.sin(angle / 2),
            0,
            0,
            Math.cos(angle / 2),
            -Math.sin(angle / 2),
            0,
            0,
            Math.cos(angle / 2),
            Math.sin(angle / 2),
            0,
            0,
            Math.cos(angle / 2),
          ],
          "VEC4",
        );
      }
      channel(
        1,
        "translation",
        name === "Jump"
          ? [0, 0, 0, 0, 0.2, 0, 0, 0, 0]
          : [0, 0, 0, 0, 0, 0, 0, 0, 0],
        "VEC3",
      );
      g.animations.push({ name, samplers, channels });
    }
  }
  g.buffers = [{ byteLength: offset }];
  return glb(g, Buffer.concat(chunks));
}
function cube() {
  const p = new Float32Array(
      [
        -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1,
        1, -1, 1, 1,
      ].map((v) => v * 0.4),
    ),
    indices = new Uint16Array([
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1,
      2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7,
    ]),
    binary = Buffer.concat([
      Buffer.from(p.buffer),
      Buffer.from(indices.buffer),
    ]);
  return glb(
    {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "CratePart", mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      buffers: [{ byteLength: binary.length }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: p.byteLength },
        { buffer: 0, byteOffset: p.byteLength, byteLength: indices.byteLength },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 8,
          type: "VEC3",
          min: [-0.4, -0.4, -0.4],
          max: [0.4, 0.4, 0.4],
        },
        { bufferView: 1, componentType: 5123, count: 36, type: "SCALAR" },
      ],
    },
    binary,
  );
}
function wav(seconds, hz) {
  const sr = 22050,
    n = Math.floor(sr * seconds),
    b = Buffer.alloc(44 + n * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    b.writeInt16LE(
      Math.round(
        5000 *
          Math.sin((i * 2 * Math.PI * hz) / sr) *
          Math.min(1, i / 100, (n - i) / 100),
      ),
      44 + i * 2,
    );
  return b;
}
const source = rig(),
  target = rig(true),
  crate = cube(),
  tone = wav(0.2, 440),
  music = wav(12, 220),
  png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAB80lEQVR4nO2azW3DMAyFmSIzdIN2gU4QILN0mkzQETpDgUyQYw/pCF0iucSAEUgiKfFHNPjOtkU+fZQo2wCpVMpTP/+3m+f4O6+BS4kfX3fm8bxYDwhQn3UPGkwd5yRoRYMZAdzZtaJB3WWJRDRpUCVAahY1aVBxVjNgaRrECdCuXenni7npsYVJ0CBCgFc3JzHukIPebexavTR0EzBT8gD98bBdmy3xkjg0sAiIkDwAL06SU1ESLwmjASUgcvIAePxVd6InXlKJhn3t4u9fgPPlTzeihw4f7ybjlFQtga+D/dsZTdXyaa4BnjNjJXQR3LoJTQO2UgatPEiN0JYpcHkrPJNQAxZ8olKAlTGLgKgmtJQlQLlojVEkCii7WBcBkUzAlCVAvfAZp9kpoDZxQwTMbgJFWQKjD4hOAcuAKIcjTpwiJRCZArE1IKoJbANmLwNufKK7QEQKxLfBaCZ0GTBrGfTEpdIIRaIgO8HeGzHcrCnoLUtVAiKUQpbAyM0U7CwoGNmVTAiYuRSqn8epWtz/PNv/TyDRj4gRYL0rSDVjKh1di4bSTxccc6S7UJU1QKtV1niuek9fouGZAowAzbPH8CKIaWSRtDh0mTVC3M9rVidOl2PtQsNSCmtDrI/aLq1wLclZ3zOo6u103dwPmalIugO5Y6zhd/wyMQAAAABJRU5ErkJggg==",
    "base64",
  );
const node = (id, type, pos, extra = {}) => ({
  id,
  name: id,
  type,
  transform: { x: pos[0], y: pos[1], z: pos[2] },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  visible: true,
  parentId: null,
  ...extra,
});
const body = (
  motion = "static",
  shape = "box",
  size = { x: 1, y: 1, z: 1 },
  extra = {},
) => ({
  motion,
  shape,
  size,
  mass: 1,
  friction: 0.5,
  restitution: 0,
  sensor: false,
  lockRotation: false,
  ...extra,
});
const character = {
  radius: 0.3,
  height: 1.8,
  stepHeight: 0.3,
  maxSlope: 45,
  speed: 2,
  jumpSpeed: 5,
};
const anim = (target = "Root") => ({
  clip: "Idle",
  autoplay: true,
  loop: true,
  speed: 1,
  controllerId: "locomotion",
  rootMotion: { target, translation: true, rotation: false },
});
const nodes = [
  node("Player", "model", [0, 2, -2], {
    modelUrl: "third-player.glb",
    character,
    animation: anim(),
    scripts: ["player.js"],
  }),
  node("Mirror", "model", [-4, 2, 0], {
    modelUrl: "third-mirror.glb",
    character,
    animation: {
      ...anim("OtherRoot"),
      retarget: { sourceId: "Player", profileId: "mirror" },
    },
    scripts: ["mirror.js"],
  }),
  node("Floor", "mesh", [0, -0.5, 0], {
    primitive: "box",
    scale: { x: 20, y: 1, z: 20 },
    color: "#28394B",
    physics: body(),
  }),
  node("Ramp", "mesh", [-3, 0.2, 3], {
    primitive: "box",
    scale: { x: 4, y: 0.2, z: 3 },
    rotation: { x: 0, y: 0, z: 0.3 },
    color: "#758B63",
    physics: body(),
  }),
  node("Step", "mesh", [1, 0.1, 0], {
    primitive: "box",
    scale: { x: 2, y: 0.2, z: 2 },
    color: "#8A784C",
    physics: body(),
  }),
  node("Wall", "mesh", [4, 1.5, 0], {
    primitive: "box",
    scale: { x: 0.3, y: 3, z: 6 },
    color: "#5C617A",
    physics: body(),
  }),
  node("Platform", "mesh", [-1, 0.2, 5], {
    primitive: "box",
    scale: { x: 3, y: 0.4, z: 3 },
    color: "#9966AA",
    physics: body("kinematic"),
  }),
  node("Trigger", "mesh", [0, 1, 2], {
    primitive: "box",
    visible: false,
    scale: { x: 3, y: 2, z: 1 },
    physics: body(
      "static",
      "box",
      { x: 1, y: 1, z: 1 },
      { group: "Trigger", sensor: true },
    ),
  }),
  node("HingeBase", "mesh", [3, 0.1, 4], { primitive: "box", physics: body() }),
  node("Door", "mesh", [3, 1.5, 4], {
    primitive: "box",
    scale: { x: 1.6, y: 2, z: 0.2 },
    color: "#B48152",
    physics: body("dynamic"),
    joints: [
      {
        id: "door-hinge",
        kind: "hinge",
        targetId: "HingeBase",
        anchor: { x: 0, y: -0.7, z: 0 },
        anchor2: { x: 0, y: 0, z: 0 },
        axis: { x: 0, y: 1, z: 0 },
        min: -1.2,
        max: 1.2,
        motor: { velocity: 0.3, force: 8 },
      },
    ],
  }),
  node("CrateGroup", "empty", [6, 1, 3]),
  node("Crate", "model", [0, 1, 0], {
    parentId: "CrateGroup",
    modelUrl: "third-crate.glb",
    physics: body(
      "dynamic",
      "convex",
      { x: 1, y: 1, z: 1 },
      { parts: ["CratePart"] },
    ),
    scripts: ["crate.js"],
  }),
  node("MeshPlatform", "model", [-5, 0.4, 5], {
    modelUrl: "third-crate.glb",
    scale: { x: 3, y: 0.5, z: 3 },
    physics: body(
      "static",
      "mesh",
      { x: 1, y: 1, z: 1 },
      { parts: ["CratePart"] },
    ),
  }),
  node("Camera", "camera", [0, 9, -13], {
    rotation: { x: 0.52, y: 0, z: 0 },
    activeCamera: true,
    fov: 60,
  }),
];
const hud = (id, kind, text, x, y, extra = {}) => ({
  id,
  kind,
  text,
  x,
  y,
  fontSize: 18,
  color: "#FFFFFF",
  background: "#253044",
  ...extra,
});
const actions = [
  {
    name: "moveX",
    positive: ["KeyD"],
    negative: ["KeyA"],
    gamepad: [{ kind: "axis", index: 0, direction: 1, deadzone: 0.15 }],
  },
  {
    name: "moveZ",
    positive: ["KeyW"],
    negative: ["KeyS"],
    gamepad: [{ kind: "axis", index: 1, direction: -1, deadzone: 0.15 }],
  },
  {
    name: "jump",
    positive: ["Space"],
    negative: [],
    gamepad: [{ kind: "button", index: 0, direction: 1, deadzone: 0.1 }],
  },
];
const controls = {
  id: "locomotion",
  name: "角色方向状态机",
  defaultState: "Locomotion",
  parameters: { moveX: 0, moveZ: 0, airborne: false, speed: 0 },
  states: [
    {
      name: "Locomotion",
      clip: "Idle",
      speed: 1,
      loop: true,
      blend: {
        kind: "2d",
        parameterX: "moveX",
        parameterY: "moveZ",
        children: [
          ["Idle", 0, 0],
          ["Right", 1, 0],
          ["Left", -1, 0],
          ["Forward", 0, 1],
          ["Back", 0, -1],
        ].map(([clip, x, y]) => ({ clip, x, y, threshold: x })),
      },
      events: [
        { time: 0.2, name: "footstep" },
        { time: 0.7, name: "footstep" },
      ],
    },
    {
      name: "Jump",
      clip: "Jump",
      speed: 1,
      loop: false,
      events: [
        { time: 0, name: "jump" },
        { time: 0.8, name: "land" },
      ],
    },
  ],
  transitions: [
    {
      from: "Locomotion",
      to: "Jump",
      duration: 0.1,
      conditions: [{ parameter: "airborne", op: "==", value: true }],
    },
    {
      from: "Jump",
      to: "Locomotion",
      duration: 0.15,
      conditions: [{ parameter: "airborne", op: "==", value: false }],
    },
  ],
};
const scripts = {
  "movement.js": `export const direction = input => ({x:input.getAction('moveX'), z:input.getAction('moveZ')});\nexport const rates=[.5,1,2];\n`,
  "player.js": `import {direction,rates} from './movement.js';\nexport default function({entity,input,scene,time,physics,animation,audio,ui,prefabs,timers}) {\nlet char,controller,music,snapshot=null,rateIndex=1,paused=false,spawned=[];\nconst clickSound=()=>audio.play('tone',{bus:'UI',volume:.25,priority:10});\nfunction menu(){paused=!paused;if(snapshot)snapshot.release();snapshot=paused?audio.applySnapshot('pause',.25):null;time.timeScale=paused?0:1;ui.get('menu').setVisible(paused);ui.get('menu').setText('暂停菜单');clickSound();}\nreturn {onStart(){char=physics.character(entity);controller=animation.controller(entity);music=audio.play('music',{bus:'Music',stream:true,loop:true,volume:.2,priority:5,preservePitch:true});animation.onEvent(entity,e=>{if(e.name==='footstep'&&controller.getParameter('speed')>.1)audio.play('tone',{bus:'SFX',volume:.15,spatial:true,entity,priority:1});});ui.get('pause').on('click',menu);ui.get('resume').on('click',menu);ui.get('rate').on('click',()=>{rateIndex=(rateIndex+1)%rates.length;music.setRate(rates[rateIndex]);ui.get('rate').setText('音乐倍率：'+rates[rateIndex]);clickSound();});ui.get('rebind').on('click',()=>input.captureBinding('jump').then(r=>{if(r.cancelled)return;ui.get('status').setText(r.applied?'跳跃改绑：'+r.code:'改绑取消或冲突');}));timers.every(5,()=>{const p=prefabs.findByName('补给箱组合');if(p)prefabs.instantiate(p.id,{position:{x:entity.position.x+1,y:3,z:entity.position.z}}).then(h=>{spawned.push(h);if(spawned.length>2)spawned.shift().destroy();});});},onFixedUpdate(){const d=direction(input);controller.setParameter('moveX',d.x);controller.setParameter('moveZ',d.z);controller.setParameter('speed',Math.hypot(d.x,d.z));controller.setParameter('airborne',!char.grounded);if(input.wasActionPressed('jump'))char.jump();const platform=scene.find('Platform');platform.position.x=-1+Math.sin(time.fixedTotalTime)*1.5;},onUpdate(){const hits=physics.overlap({kind:'sphere',radius:.6},entity.getWorldPosition(),{mask:2,sensors:true});ui.get('status').setText((char.grounded?'地面':'空中')+' · '+controller.state+' · 触发区 '+hits.length+' · 音乐 '+music.position.toFixed(1)+'s');},onDestroy(){for(const h of spawned)h.destroy();}};\n}`,
  "mirror.js": `export default function({entity,time,animation}){let c;return {onStart(){c=animation.controller(entity);},onFixedUpdate(){c.setParameter('moveX',Math.sin(time.fixedTotalTime)*.3);c.setParameter('speed',.3);}};}\n`,
  "crate.js": `export default function({entity,audio}){return {onStart(){audio.play('tone',{bus:'SFX',volume:.08,entity,spatial:true,priority:0});}};}\n`,
};
const project = {
  version: "0.6",
  projectId: "",
  name: "第三批完整示例：角色与补给箱",
  scene: { nodes },
  scripts,
  activeFileId: "player.js",
  modelRefs: [
    { assetId: "Player", fileName: "third-player.glb" },
    { assetId: "Mirror", fileName: "third-mirror.glb" },
    { assetId: "Crate", fileName: "third-crate.glb" },
    { assetId: "MeshPlatform", fileName: "third-platform.glb" },
  ],
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
    textures: [
      {
        id: "icon",
        name: "本地图标.png",
        mime: "image/png",
        byteLength: png.length,
      },
    ],
    prefabs: {},
    prefabInstances: {},
    audio: [
      {
        id: "tone",
        name: "脚步与按钮.wav",
        mime: "audio/wav",
        byteLength: tone.length,
      },
      {
        id: "music",
        name: "流式背景音乐.wav",
        mime: "audio/wav",
        byteLength: music.length,
        stream: true,
      },
    ],
    physics: {
      groups: [
        { name: "Default", mask: 3 },
        { name: "Trigger", mask: 1 },
      ],
      debug: false,
    },
    animationControllers: { locomotion: controls },
    retargetProfiles: {
      mirror: {
        id: "mirror",
        name: "兼容骨架异名映射",
        scale: 1,
        mapping: {
          Root: "OtherRoot",
          Spine: "OtherSpine",
          LeftLeg: "OtherLeft",
          RightLeg: "OtherRight",
        },
        sourcePose: {},
        targetPose: {},
      },
    },
    mixer: {
      buses: [
        {
          id: "Master",
          name: "Master",
          parentId: null,
          volume: 1,
          mute: false,
        },
        ...["Music", "SFX", "UI"].map((id) => ({
          id,
          name: id,
          parentId: "Master",
          volume: 1,
          mute: false,
        })),
      ],
      snapshots: [
        {
          id: "pause",
          name: "暂停菜单",
          buses: {
            Music: { volume: 0.25, mute: false },
            SFX: { volume: 0.2, mute: false },
            UI: { volume: 1, mute: false },
          },
        },
      ],
      ducking: [
        {
          sourceBus: "SFX",
          targetBus: "Music",
          amount: 0.5,
          attack: 0.03,
          release: 0.2,
        },
      ],
      maxVoices: 16,
    },
    gameplay: {
      captureInput: true,
      actions,
      defaults: structuredClone(actions),
      hud: [
        hud("status", "text", "加载中", 3, 3, { width: 70, height: 8 }),
        hud(
          "hint",
          "richtext",
          "[b]WASD[/b] 移动 / 空格跳跃 · 斜坡 / 台阶 / 平台 / 关节门",
          3,
          12,
          { width: 75, height: 8 },
        ),
        hud("pause", "button", "暂停菜单", 82, 3, { width: 16, height: 10 }),
        hud("stick", "joystick", "", 3, 65, {
          width: 20,
          height: 30,
          joystick: {
            mode: "floating",
            radius: 60,
            deadzone: 0.15,
            actionX: "moveX",
            actionY: "moveZ",
          },
        }),
        hud("jump", "button", "跳跃", 82, 78, {
          action: "jump",
          width: 16,
          height: 12,
        }),
        hud("menu", "container", "暂停菜单", 50, 40, {
          anchorX: 0.5,
          anchorY: 0.5,
          width: 60,
          height: 40,
          layout: "column",
          gap: 8,
          visible: false,
          blockInput: true,
        }),
        hud("icon", "image", "本地图标", 0, 0, {
          parentId: "menu",
          textureId: "icon",
          width: 8,
          height: 20,
        }),
        hud("resume", "button", "继续", 0, 0, {
          parentId: "menu",
          width: 100,
          height: 22,
          tabIndex: 0,
        }),
        hud("rate", "button", "音乐倍率：1", 0, 0, {
          parentId: "menu",
          width: 100,
          height: 22,
          tabIndex: 1,
        }),
        hud("rebind", "button", "修改跳跃键（Esc 取消）", 0, 0, {
          parentId: "menu",
          width: 100,
          height: 22,
          tabIndex: 2,
        }),
      ],
    },
  },
};
const files = {
  "project.json": strToU8(JSON.stringify(project)),
  "assets/third-player.glb": source,
  "assets/third-mirror.glb": target,
  "assets/third-crate.glb": crate,
  "assets/third-platform.glb": crate,
  "audio/tone.bin": tone,
  "audio/music.bin": music,
  "textures/icon.bin": png,
};
const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { useEditorStore: store } = await server.ssrLoadModule(
      "/src/store/useEditorStore.ts",
    ),
    archive = await server.ssrLoadModule("/src/utils/projectExport.ts");
  await archive.importProject(new File([zipSync(files)], "example.arkglide"));
  const s = () => store.getState();
  const child = s().createPrefab("CrateGroup", "补给箱");
  const parent = s().addNode("empty", "补给箱组合");
  s().updateTransform(parent, { transform: { x: 6, y: 2, z: -3 } });
  const instance = s().instantiatePrefab(child);
  s().setParent(instance, parent);
  s().createPrefab(parent, "补给箱组合");
  const out = archive.createProjectArchive();
  fs.writeFileSync(new URL("third-full.arkglide", dir), out);
  fs.writeFileSync(new URL("third-player.glb", dir), source);
  fs.writeFileSync(new URL("third-mirror.glb", dir), target);
  fs.writeFileSync(new URL("third-crate.glb", dir), crate);
  fs.writeFileSync(new URL("third-music.wav", dir), music);
  fs.writeFileSync(new URL("third-tone.wav", dir), tone);
  const { unzipSync, strFromU8 } = await import("fflate");
  fs.writeFileSync(
    new URL("third-full.json", dir),
    strFromU8(unzipSync(out)["project.json"]),
  );
  console.log("Created full third-batch example", out.length, "bytes");
} finally {
  await server.close();
}
