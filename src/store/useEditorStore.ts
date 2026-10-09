import { create } from 'zustand';
import type { ProjectJSON, ProjectSettings } from '../types/project';
import { validateProject, normalizeProject, PROJECT_VERSION } from '../utils/projectValidation';
import { DEFAULT_SETTINGS } from '../types/project';
import {
  saveProjectSnapshot,
  loadProject,
  loadModelBlob,
  type StoredProject,
} from '../utils/projectStorage';

// 播放状态
export type PlayState = 'stopped' | 'playing' | 'paused';
// 节点类型
export type NodeType = 'mesh' | 'light' | 'camera' | 'empty' | 'model';

export interface Transform {
  x: number;
  y: number;
  z: number;
}

export interface SceneNode {
  id: string;
  name: string;
  type: NodeType;            // 'mesh' | 'light' | 'camera' | 'empty' | 'model'
  transform: Transform;      // 位置（保持不变，向后兼容 runtime.html）
  rotation: Transform;       // 旋转（弧度，与 Babylon mesh.rotation 一致）
  scale: Transform;          // 缩放
  visible: boolean;          // 可见性
  primitive?: 'box' | 'sphere' | 'plane' | 'cylinder' | 'capsule' | 'torus';
  lightType?: 'hemispheric' | 'directional' | 'point';
  activeCamera?: boolean;
  color?: string;            // 颜色（hex 格式如 '#FF6B6B'，mesh 用）
  intensity?: number;        // 光照强度（light 用）
  fov?: number;              // 视场角（camera 用，角度）
  parentId?: string | null;  // 父节点 ID（null 或 undefined = 根节点）
  modelUrl?: string;         // 模型文件 URL（type='model' 时用）
  scripts?: string[];        // 挂载的脚本文件名列表，如 ['player.js', 'physics.js']
}

// 控制台消息（来自 iframe 沙箱转发）
export interface DiagnosticLocation {file?:string|null;line?:number|null;column?:number|null;hook?:string;entityId?:string|null;stack?:string;}
export interface RuntimeStats {state:string;mathBackend:string;fps:number;frameMs:number;peakFrameMs:number;renderMs:number;scriptMs:number;entities:number;scripts:number;meshes:number;materials:number;textures:number;lights:number;cameras:number;modelLoads:number;timers:number;subscriptions:number;listeners:number;heapBytes:number|null;totalTime:number;unscaledTotalTime:number;fixedSteps:number;timeScale:number;droppedTime:number;errors:number;}
export interface ConsoleMessage {
  location?:DiagnosticLocation;
  id: number;
  level: 'log' | 'warn' | 'error';
  text: string;
  time: number;
}

// 资源条目（AssetBrowser 挂载的本地文件，只读 name/path，不读取内容到内存）
export interface AssetEntry {
  id: string;
  name: string;
  path: string;
  type: 'model' | 'texture' | 'script' | 'other';
  size: number;
  fileHandle?: FileSystemFileHandle;
  file?: File;
}

// 默认用户脚本（ArkGlide API 演示 —— this.entity 指向挂载此脚本的实体，按 WASD 移动）
// 用 join 构造避免模板字符串反引号嵌套问题
// 注意：DEFAULT_SCRIPT 不再使用 entity 参数和 scene.find('cube')，改用 this.entity 直接操作挂载的实体
// entity 参数仍保留在 runtime.html 的 new Function 签名中（向后兼容），只是此处不再使用
export const DEFAULT_SCRIPT = [
  '// ArkGlide 脚本 — this.entity 指向挂载此脚本的实体',
  '// 生命周期：onStart（启动时调用一次）/ onUpdate（每帧调用）',
  '// 输入：input.isKeyDown(\'w\') / input.getMouseDelta()',
  '// 场景：scene.find(\'id\') / scene.findByName(\'Cube\')',
  '',
  'return {',
  '  onStart() {',
  '    console.log(\'脚本启动:\', this.entity.name);',
  '  },',
  '  onUpdate() {',
  '    // 以每秒 3 个单位移动，速度不随帧率变化',
  '    const distance = 3 * time.deltaTime;',
  '    this.entity.translate(',
  '      input.getAxis(\'a\', \'d\') * distance,',
  '      0,',
  '      input.getAxis(\'s\', \'w\') * distance',
  '    );',
  '  }',
  '};',
  '',
].join('\n');

