export interface PhysicsComponent {
  linearDamping?: number;
  angularDamping?: number;
  motion: "static" | "dynamic" | "kinematic";
  shape: "box" | "sphere" | "capsule" | "convex" | "mesh";
  group?: string;
  parts?: string[];
  size: { x: number; y: number; z: number };
  mass: number;
  friction: number;
  restitution: number;
  sensor: boolean;
  lockRotation: boolean;
}
export interface AnimationComponent {
  controllerId?: string;
  rootMotion?: { target: string; translation: boolean; rotation: boolean };
  retarget?: { sourceId: string; profileId: string };
  clip: string;
  autoplay: boolean;
  loop: boolean;
  speed: number;
}
export interface AudioSourceComponent {
  rate?: number;
  bus?: string;
  stream?: boolean;
  preservePitch?: boolean;
  priority?: number;
  assetId: string;
  autoplay: boolean;
  loop: boolean;
  volume: number;
  spatial: boolean;
  refDistance: number;
}
export interface AudioAsset {
  id: string;
  name: string;
  mime: string;
  byteLength: number;
  stream?: boolean;
}
export interface InputAction {
  gamepad?: {
    kind: "button" | "axis";
    index: number;
    direction: 1 | -1;
    deadzone: number;
  }[];
  name: string;
  positive: string[];
  negative: string[];
}
export interface HUDItem {
  id: string;
  kind:
    | "text"
    | "button"
    | "container"
    | "image"
    | "richtext"
    | "input"
    | "joystick";
  parentId?: string | null;
  width?: number;
  height?: number;
  unit?: "px" | "percent";
  anchorX?: number;
  anchorY?: number;
  margin?: number;
  gap?: number;
  columns?: number;
  layout?: "absolute" | "row" | "column" | "grid";
  zIndex?: number;
  disabled?: boolean;
  visible?: boolean;
  textureId?: string;
  blockInput?: boolean;
  tabIndex?: number;
  joystick?: {
    mode: "fixed" | "floating";
    radius: number;
    deadzone: number;
    actionX: string;
    actionY: string;
  };
  text: string;
  x: number;
  y: number;
  color: string;
  background: string;
  fontSize: number;
  direction?: 1 | -1;
  action?: string;
}
export interface GameplayConfig {
  defaults?: InputAction[];
  actions: InputAction[];
  hud: HUDItem[];
  captureInput: boolean;
}
export const defaultGameplay = (): GameplayConfig => ({
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
  hud: [],
});
export const defaultPhysics = (): PhysicsComponent => ({
  motion: "dynamic",
  shape: "box",
  size: { x: 1, y: 1, z: 1 },
  mass: 1,
  friction: 0.5,
  restitution: 0,
  sensor: false,
  lockRotation: false,
});
