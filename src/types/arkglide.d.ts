// Script-facing API. Loaded into both Monaco language services as an ambient lib.
// Keep in sync with public/arkglide-api.js and public/runtime.html.
interface Vec3 {
  x: number;
  y: number;
  z: number;
}
interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}
interface Vec2 {
  x: number;
  y: number;
}
type PrimitiveType =
  | "box"
  | "sphere"
  | "plane"
  | "cylinder"
  | "capsule"
  | "torus";

/** Engine-independent entity handle. Obtain via this.entity or scene, not new Entity(). */
interface Entity {
  readonly id: string;
  readonly destroyed: boolean;
  name: string;
  /** Live local position. Component edits and full-vector assignment update the entity. */
  position: Vec3;
  /** Legacy alias for position. */
  transform: Vec3;
  /** Live Euler rotation in radians. */
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  getId(): string;
  getName(): string;
  setName(name: string): void;
  /** Returns a copy. Change position/transform or use a setter to write back. */
  getPosition(): Vec3;
  setPosition(x: number, y: number, z: number): void;
  setPosition(value: Vec3): void;
  getRotation(): Vec3;
  setRotation(x: number, y: number, z: number): void;
  setRotation(value: Vec3): void;
  getWorldPosition(): Vec3;
  /** Column-major world matrix, including ancestor transforms. */
  getWorldMatrix(): number[];
  getScale(): Vec3;
  setScale(x: number, y: number, z: number): void;
  setScale(value: Vec3): void;
  /** Add a local-position offset; use time.deltaTime for speed in units/second. */
  translate(x: number, y: number, z: number): void;
  translate(offset: Vec3): void;
  /** Add Euler angles in radians. */
  rotate(x: number, y: number, z: number): void;
  rotate(angles: Vec3): void;
  isVisible(): boolean;
  setVisible(visible: boolean): void;
  /** Idempotent. Other operations on a destroyed entity throw an error. */
  destroy(): void;
}

interface InputAPI {
  /** Keys use KeyboardEvent.key, case insensitive: 'w', 'ArrowUp', ' ' (space). */
  isKeyDown(key: string): boolean;
  wasKeyPressed(key: string): boolean;
  wasKeyReleased(key: string): boolean;
  /** -1, 0 or 1. Opposite keys cancel each other. */
  getAxis(negativeKey: string, positiveKey: string): number;
  getMousePosition(): Vec2;
  /** Accumulated movement this frame while a mouse button is held. */
  getMouseDelta(): Vec2;
  isMouseDown(): boolean;
  wasMousePressed(): boolean;
  wasMouseReleased(): boolean;
}

interface SceneAPI {
  /** Find by stable ID (not display name). Returns null when absent. */
  find(id: string): Entity | null;
  /** First entity with this display name; names need not be unique. */
  findByName(name: string): Entity | null;
  findAllByName(name: string): Entity[];
  /** Create a primitive. Duplicate explicit IDs throw; generated IDs are unique. */
  create(type: PrimitiveType, id?: string): Entity;
  findAll(): Entity[];
  destroy(id: string): void;
  destroyAll(): void;
  getEntityCount(): number;
}

interface TimeAPI {
  /** Frame interval in seconds; zero on start and the first frame after resume. */
  readonly deltaTime: number;
  /** Simulation time in seconds, excluding pauses. */
  readonly totalTime: number;
  readonly frameCount: number;
  readonly unscaledDeltaTime: number;
  readonly unscaledTotalTime: number;
  readonly fixedDeltaTime: number;
  readonly fixedTotalTime: number;
  readonly fixedFrameCount: number;
  readonly interpolationAlpha: number;
  /** 0 freezes simulation time and timers; range 0..100. */
  timeScale: number;
}

interface ScriptThis {
  entity: Entity;
}
interface ScriptLifecycle {
  onStart?(this: ScriptInstance): void;
  onUpdate?(this: ScriptInstance): void;
  /** Use time.fixedDeltaTime; runs zero or multiple times before onUpdate. */
  onFixedUpdate?(this: ScriptInstance): void;
  /** Once, before entity disposal or when stopping the run. */
  onDestroy?(this: ScriptInstance): void;
  // Scripts can keep per-instance state on the returned object.
  [key: string]: any;
}
interface ScriptInstance extends ScriptLifecycle, ScriptThis {}

