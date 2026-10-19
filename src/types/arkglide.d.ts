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
  "box" | "sphere" | "plane" | "cylinder" | "capsule" | "torus";

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
  /** Accumulated movement this frame: relative under pointer lock, otherwise button dragging. */
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
  linearDamping?: number;
  angularDamping?: number;
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
  phase: "enter" | "stay" | "exit";
  self: Entity;
  other: Entity;
  sensor: boolean;
}
interface PhysicsAPI {
  /** Fresh list of the native joint-connected island, including the queried body. */
  getConnectedBodies(entity: Entity): Entity[];
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
  | { kind: "capsule"; radius: number; height: number }
  | { kind: "convex"; points: Vec3[] };
interface PhysicsHit {
  entity: Entity;
  point: Vec3;
  normal: Vec3;
  fraction: number;
  distance: number;
  penetration?: number;
}
interface CharacterOptions {
  mass?: number;
  radius: number;
  height: number;
  stepHeight: number;
  maxSlope: number;
  speed: number;
  jumpSpeed: number;
  group?: string;
}
interface CharacterHandle {
  /** Clears queued movement/jump input; external velocity and impulses remain. */
  clearInput(): void;
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
  motor?: JointMotorOptions;
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
  "text" | "button" | "container" | "image" | "richtext" | "input" | "joystick" | "shape";
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

/** World-space view, inertial motion and paired apertures (radians except lens FOV). */
interface WorldPose {
  position: Vec3;
  rotation: Quat;
}
interface InputAPI {
  /** Must be invoked by a user gesture; false means unsupported, denied or canceled. */
  requestPointerLock(): Promise<boolean>;
  releasePointerLock(): void;
  isPointerLocked(): boolean;
  onPointerLockChange(callback: (locked: boolean) => void): () => void;
  isMouseButtonDown(button?: number): boolean;
  wasMouseButtonPressed(button?: number): boolean;
  wasMouseButtonReleased(button?: number): boolean;
}
interface CharacterOptions {
  movementMode?: "direct" | "inertial";
  groundAcceleration?: number;
  airAcceleration?: number;
  groundFriction?: number;
}
interface CharacterHandle {
  setVelocity(worldVelocity: Vec3): void;
  /** Delta velocity, independent of body mass. */
  addImpulse(deltaVelocity: Vec3): void;
}
interface PhysicsState extends WorldPose {
  group?: string;
  sensor?: boolean;
  kind: "static" | "dynamic" | "kinematic" | "character";
  velocity: Vec3;
  angularVelocity: Vec3;
  mass?: number;
  shape?: string;
  size?: Vec3;
  radius?: number;
  height?: number;
}
interface PhysicsAPI {
  addImpulseAt(entity: Entity, impulse: Vec3, worldPoint: Vec3): void;
  addAngularImpulse(entity: Entity, impulse: Vec3): void;
  getPointVelocity(entity: Entity, worldPoint: Vec3): Vec3;
  getState(entity: Entity): PhysicsState;
  setState(
    entity: Entity,
    state: Partial<WorldPose> & { velocity?: Vec3; angularVelocity?: Vec3 },
  ): void;
  getAngularVelocity(entity: Entity): Vec3;
  setAngularVelocity(entity: Entity, worldRadiansPerSecond: Vec3): void;
}
interface CameraLens {
  fov: number;
  near: number;
  far: number;
}
interface CameraOptions extends Partial<CameraLens> {
  id?: string;
  position?: Vec3;
  rotation?: Quat;
  active?: boolean;
}
interface CameraRay {
  origin: Vec3;
  direction: Vec3;
}
interface CameraHandle {
  readonly id: string;
  getPose(): WorldPose;
  setPose(pose: WorldPose): void;
  lookAt(worldPoint: Vec3, up?: Vec3): void;
  setLens(lens: Partial<CameraLens>): void;
  getLens(): CameraLens;
  /** Normalized screen position; direction length is the query range. */
  ray(x?: number, y?: number, length?: number): CameraRay;
  destroy(): void;
}
type CameraRigMode = "firstPerson" | "thirdPerson" | "observer" | "fixed";
interface CameraRigOptions extends CameraOptions {
  mode?: CameraRigMode;
  /** Controlled/followed actor and observer viewpoint are independent. */
  target?: Entity;
  viewpoint?: Entity;
  offset?: Vec3;
  pivotOffset?: Vec3;
  eyeOffset?: Vec3;
  followOffset?: Vec3;
  observerOffset?: Vec3;
  sensitivity?: number;
  pitchLimit?: number;
  /** Optional horizon recovery after an arbitrary world-space warp. */
  uprightSpeed?: number;
  collision?: boolean;
  collisionRadius?: number;
  lookAtTarget?: boolean;
}
interface CameraRigHandle {
  readonly camera: CameraHandle;
  look(deltaX: number, deltaY: number): void;
  direction(strafe: number, forward: number): Vec3;
  setRotation(worldRotation: Quat): void;
  setMode(mode: CameraRigMode): void;
  update(): void;
  destroy(): void;
}
interface CamerasAPI {
  create(options?: CameraOptions): CameraHandle;
  get(id: string): CameraHandle | null;
  active(): CameraHandle | null;
  setActive(camera: string | CameraHandle): void;
  createRig(options: CameraRigOptions): CameraRigHandle;
}
interface PortalOptions extends Partial<WorldPose> {
  id?: string;
  width?: number;
  height?: number;
  shape?: "ellipse" | "rectangle";
  color?: string;
  enabled?: boolean;
}
interface PortalHandle {
  readonly width: number;
  readonly height: number;
  readonly shape: "ellipse" | "rectangle";
  readonly id: string;
  readonly enabled: boolean;
  readonly linked: boolean;
  getDestination(): PortalHandle | null;
  getPose(): WorldPose;
  setPose(pose: WorldPose): void;
  setEnabled(enabled: boolean): void;
  link(other: PortalHandle | string): void;
  unlink(): void;
  place(
    origin: Vec3,
    direction: Vec3,
    options?: {
      up?: Vec3;
      ignore?: (Entity | string)[];
      throughPortals?: boolean;
    },
  ): {
    placed: boolean;
    reason?: string;
    surface?: Entity;
    point?: Vec3;
    normal?: Vec3;
  };
  mapPoint(worldPoint: Vec3): Vec3;
  mapVector(worldVector: Vec3): Vec3;
  mapRotation(worldRotation: Quat): Quat;
  destroy(): void;
}
interface PortalTrace {
  hit: PhysicsHit | null;
  segments: { origin: Vec3; end: Vec3; portalId?: string }[];
  path: string[];
  truncated: boolean;
}
interface PortalTraverseEvent {
  entity: Entity;
  source: PortalHandle;
  destination: PortalHandle;
  position: Vec3;
  velocity: Vec3;
  matrix: number[];
  /** Present for atomic assembly transport; every state is written before callbacks. */
  entities?: readonly Entity[];
}
interface PortalBlockedEvent {
  entity: Entity;
  entities: readonly Entity[];
  source: PortalHandle;
  destination: PortalHandle;
  reason: "joint-policy" | "assembly-too-large" | "assembly-exit-obstructed"
    | "traveler-does-not-fit" | "exit-does-not-fit";
}
interface PortalsAPI {
  getTraversalLimits(): { maxSubSteps: number; maxStepTime: number; maxTravelDistance: number };
  setTraversalLimits(patch: Partial<{ maxSubSteps: number; maxStepTime: number; maxTravelDistance: number }>): void;
  create(options?: PortalOptions): PortalHandle;
  get(id: string): PortalHandle | null;
  /** Centered box mesh (static/dynamic/kinematic), fixed positive world scale and matching collision bounds. */
  addSurface(
    entity: Entity,
    options?: PortalSurfaceOptions,
  ): PortalSurfaceHandle;
  watch(
    entity: Entity,
    options?: { keepUpright?: boolean; visualMargin?: number },
  ): { entity: Entity; destroy(): void };
  /** Atomic whole-island transport; requires dynamic members without world anchors. */
  watchAssembly(
    entity: Entity,
    options?: { keepUpright?: boolean; maxBodies?: number; visualMargin?: number },
  ): { readonly entities: readonly Entity[]; destroy(): void };
  raycast(
    origin: Vec3,
    direction: Vec3,
    filter?: PhysicsQueryFilter & { maxHops?: number },
  ): PortalTrace;
  onTraverse(callback: (event: PortalTraverseEvent) => void): () => void;
  onBlocked(callback: (event: PortalBlockedEvent) => void): () => void;
  setQuality(options: {
    depth?: number;
    scale?: number;
    recursiveScale?: number;
    samples?: 1 | 2 | 4 | 8;
    maxViews?: number;
    maxPixels?: number;
    minArea?: number;
    minResolution?: number;
    particles?: boolean;
  }): void;
}
interface GrabHandle {
  readonly entity: Entity;
  readonly active: boolean;
  setTarget(worldPosition: Vec3, worldRotation?: Quat): void;
  setRay(
    origin: Vec3,
    direction: Vec3,
    distance?: number,
    options?: { segment?: number; ignore?: (Entity | string)[] },
  ): void;
  release(): void;
}
interface InteractionAPI {
  grab(
    entity: Entity,
    options?: {
      position?: Vec3;
      rotation?: Quat;
      stiffness?: number;
      damping?: number;
      maxForce?: number;
      maxDistance?: number;
      /** Entrance portal IDs from holder to picked object; pass PortalTrace.path. */
      path?: string[];
      /** Defaults to the owning script's entity. */
      holder?: Entity;
    },
  ): GrabHandle;
}
declare const cameras: CamerasAPI;
declare const portals: PortalsAPI;
declare const interaction: InteractionAPI;
interface ScriptContext {
  cameras: CamerasAPI;
  portals: PortalsAPI;
  interaction: InteractionAPI;
}

/** General gameplay foundations. World distances are engine units; no game rules are implicit. */
interface PhysicsOptions { gravityFactor?: number; }
interface ContactEvent {
  /** Unit normal from self toward other. Exit events retain the last known manifold. */
  normal: Vec3;
  point: Vec3 | null;
  points: Vec3[];
  subShape: number;
  otherSubShape: number;
}
interface PhysicsHit { subShape?: number; }
interface ContactMaterialOverride { friction?: number; restitution?: number; /** Relative velocity of body 2's surface against body 1. */ surfaceVelocity?: Vec3; }
interface BodyPropertyPatch { mass?: number; friction?: number; restitution?: number; gravityFactor?: number; linearDamping?: number; angularDamping?: number; }
interface PhysicsAPI {
  getProperties(entity: Entity): PhysicsOptions;
  configure(entity: Entity, patch: BodyPropertyPatch): void;
  /** Retains BodyID/COM frame and joints. Unregister portal surfaces before shape changes. */
  updateShape(entity: Entity, patch: Partial<Pick<PhysicsOptions, 'shape' | 'size' | 'parts'>>): void;
  /** Newtons, applied over the next full fixed step, including portal substeps. */
  applyForce(entity: Entity, force: Vec3, worldPoint?: Vec3): void;
  applyTorque(entity: Entity, torque: Vec3): void;
  /** Pure pre-solver callback: return material overrides, never mutate the scene/physics here. */
  onContactMaterial(entity: Entity | null, callback: (event: ContactEvent) => ContactMaterialOverride | void): () => void;
  getJoints(entity?: Entity): JointHandle[];
  setQueryLimits(limits: { maxConvexVertices: number }): void;
}
interface CharacterOptions { gravity?: Vec3; gravityFactor?: number; controlEnabled?: boolean; }
interface CharacterHandle {
  /** false means a shape enlargement is obstructed; all configuration remains unchanged. */
  configure(patch: Partial<Omit<CharacterOptions, 'group'>>, resize?: { keepFeet?: boolean; maxPenetration?: number }): boolean;
  getConfig(): CharacterOptions;
  getGround(): { entity: Entity | null; point: Vec3; normal: Vec3; velocity: Vec3 } | null;
  applyForce(force: Vec3): void;
}
interface JointMotorOptions { mode?: 'off' | 'velocity' | 'position'; velocity?: number; position?: number; force?: number; frequency?: number; damping?: number; }
interface JointHandle {
  readonly kind: JointOptions['kind'];
  readonly entities: readonly Entity[];
  setMotor(options: JointMotorOptions): void;
  /** Hinge limits use radians; slider/distance limits use world distances. */
  setLimits(min: number, max: number): void;
  getState(): { kind: JointOptions['kind']; current: number | null; min: number | null; max: number | null; motor: JointMotorOptions; /** Native motor impulse for the most recent substep, not force. */ motorImpulse: number | null };
}
interface TextureHandle { readonly active: boolean; readonly ready: Promise<TextureHandle>; destroy(): void; }
interface MaterialOptions { color?: string; emissive?: string; alpha?: number; unlit?: boolean; doubleSided?: boolean; wireframe?: boolean; texture?: TextureHandle | null; emissiveTexture?: TextureHandle | null; }
interface MaterialHandle {
  readonly active: boolean;
  update(patch: MaterialOptions): void;
  apply(entity: Entity, options?: { includeChildren?: boolean }): void;
  detach(entity: Entity): void;
  destroy(): void;
}
interface MeshGeometry { positions: number[]; indices: number[]; normals?: number[]; uvs?: number[]; }
interface VisualMeshOptions { id?: string; name?: string; parent?: Entity; pose?: WorldPose; material?: MaterialHandle; }
interface VisualMeshHandle {
  readonly entity: Entity;
  readonly active: boolean;
  updateGeometry(data: MeshGeometry): void;
  setMaterial(material: MaterialHandle): void;
  setPose(worldPose: WorldPose): void;
  destroy(): void;
}
interface BeamOptions extends VisualMeshOptions { segments: { origin: Vec3; end: Vec3 }[]; radius: number; sides?: number; color?: string; }
interface BeamHandle { readonly entity: Entity; readonly active: boolean; update(patch: Partial<BeamOptions>): void; destroy(): void; }
interface ParticleOptions {
  backend?: 'cpu' | 'gpu' | 'auto';
  blendMode?: 'standard' | 'additive' | 'multiply';
  gravity?: Vec3;
  emitBox?: { min: Vec3; max: Vec3 };
  angularSpeed?: [number, number];
  capacity: number; rate: number; lifetime: [number, number]; size: [number, number]; velocity: { min: Vec3; max: Vec3 }; colors: [string, string]; texture?: TextureHandle; entity?: Entity; position?: Vec3;
}
interface ParticleHandle { readonly active: boolean; readonly backend: 'cpu' | 'gpu'; start(): void; stop(): void; destroy(): void; }
interface VisualsAPI {
  createMaterial(options?: MaterialOptions): MaterialHandle;
  createTexture(options: { assetId: string; invertY?: boolean }): TextureHandle;
  createMesh(geometry: MeshGeometry, options?: VisualMeshOptions): VisualMeshHandle;
  createBeam(options: BeamOptions): BeamHandle;
  createDecal(entity: Entity, options: VisualMeshOptions & { position: Vec3; normal: Vec3; size: Vec3; angle?: number }): VisualMeshHandle;
  createParticles(options: ParticleOptions): ParticleHandle;
  setLimits(patch: { maxVertices?: number; maxIndices?: number; maxParticles?: number }): void;
}
interface SurfacePatchOptions {
  id?: string; position: Vec3; normal: Vec3; up?: Vec3; width: number; height: number; depth: number; shape?: 'rectangle' | 'ellipse'; tags: string[]; properties?: Record<string, unknown>; priority?: number; material?: MaterialHandle;
}
interface SurfacePatchHandle { readonly id: string; readonly entity: Entity; readonly active: boolean; update(patch: Pick<Partial<SurfacePatchOptions>, 'tags' | 'properties' | 'priority'>): void; destroy(): void; }
interface SurfaceSample { id: string; entity: Entity; tags: string[]; properties: Record<string, unknown>; priority: number; }
interface SurfacesAPI {
  /** World-space placement, then follows host motion/scale in its local frame. */
  paint(entity: Entity, options: SurfacePatchOptions): SurfacePatchHandle;
  get(id: string): SurfacePatchHandle | null;
  query(entity: Entity, worldPoint: Vec3): SurfaceSample[];
  /** Conservative convex-footprint coverage by one patch, not the union of several patches. */
  covers(entity: Entity, worldPoints: Vec3[], tag?: string): boolean;
  clear(entity: Entity): void;
  setLimit(maxPatches: number): void;
}
interface PortalPlacementCandidate { entity: Entity; point: Vec3; normal: Vec3; footprint: Vec3[]; portal: PortalHandle; regionId: string | null; subShape?: number; }
interface PortalPlanarRegion { id: string; /** Host-local frame, units and normal; region must be covered by planar mesh triangles. */ position: Vec3; normal: Vec3; up?: Vec3; width: number; height: number; depth: number; }
interface PortalSurfaceOptions { faces?: string[]; margin?: number; regions?: PortalPlanarRegion[]; canPlace?: (candidate: PortalPlacementCandidate) => boolean; }
interface PortalSurfaceHandle { readonly entity: Entity; setPlacementRule(predicate: ((candidate: PortalPlacementCandidate) => boolean) | null): void; destroy(): void; }
interface PortalShapeTrace extends PortalTrace { blocked: { portalId: string; reason: 'entrance-does-not-fit' | 'exit-does-not-fit' | 'hop-limit' } | null; }
interface PortalVolumeOptions { origin: Vec3; direction: Vec3; up?: Vec3; /** Convex cross-section in the plane perpendicular to the initial direction. */ profile: Vec2[]; /** Native hull query thickness, independent of the ray center line. */ thickness: number; inset?: number; maxHops?: number; filter?: PhysicsQueryFilter; }
interface PortalVolumeTrace { hit: PhysicsHit | null; path: string[]; truncated: boolean; segments: { origin: Vec3; end: Vec3; direction: Vec3; start: Vec3[]; finish: Vec3[]; geometry: MeshGeometry; portalId?: string }[]; }
interface PortalsAPI {
  /** First-obstruction query with orientation mapping and finite-shape aperture fit checks. */
  shapeCast(shape: PhysicsQueryShape, origin: Vec3, direction: Vec3, filter?: PhysicsQueryFilter & { maxHops?: number }): PortalShapeTrace;
  /** Convex volume extrusion; clips its profile at each aperture and returns world-space meshes. */
  projectVolume(options: PortalVolumeOptions): PortalVolumeTrace;
  setProjectionLimits(patch: { maxHops?: number; maxProfileVertices?: number }): void;
}
interface FieldVolume { shape: PhysicsQueryShape; position: Vec3; rotation?: Quat; vector?: Vec3; }
interface FieldEvent { entity: Entity; deltaTime: number; field: FieldHandle; }
interface FieldOptions {
  volumes: FieldVolume[]; mode: 'force' | 'acceleration'; vector: Vec3 | ((entity: Entity, info: { deltaTime: number; state: PhysicsState }) => Vec3); filter?: PhysicsQueryFilter; filterEntity?: (entity: Entity) => boolean; enabled?: boolean; onEnter?: (event: FieldEvent) => void; onStay?: (event: FieldEvent) => void; onExit?: (event: FieldEvent) => void;
}
interface FieldHandle { readonly active: boolean; setEnabled(enabled: boolean): void; update(patch: Partial<FieldOptions>): void; getEntities(): Entity[]; destroy(): void; }
interface FieldsAPI { create(options: FieldOptions): FieldHandle; }
/** World-space volumes, queried against actual physics shapes. */
interface TriggerVolume { shape: PhysicsQueryShape; position: Vec3; rotation?: Quat; }
interface TriggerEvent {
  entity: Entity;
  trigger: TriggerHandle;
  phase: 'enter' | 'stay' | 'exit';
  /** Scaled simulation time since the preceding occupancy sample. */
  deltaTime: number;
  /** Exit only; destroyed handles may still be reported here. */
  reason?: 'left' | 'disabled' | 'destroyed';
}
interface TriggerOptions {
  volumes: TriggerVolume[];
  /** Default: dynamic, kinematic and character. Static bodies can be opted in. */
  motions?: ('static' | 'dynamic' | 'kinematic' | 'character')[];
  filter?: Pick<PhysicsQueryFilter, 'group' | 'mask' | 'sensors' | 'ignore'>;
  /** Synchronous boolean predicate, evaluated once per distinct candidate. */
  filterEntity?: (entity: Entity) => boolean;
  enabled?: boolean;
  /** Seconds between samples; zero samples every fixed step. No swept crossing detection. */
  interval?: number;
  onEnter?: (event: TriggerEvent) => void;
  onStay?: (event: TriggerEvent) => void;
  onExit?: (event: TriggerEvent) => void;
}
interface TriggerHandle {
  readonly active: boolean;
  /** Changes apply on the next fixed step, including exits when disabled. */
  setEnabled(enabled: boolean): void;
  /** Validates the entire replacement before changing existing options. */
  update(patch: Partial<TriggerOptions>): void;
  /** Last sampled occupants. Returns a copy, excluding destroyed entities. */
  getEntities(): Entity[];
  contains(entity: Entity): boolean;
  /** Queries current occupancy without changing membership or emitting events. */
  query(): Entity[];
  /** Idempotent; destruction emits no gameplay callbacks. */
  destroy(): void;
}
interface TriggerLimits { maxTriggers: number; maxVolumesPerTrigger: number; maxMembersPerTrigger: number; }
interface TriggersAPI {
  create(options: TriggerOptions): TriggerHandle;
  /** Session-wide budgets; cannot lower them below current usage. */
  setLimits(patch: Partial<TriggerLimits>): void;
  getLimits(): TriggerLimits;
}
interface ReadonlySignal {
  readonly active: boolean;
  readonly value: boolean;
  /** Also destroys derived nodes that depend on this node. */
  destroy(): void;
}
interface SignalHandle extends ReadonlySignal { set(value: boolean): void; }
interface SignalLimits { maxNodes: number; maxListeners: number; maxPasses: number; }
interface SignalsAPI {
  create(initial?: boolean): SignalHandle;
  gate(operation: 'and' | 'or' | 'not' | 'xor', inputs: ReadonlySignal[]): ReadonlySignal;
  /** Notifications occur at flush; derived values settle before callbacks. No initial notification. */
  onChange(signal: ReadonlySignal, callback: (event: { signal: ReadonlySignal; value: boolean; previous: boolean }) => void): () => void;
  /** Automatically called before and after each fixed step. Reentrant flushing is rejected. */
  flush(): void;
  getLimits(): SignalLimits;
  setLimits(patch: Partial<SignalLimits>): void;
}
interface MotionState { progress: number; target: number; paused: boolean; }
interface MotionHandle {
  readonly active: boolean;
  setTarget(progress: number): void;
  setPaused(paused: boolean): void;
  getState(): MotionState;
  /** Validates and teleports to a saved progress; ordinary updates use native kinematic movement. */
  restore(state: MotionState): void;
  destroy(): void;
}
interface MotionAPI {
  create(entity: Entity, options: { from?: WorldPose; to: WorldPose; duration: number; easing?: 'linear' | 'smoothstep'; progress?: number; target?: number; paused?: boolean }): MotionHandle;
  setLimit(maxMotions: number): void;
}
interface ReflectorOptions { reflectivity?: number; twoSided?: boolean; }
interface ReflectorHandle { readonly active: boolean; update(patch: ReflectorOptions): void; destroy(): void; }
interface OpticalLimits { maxReflectors: number; maxBounces: number; maxPortalHops: number; maxSegments: number; }
interface OpticalTrace {
  segments: { origin: Vec3; end: Vec3; energy: number; portalId?: string }[];
  reflections: { entity: Entity; point: Vec3; normal: Vec3; direction: Vec3; energy: number }[];
  path: string[];
  hit: PhysicsHit | null;
  energy: number;
  distance: number;
  truncated: boolean;
  reason: 'range' | 'hit' | 'energy' | 'budget';
}
interface OpticsAPI {
  addReflector(entity: Entity, options?: ReflectorOptions): ReflectorHandle;
  trace(options: { origin: Vec3; direction: Vec3; filter?: Pick<PhysicsQueryFilter, 'group' | 'mask' | 'ignore' | 'sensors'>; throughPortals?: boolean; energy?: number; minEnergy?: number; epsilon?: number; maxBounces?: number; maxPortalHops?: number }): OpticalTrace;
  setLimits(patch: Partial<OpticalLimits>): void;
  getLimits(): OpticalLimits;
}
declare const signals: SignalsAPI;
declare const motion: MotionAPI;
declare const optics: OpticsAPI;
type RenderQuality = "low" | "medium" | "high" | "custom";
interface RenderingAPI {
  /** Changes quality budgets for this session; keeps environment assets and color choices. */
  setQuality(quality: RenderQuality): void;
  getSettings(): {
    quality: RenderQuality;
    resolutionScale: number;
    antialiasing: "none" | "fxaa" | "msaa";
    samples: number;
    gpuProfiling: boolean;
    fog: { mode: "none" | "linear" | "exp" | "exp2"; color: string; density: number; start: number; end: number };
    sky: { enabled: boolean; sunAzimuth: number; sunElevation: number; turbidity: number; rayleigh: number; mie: number; luminance: number };
    dof: { enabled: boolean; focusDistance: number; focalLength: number; fStop: number; quality: 0 | 1 | 2 };
    shadows: { enabled: boolean; mapSize: number; filter: "pcf" | "pcss" | "poisson"; bias: number; normalBias: number; darkness: number; maxDistance: number; maxLights: number };
    environment: { textureId: string | null; intensity: number; rotation: number; skybox: boolean };
    color: { toneMapping: "none" | "standard" | "aces"; exposure: number; contrast: number; saturation: number; hue: number; tint: number };
    ao: { enabled: boolean; ratio: number; radius: number; strength: number; samples: number };
    bloom: { enabled: boolean; threshold: number; weight: number; kernel: number; scale: number };
    views: { depth: number; scale: number; recursiveScale: number; samples: number; maxViews: number; maxPixels: number; minArea: number; minResolution: number; particles: boolean };
    probes: { id: string; name: string; textureId: string; position: Vec3; size: Vec3; priority: number; intensity: number }[];
  };
  getStats(): { renderQuality: RenderQuality; renderResolutionScale: number; renderDrawCalls: number; renderMainTriangles: number; renderSubmitMs: number; gpuTimerSupported: boolean; gpuTimeMs: number | null; shadowLights: number; picturePipelines: number; hdrOutput: boolean };
}
declare const rendering: RenderingAPI;
interface ScriptContext { rendering: RenderingAPI; }
interface ScriptContext { signals: SignalsAPI; motion: MotionAPI; optics: OpticsAPI; }
interface PrefabSpawnOptions { visible?: boolean; /** Load assets first, activate component/script bindings via handle.startScripts(). */ deferScripts?: boolean; }
interface PrefabHandle { startScripts(): void; }
interface LevelDescriptor { id: string; prefabId: string; }
interface LoadedLevel extends LevelDescriptor { root: Entity; entities: Entity[]; }
interface LevelsAPI {
  register(id: string, options: { prefabId: string; spawn?: Omit<PrefabSpawnOptions, 'parent' | 'deferScripts'> }): void;
  list(): LevelDescriptor[];
  current(): LoadedLevel | null;
  /** Preloads prefab assets; replaces the previous level before starting new scripts. Bootstrap scene remains. */
  load(id: string): Promise<LoadedLevel>;
  unload(): void;
  find(localPrefabNodeId: string): Entity | null;
  onChange(callback: (event: { phase: 'loaded' | 'unloaded'; previousId: string | null; current: LoadedLevel | null }) => void): () => void;
}
interface StorageAPI { read<T = unknown>(key: string): Promise<T | null>; write(key: string, jsonValue: unknown): Promise<void>; remove(key: string): Promise<void>; }
interface CheckpointSnapshot { format: 'arkglide-checkpoint-1'; levelId: string | null; providers: Record<string, { version: number; state: unknown }>; }
interface CheckpointProvider<T> { version: number; capture(): T; validate?(state: T): boolean | void; restore(state: T): void | Promise<void>; }
interface SavesAPI {
  /** Register before capture. Capture and validation must be synchronous; restore may be async. */
  register<T>(id: string, provider: CheckpointProvider<T>): () => void;
  capture(): CheckpointSnapshot;
  /** Reloads a registered saved level. Built-in state requires matching world/joint/portal structure. */
  restore(snapshot: CheckpointSnapshot): Promise<void>;
  save(slot: string): Promise<void>;
  load(slot: string): Promise<boolean>;
}
declare const visuals: VisualsAPI;
declare const surfaces: SurfacesAPI;
declare const fields: FieldsAPI;
declare const triggers: TriggersAPI;
declare const levels: LevelsAPI;
declare const storage: StorageAPI;
declare const saves: SavesAPI;
interface ScriptContext { visuals: VisualsAPI; surfaces: SurfacesAPI; fields: FieldsAPI; levels: LevelsAPI; storage: StorageAPI; saves: SavesAPI; triggers: TriggersAPI; }

/** Explicit leases for resources referenced dynamically by scripts in streaming packages. */
interface ResourceLease { readonly kind: string; readonly id: string; readonly active: boolean; release(): void; }
interface AssetsAPI { load(kind: 'model' | 'texture' | 'audio' | 'prefab' | 'materials' | 'animationControllers' | 'retargetProfiles', id: string): Promise<ResourceLease>; }
declare const assets: AssetsAPI;
interface ScriptContext { assets: AssetsAPI; }

interface UIStyle {
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
type UIState = "hover" | "focus" | "pressed" | "disabled";
type UIStyleDefinition = Partial<Record<"base" | UIState, UIStyle>>;

interface HUDOptions {
  classes?:string[];style?:UIStyle;stateStyles?:UIStyleDefinition;
  positionUnit?:'px'|'percent';sizeUnit?:'px'|'percent';shape?:'rect'|'ellipse';
}
interface HUDHandle {
  getStyle():UIStyle;
  /** Merge inline overrides. Pass null to remove all inline overrides. */
  setStyle(patch:UIStyle|null):void;
  setClasses(classes:string[]):void;
  setLayout(patch:Partial<Pick<HUDOptions,'x'|'y'|'width'|'height'|'unit'|'positionUnit'|'sizeUnit'|'anchorX'|'anchorY'|'zIndex'|'gap'|'margin'>>):void;
}
