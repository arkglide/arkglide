import fs from "node:fs";
import { zipSync, strToU8 } from "fflate";
const root = new URL("../examples/", import.meta.url);
const body = (motion = "static") => ({
  motion,
  shape: "box",
  size: { x: 1, y: 1, z: 1 },
  mass: 2,
  friction: 0.5,
  restitution: 0,
  sensor: false,
  lockRotation: false,
  linearDamping: 0,
  angularDamping: 0,
});
const node = (id, type, position, size, extra = {}) => ({
  id,
  name: id,
  type,
  transform: { x: position[0], y: position[1], z: position[2] },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: size[0], y: size[1], z: size[2] },
  visible: true,
  scripts: [],
  ...extra,
});
const mesh = (id, position, size, color) =>
  node(id, "mesh", position, size, {
    primitive: "box",
    color,
    physics: body(),
  });
const nodes = [
  mesh("Floor", [0, -0.15, 0], [24, 0.3, 24], "#B1BBC8"),
  mesh("Front", [0, 3, 10], [24, 6, 0.3], "#D9E1E8"),
  mesh("Back", [0, 3, -10], [24, 6, 0.3], "#D9E1E8"),
  mesh("Left", [-12, 3, 0], [0.3, 6, 20], "#ABB9CD"),
  mesh("Right", [12, 3, 0], [0.3, 6, 20], "#BBCDDB"),
  node("MovingPanel", "mesh", [4, 2, -2], [4, 4, 0.3], {
    primitive: "box", color: "#7E99B6", physics: body("kinematic"),
  }),
  node("Twin1", "mesh", [3, 0.4, 4], [0.45, 0.45, 0.45], {
    primitive: "box", color: "#B295F7", physics: body("dynamic"),
  }),
  node("Twin2", "mesh", [3, 0.4, 3.2], [0.45, 0.45, 0.45], {
    primitive: "box", color: "#B295F7", physics: body("dynamic"),
  }),
  node("Player", "empty", [0, 2, -6], [1, 1, 1], {
    scripts: ["main.js"],
    character: {
      radius: 0.3,
      height: 1.8,
      stepHeight: 0.3,
      maxSlope: 45,
      speed: 4,
      jumpSpeed: 5,
      movementMode: "inertial",
      groundAcceleration: 40,
      airAcceleration: 6,
      groundFriction: 8,
    },
  }),
  node("Crate1", "mesh", [1, 0.4, 0], [0.7, 0.7, 0.7], {
    primitive: "box",
    color: "#F1A85F",
    physics: body("dynamic"),
  }),
  node("Crate2", "mesh", [-1, 0.4, 2], [0.7, 0.7, 0.7], {
    primitive: "box",
    color: "#55C8B4",
    physics: body("dynamic"),
  }),
  node("Marker", "mesh", [7, 2.3, 5], [1, 1, 1], {
    primitive: "sphere",
    color: "#CF3E60",
  }),
  node("Observer", "empty", [-7, 5, -7], [1, 1, 1]),
  node("Light", "light", [0, 5, 0], [1, 1, 1], {
    lightType: "point",
    intensity: 1.4,
    color: "#FFFFFF",
  }),
];
const label = (id, text, x, y, extra = {}) => ({
  id,
  kind: "text",
  text,
  x,
  y,
  color: "#FFFFFF",
  background: "#15202B",
  fontSize: 16,
  ...extra,
});
const button = (id, text, x) =>
  label(id, text, x, 92, { kind: "button", width: 18, height: 5 });
const actions = [
  ["moveX", ["KeyD"], ["KeyA"]],
  ["moveZ", ["KeyW"], ["KeyS"]],
  ["jump", ["Space"], []],
  ["interact", ["KeyE"], []],
  ["camera", ["KeyF"], []],
  ["reset", ["KeyR"], []],
].map(([name, positive, negative]) => ({ name, positive, negative }));
const project = {
  version: "0.6",
  name: "ArkGlide 视角与传送门验收场景",
  projectId: "",
  scene: { nodes },
  scripts: {
    "main.js": fs.readFileSync(
      new URL("portal-lab-scripts/main.js", root),
      "utf8",
    ),
  },
  activeFileId: "main.js",
  modelRefs: [],
  settings: {
    gravity: { x: 0, y: -9.8, z: 0 },
    backgroundColor: "#15202B",
    ambientIntensity: 0.65,
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
    audio: [],
    physics: { groups: [{ name: "Default", mask: 1 }], debug: false },
    mixer: {
      buses: [
        {
          id: "Master",
          name: "Master",
          parentId: null,
          volume: 1,
          mute: false,
        },
      ],
      snapshots: [],
      ducking: [],
      maxVoices: 32,
    },
    animationControllers: {},
    retargetProfiles: {},
    gameplay: {
      captureInput: true,
      actions,
      hud: [
        label("title", "ArkGlide · 通用视角 / 传送门实验室", 3, 3),
        label(
          "hint",
          "WASD 移动 · 空格跳跃 · 左/右键放门 · E 拿放物体 · F 切换视角 · R 复位",
          3,
          8,
        ),
        label("lock", "点击画面锁定鼠标", 3, 13),
        label("mode", "视角：firstPerson", 3, 18),
        label("status", "穿越次数：0", 3, 23),
        label("crosshair", "+", 50, 50, {
          anchorX: 0.5,
          anchorY: 0.5,
          fontSize: 26,
          background: "#15202B",
        }),
        button("wallPair", "墙面互传", 2),
        button("floorPair", "地面 → 墙面", 21),
        button("launch", "高处落入门", 40),
        button("movingPair", "移动平板门", 59),
        button("assembly", "关节组穿越", 78),
      ],
    },
  },
};
fs.writeFileSync(
  new URL("portal-lab.json", root),
  JSON.stringify(project, null, 2),
);
fs.writeFileSync(
  new URL("portal-lab.arkglide", root),
  zipSync({ "project.json": strToU8(JSON.stringify(project)) }, { level: 6 }),
);
console.log("Portal lab project generated.");
