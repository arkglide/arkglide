export interface PhysicsComponent {
  motion: "static" | "dynamic" | "kinematic";
  shape: "box" | "sphere" | "capsule";
  size: { x: number; y: number; z: number };
  mass: number;
  friction: number;
  restitution: number;
  sensor: boolean;
  lockRotation: boolean;
}
export interface AnimationComponent {
  clip: string;
  autoplay: boolean;
  loop: boolean;
  speed: number;
}
export interface AudioSourceComponent {
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
}
export interface InputAction {
  name: string;
  positive: string[];
  negative: string[];
}
export interface HUDItem {
  id: string;
  kind: "text" | "button";
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
