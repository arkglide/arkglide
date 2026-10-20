import { remapGameplayReferences } from "../types/advancedGameplay";
import type {
  CharacterComponent,
  JointComponent,
} from "../types/advancedGameplay";
import type {
  PhysicsComponent,
  AnimationComponent,
  AudioSourceComponent,
  AudioAsset,
  GameplayConfig,
} from "../types/gameplay";
import { create } from "zustand";
import "../vendor/acorn.js";
import "../engine/module-runtime.js";
import {
  emptyContent,
  defaultMaterial,
  type ProjectContent,
  type MaterialAsset,
  type TextureAsset,
  type PrefabInstance,
} from "../types/content";
import {
  captureNestedPrefab,
  inferInstanceParents,
  linkNestedInstances,
  assertPrefabGraph,
  refreshDependentTemplates,
  createInstance,
  applyPrefab,
  cloneInstanceLinks,
  subtree,
} from "../engine/prefabs";
import { collectModelRefs } from "../utils/contentResources";
import type { ProjectJSON, ProjectSettings } from "../types/project";
import {
  assertScriptPath,
  validateProject,
  normalizeProject,
  PROJECT_VERSION,
} from "../utils/projectValidation";
import { DEFAULT_SETTINGS } from "../types/project";
import {
  saveProjectSnapshot,
  loadProject,
  loadModelBlob,
  loadTextureBlob,
  loadAudioBlob,
  type StoredProject,
} from "../utils/projectStorage";

// 播放状态
export type PlayState = "stopped" | "playing" | "paused";
// 节点类型
export type NodeType = "mesh" | "light" | "camera" | "empty" | "model";

export interface Transform {
  x: number;
  y: number;
  z: number;
}

export interface SceneNode {
  optimization?: import('../types/rendering').MeshOptimizationSettings;
  bakedLighting?: { autoUV2: boolean; signature: string };
  planarReflection?: import('../types/rendering').PlanarReflectionSettings;
  castShadows?: boolean;
  receiveShadows?: boolean;
  id: string;
  name: string;
  type: NodeType; // 'mesh' | 'light' | 'camera' | 'empty' | 'model'
  transform: Transform; // 位置（保持不变，向后兼容 runtime.html）
  rotation: Transform; // 旋转（弧度，与 Babylon mesh.rotation 一致）
  scale: Transform; // 缩放
  visible: boolean; // 可见性
  primitive?: "box" | "sphere" | "plane" | "cylinder" | "capsule" | "torus";
  lightType?: "hemispheric" | "directional" | "point";
  activeCamera?: boolean;
  color?: string; // 颜色（hex 格式如 '#FF6B6B'，mesh 用）
  intensity?: number; // 光照强度（light 用）
  fov?: number; // 视场角（camera 用，角度）
  parentId?: string | null; // 父节点 ID（null 或 undefined = 根节点）
  modelRevision?: string;
  modelUrl?: string; // 模型文件 URL（type='model' 时用）
  physics?: PhysicsComponent;
  character?: CharacterComponent;
  joints?: JointComponent[];
  animation?: AnimationComponent;
  audioSource?: AudioSourceComponent;
  materialId?: string;
  /** mesh:<import index>/slot:<material index>; null explicitly restores original. */
  materialSlots?: Record<string, string | null>;
  prefab?: { prefabId: string; instanceId: string; nodeId: string };
  scripts?: string[]; // 挂载的脚本文件名列表，如 ['player.js', 'physics.js']
}

// 控制台消息（来自 iframe 沙箱转发）
export interface DiagnosticLocation {
  file?: string | null;
  line?: number | null;
  column?: number | null;
  hook?: string;
  entityId?: string | null;
  stack?: string;
}
export interface RuntimeStats {
  lodMeshes?: number; lodLevels?: number; lodNativeBuilds?: number; lodJSBuilds?: number; lodSkippedMeshes?: number;
  cascadedShadowLights?: number;
  atmosphereSky?: boolean;
  volumetricSupported?: boolean; volumetricEnabled?: boolean; volumetricPixels?: number; volumetricWidth?: number; volumetricHeight?: number; volumetricSteps?: number; volumetricShadowSize?: number; volumetricShadowed?: boolean; volumetricLight?: string | null;
  dofEnabled?: boolean;
  ssrEnabled?: boolean;
  ssrSupported?: boolean;
  planarReflections?: number;
  planarRenderedViews?: number;
  planarRenderedPixels?: number;
  gpuParticleSystems?: number;
  cpuParticleSystems?: number;
  renderQuality?: string;
  renderResolutionScale?: number;
  renderDrawCalls?: number;
  renderMainTriangles?: number;
  renderSceneTriangles?: number;
  renderSubmitMs?: number;
  gpuTimerSupported?: boolean;
  gpuTimeMs?: number | null;
  shadowLights?: number;
  picturePipelines?: number;
  portalRenderedViews?: number;
  portalRenderedPixels?: number;
  portalPixelBudget?: number;
  viewBudgetNativeBatches?: number;
  viewBudgetJSBatches?: number;
  renderComputeBackend?: string;
  renderCullBatches?: number;
  renderCullCandidates?: number;
  renderCulledMeshes?: number;
  renderNormalBatches?: number;
  renderNormalVertices?: number;
  renderNativeBounds?: number;
  renderBoundsFallbacks?: number;
  nativeTransformBatches?: number;
  nativeTransformWrites?: number;
  nativeBoundsBatches?: number;
  nativeBoundsUpdates?: number;
  nativeBoundsEntries?: number;
  nativeBoundsCacheHits?: number;
  sceneBackend?:string;lifecycleBackend?:string;
  nativeEntities?:number;nativeSceneSlots?:number;nativeMatrixUpdates?:number;
  nativeOwners?:number;nativeTimers?:number;coreWasmHeapBytes?:number;
  state: string;
  mathBackend: string;
  fps: number;
  frameMs: number;
  peakFrameMs: number;
  renderMs: number;
  scriptMs: number;
  entities: number;
  scripts: number;
  meshes: number;
  materials: number;
  textures: number;
  lights: number;
  cameras: number;
  modelLoads: number;
  timers: number;
  subscriptions: number;
  listeners: number;
  heapBytes: number | null;
  totalTime: number;
  unscaledTotalTime: number;
  fixedSteps: number;
  timeScale: number;
  droppedTime: number;
  physicsCharacters?: number;
  physicsConstraints?: number;
  physicsShapeCache?: number;
  physicsCacheBytes?: number;
  physicsQueriesActive?: number;
  physicsDebugMeshes?: number;
  animationControllers?: number;
  animationEventSubscriptions?: number;
  animationRetargetGroups?: number;
  animationDroppedEvents?: number;
  audioBuses?: number;
  audioStreams?: number;
  audioWorklets?: number;
  audioTransitions?: number;
  audioBlobURLs?: number;
  uiSubscriptions?: number;
  uiBlobURLs?: number;
  inputGamepads?: number;
  inputCaptures?: number;
  wasmHeapBytes?: number;
  physicsBodies?: number;
  physicsContacts?: number;
  physicsSubscriptions?: number;
  physicsBackend?: string;
  audioVoices?: number;
  audioBuffers?: number;
  audioState?: string;
  animationPlayers?: number;
  hudElements?: number;
  inputHeld?: number;
  errors: number;
}
export interface ConsoleMessage {
  location?: DiagnosticLocation;
  id: number;
  level: "log" | "warn" | "error";
  text: string;
  time: number;
}

// 资源条目（AssetBrowser 挂载的本地文件，只读 name/path，不读取内容到内存）
export interface AssetEntry {
  id: string;
  name: string;
  path: string;
  type: "model" | "texture" | "script" | "other";
  size: number;
  fileHandle?: FileSystemFileHandle;
  file?: File;
}

// 默认用户脚本（ArkGlide API 演示 —— this.entity 指向挂载此脚本的实体，按 WASD 移动）
// 用 join 构造避免模板字符串反引号嵌套问题
// 注意：DEFAULT_SCRIPT 不再使用 entity 参数和 scene.find('cube')，改用 this.entity 直接操作挂载的实体
// entity 参数仍保留在 runtime.html 的 new Function 签名中（向后兼容），只是此处不再使用
export const DEFAULT_SCRIPT = [
  "// ArkGlide 脚本 — this.entity 指向挂载此脚本的实体",
  "// 生命周期：onStart（启动时调用一次）/ onUpdate（每帧调用）",
  "// 输入：input.isKeyDown('w') / input.getMouseDelta()",
  "// 场景：scene.find('id') / scene.findByName('Cube')",
  "",
  "return {",
  "  onStart() {",
  "    console.log('脚本启动:', this.entity.name);",
  "  },",
  "  onUpdate() {",
  "    // 以每秒 3 个单位移动，速度不随帧率变化",
  "    const distance = 3 * time.deltaTime;",
  "    this.entity.translate(",
  "      input.getAxis('a', 'd') * distance,",
  "      0,",
  "      input.getAxis('s', 'w') * distance",
  "    );",
  "  }",
  "};",
  "",
].join("\n");

// 历史栈条目：nodes + scripts 的快照
type ClipboardScriptsSnapshot = Pick<
  EditorState,
  "clipboard" | "clipboardContent" | "clipboardPrefabInstances"
>;
interface ScriptHistoryChange {
  oldName: string;
  newName: string | null;
  before: ClipboardScriptsSnapshot;
  after: ClipboardScriptsSnapshot;
}
interface HistoryEntry {
  scriptChange?: ScriptHistoryChange;
  content: ProjectContent;
  audioBuffers: Map<string, ArrayBuffer>;
  textureBuffers: Map<string, ArrayBuffer>;
  nodes: SceneNode[];
  scripts: Record<string, string>;
  activeFileId: string;
  modelBuffers: Map<string, ArrayBuffer>;
  missingModelIds: Set<string>;
  settings: ProjectSettings;
}