/** Optional helper: infer custom state while supplying a typed this.entity. */
declare function defineScript<T extends object>(
  script: T & ThisType<T & ScriptThis>,
): T;
// Injected factory arguments. In legacy scripts with an empty scene, entity is null.
// Bound entity scripts always receive an Entity.
declare const entity: Entity;
declare const input: InputAPI;
declare const scene: SceneAPI;
declare const time: TimeAPI;

/** Plain values; the runtime releases all internal WASM allocations. */
interface MathAPI {
  readonly backend: "wasm" | "javascript";
  vec3: {
    add(a: Vec3, b: Vec3): Vec3;
    sub(a: Vec3, b: Vec3): Vec3;
    dot(a: Vec3, b: Vec3): number;
    cross(a: Vec3, b: Vec3): Vec3;
    length(a: Vec3): number;
    distance(a: Vec3, b: Vec3): number;
    scale(a: Vec3, s: number): Vec3;
    normalize(a: Vec3): Vec3;
    lerp(a: Vec3, b: Vec3, t: number): Vec3;
  };
  mat4: {
    identity(): number[];
    multiply(a: readonly number[], b: readonly number[]): number[];
    translation(p: Vec3): number[];
    scaling(s: Vec3): number[];
    rotation(angle: number, axis: Vec3): number[];
    compose(position: Vec3, rotation: Vec3, scale: Vec3): number[];
    transformPoint(matrix: readonly number[], point: Vec3): Vec3;
  };
  quat: {
    normalize(q: Quat): Quat;
    fromEuler(euler: Vec3): Quat;
    slerp(a: Quat, b: Quat, t: number): Quat;
    toMatrix(q: Quat): number[];
  };
}
declare const math: MathAPI;

interface TimersAPI {
  /** Scaled game seconds. Returned function cancels this timer. */
  after(seconds: number, callback: () => void): () => void;
  /** Coalesces missed intervals to one callback per frame. */
  every(seconds: number, callback: () => void): () => void;
}
interface EventsAPI {
  on<T = unknown>(name: string, callback: (payload: T) => void): () => void;
  once<T = unknown>(name: string, callback: (payload: T) => void): () => void;
  emit(name: string, payload?: unknown): void;
  /** Track a native listener; it is removed on script/entity destruction. */
  listen(
    target: EventTarget,
    name: string,
    callback: (event: Event) => void,
    options?: boolean | AddEventListenerOptions,
  ): () => void;
}
declare const timers: TimersAPI;
declare const events: EventsAPI;

interface PrefabDescriptor {
  readonly id: string;
  readonly name: string;
  readonly revision: number;
  readonly nodeCount: number;
}
interface PrefabSpawnOptions {
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  parent?: Entity;
}
interface PrefabHandle {
  readonly root: Entity;
  readonly entities: readonly Entity[];
  /** ID within the template, not the generated scene ID. */
  find(localNodeId: string): Entity | null;
  findByName(name: string): Entity | null;
  /** Destroy root, descendants, scripts, timers and subscriptions. */
  destroy(): void;
}
interface PrefabsAPI {
  list(): PrefabDescriptor[];
  findByName(name: string): PrefabDescriptor | null;
  /** Resolves after models load and all factories/onStart run; rejects on stop or owner destruction. */
  instantiate(
    prefabId: string,
    options?: PrefabSpawnOptions,
  ): Promise<PrefabHandle>;
}
declare const prefabs: PrefabsAPI;

