// Script-facing API. Loaded into both Monaco language services as an ambient lib.
// Keep in sync with public/arkglide-api.js and public/runtime.html.
interface Vec3 { x: number; y: number; z: number; }
interface Quat { x:number; y:number; z:number; w:number; }
interface Vec2 { x: number; y: number; }
type PrimitiveType = 'box' | 'sphere' | 'plane' | 'cylinder' | 'capsule' | 'torus';

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
  readonly unscaledDeltaTime:number;
  readonly unscaledTotalTime:number;
  readonly fixedDeltaTime:number;
  readonly fixedTotalTime:number;
  readonly fixedFrameCount:number;
  readonly interpolationAlpha:number;
  /** 0 freezes simulation time and timers; range 0..100. */
  timeScale:number;
}

interface ScriptThis { entity: Entity; }
interface ScriptLifecycle {
  onStart?(this: ScriptInstance): void;
  onUpdate?(this: ScriptInstance): void;
  /** Use time.fixedDeltaTime; runs zero or multiple times before onUpdate. */
  onFixedUpdate?(this: ScriptInstance):void;
  /** Once, before entity disposal or when stopping the run. */
  onDestroy?(this: ScriptInstance):void;
  // Scripts can keep per-instance state on the returned object.
  [key: string]: any;
}
interface ScriptInstance extends ScriptLifecycle, ScriptThis {}

/** Optional helper: infer custom state while supplying a typed this.entity. */
declare function defineScript<T extends object>(script: T & ThisType<T & ScriptThis>): T;
// Injected factory arguments. In legacy scripts with an empty scene, entity is null.
// Bound entity scripts always receive an Entity.
declare const entity: Entity;
declare const input: InputAPI;
declare const scene: SceneAPI;
declare const time: TimeAPI;

/** Plain values; the runtime releases all internal WASM allocations. */
interface MathAPI {
  readonly backend: 'wasm' | 'javascript';
  vec3: {
    add(a:Vec3,b:Vec3):Vec3; sub(a:Vec3,b:Vec3):Vec3;
    dot(a:Vec3,b:Vec3):number; cross(a:Vec3,b:Vec3):Vec3;
    length(a:Vec3):number; distance(a:Vec3,b:Vec3):number;
    scale(a:Vec3,s:number):Vec3; normalize(a:Vec3):Vec3; lerp(a:Vec3,b:Vec3,t:number):Vec3;
  };
  mat4: {
    identity():number[]; multiply(a:readonly number[],b:readonly number[]):number[];
    translation(p:Vec3):number[]; scaling(s:Vec3):number[]; rotation(angle:number,axis:Vec3):number[];
    compose(position:Vec3,rotation:Vec3,scale:Vec3):number[];
    transformPoint(matrix:readonly number[],point:Vec3):Vec3;
  };
  quat: {
    normalize(q:Quat):Quat; fromEuler(euler:Vec3):Quat;
    slerp(a:Quat,b:Quat,t:number):Quat; toMatrix(q:Quat):number[];
  };
}
declare const math: MathAPI;

interface TimersAPI {
  /** Scaled game seconds. Returned function cancels this timer. */
  after(seconds:number,callback:()=>void):()=>void;
  /** Coalesces missed intervals to one callback per frame. */
  every(seconds:number,callback:()=>void):()=>void;
}
interface EventsAPI {
  on<T=unknown>(name:string,callback:(payload:T)=>void):()=>void;
  once<T=unknown>(name:string,callback:(payload:T)=>void):()=>void;
  emit(name:string,payload?:unknown):void;
  /** Track a native listener; it is removed on script/entity destruction. */
  listen(target:EventTarget,name:string,callback:(event:Event)=>void,options?:boolean|AddEventListenerOptions):()=>void;
}
declare const timers:TimersAPI;
declare const events:EventsAPI;