export interface EditorState {
  applyLightingBake: (nodes: SceneNode[], materials: Record<string, MaterialAsset>, textures: { asset: TextureAsset; bytes: ArrayBuffer }[], documentId: string) => void;
  importAudio: (asset: AudioAsset, bytes: ArrayBuffer) => void;
  deleteAudio: (id: string) => void;
  updateGameplay: (value: GameplayConfig) => void;
  updateAdvancedContent: (
    patch: Partial<
      Pick<
        ProjectContent,
        "physics" | "mixer" | "animationControllers" | "retargetProfiles"
      >
    >,
  ) => void;
  modelAnimations: Record<string, string[]>;
  setModelAnimations: (id: string, names: string[]) => void;
  content: ProjectContent;
  audioBuffers: Map<string, ArrayBuffer>;
  textureBuffers: Map<string, ArrayBuffer>;
  clipboardPrefabInstances: Record<string, PrefabInstance>;
  clipboardContent: ProjectContent | null;
  clipboardAudioBuffers: Map<string, ArrayBuffer>;
  clipboardTextureBuffers: Map<string, ArrayBuffer>;
  createMaterial: (name?: string, sourceId?: string) => string;
  updateMaterial: (id: string, patch: Partial<MaterialAsset>) => void;
  deleteMaterial: (id: string) => void;
  modelParts: Record<string, { key: string; name: string }[]>;
  setModelParts: (id: string, parts: { key: string; name: string }[]) => void;
  setModelSlotMaterial: (
    nodeId: string,
    key: string,
    materialId?: string | null,
  ) => void;
  setNodeMaterial: (nodeId: string, materialId?: string) => void;
  importTexture: (asset: TextureAsset, bytes: ArrayBuffer) => void;
  deleteTexture: (id: string) => void;
  createPrefab: (rootId: string, name?: string) => string;
  instantiatePrefab: (id: string) => string;
  updatePrefabFromInstance: (instanceId: string) => void;
  resetPrefabInstance: (instanceId: string) => void;
  unpackPrefabInstance: (instanceId: string) => void;
  deletePrefab: (id: string) => void;
  renamePrefab: (id: string, name: string) => void;
  documentId: string;
  documentOrigin: "new" | "loaded" | "imported" | "recovered";
  savedSnapshot: {
    project: StoredProject;
    buffers: Map<string, ArrayBuffer>;
    audio: Map<string, ArrayBuffer>;
    textures: Map<string, ArrayBuffer>;
  } | null;
  recoveryStatus: "idle" | "pending" | "saving" | "saved" | "error";
  recoveryError: string | null;
  recoveryUpdatedAt: number | null;
  scriptNavigation: {
    id: number;
    file: string;
    line: number;
    column: number;
  } | null;
  navigateToScript: (file: string, line?: number, column?: number) => void;
  runtimeStats: RuntimeStats | null;
  setRuntimeStats: (stats: RuntimeStats | null) => void;
  playState: PlayState;
  nodes: SceneNode[];
  selectedNodeId: string | null;
  selectedNodeIds: string[]; // 多选节点 ID 列表（selectedNodeId 派生自 [0]）
  clipboardModelBuffers: Map<string, ArrayBuffer>;
  clipboard: SceneNode[] | null; // 内部剪贴板（复制/粘贴用）
  gizmoMode: "move" | "rotate" | "scale"; // Gizmo 模式（W/E/R 切换）
  gizmoSpace: "global" | "local"; // 坐标系（Global/Local 切换）
  // 撤销/重做历史栈
  past: HistoryEntry[]; // 撤销栈（过去的状态快照）
  future: HistoryEntry[]; // 重做栈（未来的状态快照）
  undo: () => void; // 撤销
  redo: () => void; // 重做
  beginTransform: () => void; // Gizmo 拖拽开始时调用（保存拖拽前快照）
  // 多脚本数据层：key 为文件名（如 'main.js'），value 为代码内容
  scripts: Record<string, string>;
  activeFileId: string; // 当前编辑的脚本文件名
  // 派生字段（向后兼容 CodeEditor.tsx，阶段三前不改动 CodeEditor）
  // script 始终等于 scripts[activeFileId]，每次 set 时同步更新
  script: string;
  consoleLogs: ConsoleMessage[];
  project: ProjectJSON | null;
  // 播放前的场景快照（深拷贝），stop() 时用于恢复编辑器场景
  prePlaySnapshot: SceneNode[] | null;
  assets: AssetEntry[];
  // 持久化字段：当前项目 ID（null = 未保存的新项目）和显示名称
  currentProjectId: string | null;
  currentProjectName: string;
  setPlayState: (s: PlayState) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  selectNode: (id: string | null) => void;
  // 多选：selectedNodeIds 为主，selectedNodeId 派生自 [0]（向后兼容）
  selectNodes: (ids: string[]) => void; // 设置多选
  toggleNodeSelection: (id: string) => void; // 加选/减选（Ctrl/Cmd+点击）
  clearSelection: () => void; // 清空选择
  // 复制/粘贴/复制副本
  copyToClipboard: () => void;
  pasteFromClipboard: (parentId?: string | null) => void;
  duplicateNode: (id: string) => void; // 复制副本（Ctrl+D，含子树，入栈）
  // 可见性 toggle（入栈）
  toggleVisibility: (id: string) => void;
  setGizmoMode: (mode: "move" | "rotate" | "scale") => void;
  setGizmoSpace: (space: "global" | "local") => void;
  updateTransform: (
    id: string,
    partial: Partial<
      Pick<
        SceneNode,
        | "transform"
        | "rotation"
        | "scale"
        | "visible"
        | "color"
        | "intensity"
        | "fov"
        | "modelUrl"
        | "primitive"
        | "lightType"
        | "character"
        | "joints"
        | "physics"
        | "animation"
        | "audioSource"
        | "activeCamera"
        | "castShadows"
        | "receiveShadows"
        | "planarReflection"
        | "bakedLighting"
        | "optimization"
      >
    >,
    recordHistory?: boolean,
  ) => void;
  addNode: (type: NodeType, name?: string) => string; // 创建节点，返回新节点 id
  removeNodes: (ids: string[]) => void;
  removeNode: (id: string) => void; // 级联删除子节点
  renameNode: (id: string, name: string) => void; // 重命名节点
  setParent: (id: string, parentId: string | null) => void; // 设置父节点（拖拽层级）
  attachScript: (nodeId: string, scriptFile: string) => void; // 给节点挂载脚本
  detachScript: (nodeId: string, scriptFile: string) => void; // 从节点卸载脚本
  // 多脚本 CRUD
  createScript: (fileName: string, content?: string) => void; // 新建脚本（避免重名）
  deleteScript: (fileName: string) => void; // 删除脚本（不允许删除 main.js）
  renameScript: (oldName: string, newName: string) => void; // 重命名脚本
  updateScript: (fileName: string, content: string) => void; // 更新脚本内容
  setActiveFile: (fileName: string) => void; // 切换当前编辑的脚本
  // 向后兼容别名：setScript(code) === updateScript(activeFileId, code)
  setScript: (code: string) => void;
  addConsoleLog: (
    level: ConsoleMessage["level"],
    text: string,
    location?: DiagnosticLocation,
  ) => void;
  clearConsoleLogs: () => void;
  setAssets: (assets: AssetEntry[]) => void;
  // 模型 ArrayBuffer 缓存：nodeId → ArrayBuffer
  // Viewport 加载模型时写入，RuntimeFrame 播放时读取并通过 Transferable 传递给 iframe
  modelBuffers: Map<string, ArrayBuffer>;
  setModelBuffer: (id: string, buffer: ArrayBuffer) => void;
  // 资源丢失标记：加载项目时 modelBlob 缺失的模型节点 ID 集合
  // SceneTree 显示红色警告图标，Inspector 显示重新链接按钮
  missingModelIds: Set<string>;
  // 重新链接模型：用户选择本地文件后，用其 ArrayBuffer 替换丢失的模型
  relinkModel: (nodeId: string, buffer: ArrayBuffer, fileName?: string) => void;
  // 持久化方法：保存/加载/新建项目
  saveCurrentProject: (name?: string) => Promise<void>;
  loadProjectById: (projectId: string) => Promise<void>;
  newProject: () => void;
  replaceProject: (
    data: StoredProject,
    buffers: Map<string, ArrayBuffer>,
    missing: Set<string>,
    imported?: boolean,
    recoveryId?: string,
    textures?: Map<string, ArrayBuffer>,
    audio?: Map<string, ArrayBuffer>,
  ) => void;
  // 项目设置：重力/背景色/环境光/帧率上限
  settings: ProjectSettings;
  updateSettings: (partial: Partial<ProjectSettings>) => void;
}