interface PhysicsOptions {
  motion: "static" | "dynamic" | "kinematic";
  shape: "box" | "sphere" | "capsule" | "convex" | "mesh";
  group?: string;
  parts?: string[];
  size: Vec3;
  mass: number;
  friction: number;
  restitution: number;
  sensor: boolean;
  lockRotation: boolean;
}
interface ContactEvent {
  phase: "enter" | "exit";
  self: Entity;
  other: Entity;
  sensor: boolean;
}
interface PhysicsAPI {
  readonly backend: "jolt-wasm";
  has(entity: Entity): boolean;
  /** Collision dimensions are local units; world scale is applied once. */
  add(entity: Entity, options: PhysicsOptions): void;
  remove(entity: Entity): void;
  getVelocity(entity: Entity): Vec3;
  setVelocity(entity: Entity, value: Vec3): void;
  addImpulse(entity: Entity, value: Vec3): void;
  /** World position, unlike Entity.position which is local. Velocity is preserved. */
  teleport(entity: Entity, worldPosition: Vec3): void;
  /** Contact callbacks run after the fixed step, outside the WASM solver. */
  onContact(
    entity: Entity | null,
    callback: (event: ContactEvent) => void,
  ): () => void;
}
interface AudioPlayOptions {
  loop?: boolean;
  volume?: number;
  rate?: number;
  spatial?: boolean;
  entity?: Entity;
  refDistance?: number;
}
interface AudioVoice {
  readonly playing: boolean;
  stop(): void;
  setVolume(value: number): void;
}
interface AudioAPI {
  readonly state: string;
  list(): string[];
  unlock(): Promise<boolean>;
  play(assetId: string, options?: AudioPlayOptions): AudioVoice;
  setMasterVolume(value: number): void;
}
interface HUDOptions {
  id: string;
  text?: string;
  x?: number;
  y?: number;
  fontSize?: number;
  color?: string;
  background?: string;
  action?: string;
  direction?: 1 | -1;
}
interface HUDHandle {
  readonly id: string;
  readonly text: string;
  setText(value: unknown): void;
  setVisible(value: boolean): void;
  destroy(): void;
}
interface UIAPI {
  get(id: string): HUDHandle | null;
  createText(options: HUDOptions): HUDHandle;
  createButton(options: HUDOptions, onClick?: () => void): HUDHandle;
}
interface AnimationHandle {
  readonly playing: boolean;
  stop(): void;
}
interface AnimationAPI {
  list(entity: Entity): string[];
  play(
    entity: Entity,
    clip: string,
    options?: { loop?: boolean; speed?: number; fade?: number },
  ): AnimationHandle;
  stop(entity: Entity): void;
}
interface InputAPI {
  /** Action names from project resources; keyboard bindings use KeyboardEvent.code. */
  getAction(name: string): number;
  isActionDown(name: string): boolean;
  wasActionPressed(name: string): boolean;
  wasActionReleased(name: string): boolean;
}
declare const physics: PhysicsAPI;
declare const audio: AudioAPI;
declare const ui: UIAPI;
declare const animation: AnimationAPI;

/** Explicit ES-module factories receive APIs owned by the entity/script instance. */
interface ScriptContext {
  entity: Entity;
  input: InputAPI;
  scene: SceneAPI;
  time: TimeAPI;
  console: Console;
  defineScript: typeof defineScript;
  math: MathAPI;
  events: EventsAPI;
  timers: TimersAPI;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  prefabs: PrefabsAPI;
  physics: PhysicsAPI;
  audio: AudioAPI;
  ui: UIAPI;
  animation: AnimationAPI;
}

/** Advanced third-batch APIs. User scripts remain JavaScript. */
interface PhysicsQueryFilter {
  group?: string;
  mask?: number;
  sensors?: boolean;
  ignore?: (Entity | string)[];
  all?: boolean;
  /** Unit quaternion: shape cast and overlap only. */
  rotation?: Quat;
}
type PhysicsQueryShape =
  | { kind: "box"; size: Vec3 }
  | { kind: "sphere"; radius: number }
  | { kind: "capsule"; radius: number; height: number };
