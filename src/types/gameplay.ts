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
export interface UIStyle {
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  outlineColor?: string;
  borderWidth?: number;
  borderRadius?: number | string;
  borderStyle?: "none" | "solid" | "dashed" | "dotted" | "double";
  padding?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  opacity?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number | "normal" | "bold" | "lighter" | "bolder";
  fontStyle?: "normal" | "italic" | "oblique";
  textAlign?: "left" | "center" | "right" | "start" | "end" | "justify";
  lineHeight?: number;
  letterSpacing?: number;
  alignItems?:
    | "start"
    | "end"
    | "center"
    | "stretch"
    | "baseline"
    | "flex-start"
    | "flex-end";
  justifyContent?:
    | "start"
    | "end"
    | "center"
    | "space-between"
    | "space-around"
    | "space-evenly"
    | "flex-start"
    | "flex-end";
  whiteSpace?: "normal" | "pre" | "pre-wrap" | "nowrap";
  overflow?: "visible" | "hidden" | "clip" | "auto";
  textOverflow?: "clip" | "ellipsis";
  objectFit?: "contain" | "cover" | "fill" | "none" | "scale-down";
  mixBlendMode?:
    | "normal"
    | "multiply"
    | "screen"
    | "overlay"
    | "darken"
    | "lighten"
    | "difference"
    | "exclusion";
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  boxShadow?: string;
  textShadow?: string;
  outlineWidth?: number;
  outlineOffset?: number;
}
export type UIState = "hover" | "focus" | "pressed" | "disabled";
export type UIStyleDefinition = Partial<Record<"base" | UIState, UIStyle>>;
export interface HUDItem {
  id: string;
  classes?: string[];
  style?: UIStyle;
  stateStyles?: UIStyleDefinition;
  positionUnit?: "px" | "percent";
  sizeUnit?: "px" | "percent";
  shape?: "rect" | "ellipse";
  kind:
    | "shape"
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
  styles?: Record<string, UIStyleDefinition>;
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