// 历史栈条目：nodes + scripts 的快照
interface HistoryEntry {
  nodes: SceneNode[];
  scripts: Record<string, string>;
  activeFileId: string;
  modelBuffers: Map<string, ArrayBuffer>;
  missingModelIds: Set<string>;
  settings: ProjectSettings;
}

export interface EditorState {
  documentId:string;
  documentOrigin:'new'|'loaded'|'imported'|'recovered';
  savedSnapshot:{project:StoredProject;buffers:Map<string,ArrayBuffer>}|null;
  recoveryStatus:'idle'|'pending'|'saving'|'saved'|'error';
  recoveryError:string|null;
  recoveryUpdatedAt:number|null;
  scriptNavigation:{id:number;file:string;line:number;column:number}|null;
  navigateToScript:(file:string,line?:number,column?:number)=>void;
  runtimeStats:RuntimeStats|null;
  setRuntimeStats:(stats:RuntimeStats|null)=>void;
  playState: PlayState;
  nodes: SceneNode[];
  selectedNodeId: string | null;
  selectedNodeIds: string[];           // 多选节点 ID 列表（selectedNodeId 派生自 [0]）
  clipboardModelBuffers: Map<string, ArrayBuffer>;
  clipboard: SceneNode[] | null;       // 内部剪贴板（复制/粘贴用）
  gizmoMode: 'move' | 'rotate' | 'scale';   // Gizmo 模式（W/E/R 切换）
  gizmoSpace: 'global' | 'local';            // 坐标系（Global/Local 切换）
  // 撤销/重做历史栈
  past: HistoryEntry[];        // 撤销栈（过去的状态快照）
  future: HistoryEntry[];      // 重做栈（未来的状态快照）
  undo: () => void;             // 撤销
  redo: () => void;             // 重做
  beginTransform: () => void;   // Gizmo 拖拽开始时调用（保存拖拽前快照）
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
  selectNodes: (ids: string[]) => void;           // 设置多选
  toggleNodeSelection: (id: string) => void;       // 加选/减选（Ctrl/Cmd+点击）
  clearSelection: () => void;                       // 清空选择
  // 复制/粘贴/复制副本
  copyToClipboard: () => void;
  pasteFromClipboard: (parentId?: string | null) => void;
  duplicateNode: (id: string) => void;                      // 复制副本（Ctrl+D，含子树，入栈）
  // 可见性 toggle（入栈）
  toggleVisibility: (id: string) => void;
  setGizmoMode: (mode: 'move' | 'rotate' | 'scale') => void;
  setGizmoSpace: (space: 'global' | 'local') => void;
  updateTransform: (id: string, partial: Partial<Pick<SceneNode, 'transform' | 'rotation' | 'scale' | 'visible' | 'color' | 'intensity' | 'fov' | 'modelUrl' | 'primitive' | 'lightType' | 'activeCamera'>>, recordHistory?: boolean) => void;
  addNode: (type: NodeType, name?: string) => string;       // 创建节点，返回新节点 id
  removeNodes: (ids: string[]) => void;
  removeNode: (id: string) => void;                          // 级联删除子节点
  renameNode: (id: string, name: string) => void;            // 重命名节点
  setParent: (id: string, parentId: string | null) => void;  // 设置父节点（拖拽层级）
  attachScript: (nodeId: string, scriptFile: string) => void; // 给节点挂载脚本
  detachScript: (nodeId: string, scriptFile: string) => void; // 从节点卸载脚本
  // 多脚本 CRUD
  createScript: (fileName: string) => void;                  // 新建脚本（避免重名）
  deleteScript: (fileName: string) => void;                  // 删除脚本（不允许删除 main.js）
  renameScript: (oldName: string, newName: string) => void;  // 重命名脚本
  updateScript: (fileName: string, content: string) => void; // 更新脚本内容
  setActiveFile: (fileName: string) => void;                 // 切换当前编辑的脚本
  // 向后兼容别名：setScript(code) === updateScript(activeFileId, code)
  setScript: (code: string) => void;
  addConsoleLog: (level: ConsoleMessage['level'], text: string, location?:DiagnosticLocation) => void;
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
  relinkModel: (nodeId: string, buffer: ArrayBuffer) => void;
  // 持久化方法：保存/加载/新建项目
  saveCurrentProject: (name?: string) => Promise<void>;
  loadProjectById: (projectId: string) => Promise<void>;
  newProject: () => void;
  replaceProject: (data: StoredProject, buffers: Map<string, ArrayBuffer>, missing: Set<string>, imported?: boolean, recoveryId?:string) => void;
  // 项目设置：重力/背景色/环境光/帧率上限
  settings: ProjectSettings;
  updateSettings: (partial: Partial<ProjectSettings>) => void;
}