interface PhysicsHit {
  entity: Entity;
  point: Vec3;
  normal: Vec3;
  fraction: number;
  distance: number;
  penetration?: number;
}
interface CharacterOptions {
  radius: number;
  height: number;
  stepHeight: number;
  maxSlope: number;
  speed: number;
  jumpSpeed: number;
  group?: string;
}
interface CharacterHandle {
  /** World X/Z direction; magnitude clamped to 1 and multiplied by configured speed. */
  move(direction: Vec3): void;
  jump(): void;
  teleport(worldPosition: Vec3): void;
  readonly grounded: boolean;
  readonly velocity: Vec3;
  readonly groundNormal: Vec3;
}
interface JointOptions {
  kind: "fixed" | "hinge" | "slider" | "distance";
  anchor?: Vec3;
  anchor2?: Vec3;
  axis?: Vec3;
  min?: number;
  max?: number;
  motor?: { velocity: number; force: number };
}
interface JointHandle {
  readonly id: string;
  readonly active: boolean;
  destroy(): void;
}
interface PhysicsAPI {
  raycast(
    origin: Vec3,
    direction: Vec3,
    filter?: PhysicsQueryFilter & { all?: false },
  ): PhysicsHit | null;
  raycast(
    origin: Vec3,
    direction: Vec3,
    filter: PhysicsQueryFilter & { all: true },
  ): PhysicsHit[];
  shapeCast(
    shape: PhysicsQueryShape,
    position: Vec3,
    direction: Vec3,
    filter?: PhysicsQueryFilter & { all?: false },
  ): PhysicsHit | null;
  shapeCast(
    shape: PhysicsQueryShape,
    position: Vec3,
    direction: Vec3,
    filter: PhysicsQueryFilter & { all: true },
  ): PhysicsHit[];
  overlap(
    shape: PhysicsQueryShape,
    position: Vec3,
    filter?: PhysicsQueryFilter,
  ): PhysicsHit[];
  character(entity: Entity): CharacterHandle;
  addCharacter(entity: Entity, options: CharacterOptions): CharacterHandle;
  removeCharacter(entity: Entity): void;
  /** Script API anchors are world coordinates; Inspector anchors are local to their endpoints. */
  createJoint(
    entity: Entity,
    target: Entity,
    options: JointOptions,
  ): JointHandle;
  setDebug(value: boolean): void;
}
interface AnimationControllerHandle {
  readonly state: string;
  setParameter(name: string, value: number | boolean): void;
  getParameter(name: string): number | boolean;
  setState(name: string, fade?: number): void;
  inspect(): {
    state: string;
    parameters: Record<string, number | boolean>;
    weights: { clip: string; weight: number }[];
    time: number;
  };
  destroy(): void;
}
interface AnimationEventPayload {
  entity: Entity;
  state: string;
  name: string;
  data?: string | number | boolean | null;
  time: number;
  loop: number;
}
interface RetargetOptions {
  mapping: Record<string, string>;
  scale: number;
  sourcePose?: Record<string, { position: Vec3; rotation: Quat }>;
  targetPose?: Record<string, { position: Vec3; rotation: Quat }>;
}
interface AnimationAPI {
  createController(
    entity: Entity,
    controllerId: string,
    options?: {
      rootMotion?: { target: string; translation: boolean; rotation: boolean };
    },
  ): AnimationControllerHandle;
  controller(entity: Entity): AnimationControllerHandle | null;
  onEvent(
    entity: Entity,
    callback: (event: AnimationEventPayload) => void,
  ): () => void;
  retarget(
    source: Entity,
    target: Entity,
    profileIdOrOptions: string | RetargetOptions,
  ): string[];
}
interface AudioPlayOptions {
  bus?: string;
  priority?: number;
  stream?: boolean;
  preservePitch?: boolean;
}
interface AudioVoice {
  readonly position: number;
  readonly duration: number | null;
  readonly reason?: string;
  fadeTo(volume: number, seconds?: number, stopAfter?: boolean): void;
  setRate(rate: number): void;
  pause(): void;
  resume(): void;
  /** Local media stream only. */
  seek(seconds: number): void;
}
interface AudioAPI {
  buses(): {
    id: string;
    name: string;
    parentId: string | null;
    volume: number;
    mute: boolean;
    duck: number;
  }[];
  setBusVolume(id: string, value: number): void;
  setBusMuted(id: string, value: boolean): void;
  applySnapshot(
    id: string,
    seconds?: number,
  ): { readonly transitioning: boolean; release(): void };
}
interface GamepadBinding {
  kind: "button" | "axis";
  index: number;
  direction: 1 | -1;
  deadzone: number;
}
interface ActionBinding {
  name: string;
  positive: string[];
  negative: string[];
  gamepad?: GamepadBinding[];
}
interface InputBindingResult {
  applied: boolean;
  conflicts?: { action: string; kind: string; code?: string; index?: number }[];
  cancelled?: boolean;
  code?: string;
}
interface InputAPI {
  gamepads(): { index: number; id: string; mapping: string }[];
  bindings(): ActionBinding[];
  rebind(
    name: string,
    binding: Partial<Omit<ActionBinding, "name">>,
    acceptConflicts?: boolean,
  ): InputBindingResult;
  resetBindings(name?: string): void;
  /** Captures one keyboard code. Escape cancels. Editor mappings are persisted separately. */
  captureBinding(
    name: string,
    direction?: "positive" | "negative",
  ): Promise<InputBindingResult>;
}
type UIKind =
  | "text"
  | "button"
  | "container"
  | "image"
  | "richtext"
  | "input"
  | "joystick";
interface HUDOptions {
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
}
interface UIEvent {
  id: string;
  type: "click" | "press" | "release" | "change" | "focus" | "blur";
  value: string | Vec2;
}
interface HUDHandle {
  setDisabled(value: boolean): void;
  focus(): void;
  on(type: UIEvent["type"], callback: (event: UIEvent) => void): () => void;
}
interface UIAPI {
  create(options: HUDOptions & { kind: UIKind }): HUDHandle;
}