// 初始场景节点（Mock）
const initialNodes: SceneNode[] = [
  {
    id: "cube",
    name: "Cube",
    type: "mesh",
    primitive: "box",
    transform: { x: 0, y: 0.5, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    color: "#7C9CFF",
    scripts: ["main.js"],
  },
  {
    id: "sphere",
    name: "Sphere",
    type: "mesh",
    primitive: "sphere",
    transform: { x: 2, y: 0.5, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    color: "#FF6B6B",
  },
  {
    id: "light",
    name: "DirectionalLight",
    type: "light",
    transform: { x: 0, y: 5, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    color: "#FFFFFF",
    intensity: 0.8,
  },
  {
    id: "camera",
    name: "Camera",
    type: "camera",
    transform: { x: 0, y: 3, z: -8 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    fov: 60,
    activeCamera: true,
  },
];

let logId = 0;
let projectEpoch = 0;
const activeProjectSaves = new Map<
  string,
  { projectId: string; pending: number }
>();

// 历史栈上限：超过时移除最旧的条目
const HISTORY_LIMIT = 100;

// Zustand set 函数的类型（接受 partial 对象或 updater 函数）
type EditorSet = (
  partial:
    | Partial<EditorState>
    | ((state: EditorState) => Partial<EditorState>),
) => void;

// 深拷贝 SceneNode（含嵌套 transform/rotation/scale/scripts）
function deepCloneNodes(nodes: SceneNode[]): SceneNode[] {
  return structuredClone(nodes);
}

function sameConfiguration(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) =>
    Object.hasOwn(right, key) && sameConfiguration(left[key], right[key]),
  );
}

// 深拷贝 scripts（Record<string, string>，string 不可变只需浅拷贝对象）
function deepCloneScripts(
  scripts: Record<string, string>,
): Record<string, string> {
  return { ...scripts };
}

// 创建历史快照：深拷贝当前 nodes + scripts
function createSnapshot(state: EditorState): HistoryEntry {
  return {
    content: structuredClone(state.content),
    audioBuffers: new Map(state.audioBuffers),
    textureBuffers: new Map(state.textureBuffers),
    nodes: deepCloneNodes(state.nodes),
    scripts: deepCloneScripts(state.scripts),
    activeFileId: state.activeFileId,
    modelBuffers: new Map(state.modelBuffers),
    missingModelIds: new Set(state.missingModelIds),
    settings: { ...state.settings, gravity: { ...state.settings.gravity } },
  };
}

// 在修改前保存当前状态到 past，清空 future
// 历史栈上限 HISTORY_LIMIT，超过时移除最旧的条目
function pushHistory(get: () => EditorState, set: EditorSet): void {
  const snapshot = createSnapshot(get());
  set((state) => {
    const past = [...state.past, snapshot];
    // 超过上限时移除最旧的条目（保持最近 HISTORY_LIMIT 个快照）
    if (past.length > HISTORY_LIMIT) {
      past.shift();
    }
    return {
      past,
      future: [], // 新操作清空重做栈
    };
  });
}

function assertEditing(s: EditorState) {
  if (s.playState !== "stopped") throw new Error("请先停止运行");
}
function pruneModels(
  nodes: SceneNode[],
  content: ProjectContent,
  buffers: Map<string, ArrayBuffer>,
) {
  const keys = new Set(collectModelRefs(nodes, content).map((r) => r.assetId));
  for (const id of buffers.keys()) if (!keys.has(id)) buffers.delete(id);
}
function missingModels(
  nodes: SceneNode[],
  content: ProjectContent,
  buffers: Map<string, ArrayBuffer>,
) {
  return new Set(
    collectModelRefs(nodes, content)
      .filter((r) => !buffers.has(r.assetId))
      .map((r) => r.assetId),
  );
}
function rewriteNodeScripts(
  n: SceneNode,
  fn: (name: string) => string | null,
): SceneNode {
  return {
    ...n,
    scripts: n.scripts?.flatMap((name) => {
      const next = fn(name);
      return next ? [next] : [];
    }),
  };
}
function rewriteInstancesScripts(
  instances: Record<string, PrefabInstance>,
  fn: (name: string) => string | null,
) {
  return Object.fromEntries(
    Object.entries(instances).map(([id, i]) => [
      id,
      { ...i, baseline: i.baseline.map((n) => rewriteNodeScripts(n, fn)) },
    ]),
  );
}
function rewriteContentScripts(
  content: ProjectContent,
  fn: (name: string) => string | null,
): ProjectContent {
  return {
    ...content,
    prefabs: Object.fromEntries(
      Object.entries(content.prefabs).map(([id, p]) => [
        id,
        {
          ...p,
          nodes: p.nodes.map((n) => rewriteNodeScripts(n, fn)),
          nestedInstances: p.nestedInstances
            ? rewriteInstancesScripts(p.nestedInstances, fn)
            : undefined,
        },
      ]),
    ),
    prefabInstances: rewriteInstancesScripts(content.prefabInstances, fn),
  };
}

function clipboardScriptsSnapshot(
  state: EditorState,
): ClipboardScriptsSnapshot {
  return {
    clipboard: state.clipboard,
    clipboardContent: state.clipboardContent,
    clipboardPrefabInstances: state.clipboardPrefabInstances,
  };
}
function rewriteClipboardScripts(
  state: EditorState,
  fn: (name: string) => string | null,
): ClipboardScriptsSnapshot {
  return {
    clipboard: state.clipboard?.map((n) => rewriteNodeScripts(n, fn)) || null,
    clipboardContent: state.clipboardContent
      ? rewriteContentScripts(state.clipboardContent, fn)
      : null,
    clipboardPrefabInstances: rewriteInstancesScripts(
      state.clipboardPrefabInstances,
      fn,
    ),
  };
}
function restoreClipboardScripts(
  state: EditorState,
  change: ScriptHistoryChange | undefined,
  undo: boolean,
): Partial<EditorState> {
  if (!change) return {};
  const expected = undo ? change.after : change.before,
    target = undo ? change.before : change.after;
  if (
    state.clipboard === expected.clipboard &&
    state.clipboardContent === expected.clipboardContent &&
    state.clipboardPrefabInstances === expected.clipboardPrefabInstances
  )
    return target;
  // A later copy remains on the clipboard; only update renamed/deleted file references.
  if (undo && !change.newName) return {};
  return rewriteClipboardScripts(state, (name) =>
    undo
      ? name === change.newName
        ? change.oldName
        : name
      : name === change.oldName
        ? change.newName
        : name,
  );
}
function recordScriptHistory(
  get: () => EditorState,
  set: EditorSet,
  oldName: string,
  newName: string | null,
  before: ClipboardScriptsSnapshot,
) {
  const state = get(),
    after = clipboardScriptsSnapshot(state);
  set({
    past: state.past.map((entry, index) =>
      index === state.past.length - 1
        ? { ...entry, scriptChange: { oldName, newName, before, after } }
        : entry,
    ),
  });
}

function restoreClipboardResources(
  state: EditorState,
  nodes: SceneNode[],
  instances: Record<string, PrefabInstance>,
) {
  const snapshot = state.clipboardContent,
    content = structuredClone(state.content),
    buffers = new Map(state.modelBuffers),
    textures = new Map(state.textureBuffers);
  content.prefabInstances = inferInstanceParents([...state.nodes, ...nodes], {
    ...content.prefabInstances,
    ...instances,
  });
  const materialIds = new Set(
    nodes.flatMap((n) =>
      [n.materialId, ...Object.values(n.materialSlots || {})].filter(
        (id): id is string => !!id,
      ),
    ),
  );
  const pending = Object.values(instances).map((i) => i.prefabId),
    seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const instance = Object.values(instances).find((i) => i.prefabId === id);
    if (!content.prefabs[id] && snapshot?.prefabs[id]) {
      content.prefabs[id] = structuredClone(snapshot.prefabs[id]);
      for (const key of Object.values(content.prefabs[id].modelKeys)) {
        const b = state.clipboardModelBuffers.get(key);
        if (b) buffers.set(key, b.slice(0));
      }
    }
    pending.push(
      ...Object.values(content.prefabs[id]?.nestedInstances || {}).map(
        (i) => i.prefabId,
      ),
    );
    for (const n of [
      ...(content.prefabs[id]?.nodes || []),
      ...Object.values(content.prefabs[id]?.nestedInstances || {}).flatMap(
        (i) => i.baseline,
      ),
      ...(instance?.baseline || []),
    ])
      for (const id of [n.materialId, ...Object.values(n.materialSlots || {})])
        if (id) materialIds.add(id);
  }
  for (const id of materialIds)
    if (!content.materials[id] && snapshot?.materials[id])
      content.materials[id] = structuredClone(snapshot.materials[id]);
  for (const id of materialIds) {
    const m = content.materials[id];
    if (!m) continue;
    for (const textureId of [
      m.albedoTextureId,
      m.normalTextureId,
      m.metallicRoughnessTextureId,
      m.aoTextureId,
      m.lightmapTextureId,
      m.emissiveTextureId,
      m.clearCoatTextureId,
      m.clearCoatNormalTextureId,
      m.sheenTextureId,
      m.anisotropyTextureId,
      m.thicknessTextureId,
      m.transmissionTextureId,
      m.detailTextureId,
    ])
      if (textureId && !content.textures.some((t) => t.id === textureId)) {
        const t = snapshot?.textures.find((t) => t.id === textureId);
        if (t) content.textures.push({ ...t });
        const b = state.clipboardTextureBuffers.get(textureId);
        if (b) textures.set(textureId, b.slice(0));
      }
  }
  const audio = new Map(state.audioBuffers);
  for (const a of snapshot?.audio || [])
    if (!content.audio?.some((v) => v.id === a.id)) {
      (content.audio ??= []).push(structuredClone(a));
      const b = state.clipboardAudioBuffers.get(a.id);
      if (b) audio.set(a.id, b.slice(0));
    }
  if (snapshot) {
    content.animationControllers = {
      ...structuredClone(snapshot.animationControllers || {}),
      ...content.animationControllers,
    };
    content.retargetProfiles = {
      ...structuredClone(snapshot.retargetProfiles || {}),
      ...content.retargetProfiles,
    };
    if (snapshot.physics && content.physics) {
      const old = snapshot.physics.groups,
        current = content.physics.groups,
        missing = old.filter((g) => !current.some((v) => v.name === g.name));
      const combined = [...current, ...missing.map((g) => ({ ...g, mask: 0 }))];
      for (const g of combined) {
        const prior = old.find((v) => v.name === g.name);
        if (!prior) continue;
        for (let bit = 0; bit < old.length; bit++) {
          if (!(prior.mask & (1 << bit))) continue;
          const target = combined.findIndex((v) => v.name === old[bit].name);
          if (
            missing.some((v) => v.name === g.name) ||
            missing.some((v) => v.name === old[bit].name)
          )
            g.mask |= 1 << target;
        }
      }
      content.physics.groups = combined;
    }
    if (snapshot.mixer && content.mixer) {
      for (const b of snapshot.mixer.buses)
        if (!content.mixer.buses.some((v) => v.id === b.id))
          content.mixer.buses.push(structuredClone(b));
      for (const s of snapshot.mixer.snapshots)
        if (!content.mixer.snapshots.some((v) => v.id === s.id))
          content.mixer.snapshots.push(structuredClone(s));
    }
  }
  return { content, buffers, textures, audio };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  modelAnimations: {},
  setModelAnimations: (id, names) =>
    set((s) => {
      const modelAnimations = { ...s.modelAnimations };
      if (names.length && s.nodes.some((n) => n.id === id && n.type === "model"))
        modelAnimations[id] = [...names];
      else delete modelAnimations[id];
      return { modelAnimations };
    }),
  importAudio: (asset, bytes) => {
    const s = get();
    assertEditing(s);
    if (bytes.byteLength !== asset.byteLength)
      throw new Error("音频大小不一致");
    asset = structuredClone(asset);
    bytes = bytes.slice(0);
    const content = {
      ...s.content,
      audio: [
        ...(s.content.audio || []).filter((a) => a.id !== asset.id),
        asset,
      ],
    };
    validateProject({ ...s, scene: { nodes: s.nodes }, content });
    pushHistory(get, set);
    set({
      content,
      audioBuffers: new Map([...s.audioBuffers, [asset.id, bytes]]),
    });
  },
  deleteAudio: (id) => {
    const s = get();
    assertEditing(s);
    if (!s.content.audio?.some((asset) => asset.id === id)) return;
    const all = [
      ...s.nodes,
      ...Object.values(s.content.prefabs).flatMap((p) => [
        ...p.nodes,
        ...Object.values(p.nestedInstances || {}).flatMap((i) => i.baseline),
      ]),
      ...Object.values(s.content.prefabInstances).flatMap((i) => i.baseline),
    ];
    if (all.some((n) => n.audioSource?.assetId === id))
      throw new Error("音频仍被场景或预制体引用，请先解除音源绑定");
    pushHistory(get, set);
    const audioBuffers = new Map(s.audioBuffers);
    audioBuffers.delete(id);
    set({
      audioBuffers,
      content: {
        ...s.content,
        audio: s.content.audio?.filter((a) => a.id !== id),
      },
    });
  },
  updateAdvancedContent: (patch) => {
    const s = get();
    assertEditing(s);
    const content = { ...s.content, ...structuredClone(patch) };
    validateProject({ ...s, scene: { nodes: s.nodes }, content });
    if (sameConfiguration(content, s.content)) return;
    pushHistory(get, set);
    set({ content });
  },
  updateGameplay: (value) => {
    const s = get();
    assertEditing(s);
    const content = { ...s.content, gameplay: structuredClone(value) };
    validateProject({ ...s, scene: { nodes: s.nodes }, content });
    if (sameConfiguration(content.gameplay, s.content.gameplay)) return;
    pushHistory(get, set);
    set({ content });
  },
  modelParts: {},
  setModelParts: (id, parts) =>
    set((s) => {
      const modelParts = { ...s.modelParts };
      if (parts.length && s.nodes.some((n) => n.id === id && n.type === "model"))
        modelParts[id] = structuredClone(parts);
      else delete modelParts[id];
      return { modelParts };
    }),
  setModelSlotMaterial: (nodeId, key, materialId) => {
    const s = get();
    assertEditing(s);
    const node = s.nodes.find((n) => n.id === nodeId);
    if (node?.type !== "model" || !/^mesh:\d+\/slot:\d+$/.test(key))
      throw new Error("无效模型材质槽");
    if (materialId != null && !Object.hasOwn(s.content.materials, materialId))
      throw new Error("材质不存在");
    if (node.materialSlots?.[key] === materialId) return;
    const slots = { ...node.materialSlots };
    if (materialId === undefined) delete slots[key];
    else slots[key] = materialId;
    pushHistory(get, set);
    set({
      nodes: s.nodes.map((n) =>
        n.id === nodeId ? { ...n, materialSlots: slots } : n,
      ),
    });
  },
  content: emptyContent(),
  audioBuffers: new Map(),
  textureBuffers: new Map(),
  clipboardPrefabInstances: {},
  clipboardContent: null,
  clipboardAudioBuffers: new Map(),
  clipboardTextureBuffers: new Map(),
  documentId: crypto.randomUUID(),
  documentOrigin: "new",
  savedSnapshot: null,
  recoveryStatus: "idle",
  recoveryError: null,
  recoveryUpdatedAt: null,
  scriptNavigation: null,
  runtimeStats: null,
  navigateToScript: (file, line = 1, column = 1) => {
    if (!Object.hasOwn(get().scripts, file)) return;
    get().setActiveFile(file);
    set({
      scriptNavigation: {
        id: Date.now() + Math.random(),
        file,
        line: Math.max(1, line),
        column: Math.max(1, column),
      },
    });
  },
  setRuntimeStats: (runtimeStats) => set({ runtimeStats }),
  playState: "stopped",
  nodes: initialNodes,
  selectedNodeId: "cube",
  selectedNodeIds: ["cube"],
  clipboard: null,
  clipboardModelBuffers: new Map(),
  gizmoMode: "move",
  gizmoSpace: "global",
  // 多脚本数据层：默认包含 main.js，内容为 DEFAULT_SCRIPT
  scripts: { "main.js": DEFAULT_SCRIPT },
  activeFileId: "main.js",
  // 派生字段：script === scripts[activeFileId]，向后兼容 CodeEditor
  script: DEFAULT_SCRIPT,
  consoleLogs: [],
  project: null,
  prePlaySnapshot: null,
  assets: [],
  // 持久化字段初始值：未保存的新项目
  currentProjectId: null,
  currentProjectName: "未命名项目",
  settings: { ...DEFAULT_SETTINGS },
  // 撤销/重做历史栈初始为空
  past: [],
  future: [],
  setPlayState: (playState) => set({ playState }),
  // 播放：组装项目 JSON（nodes + script + scripts）→ iframe run
  // 同时传递 script（向后兼容 runtime.html）和 scripts（阶段四 runtime.html 用）
  // 深拷贝 nodes：确保发给 iframe 的数据与编辑器完全独立
  // structured clone via postMessage 已隔离 iframe 侧，但 store.project 也用深拷贝防止引用泄漏
  play: () =>
    set((state) => {
      if (state.playState === "playing") return {};
      if (state.playState === "paused") return { playState: "playing" };
      return {
        playState: "playing",
        // 保存播放前场景快照（深拷贝每个节点含嵌套 transform/rotation/scale）
        prePlaySnapshot: deepCloneNodes(state.nodes),
        project: {
          content: structuredClone(state.content),
          version: PROJECT_VERSION,
          scene: {
            nodes: deepCloneNodes(state.nodes),
          }, // 深拷贝
          assets: [],
          script: state.script,
          scripts: deepCloneScripts(state.scripts),
          activeFileId: state.activeFileId,
          settings: structuredClone(state.settings),
        },
      };
    }),
  pause: () =>
    set((state) =>
      state.playState === "playing" ? { playState: "paused" } : {},
    ),
  // 停止：恢复播放前的场景快照（如果有），清除 project 引用，实现编辑态/运行态隔离
  stop: () =>
    set((state) => ({
      playState: "stopped",
      // 恢复播放前的场景快照（如果有的话）
      nodes: state.prePlaySnapshot ?? state.nodes,
      prePlaySnapshot: null,
      // 清除 project 引用
      project: null,
    })),
  selectNode: (selectedNodeId) =>
    set({
      selectedNodeId,
      selectedNodeIds: selectedNodeId ? [selectedNodeId] : [],
    }),
  // 设置多选：selectedNodeId 派生自 selectedNodeIds[0]
  selectNodes: (ids) =>
    set({
      selectedNodeIds: ids,
      selectedNodeId: ids[0] || null,
    }),
  // 加选/减选（Ctrl/Cmd+点击）：已选则移除，未选则追加
  toggleNodeSelection: (id) =>
    set((state) => {
      const isSelected = state.selectedNodeIds.includes(id);
      const newIds = isSelected
        ? state.selectedNodeIds.filter((sid) => sid !== id)
        : [...state.selectedNodeIds, id];
      return {
        selectedNodeIds: newIds,
        selectedNodeId: newIds[0] || null,
      };
    }),
  // 清空选择
  clearSelection: () =>
    set({
      selectedNodeIds: [],
      selectedNodeId: null,
    }),
  // 复制选中节点到内部剪贴板（深拷贝 transform/rotation/scale/scripts，不入栈）
  copyToClipboard: () => {
    const state = get();
    const selected = new Set(state.selectedNodeIds);
    if (!state.nodes.some((node) => selected.has(node.id))) return;
    const children = new Map<string, string[]>();
    for (const node of state.nodes) {
      if (!node.parentId) continue;
      const siblings = children.get(node.parentId) || [];
      siblings.push(node.id);
      children.set(node.parentId, siblings);
    }
    const ids = new Set<string>(), pending = [...state.selectedNodeIds];
    while (pending.length) {
      const id = pending.pop()!;
      if (ids.has(id)) continue;
      ids.add(id);
      for (const child of children.get(id) || []) pending.push(child);
    }
    set({
      clipboardContent: structuredClone(state.content),
      clipboardAudioBuffers: new Map(state.audioBuffers),
      clipboardTextureBuffers: new Map(state.textureBuffers),
      clipboardPrefabInstances: structuredClone(state.content.prefabInstances),
      clipboard: deepCloneNodes(state.nodes.filter((node) => ids.has(node.id))),
      clipboardModelBuffers: new Map(state.modelBuffers),
    });
  },
  // 粘贴剪贴板节点：生成新 ID，保持剪贴板内父子关系，可选指定 parentId（入栈）
  pasteFromClipboard: (parentId) => {
    const state = get();
    if (!state.clipboard || state.clipboard.length === 0) return;
    if (parentId !== undefined && parentId !== null &&
        !state.nodes.some((node) => node.id === parentId))
      throw new Error("粘贴目标父节点不存在");

    const newNodes: SceneNode[] = [];
    const idMap = new Map<string, string>(); // 旧ID → 新ID

    // 为每个剪贴板节点生成新 ID
    state.clipboard.forEach((node) => {
      const newId =
        node.id +
        "_copy_" +
        Date.now().toString(36) +
        "_" +
        Math.random().toString(36).slice(2, 6);
      idMap.set(node.id, newId);
    });

    state.clipboard.forEach((node) => {
      const newId = idMap.get(node.id)!;
      // parentId 显式传入时用之；否则映射剪贴板内父子关系，找不到则保留原 parentId
      const newParentId =
        node.parentId && idMap.has(node.parentId)
          ? idMap.get(node.parentId)
          : parentId !== undefined
            ? parentId
            : state.nodes.some((n) => n.id === node.parentId)
              ? node.parentId
              : null;
      newNodes.push({
        ...remapGameplayReferences(node, idMap),
        ...(node.type === "camera" ? { activeCamera: false } : {}),
        id: newId,
        name: node.name + "_copy",
        parentId: newParentId,
        transform: { ...node.transform },
        rotation: { ...node.rotation },
        scale: { ...node.scale },
        scripts: node.scripts ? [...node.scripts] : undefined,
      });
    });

    const links = cloneInstanceLinks(
      newNodes,
      state.clipboardPrefabInstances,
      idMap,
    );
    const restored = restoreClipboardResources(
      state,
      links.nodes,
      links.instances,
    );
    const buffers = new Map([
      ...restored.buffers,
      ...[...idMap].flatMap(([oldId, newId]) => {
        const b = state.clipboardModelBuffers.get(oldId);
        return b ? [[newId, b.slice(0)] as [string, ArrayBuffer]] : [];
      }),
    ]);
    const nodes = [...state.nodes, ...links.nodes];
    validateProject({ ...state, scene: { nodes }, content: restored.content });
    pushHistory(get, set);
    set({
      content: restored.content,
      nodes,
      audioBuffers: restored.audio,
      textureBuffers: restored.textures,
      modelBuffers: buffers,
      missingModelIds: missingModels(nodes, restored.content, buffers),
      selectedNodeIds: links.nodes.map((n) => n.id),
      selectedNodeId: links.nodes[0]?.id || null,
    });
  },
  // 复制副本（Ctrl+D）：深拷贝节点及其整棵子树，根节点保持同级（入栈）
  duplicateNode: (id) => {
    const state = get();
    const node = state.nodes.find((n) => n.id === id);
    if (!node) return;
    pushHistory(get, set);

    // 深拷贝节点 + 整棵子树
    const idMap = new Map<string, string>();
    const timestamp = Date.now().toString(36);

    const children = new Map<string, SceneNode[]>();
    for (const item of state.nodes) {
      if (!item.parentId) continue;
      const siblings = children.get(item.parentId) || [];
      siblings.push(item);
      children.set(item.parentId, siblings);
    }
    const subtree: SceneNode[] = [], pending = [node], visited = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      subtree.push(current);
      idMap.set(current.id, current.id + "_copy_" + timestamp + "_" + Math.random().toString(36).slice(2, 6));
      const descendants = children.get(current.id) || [];
      for (let i = descendants.length - 1; i >= 0; i--) pending.push(descendants[i]);
    }

    const newNodes: SceneNode[] = subtree.map((n) => {
      const newId = idMap.get(n.id)!;
      const newParentId = n.parentId
        ? idMap.get(n.parentId) || n.parentId
        : n.parentId;
      return {
        ...remapGameplayReferences(n, idMap),
        ...(n.type === "camera" ? { activeCamera: false } : {}),
        id: newId,
        name: n.name + "_copy",
        // 根节点保持同级（沿用原 parentId），子节点映射到新父 ID
        parentId: n.id === id ? n.parentId : newParentId,
        transform: { ...n.transform },
        rotation: { ...n.rotation },
        scale: { ...n.scale },
        scripts: n.scripts ? [...n.scripts] : undefined,
      };
    });

    const links = cloneInstanceLinks(
      newNodes,
      state.content.prefabInstances,
      idMap,
    );
    const nodes = [...state.nodes, ...links.nodes];
    const content = {
      ...state.content,
      prefabInstances: inferInstanceParents(nodes, {
        ...state.content.prefabInstances,
        ...links.instances,
      }),
    };
    const buffers = new Map([
      ...state.modelBuffers,
      ...[...idMap].flatMap(([oldId, newId]) => {
        const buffer = state.modelBuffers.get(oldId);
        return buffer ? [[newId, buffer.slice(0)] as [string, ArrayBuffer]] : [];
      }),
    ]);
    set({
      content,
      nodes,
      modelBuffers: buffers,
      missingModelIds: missingModels(nodes, content, buffers),
      selectedNodeIds: [newNodes[0].id],
      selectedNodeId: newNodes[0].id,
    });
  },
  // 可见性 toggle（入栈，可撤销）
  toggleVisibility: (id) => {
    if (!get().nodes.some((node) => node.id === id)) return;
    pushHistory(get, set);
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, visible: !n.visible } : n,
      ),
    }));
  },
  setGizmoMode: (gizmoMode) => set({ gizmoMode }),
  setGizmoSpace: (gizmoSpace) => set({ gizmoSpace }),
  // 撤销：从 past 弹出最近快照恢复，当前状态压入 future
  undo: () =>
    set((state) => {
      if (state.playState !== "stopped" || state.past.length === 0) return {};
      const previous = state.past[state.past.length - 1];
      const currentSnapshot = createSnapshot(state);
      currentSnapshot.scriptChange = previous.scriptChange;
      const availableIds = new Set(previous.nodes.map((node) => node.id));
      const restoredSelectedIds = state.selectedNodeIds.filter((id) => availableIds.has(id));
      const restoredSelectedId = restoredSelectedIds[0] || null;
      return {
        ...restoreClipboardScripts(state, previous.scriptChange, true),
        content: previous.content,
        audioBuffers: previous.audioBuffers,
        textureBuffers: previous.textureBuffers,
        nodes: previous.nodes,
        scripts: previous.scripts,
        activeFileId: previous.activeFileId,
        modelBuffers: new Map(previous.modelBuffers),
        missingModelIds: new Set(previous.missingModelIds),
        settings: previous.settings,
        // 同步派生字段：恢复 activeFileId 对应的脚本内容
        script: previous.scripts[previous.activeFileId] || "",
        past: state.past.slice(0, -1),
        future: [currentSnapshot, ...state.future],
        selectedNodeId: restoredSelectedId,
        selectedNodeIds: restoredSelectedIds,
      };
    }),
  // 重做：从 future 弹出最近快照恢复，当前状态压入 past
  redo: () =>
    set((state) => {
      if (state.playState !== "stopped" || state.future.length === 0) return {};
      const next = state.future[0];
      const currentSnapshot = createSnapshot(state);
      currentSnapshot.scriptChange = next.scriptChange;
      const availableIds = new Set(next.nodes.map((node) => node.id));
      const restoredSelectedIds = state.selectedNodeIds.filter((id) => availableIds.has(id));
      const restoredSelectedId = restoredSelectedIds[0] || null;
      return {
        ...restoreClipboardScripts(state, next.scriptChange, false),
        content: next.content,
        audioBuffers: next.audioBuffers,
        textureBuffers: next.textureBuffers,
        nodes: next.nodes,
        scripts: next.scripts,
        activeFileId: next.activeFileId,
        modelBuffers: new Map(next.modelBuffers),
        missingModelIds: new Set(next.missingModelIds),
        settings: next.settings,
        script: next.scripts[next.activeFileId] || "",
        past: [...state.past, currentSnapshot],
        future: state.future.slice(1),
        selectedNodeId: restoredSelectedId,
        selectedNodeIds: restoredSelectedIds,
      };
    }),
  // Gizmo 拖拽开始时调用：保存拖拽前快照到 past
  // 之后 updateTransform(recordHistory=false) 不再入栈，拖拽结束只产生一条历史
  beginTransform: () => {
    pushHistory(get, set);
  },
  updateTransform: (id, partial, recordHistory = true) => {
    const target = get().nodes.find((node) => node.id === id);
    if (!target) return;
    if (partial.activeCamera === true && target.type !== "camera")
      throw new Error("运行相机必须引用相机节点");
    const unchanged = Object.entries(partial).every(([key, value]) => {
      const current = target[key as keyof SceneNode];
      if (["physics", "character", "joints", "animation", "audioSource"].includes(key))
        return sameConfiguration(value, current);
      if (["transform", "rotation", "scale"].includes(key) && value && current) {
        const nextVector = value as Transform, currentVector = current as Transform;
        return ["x", "y", "z"].every((axis) =>
          Object.is(nextVector[axis as keyof Transform], currentVector[axis as keyof Transform]),
        );
      }
      return Object.is(value, current);
    });
    if (unchanged && !(partial.activeCamera === true && get().nodes.some(
      (node) => node.id !== id && node.type === "camera" && node.activeCamera,
    ))) return;
    partial = structuredClone(partial);
    if (
      ["physics", "character", "joints", "animation", "audioSource", "castShadows", "receiveShadows", "planarReflection", "bakedLighting", "optimization"].some((k) =>
        Object.hasOwn(partial, k),
      )
    ) {
      assertEditing(get());
      validateProject({
        ...get(),
        scene: {
          nodes: get().nodes.map((n) =>
            n.id === id ? { ...n, ...partial } : n,
          ),
        },
      });
    }
    if (recordHistory) pushHistory(get, set);
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id
          ? { ...n, ...partial }
          : partial.activeCamera === true && n.type === "camera"
            ? { ...n, activeCamera: false }
            : n,
      ),
    }));
  },
  // 创建节点：生成 id、默认属性，并选中该节点
  addNode: (type, name) => {
    pushHistory(get, set);
    const id = type + "_" + crypto.randomUUID();
    const defaultName = name || type.charAt(0).toUpperCase() + type.slice(1);
    const newNode: SceneNode = {
      id,
      name: defaultName,
      type,
      transform: { x: 0, y: 0.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      parentId: null,
      ...(type === "mesh"
        ? {
            primitive: /sphere/i.test(defaultName)
              ? ("sphere" as const)
              : ("box" as const),
          }
        : {}),
      ...(type === "light" ? { lightType: "directional" as const } : {}),
      ...(type === "mesh" ? { color: "#7C9CFF" } : {}),
      ...(type === "light" ? { color: "#FFFFFF", intensity: 0.8 } : {}),
      ...(type === "camera"
        ? {
            fov: 60,
            activeCamera: !get().nodes.some(
              (n) => n.type === "camera" && n.activeCamera,
            ),
          }
        : {}),
    };
    set((state) => ({
      nodes: [...state.nodes, newNode],
      selectedNodeId: id,
      selectedNodeIds: [id],
    }));
    return id;
  },
  // 级联删除：按父子索引收集目标节点及其后代
  removeNode: (id) => get().removeNodes([id]),
  removeNodes: (ids) => {
    const targets = new Set(ids);
    if (!get().nodes.some((node) => targets.has(node.id))) return;
    pushHistory(get, set);
    set((state) => {
      const toDelete = new Set<string>();
      const children = new Map<string, string[]>();
      for (const node of state.nodes) {
        if (!node.parentId) continue;
        const siblings = children.get(node.parentId) || [];
        siblings.push(node.id);
        children.set(node.parentId, siblings);
      }
      const pending = [...ids];
      while (pending.length) {
        const id = pending.pop()!;
        if (toDelete.has(id)) continue;
        toDelete.add(id);
        for (const child of children.get(id) || []) pending.push(child);
      }
      // 同步多选：从 selectedNodeIds 中移除所有被删节点
      const newSelectedIds = state.selectedNodeIds.filter(
        (sid) => !toDelete.has(sid),
      );
      return {
        content: {
          ...state.content,
          prefabInstances: Object.fromEntries(
            Object.entries(state.content.prefabInstances).filter(
              ([, i]) => !toDelete.has(i.rootId),
            ),
          ),
        },
        nodes: state.nodes
          .filter((n) => !toDelete.has(n.id))
          .map((n) => ({
            ...n,
            joints: n.joints?.filter((j) => !toDelete.has(j.targetId)),
            animation:
              n.animation?.retarget &&
              toDelete.has(n.animation.retarget.sourceId)
                ? { ...n.animation, retarget: undefined }
                : n.animation,
          })),
        modelBuffers: new Map(
          [...state.modelBuffers].filter(([id]) => !toDelete.has(id)),
        ),
        missingModelIds: new Set(
          [...state.missingModelIds].filter((id) => !toDelete.has(id)),
        ),
        modelAnimations: Object.fromEntries(
          Object.entries(state.modelAnimations).filter(([id]) => !toDelete.has(id)),
        ),
        modelParts: Object.fromEntries(
          Object.entries(state.modelParts).filter(([id]) => !toDelete.has(id)),
        ),
        selectedNodeId: newSelectedIds[0] || null,
        selectedNodeIds: newSelectedIds,
      };
    });
  },
  // 重命名节点
  renameNode: (id, name) => {
    const node = get().nodes.find((item) => item.id === id);
    if (!node || node.name === name) return;
    pushHistory(get, set);
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id
          ? {
              ...n,
              primitive:
                n.type === "mesh"
                  ? (n.primitive ?? (/sphere/i.test(n.name) ? "sphere" : "box"))
                  : undefined,
              name,
            }
          : n,
      ),
    }));
  },
  // 设置父节点（拖拽层级）
  setParent: (id, parentId) => {
    const state = get();
    const node = state.nodes.find((item) => item.id === id);
    if (!node || (node.parentId ?? null) === (parentId ?? null)) return;
    const moved = Object.values(state.content.prefabInstances).find(
      (i) => i.rootId === id,
    );
    if (moved) {
      let ancestor = parentId;
      while (ancestor) {
        const enclosing = Object.values(state.content.prefabInstances).find(
          (i) => i.rootId === ancestor,
        );
        if (
          enclosing &&
          (enclosing.prefabId === moved.prefabId ||
            prefabDependsOn(
              state.content.prefabs,
              moved.prefabId,
              enclosing.prefabId,
            ))
        )
          throw new Error("预制体嵌套依赖包含循环");
        ancestor = state.nodes.find((n) => n.id === ancestor)?.parentId || null;
      }
    }
    for (const i of Object.values(state.content.prefabInstances)) {
      if (
        i.rootId !== id &&
        Object.values(i.nodeMap).includes(id) &&
        !subtree(state.nodes, i.rootId).some((n) => n.id === parentId)
      )
        throw new Error("请先解除外层预制体关联，再移出继承节点");
    }
    const linked = get().nodes.find((n) => n.id === id)?.prefab;
    if (linked) {
      const instance = get().content.prefabInstances[linked.instanceId];
      if (
        instance &&
        instance.rootId !== id &&
        !subtree(get().nodes, instance.rootId).some((n) => n.id === parentId)
      )
        throw new Error("请先解除预制体关联，再将子节点移出实例");
    }
    let ancestor = parentId;
    while (ancestor) {
      if (ancestor === id) return;
      ancestor = get().nodes.find((n) => n.id === ancestor)?.parentId ?? null;
    }
    if (
      !get().nodes.some((n) => n.id === id) ||
      (parentId && !get().nodes.some((n) => n.id === parentId))
    )
      return;
    const nodes = state.nodes.map((n) =>
      n.id === id ? { ...n, parentId } : n,
    );
    const content = {
      ...state.content,
      prefabInstances: inferInstanceParents(
        nodes,
        state.content.prefabInstances,
      ),
    };
    validateProject({ ...state, scene: { nodes }, content });
    pushHistory(get, set);
    set({ nodes, content });
  },
  // 给节点挂载脚本（进入历史栈，可撤销）
  attachScript: (nodeId, scriptFile) => {
    assertEditing(get());
    const node = get().nodes.find((item) => item.id === nodeId);
    if (
      !node ||
      !Object.hasOwn(get().scripts, scriptFile) ||
      node.scripts?.includes(scriptFile)
    )
      return;
    pushHistory(get, set);
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, scripts: [...(n.scripts || []), scriptFile] }
          : n,
      ),
    }));
  },
  // 从节点卸载脚本（进入历史栈，可撤销）
  detachScript: (nodeId, scriptFile) => {
    assertEditing(get());
    if (!get().nodes.find((node) => node.id === nodeId)?.scripts?.includes(scriptFile)) return;
    pushHistory(get, set);
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, scripts: (n.scripts || []).filter((s) => s !== scriptFile) }
          : n,
      ),
    }));
  },
  // setScript：向后兼容别名，等价于 updateScript(activeFileId, code)
  setScript: (code) => {
    assertEditing(get());
    set((state) => ({
      scripts: { ...state.scripts, [state.activeFileId]: code },
      script: code,
    }));
  },
  // 新建脚本：避免重名，创建后切换为活跃文件
  createScript: (fileName, content = "") => {
    assertEditing(get());
    if (!fileName.trim() || Object.hasOwn(get().scripts, fileName)) return;
    assertScriptPath(fileName);
    pushHistory(get, set);
    set((state) => {
      if (Object.prototype.hasOwnProperty.call(state.scripts, fileName))
        return {}; // 重名则不操作
      const newScripts = { ...state.scripts, [fileName]: content };
      return { scripts: newScripts, activeFileId: fileName, script: content };
    });
  },
  // 删除脚本：不允许删除 main.js；若删除的是活跃文件则切回 main.js
  deleteScript: (fileName) => {
    assertEditing(get());
    if (fileName === "main.js" || !Object.hasOwn(get().scripts, fileName))
      return;
    const clipboardBefore = clipboardScriptsSnapshot(get());
    pushHistory(get, set);
    set((state) => {
      if (fileName === "main.js") return {}; // 不允许删除 main.js
      const newScripts = { ...state.scripts };
      delete newScripts[fileName];
      const newActive =
        state.activeFileId === fileName ? "main.js" : state.activeFileId;
      return {
        scripts: newScripts,
        clipboardContent: state.clipboardContent
          ? rewriteContentScripts(state.clipboardContent, (name) =>
              name === fileName ? null : name,
            )
          : null,
        content: rewriteContentScripts(state.content, (name) =>
          name === fileName ? null : name,
        ),
        clipboard:
          state.clipboard?.map((n) =>
            rewriteNodeScripts(n, (name) => (name === fileName ? null : name)),
          ) || null,
        clipboardPrefabInstances: rewriteInstancesScripts(
          state.clipboardPrefabInstances,
          (name) => (name === fileName ? null : name),
        ),
        nodes: state.nodes.map((n) =>
          rewriteNodeScripts(n, (name) => (name === fileName ? null : name)),
        ),
        activeFileId: newActive,
        script: newScripts[newActive] || "",
      };
    });
    recordScriptHistory(get, set, fileName, null, clipboardBefore);
  },
  // 重命名脚本：目标名已存在或源名不存在则不操作
  renameScript: (oldName, newName) => {
    assertEditing(get());
    if (
      oldName === "main.js" ||
      !newName.trim() ||
      Object.hasOwn(get().scripts, newName) ||
      !Object.hasOwn(get().scripts, oldName)
    )
      return;
    assertScriptPath(newName);
    const clipboardBefore = clipboardScriptsSnapshot(get());
    pushHistory(get, set);
    set((state) => {
      if (
        Object.prototype.hasOwnProperty.call(state.scripts, newName) ||
        !Object.prototype.hasOwnProperty.call(state.scripts, oldName)
      )
        return {};
      const newScripts = globalThis.ArkGlideModules.rewriteRename(
        state.scripts,
        oldName,
        newName,
      );
      const newActive =
        state.activeFileId === oldName ? newName : state.activeFileId;
      return {
        scripts: newScripts,
        clipboardContent: state.clipboardContent
          ? rewriteContentScripts(state.clipboardContent, (name) =>
              name === oldName ? newName : name,
            )
          : null,
        content: rewriteContentScripts(state.content, (name) =>
          name === oldName ? newName : name,
        ),
        clipboard:
          state.clipboard?.map((n) =>
            rewriteNodeScripts(n, (name) =>
              name === oldName ? newName : name,
            ),
          ) || null,
        clipboardPrefabInstances: rewriteInstancesScripts(
          state.clipboardPrefabInstances,
          (name) => (name === oldName ? newName : name),
        ),
        nodes: state.nodes.map((n) =>
          rewriteNodeScripts(n, (name) => (name === oldName ? newName : name)),
        ),
        activeFileId: newActive,
        script: newScripts[newActive] || "",
      };
    });
    recordScriptHistory(get, set, oldName, newName, clipboardBefore);
  },
  // 更新脚本内容：仅当更新的是活跃文件时同步派生 script 字段
  updateScript: (fileName, content) => {
    assertEditing(get());
    if (!Object.hasOwn(get().scripts, fileName)) return;
    if (get().scripts[fileName] === content) return;
    pushHistory(get, set);
    set((state) => ({
      scripts: { ...state.scripts, [fileName]: content },
      script: state.activeFileId === fileName ? content : state.script,
    }));
  },
  // 切换当前编辑的脚本：同步派生 script 字段
  setActiveFile: (fileName) => {
    if (!Object.hasOwn(get().scripts, fileName) || get().activeFileId === fileName) return;
    set((state) => ({
      activeFileId: fileName,
      script: state.scripts[fileName] || "",
    }));
  },
  addConsoleLog: (level, text, location) =>
    set((state) => ({
      consoleLogs: [
        ...state.consoleLogs.slice(-999),
        { id: ++logId, level, text, time: Date.now(), location },
      ],
    })),
  clearConsoleLogs: () => set({ consoleLogs: [] }),
  setAssets: (assets) => set({ assets }),
  modelBuffers: new Map(),
  setModelBuffer: (id, buffer) =>
    set((state) => {
      const newMap = new Map(state.modelBuffers);
      newMap.set(id, buffer.slice(0));
      return {
        modelBuffers: newMap,
        missingModelIds: new Set(
          [...state.missingModelIds].filter((missingId) => missingId !== id),
        ),
      };
    }),
  // 资源丢失标记初始为空集
  missingModelIds: new Set(),
  // 重新链接模型：写入 modelBuffers 缓存并从 missingModelIds 移除
  relinkModel: (nodeId, buffer, fileName) => {
    buffer = buffer.slice(0);
    pushHistory(get, set);
    set((state) => {
      const newMap = new Map(state.modelBuffers);
      newMap.set(nodeId, buffer);
      const newMissing = new Set(state.missingModelIds);
      newMissing.delete(nodeId);
      const modelAnimations = { ...state.modelAnimations };
      const modelParts = { ...state.modelParts };
      delete modelAnimations[nodeId];
      delete modelParts[nodeId];
      return {
        modelAnimations,
        modelParts,
        nodes: state.nodes.map((n) =>
          n.id === nodeId
            ? { ...n, ...(fileName === undefined ? {} : { modelUrl: fileName }), modelRevision: crypto.randomUUID() }
            : n,
        ),
        modelBuffers: newMap,
        missingModelIds: newMissing,
      };
    });
  },
  // 保存当前项目到 IndexedDB
  // 如果 currentProjectId 为 null，用时间戳生成新 ID
  // 序列化 nodes + scripts + activeFileId + modelRefs（从 modelBuffers 提取）
  // 同时保存所有 modelBuffers 到 modelStore
  saveCurrentProject: async (name) => {
    const state = get();
    const epoch = projectEpoch;
    // 确定项目 ID：若 currentProjectId 为 null 则生成新 ID
    const projectId =
      state.currentProjectId ??
      activeProjectSaves.get(state.documentId)?.projectId ??
      crypto.randomUUID();
    // 确定项目名称：若提供 name 参数则更新，否则沿用现有名称
    const projectName = name ?? state.currentProjectName;
    // 从 nodes 中提取模型引用：遍历 type='model' 的节点
    const modelRefs = collectModelRefs(state.nodes, state.content);
    // 构造 StoredProject 元数据
    const data: StoredProject = {
      projectId,
      content: state.content,
      name: projectName,
      version: PROJECT_VERSION,
      updatedAt: Date.now(),
      scene: { nodes: state.nodes },
      scripts: state.scripts,
      activeFileId: state.activeFileId,
      modelRefs,
      settings: state.settings,
    };
    const activeSave = activeProjectSaves.get(state.documentId) || {
      projectId,
      pending: 0,
    };
    activeSave.pending++;
    activeProjectSaves.set(state.documentId, activeSave);
    try {
      await saveProjectSnapshot(
        data,
        state.modelBuffers,
        state.textureBuffers,
        state.audioBuffers,
      );
      // 更新 currentProjectId / currentProjectName 状态
      if (epoch === projectEpoch)
        set({
          currentProjectId: projectId,
          currentProjectName: projectName,
          savedSnapshot: {
            project: data,
            buffers: state.modelBuffers,
            audio: state.audioBuffers,
            textures: state.textureBuffers,
          },
        });
    } finally {
      if (--activeSave.pending === 0) activeProjectSaves.delete(state.documentId);
    }
  },
  // 从 IndexedDB 加载项目并恢复全部状态
  // 读取 StoredProject → 恢复 nodes/scripts/activeFileId/currentProjectId/currentProjectName
  // 异步加载所有 modelRefs 对应的 modelBlob 到 modelBuffers
  // 如果某个 modelBlob 不存在（用户清了缓存），在 consoleLogs 中添加警告
  loadProjectById: async (projectId) => {
    const epoch = ++projectEpoch;
    const stored = await loadProject(projectId);
    const data = stored ? normalizeProject(stored) : undefined;
    if (!data) throw new Error("项目不存在: " + projectId);
    validateProject(data);
    const buffers = new Map<string, ArrayBuffer>(),
      missing = new Set<string>();
    for (const ref of data.modelRefs) {
      const blob = await loadModelBlob(ref.assetId, projectId);
      if (blob) {
        if (!(blob instanceof ArrayBuffer))
          throw new Error("模型资源损坏: " + ref.fileName);
        buffers.set(ref.assetId, blob);
      }
      else missing.add(ref.assetId);
    }
    if (epoch !== projectEpoch) return;
    const textures = new Map<string, ArrayBuffer>();
    for (const texture of data.content?.textures || []) {
      const b = await loadTextureBlob(texture.id, projectId);
      if (b) {
        if (!(b instanceof ArrayBuffer) || b.byteLength !== texture.byteLength)
          throw new Error("贴图大小不一致: " + texture.name);
        textures.set(texture.id, b);
      }
    }
    if (epoch !== projectEpoch) return;
    const audio = new Map<string, ArrayBuffer>();
    for (const a of data.content?.audio || []) {
      const b = await loadAudioBlob(a.id, projectId);
      if (b) {
        if (!(b instanceof ArrayBuffer) || b.byteLength !== a.byteLength)
          throw new Error("音频大小不一致: " + a.name);
        audio.set(a.id, b);
      }
    }
    if (epoch !== projectEpoch) return;
    get().replaceProject(
      data,
      buffers,
      missing,
      false,
      undefined,
      textures,
      audio,
    );
  },
  replaceProject: (
    data,
    buffers,
    missing,
    imported = false,
    recoveryId,
    textures = new Map(),
    audio = new Map(),
  ) => {
    const normalized = normalizeProject(data);
    const valid = validateProject(normalized);
    ({ buffers, textures, audio, missing } = structuredClone({
      buffers, textures, audio, missing,
    }));
    ++projectEpoch;
    set({
      modelAnimations: {},
      modelParts: {},
      content: valid.content,
      audioBuffers: audio,
      textureBuffers: textures,
      clipboardPrefabInstances: {},
      clipboardContent: null,
      clipboardAudioBuffers: new Map(),
      clipboardTextureBuffers: new Map(),
      documentId: recoveryId || crypto.randomUUID(),
      documentOrigin: recoveryId
        ? "recovered"
        : imported
          ? "imported"
          : "loaded",
      savedSnapshot: null,
      recoveryStatus: "idle",
      recoveryError: null,
      recoveryUpdatedAt: null,
      scriptNavigation: null,
      runtimeStats: null,
      nodes: valid.nodes,
      scripts: valid.scripts,
      activeFileId: valid.activeFileId,
      script: valid.scripts[valid.activeFileId],
      settings: valid.settings,
      currentProjectId: imported ? null : data.projectId,
      currentProjectName: data.name,
      modelBuffers: buffers,
      missingModelIds: missing,
      playState: "stopped",
      project: null,
      prePlaySnapshot: null,
      selectedNodeId: null,
      selectedNodeIds: [],
      clipboard: null,
      clipboardModelBuffers: new Map(),
      assets: [],
      past: [],
      future: [],
      consoleLogs: [
        ...[...missing].map((id) => ({
          id: ++logId,
          level: "warn" as const,
          text: "资源丢失: " + id,
          time: Date.now(),
        })),
        ...(valid.content.audio || [])
          .filter((a) => !audio.has(a.id))
          .map((a) => ({
            id: ++logId,
            level: "warn" as const,
            text: "音频丢失: " + a.name,
            time: Date.now(),
          })),
        ...valid.content.textures
          .filter((t) => !textures.has(t.id))
          .map((t) => ({
            id: ++logId,
            level: "warn" as const,
            text: "贴图丢失: " + t.name,
            time: Date.now(),
          })),
      ],
    });
  },
  // 项目设置和场景编辑共用撤销历史。
  updateSettings: (partial) => {
    const current = get().settings;
    const unchanged = (Object.keys(partial) as (keyof ProjectSettings)[]).every((key) =>
      key === "gravity"
        ? partial.gravity && (["x", "y", "z"] as const).every((axis) =>
            Object.is(partial.gravity![axis], current.gravity[axis]))
        : Object.is(partial[key], current[key]),
    );
    if (unchanged) return;
    partial = structuredClone(partial);
    if (partial.rendering !== undefined) {
      const state = get();
      partial.rendering = validateProject({ ...state, settings: { ...state.settings, ...partial }, scene: { nodes: state.nodes } }).settings.rendering;
    }
    pushHistory(get, set);
    set((state) => ({
      settings: { ...state.settings, ...partial },
    }));
  },
  // 新建项目：重置为初始状态
  newProject: () => {
    ++projectEpoch;
    set({
      modelAnimations: {},
      modelParts: {},
      setModelParts: (id, parts) =>
        set((s) => {
          const modelParts = { ...s.modelParts };
          if (parts.length && s.nodes.some((n) => n.id === id && n.type === "model"))
            modelParts[id] = structuredClone(parts);
          else delete modelParts[id];
          return { modelParts };
        }),
      setModelSlotMaterial: (nodeId, key, materialId) => {
        const s = get();
        assertEditing(s);
        const node = s.nodes.find((n) => n.id === nodeId);
        if (node?.type !== "model" || !/^mesh:\d+\/slot:\d+$/.test(key))
          throw new Error("无效模型材质槽");
        if (materialId != null && !Object.hasOwn(s.content.materials, materialId))
          throw new Error("材质不存在");
        if (node.materialSlots?.[key] === materialId) return;
    const slots = { ...node.materialSlots };
        if (materialId === undefined) delete slots[key];
        else slots[key] = materialId;
        pushHistory(get, set);
        set({
          nodes: s.nodes.map((n) =>
            n.id === nodeId ? { ...n, materialSlots: slots } : n,
          ),
        });
      },
      content: emptyContent(),
      audioBuffers: new Map(),
      textureBuffers: new Map(),
      clipboardPrefabInstances: {},
      clipboardContent: null,
      clipboardAudioBuffers: new Map(),
      clipboardTextureBuffers: new Map(),
      documentId: crypto.randomUUID(),
      documentOrigin: "new",
      savedSnapshot: null,
      recoveryStatus: "idle",
      recoveryError: null,
      recoveryUpdatedAt: null,
      scriptNavigation: null,
      runtimeStats: null,
      past: [],
      future: [],
      project: null,
      assets: [],
      nodes: deepCloneNodes(initialNodes),
      scripts: { "main.js": DEFAULT_SCRIPT },
      activeFileId: "main.js",
      script: DEFAULT_SCRIPT,
      currentProjectId: null,
      currentProjectName: "未命名项目",
      consoleLogs: [],
      modelBuffers: new Map(),
      missingModelIds: new Set(),
      playState: "stopped",
      selectedNodeId: "cube",
      selectedNodeIds: ["cube"],
      settings: { ...DEFAULT_SETTINGS },
      clipboard: null,
      clipboardModelBuffers: new Map(),
      // 重置播放快照：新建项目后无播放前状态
      prePlaySnapshot: null,
    });
  },
  applyLightingBake: (nodes, materials, textures, documentId) => {
    const s=get();assertEditing(s);
    if(s.documentId!==documentId)throw Error('项目已切换，烘焙结果已取消');
    const content={...s.content,materials:{...s.content.materials,...structuredClone(materials)},textures:[...s.content.textures,...textures.map(t=>structuredClone(t.asset))]};
    const textureBuffers=new Map(s.textureBuffers);
    for(const t of textures){if(t.bytes.byteLength!==t.asset.byteLength)throw Error('烘焙贴图大小不一致');textureBuffers.set(t.asset.id,t.bytes.slice(0));}
    validateProject({...s,scene:{nodes},content});
    pushHistory(get,set);set({nodes:structuredClone(nodes),content,textureBuffers});
  },
  createMaterial: (name = "新材质", sourceId) => {
    if (get().playState !== "stopped") throw new Error("请先停止运行");
    const id = crypto.randomUUID(),
      source = sourceId ? get().content.materials[sourceId] : undefined;
    pushHistory(get, set);
    set((s) => ({
      content: {
        ...s.content,
        materials: {
          ...s.content.materials,
          [id]: source
            ? { ...structuredClone(source), id, name }
            : defaultMaterial(id, name),
        },
      },
    }));
    return id;
  },
  updateMaterial: (id, patch) => {
    const s = get();
    if (s.playState !== "stopped" || !s.content.materials[id]) return;
    const material = s.content.materials[id];
    if (Object.entries(patch).every(([key, value]) => {
      if (key === "id") return true;
      if (key === "uvScale" && value) {
        const uv = value as MaterialAsset["uvScale"];
        return Object.is(uv.u, material.uvScale.u) && Object.is(uv.v, material.uvScale.v);
      }
      return Object.is(value, material[key as keyof MaterialAsset]);
    })) return;
    const content = {
      ...s.content,
      materials: {
        ...s.content.materials,
        [id]: { ...s.content.materials[id], ...structuredClone(patch), id },
      },
    };
    validateProject({ ...s, scene: { nodes: s.nodes }, content });
    pushHistory(get, set);
    set({ content });
  },
  deleteMaterial: (id) => {
    const s = get();
    assertEditing(s);
    if (!Object.hasOwn(s.content.materials, id)) return;
    if (
      [
        ...s.nodes,
        ...Object.values(s.content.prefabs).flatMap((p) => [
          ...p.nodes,
          ...Object.values(p.nestedInstances || {}).flatMap((i) => i.baseline),
        ]),
        ...Object.values(s.content.prefabInstances).flatMap((i) => i.baseline),
      ].some(
        (n) =>
          n.materialId === id ||
          Object.values(n.materialSlots || {}).includes(id),
      )
    )
      throw new Error("材质仍被节点或预制体引用，请先解除引用");
    const materials = { ...s.content.materials };
    delete materials[id];
    pushHistory(get, set);
    set({ content: { ...s.content, materials } });
  },
  setNodeMaterial: (nodeId, materialId) => {
    const s = get();
    assertEditing(s);
    const node = s.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    if (!["mesh", "model"].includes(node.type)) throw new Error("材质只能分配给网格或模型节点");
    if (materialId !== undefined && !Object.hasOwn(s.content.materials, materialId))
      throw new Error("材质不存在");
    if (node.materialId === materialId) return;
    pushHistory(get, set);
    set({
      nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, materialId } : n)),
    });
  },
  importTexture: (asset, bytes) => {
    const s = get();
    assertEditing(s);
    if (asset.byteLength !== bytes.byteLength)
      throw new Error("贴图大小不一致");
    asset = structuredClone(asset);
    bytes = bytes.slice(0);
    const content = {
      ...s.content,
      textures: [...s.content.textures.filter((t) => t.id !== asset.id), asset],
    };
    validateProject({ ...s, scene: { nodes: s.nodes }, content });
    pushHistory(get, set);
    set({
      content,
      textureBuffers: new Map([...s.textureBuffers, [asset.id, bytes]]),
    });
  },
  deleteTexture: (id) => {
    const s = get();
    assertEditing(s);
    if (!s.content.textures.some((asset) => asset.id === id)) return;
    if (s.settings.rendering?.environment?.textureId === id)
      throw new Error("贴图仍被环境光照引用，请先解除引用");
    if (s.settings.rendering?.probes?.some(p => p.textureId === id))
      throw new Error("贴图仍被局部反射探针引用，请先解除引用");
    if (
      Object.values(s.content.materials).some((m) =>
        [
          m.albedoTextureId,
          m.normalTextureId,
          m.metallicRoughnessTextureId,
          m.aoTextureId,
          m.lightmapTextureId,
          m.emissiveTextureId,
          m.clearCoatTextureId,
          m.clearCoatNormalTextureId,
          m.sheenTextureId,
          m.anisotropyTextureId,
          m.thicknessTextureId,
          m.transmissionTextureId,
          m.detailTextureId,
        ].includes(id),
      )
    )
      throw new Error("贴图仍被材质引用，请先解除引用");
    if (s.content.gameplay?.hud.some((h) => h.textureId === id))
      throw Error("贴图仍被图片 UI 引用，请先解除引用");
    const buffers = new Map(s.textureBuffers);
    buffers.delete(id);
    pushHistory(get, set);
    set({
      content: {
        ...s.content,
        textures: s.content.textures.filter((t) => t.id !== id),
      },
      textureBuffers: buffers,
    });
  },
  createPrefab: (rootId, name) => {
    const s = get();
    assertEditing(s);
    const selected = subtree(s.nodes, rootId);
    if (!selected.length || !s.nodes.some((n) => n.id === rootId))
      throw new Error("请选择节点");
    if (selected.find((n) => n.id === rootId)?.prefab)
      throw new Error("根节点已关联预制体，请使用普通父节点创建复合模板");
    const id = crypto.randomUUID(),
      prefab = captureNestedPrefab(
        s.nodes,
        rootId,
        id,
        name || selected.find((n) => n.id === rootId)!.name,
        s.content.prefabInstances,
      ),
      created = createInstance(prefab, s.nodes, undefined, selected);
    const buffers = new Map(s.modelBuffers);
    prefab.nodes.forEach((n, index) => {
      const b = s.modelBuffers.get(selected[index].id);
      if (n.type === "model" && b)
        buffers.set(prefab.modelKeys[n.id], b.slice(0));
    });
    const prefabs = { ...s.content.prefabs, [id]: prefab };
    assertPrefabGraph(prefabs);
    const linked = linkNestedInstances(
      s.nodes.map((n) => created.nodes.find((c) => c.id === n.id) || n),
      { ...s.content.prefabInstances, [created.instance.id]: created.instance },
      prefabs,
    );
    const content = {
      ...s.content,
      prefabs,
      prefabInstances: linked.instances,
    };
    validateProject({ ...s, scene: { nodes: linked.nodes }, content });
    pushHistory(get, set);
    set({
      content,
      nodes: linked.nodes,
      modelBuffers: buffers,
      missingModelIds: missingModels(linked.nodes, content, buffers),
    });
    return id;
  },
  instantiatePrefab: (id) => {
    const s = get();
    assertEditing(s);
    const prefab = s.content.prefabs[id];
    if (!prefab) throw new Error("预制体不存在");
    const created = createInstance(prefab, s.nodes, { x: 0, y: 0.5, z: 0 }),
      buffers = new Map(s.modelBuffers);
    for (const node of created.nodes)
      if (node.type === "camera") node.activeCamera = false;
    for (const n of prefab.nodes)
      if (n.type === "model") {
        const b = buffers.get(prefab.modelKeys[n.id]);
        if (b) buffers.set(created.instance.nodeMap[n.id], b.slice(0));
      }
    const linked = linkNestedInstances(
      [...s.nodes, ...created.nodes],
      { ...s.content.prefabInstances, [created.instance.id]: created.instance },
      s.content.prefabs,
    );
    const nodes = linked.nodes,
      content = { ...s.content, prefabInstances: linked.instances };
    validateProject({ ...s, scene: { nodes }, content });
    pushHistory(get, set);
    set({
      content,
      nodes,
      modelBuffers: buffers,
      missingModelIds: missingModels(nodes, content, buffers),
      selectedNodeId: created.instance.rootId,
      selectedNodeIds: [created.instance.rootId],
    });
    return created.instance.rootId;
  },
  updatePrefabFromInstance: (instanceId) => {
    const s = get();
    assertEditing(s);
    const source = s.content.prefabInstances[instanceId];
    if (!source) throw new Error("实例不存在");
    const previous = s.content.prefabs[source.prefabId],
      selected = subtree(s.nodes, source.rootId),
      prefab = captureNestedPrefab(
        s.nodes,
        source.rootId,
        previous.id,
        previous.name,
        s.content.prefabInstances,
        source,
      );
    prefab.revision = previous.revision + 1;
    const buffers = new Map(s.modelBuffers);
    prefab.nodes.forEach((n, index) => {
      if (n.type === "model") {
        const b = s.modelBuffers.get(selected[index].id);
        if (b) buffers.set(prefab.modelKeys[n.id], b.slice(0));
        else buffers.delete(prefab.modelKeys[n.id]);
      }
    });
    // New children in the source instance become inherited without changing scene IDs.
    const sourceMap = { ...source.nodeMap };
    prefab.nodes.forEach((n, index) => (sourceMap[n.id] = selected[index].id));
    let nodes = s.nodes;
    let instances = inferInstanceParents(nodes, {
      ...s.content.prefabInstances,
      [source.id]: { ...source, nodeMap: sourceMap },
    });
    const candidates = structuredClone({
      ...s.content.prefabs,
      [prefab.id]: prefab,
    });
    // A scene-only child may already have been saved in an enclosing template.
    // Promote its existing enclosing local ID into the child mount before merging.
    let mountSource = instances[source.id];
    while (mountSource?.parentInstanceId) {
      const parent = instances[mountSource.parentInstanceId];
      const mount = Object.values(
        candidates[parent.prefabId].nestedInstances || {},
      ).find((m) => parent.nodeMap[m.rootId] === mountSource.rootId);
      if (mount)
        for (const [local, sceneId] of Object.entries(mountSource.nodeMap)) {
          const outer = Object.entries(parent.nodeMap).find(
            ([, scene]) => scene === sceneId,
          )?.[0];
          if (outer && !mount.nodeMap[local]) mount.nodeMap[local] = outer;
        }
      mountSource = parent;
    }
    const refreshed = refreshDependentTemplates(candidates, prefab.id, buffers);
    // Align newly inherited source nodes through all enclosing mounts, preserving their scene IDs.
    let current = instances[source.id];
    while (current?.parentInstanceId) {
      const parent = instances[current.parentInstanceId];
      const parentTemplate = refreshed.prefabs[parent.prefabId];
      const mount = Object.values(parentTemplate.nestedInstances || {}).find(
        (m) => parent.nodeMap[m.rootId] === current.rootId,
      );
      if (mount)
        for (const [local, outer] of Object.entries(mount.nodeMap))
          if (current.nodeMap[local])
            parent.nodeMap[outer] = current.nodeMap[local];
      current = parent;
    }
    for (const i of Object.values(instances))
      if (!i.parentInstanceId && refreshed.affected.has(i.prefabId)) {
        const next = applyPrefab(
          refreshed.prefabs[i.prefabId],
          i,
          nodes,
          i.id === instanceId,
        );
        nodes = next.nodes;
        instances[i.id] = next.instance;
        for (const [scene, key] of next.modelCopies) {
          const b = buffers.get(key);
          if (b) buffers.set(scene, b.slice(0));
          else buffers.delete(scene);
        }
      }
    const linked = linkNestedInstances(nodes, instances, refreshed.prefabs);
    nodes = linked.nodes;
    instances = linked.instances;
    const content = {
      ...s.content,
      prefabs: refreshed.prefabs,
      prefabInstances: instances,
    };
    validateProject({ ...s, scene: { nodes }, content });
    pruneModels(nodes, content, buffers);
    pushHistory(get, set);
    const availableIds = new Set(nodes.map((n) => n.id));
    const selectedNodeIds = s.selectedNodeIds.filter((id) => availableIds.has(id));
    set({
      content,
      nodes,
      modelBuffers: buffers,
      missingModelIds: missingModels(nodes, content, buffers),
      selectedNodeIds,
      selectedNodeId: selectedNodeIds[0] || null,
    });
  },
  resetPrefabInstance: (instanceId) => {
    const s = get();
    assertEditing(s);
    const i = s.content.prefabInstances[instanceId];
    if (!i) throw new Error("实例不存在");
    const next = applyPrefab(s.content.prefabs[i.prefabId], i, s.nodes, true),
      content = {
        ...s.content,
        prefabInstances: {
          ...s.content.prefabInstances,
          [i.id]: next.instance,
        },
      },
      buffers = new Map(s.modelBuffers);
    for (const [scene, key] of next.modelCopies) {
      const b = buffers.get(key);
      if (b) buffers.set(scene, b.slice(0));
      else buffers.delete(scene);
    }
    const resetIds = new Set(subtree(next.nodes, i.rootId).map((n) => n.id));
    for (const child of Object.values(content.prefabInstances))
      if (resetIds.has(child.rootId)) {
        const copy = { ...child };
        delete copy.unpackedMounts;
        content.prefabInstances[child.id] = copy;
      }
    const linked = linkNestedInstances(
      next.nodes,
      content.prefabInstances,
      content.prefabs,
    );
    content.prefabInstances = linked.instances;
    next.nodes = linked.nodes;
    validateProject({ ...s, scene: { nodes: next.nodes }, content });
    pruneModels(next.nodes, content, buffers);
    pushHistory(get, set);
    const availableIds = new Set(next.nodes.map((n) => n.id));
    const selectedNodeIds = s.selectedNodeIds.filter((id) => availableIds.has(id));
    set({
      content,
      nodes: next.nodes,
      modelBuffers: buffers,
      missingModelIds: missingModels(next.nodes, content, buffers),
      selectedNodeIds,
      selectedNodeId: selectedNodeIds[0] || null,
    });
  },
  unpackPrefabInstance: (instanceId) => {
    const s = get();
    assertEditing(s);
    const removed = s.content.prefabInstances[instanceId];
    if (!removed) return;
    const instances = structuredClone(s.content.prefabInstances);
    delete instances[instanceId];
    if (
      removed.parentInstanceId &&
      removed.mountId &&
      instances[removed.parentInstanceId]
    ) {
      const parent = instances[removed.parentInstanceId];
      parent.unpackedMounts = [
        ...(parent.unpackedMounts || []),
        removed.mountId,
      ];
    }
    for (const i of Object.values(instances))
      if (i.parentInstanceId === instanceId)
        i.parentInstanceId = removed.parentInstanceId;
    const nodes = s.nodes.map((n) => {
      const copy = { ...n };
      if (copy.prefab?.instanceId === instanceId) delete copy.prefab;
      return copy;
    });
    const linked = linkNestedInstances(nodes, instances, s.content.prefabs);
    pushHistory(get, set);
    set({
      content: { ...s.content, prefabInstances: linked.instances },
      nodes: linked.nodes,
    });
  },
  deletePrefab: (id) => {
    const s = get();
    assertEditing(s);
    if (!Object.hasOwn(s.content.prefabs, id)) return;
    if (Object.values(s.content.prefabInstances).some((i) => i.prefabId === id))
      throw new Error("预制体仍有实例，请先删除实例或解除关联");
    if (
      Object.values(s.content.prefabs).some((p) =>
        Object.values(p.nestedInstances || {}).some((i) => i.prefabId === id),
      )
    )
      throw new Error("预制体仍被其他模板嵌套引用，请先解除嵌套关联并应用模板");
    const prefabs = { ...s.content.prefabs };
    delete prefabs[id];
    const content = { ...s.content, prefabs },
      buffers = new Map(s.modelBuffers);
    pruneModels(s.nodes, content, buffers);
    pushHistory(get, set);
    set({
      content,
      modelBuffers: buffers,
      missingModelIds: missingModels(s.nodes, content, buffers),
    });
  },
  renamePrefab: (id, name) => {
    const s = get();
    assertEditing(s);
    if (!s.content.prefabs[id] || !name.trim() || s.content.prefabs[id].name === name.trim()) return;
    pushHistory(get, set);
    set({
      content: {
        ...s.content,
        prefabs: {
          ...s.content.prefabs,
          [id]: { ...s.content.prefabs[id], name: name.trim() },
        },
      },
    });
  },
}));

function prefabDependsOn(
  prefabs: ProjectContent["prefabs"],
  id: string,
  target: string,
  seen = new Set<string>(),
): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  return Object.values(prefabs[id]?.nestedInstances || {}).some(
    (i) =>
      i.prefabId === target ||
      prefabDependsOn(prefabs, i.prefabId, target, seen),
  );
}