// 初始场景节点（Mock）
const initialNodes: SceneNode[] = [
  { id: 'cube', name: 'Cube', type: 'mesh', primitive: 'box', transform: { x: 0, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, color: '#7C9CFF', scripts: ['main.js'] },
  { id: 'sphere', name: 'Sphere', type: 'mesh', primitive: 'sphere', transform: { x: 2, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, color: '#FF6B6B' },
  { id: 'light', name: 'DirectionalLight', type: 'light', transform: { x: 0, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, color: '#FFFFFF', intensity: 0.8 },
  { id: 'camera', name: 'Camera', type: 'camera', transform: { x: 0, y: 3, z: -8 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, fov: 60, activeCamera: true },
];

let logId = 0;
let projectEpoch = 0;

// 历史栈上限：超过时移除最旧的条目
const HISTORY_LIMIT = 100;

// Zustand set 函数的类型（接受 partial 对象或 updater 函数）
type EditorSet = (
  partial: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>),
) => void;

// 深拷贝 SceneNode（含嵌套 transform/rotation/scale/scripts）
function deepCloneNodes(nodes: SceneNode[]): SceneNode[] {
  return nodes.map((n) => ({
    ...n,
    transform: { ...n.transform },
    rotation: { ...n.rotation },
    scale: { ...n.scale },
    scripts: n.scripts ? [...n.scripts] : undefined,
  }));
}

// 深拷贝 scripts（Record<string, string>，string 不可变只需浅拷贝对象）
function deepCloneScripts(scripts: Record<string, string>): Record<string, string> {
  return { ...scripts };
}

// 创建历史快照：深拷贝当前 nodes + scripts
function createSnapshot(state: EditorState): HistoryEntry {
  return {
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

export const useEditorStore = create<EditorState>((set, get) => ({
  documentId:crypto.randomUUID(),documentOrigin:'new',savedSnapshot:null,
  recoveryStatus:'idle',recoveryError:null,recoveryUpdatedAt:null,
  scriptNavigation:null,runtimeStats:null,
  navigateToScript:(file,line=1,column=1)=>{
    if(!Object.hasOwn(get().scripts,file))return;
    get().setActiveFile(file);
    set({scriptNavigation:{id:Date.now()+Math.random(),file,line:Math.max(1,line),column:Math.max(1,column)}});
  },
  setRuntimeStats:runtimeStats=>set({runtimeStats}),
  playState: 'stopped',
  nodes: initialNodes,
  selectedNodeId: 'cube',
  selectedNodeIds: ['cube'],
  clipboard: null,
  clipboardModelBuffers: new Map(),
  gizmoMode: 'move',
  gizmoSpace: 'global',
  // 多脚本数据层：默认包含 main.js，内容为 DEFAULT_SCRIPT
  scripts: { 'main.js': DEFAULT_SCRIPT },
  activeFileId: 'main.js',
  // 派生字段：script === scripts[activeFileId]，向后兼容 CodeEditor
  script: DEFAULT_SCRIPT,
  consoleLogs: [],
  project: null,
  prePlaySnapshot: null,
  assets: [],
  // 持久化字段初始值：未保存的新项目
  currentProjectId: null,
  currentProjectName: '未命名项目',
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
      if (state.playState === 'playing') return {};
      if (state.playState === 'paused') return { playState: 'playing' };
      return {
      playState: 'playing',
      // 保存播放前场景快照（深拷贝每个节点含嵌套 transform/rotation/scale）
      prePlaySnapshot: state.nodes.map((n) => ({
        ...n,
        transform: { ...n.transform },
        rotation: { ...n.rotation },
        scale: { ...n.scale },
        scripts: n.scripts ? [...n.scripts] : undefined,
      })),
      project: {
        version: PROJECT_VERSION,
        scene: {
          nodes: state.nodes.map((n) => ({
            ...n,
            transform: { ...n.transform },
            rotation: { ...n.rotation },
            scale: { ...n.scale },
            scripts: n.scripts ? [...n.scripts] : undefined,
          })),
        }, // 深拷贝
        assets: [],
        script: state.script,
        scripts: state.scripts,
        activeFileId: state.activeFileId,
        settings: state.settings,
      },
      };
    }),
  pause: () => set(state => state.playState === 'playing' ? { playState: 'paused' } : {}),
  // 停止：恢复播放前的场景快照（如果有），清除 project 引用，实现编辑态/运行态隔离
  stop: () =>
    set((state) => ({
      playState: 'stopped',
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
    const ids = new Set(state.selectedNodeIds);
    let changed = true;
    while (changed) {
      changed = false;
      state.nodes.forEach(node => { if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) { ids.add(node.id); changed = true; } });
    }
    set({
      clipboard: deepCloneNodes(state.nodes.filter(node => ids.has(node.id))),
      clipboardModelBuffers: new Map([...state.modelBuffers].filter(([id]) => ids.has(id))),
    });
  },
  // 粘贴剪贴板节点：生成新 ID，保持剪贴板内父子关系，可选指定 parentId（入栈）
  pasteFromClipboard: (parentId) => {
    const state = get();
    if (!state.clipboard || state.clipboard.length === 0) return;
    pushHistory(get, set);

    const newNodes: SceneNode[] = [];
    const idMap = new Map<string, string>(); // 旧ID → 新ID

    // 为每个剪贴板节点生成新 ID
    state.clipboard.forEach((node) => {
      const newId =
        node.id +
        '_copy_' +
        Date.now().toString(36) +
        '_' +
        Math.random().toString(36).slice(2, 6);
      idMap.set(node.id, newId);
    });

    state.clipboard.forEach((node) => {
      const newId = idMap.get(node.id)!;
      // parentId 显式传入时用之；否则映射剪贴板内父子关系，找不到则保留原 parentId
      const newParentId = node.parentId && idMap.has(node.parentId)
        ? idMap.get(node.parentId)
        : parentId !== undefined ? parentId : state.nodes.some(n => n.id === node.parentId) ? node.parentId : null;
      newNodes.push({
        ...node,
        id: newId,
        name: node.name + '_copy',
        parentId: newParentId,
        transform: { ...node.transform },
        rotation: { ...node.rotation },
        scale: { ...node.scale },
        scripts: node.scripts ? [...node.scripts] : undefined,
      });
    });

    set((s) => ({
      nodes: [...s.nodes, ...newNodes],
      modelBuffers: new Map([...s.modelBuffers, ...[...idMap].flatMap(([oldId, newId]) => {
        const buffer = state.clipboardModelBuffers.get(oldId);
        return buffer ? [[newId, buffer.slice(0)] as [string, ArrayBuffer]] : [];
      })]),
      selectedNodeIds: newNodes.map((n) => n.id),
      selectedNodeId: newNodes[0]?.id || null,
    }));
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

    // 收集节点及其所有子节点（前序遍历，同时为新节点分配新 ID）
    const collectSubtree = (nodeId: string): SceneNode[] => {
      const n = state.nodes.find((x) => x.id === nodeId);
      if (!n) return [];
      const newId =
        n.id +
        '_copy_' +
        timestamp +
        '_' +
        Math.random().toString(36).slice(2, 6);
      idMap.set(n.id, newId);
      const children = state.nodes.filter((x) => x.parentId === nodeId);
      return [n, ...children.flatMap((c) => collectSubtree(c.id))];
    };

    const subtree = collectSubtree(id);
    const newNodes: SceneNode[] = subtree.map((n) => {
      const newId = idMap.get(n.id)!;
      const newParentId = n.parentId
        ? idMap.get(n.parentId) || n.parentId
        : n.parentId;
      return {
        ...n,
        id: newId,
        name: n.name + '_copy',
        // 根节点保持同级（沿用原 parentId），子节点映射到新父 ID
        parentId: n.id === id ? n.parentId : newParentId,
        transform: { ...n.transform },
        rotation: { ...n.rotation },
        scale: { ...n.scale },
        scripts: n.scripts ? [...n.scripts] : undefined,
      };
    });

    set((s) => ({
      nodes: [...s.nodes, ...newNodes],
      modelBuffers: new Map([...s.modelBuffers, ...[...idMap].flatMap(([oldId, newId]) => {
        const buffer = state.modelBuffers.get(oldId);
        return buffer ? [[newId, buffer.slice(0)] as [string, ArrayBuffer]] : [];
      })]),
      selectedNodeIds: [newNodes[0].id],
      selectedNodeId: newNodes[0].id,
    }));
  },
  // 可见性 toggle（入栈，可撤销）
  toggleVisibility: (id) => {
    pushHistory(get, set);
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, visible: !n.visible } : n
      ),
    }));
  },
  setGizmoMode: (gizmoMode) => set({ gizmoMode }),
  setGizmoSpace: (gizmoSpace) => set({ gizmoSpace }),
  // 撤销：从 past 弹出最近快照恢复，当前状态压入 future
  undo: () =>
    set((state) => {
      if (state.playState !== 'stopped' || state.past.length === 0) return {};
      const previous = state.past[state.past.length - 1];
      const currentSnapshot = createSnapshot(state);
      // 同步 selectedNodeIds：快照不追踪选择状态，用 [selectedNodeId] 兜底
      const restoredSelectedId = previous.nodes.some(n => n.id === state.selectedNodeId) ? state.selectedNodeId : null;
      return {
        nodes: previous.nodes,
        scripts: previous.scripts,
        activeFileId: previous.activeFileId,
        modelBuffers: new Map(previous.modelBuffers),
        missingModelIds: new Set(previous.missingModelIds),
        settings: previous.settings,
        // 同步派生字段：恢复 activeFileId 对应的脚本内容
        script: previous.scripts[previous.activeFileId] || '',
        past: state.past.slice(0, -1),
        future: [currentSnapshot, ...state.future],
        selectedNodeId: restoredSelectedId,
        selectedNodeIds: restoredSelectedId
          ? [restoredSelectedId]
          : [],
      };
    }),
  // 重做：从 future 弹出最近快照恢复，当前状态压入 past
  redo: () =>
    set((state) => {
      if (state.playState !== 'stopped' || state.future.length === 0) return {};
      const next = state.future[0];
      const currentSnapshot = createSnapshot(state);
      // 同步 selectedNodeIds：快照不追踪选择状态，用 [selectedNodeId] 兜底
      const restoredSelectedId = next.nodes.some(n => n.id === state.selectedNodeId) ? state.selectedNodeId : null;
      return {
        nodes: next.nodes,
        scripts: next.scripts,
        activeFileId: next.activeFileId,
        modelBuffers: new Map(next.modelBuffers),
        missingModelIds: new Set(next.missingModelIds),
        settings: next.settings,
        script: next.scripts[next.activeFileId] || '',
        past: [...state.past, currentSnapshot],
        future: state.future.slice(1),
        selectedNodeId: restoredSelectedId,
        selectedNodeIds: restoredSelectedId
          ? [restoredSelectedId]
          : [],
      };
    }),
  // Gizmo 拖拽开始时调用：保存拖拽前快照到 past
  // 之后 updateTransform(recordHistory=false) 不再入栈，拖拽结束只产生一条历史
  beginTransform: () => {
    pushHistory(get, set);
  },
  updateTransform: (id, partial, recordHistory = true) => {
    if (recordHistory) pushHistory(get, set);
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, ...partial } : partial.activeCamera === true && n.type === 'camera' ? { ...n, activeCamera: false } : n
      ),
    }));
  },
  // 创建节点：生成 id、默认属性，并选中该节点
  addNode: (type, name) => {
    pushHistory(get, set);
    const id = type + '_' + crypto.randomUUID();
    const defaultName = name || (type.charAt(0).toUpperCase() + type.slice(1));
    const newNode: SceneNode = {
      id,
      name: defaultName,
      type,
      transform: { x: 0, y: 0.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      parentId: null,
      ...(type === 'mesh' ? { primitive: /sphere/i.test(defaultName) ? 'sphere' as const : 'box' as const } : {}),
      ...(type === 'light' ? { lightType: 'directional' as const } : {}),
      ...(type === 'mesh' ? { color: '#7C9CFF' } : {}),
      ...(type === 'light' ? { color: '#FFFFFF', intensity: 0.8 } : {}),
      ...(type === 'camera' ? { fov: 60, activeCamera: !get().nodes.some(n => n.type === 'camera' && n.activeCamera) } : {}),
    };
    set((state) => ({
      nodes: [...state.nodes, newNode],
      selectedNodeId: id,
      selectedNodeIds: [id],
    }));
    return id;
  },
  // 级联删除：递归收集所有子节点一并删除
  removeNode: (id) => get().removeNodes([id]),
  removeNodes: (ids) => {
    pushHistory(get, set);
    set((state) => {
      const toDelete = new Set<string>();
      const collect = (nodeId: string) => {
        toDelete.add(nodeId);
        state.nodes.forEach((n) => {
          if (n.parentId === nodeId) collect(n.id);
        });
      };
      ids.forEach(collect);
      // 同步多选：从 selectedNodeIds 中移除所有被删节点
      const newSelectedIds = state.selectedNodeIds.filter(
        (sid) => !toDelete.has(sid)
      );
      return {
        nodes: state.nodes.filter((n) => !toDelete.has(n.id)),
        modelBuffers: new Map([...state.modelBuffers].filter(([id]) => !toDelete.has(id))),
        missingModelIds: new Set([...state.missingModelIds].filter(id => !toDelete.has(id))),
        selectedNodeId: newSelectedIds[0] || null,
        selectedNodeIds: newSelectedIds,
      };
    });
  },
  // 重命名节点
  renameNode: (id, name) => {
    pushHistory(get, set);
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, primitive: n.type === 'mesh' ? n.primitive ?? (/sphere/i.test(n.name) ? 'sphere' : 'box') : undefined, name } : n)),
    }));
  },
  // 设置父节点（拖拽层级）
  setParent: (id, parentId) => {
    let ancestor = parentId;
    while (ancestor) {
      if (ancestor === id) return;
      ancestor = get().nodes.find(n => n.id === ancestor)?.parentId ?? null;
    }
    if (!get().nodes.some(n => n.id === id) || (parentId && !get().nodes.some(n => n.id === parentId))) return;
    pushHistory(get, set);
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, parentId } : n)),
    }));
  },
  // 给节点挂载脚本（进入历史栈，可撤销）
  attachScript: (nodeId, scriptFile) => {
    if (!Object.hasOwn(get().scripts, scriptFile) || get().nodes.find(n => n.id === nodeId)?.scripts?.includes(scriptFile)) return;
    pushHistory(get, set);
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, scripts: [...(n.scripts || []), scriptFile] }
          : n
      ),
    }));
  },
  // 从节点卸载脚本（进入历史栈，可撤销）
  detachScript: (nodeId, scriptFile) => {
    pushHistory(get, set);
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, scripts: (n.scripts || []).filter((s) => s !== scriptFile) }
          : n
      ),
    }));
  },
  // setScript：向后兼容别名，等价于 updateScript(activeFileId, code)
  setScript: (code) =>
    set((state) => ({
      scripts: { ...state.scripts, [state.activeFileId]: code },
      script: code,
    })),
  // 新建脚本：避免重名，创建后切换为活跃文件
  createScript: (fileName) => {
    if (!fileName.trim() || Object.hasOwn(get().scripts, fileName)) return;
    pushHistory(get, set);
    set((state) => {
      if (Object.prototype.hasOwnProperty.call(state.scripts, fileName)) return {}; // 重名则不操作
      const newScripts = { ...state.scripts, [fileName]: '' };
      return { scripts: newScripts, activeFileId: fileName, script: '' };
    });
  },
  // 删除脚本：不允许删除 main.js；若删除的是活跃文件则切回 main.js
  deleteScript: (fileName) => {
    if (fileName === 'main.js' || !Object.hasOwn(get().scripts, fileName)) return;
    pushHistory(get, set);
    set((state) => {
      if (fileName === 'main.js') return {}; // 不允许删除 main.js
      const newScripts = { ...state.scripts };
      delete newScripts[fileName];
      const newActive = state.activeFileId === fileName ? 'main.js' : state.activeFileId;
      return {
        scripts: newScripts,
        nodes: state.nodes.map(n => ({ ...n, scripts: n.scripts?.filter(name => name !== fileName) })),
        activeFileId: newActive,
        script: newScripts[newActive] || '',
      };
    });
  },
  // 重命名脚本：目标名已存在或源名不存在则不操作
  renameScript: (oldName, newName) => {
    if (oldName === 'main.js' || !newName.trim() || Object.hasOwn(get().scripts, newName) || !Object.hasOwn(get().scripts, oldName)) return;
    pushHistory(get, set);
    set((state) => {
      if (Object.prototype.hasOwnProperty.call(state.scripts, newName) || !Object.prototype.hasOwnProperty.call(state.scripts, oldName)) return {};
      const newScripts = { ...state.scripts };
      newScripts[newName] = newScripts[oldName];
      delete newScripts[oldName];
      const newActive = state.activeFileId === oldName ? newName : state.activeFileId;
      return {
        scripts: newScripts,
        nodes: state.nodes.map(n => ({ ...n, scripts: n.scripts?.map(name => name === oldName ? newName : name) })),
        activeFileId: newActive,
        script: newScripts[newActive] || '',
      };
    });
  },
  // 更新脚本内容：仅当更新的是活跃文件时同步派生 script 字段
  updateScript: (fileName, content) => {
    pushHistory(get, set);
    set((state) => ({
      scripts: { ...state.scripts, [fileName]: content },
      script: state.activeFileId === fileName ? content : state.script,
    }));
  },
  // 切换当前编辑的脚本：同步派生 script 字段
  setActiveFile: (fileName) =>
    set((state) => ({
      activeFileId: fileName,
      script: state.scripts[fileName] || '',
    })),
  addConsoleLog: (level, text, location) =>
    set((state) => ({
      consoleLogs: [...state.consoleLogs.slice(-999), { id: ++logId, level, text, time: Date.now(),location }],
    })),
  clearConsoleLogs: () => set({ consoleLogs: [] }),
  setAssets: (assets) => set({ assets }),
  modelBuffers: new Map(),
  setModelBuffer: (id, buffer) =>
    set((state) => {
      const newMap = new Map(state.modelBuffers);
      newMap.set(id, buffer);
      return { modelBuffers: newMap };
    }),
  // 资源丢失标记初始为空集
  missingModelIds: new Set(),
  // 重新链接模型：写入 modelBuffers 缓存并从 missingModelIds 移除
  relinkModel: (nodeId, buffer) => {
    pushHistory(get, set);
    set((state) => {
      const newMap = new Map(state.modelBuffers);
      newMap.set(nodeId, buffer);
      const newMissing = new Set(state.missingModelIds);
      newMissing.delete(nodeId);
      return { modelBuffers: newMap, missingModelIds: newMissing };
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
    const projectId = state.currentProjectId ?? crypto.randomUUID();
    // 确定项目名称：若提供 name 参数则更新，否则沿用现有名称
    const projectName = name ?? state.currentProjectName;
    // 从 nodes 中提取模型引用：遍历 type='model' 的节点
    const modelRefs = state.nodes
      .filter((n) => n.type === 'model')
      .map((n) => ({ assetId: n.id, fileName: n.modelUrl || n.id+'.glb' }));
    // 构造 StoredProject 元数据
    const data: StoredProject = {
      projectId,
      name: projectName,
      version: PROJECT_VERSION,
      updatedAt: Date.now(),
      scene: { nodes: state.nodes },
      scripts: state.scripts,
      activeFileId: state.activeFileId,
      modelRefs,
      settings: state.settings,
    };
    // 保存项目元数据
    await saveProjectSnapshot(data, state.modelBuffers);
    // 更新 currentProjectId / currentProjectName 状态
    if (epoch === projectEpoch) set({ currentProjectId: projectId, currentProjectName: projectName, savedSnapshot:{project:data,buffers:state.modelBuffers} });
  },
  // 从 IndexedDB 加载项目并恢复全部状态
  // 读取 StoredProject → 恢复 nodes/scripts/activeFileId/currentProjectId/currentProjectName
  // 异步加载所有 modelRefs 对应的 modelBlob 到 modelBuffers
  // 如果某个 modelBlob 不存在（用户清了缓存），在 consoleLogs 中添加警告
  loadProjectById: async (projectId) => {
    const epoch = ++projectEpoch;
    const stored = await loadProject(projectId);
    const data = stored ? normalizeProject(stored) : undefined;
    if (!data) throw new Error('项目不存在: ' + projectId);
    validateProject(data);
    const buffers = new Map<string, ArrayBuffer>(), missing = new Set<string>();
    for (const ref of data.modelRefs) {
      const blob = await loadModelBlob(ref.assetId, projectId);
      if (blob) buffers.set(ref.assetId, blob); else missing.add(ref.assetId);
    }
    if (epoch !== projectEpoch) return;
    get().replaceProject(data, buffers, missing);
  },
  replaceProject: (data, buffers, missing, imported = false, recoveryId) => {
    const normalized=normalizeProject(data);
    const valid = validateProject(normalized);
    ++projectEpoch;
    set({
      documentId:recoveryId || crypto.randomUUID(),documentOrigin:recoveryId?'recovered':imported?'imported':'loaded',savedSnapshot:null,
      recoveryStatus:'idle',recoveryError:null,recoveryUpdatedAt:null,scriptNavigation:null,runtimeStats:null,
      nodes: valid.nodes, scripts: valid.scripts, activeFileId: valid.activeFileId,
      script: valid.scripts[valid.activeFileId], settings: valid.settings,
      currentProjectId: imported ? null : data.projectId,
      currentProjectName: data.name,
      modelBuffers: buffers, missingModelIds: missing,
      playState: 'stopped', project: null, prePlaySnapshot: null,
      selectedNodeId: null, selectedNodeIds: [], clipboard: null, clipboardModelBuffers: new Map(),
      assets: [], past: [], future: [],
      consoleLogs: [...missing].map(id => ({id:++logId,level:'warn' as const,text:'资源丢失: '+id,time:Date.now()})),
    });
  },
  // 项目设置和场景编辑共用撤销历史。
  updateSettings: (partial) => {
    pushHistory(get, set);
    set((state) => ({
      settings: { ...state.settings, ...partial },
    }));
  },
  // 新建项目：重置为初始状态
  newProject: () => {
    ++projectEpoch;
    set({
      documentId:crypto.randomUUID(),documentOrigin:'new',savedSnapshot:null,
      recoveryStatus:'idle',recoveryError:null,recoveryUpdatedAt:null,scriptNavigation:null,runtimeStats:null,
      past: [], future: [], project: null, assets: [],
      nodes: deepCloneNodes(initialNodes),
      scripts: { 'main.js': DEFAULT_SCRIPT },
      activeFileId: 'main.js',
      script: DEFAULT_SCRIPT,
      currentProjectId: null,
      currentProjectName: '未命名项目',
      consoleLogs: [],
      modelBuffers: new Map(),
      missingModelIds: new Set(),
      playState: 'stopped',
      selectedNodeId: 'cube',
      selectedNodeIds: ['cube'],
      settings: { ...DEFAULT_SETTINGS },
      clipboard: null,
      clipboardModelBuffers: new Map(),
      // 重置播放快照：新建项目后无播放前状态
      prePlaySnapshot: null,
    });
  },
}));