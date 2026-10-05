import { get, set, del, keys, createStore } from 'idb-keyval';
import type { SceneNode } from '../store/useEditorStore';
import type { ProjectSettings } from '../types/project';

// 项目元数据 store 和模型 Blob store
// 两个 store 共享同一个数据库 'arkglide-db'，但分别存放项目元数据和模型 ArrayBuffer
const projectStore = createStore('arkglide-db', 'projects');
const modelStore = createStore('arkglide-db', 'models');

// 项目元数据结构（存入 IndexedDB 的数据）
export interface StoredProject {
  projectId: string;
  name: string;
  version: string;
  updatedAt: number;
  scene: { nodes: SceneNode[] };
  scripts: Record<string, string>;
  activeFileId: string;
  // 模型资源引用列表（assetId → 文件名，实际 ArrayBuffer 在 modelStore 中）
  modelRefs: { assetId: string; fileName: string }[];
  settings?: ProjectSettings; // 项目设置（可选，兼容旧数据）
}

// ============================================================================
// 项目元数据持久化 API
// ============================================================================

/**
 * 保存项目元数据到 IndexedDB。
 * @param projectId 项目唯一标识
 * @param data 项目元数据（不含模型 ArrayBuffer）
 */
export async function saveProject(projectId: string, data: StoredProject): Promise<void> {
  await set(projectId, data, projectStore);
}

/**
 * 从 IndexedDB 加载单个项目元数据。
 * @param projectId 项目唯一标识
 * @returns 项目元数据；若不存在返回 undefined
 */
export async function loadProject(projectId: string): Promise<StoredProject | undefined> {
  return get<StoredProject>(projectId, projectStore);
}

/**
 * 列出所有项目元数据，按 updatedAt 降序排序（最近更新的在前）。
 * 实现：用 keys(projectStore) 获取所有 key，逐个 get 后按 updatedAt 降序排序返回。
 */
export async function listProjects(): Promise<StoredProject[]> {
  const allKeys = await keys<string>(projectStore);
  const projects: StoredProject[] = [];
  for (const key of allKeys) {
    const project = await get<StoredProject>(key, projectStore);
    if (project) {
      projects.push(project);
    }
  }
  // 按 updatedAt 降序排序（最近更新的项目排在最前）
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  return projects;
}

/**
 * 删除项目及其关联的所有模型 Blob。
 * 实现：先 del(projectId, projectStore)，再遍历 modelRefs 调用 deleteModelBlob 删除关联模型。
 * @param projectId 项目唯一标识
 */
export async function deleteProject(projectId: string): Promise<void> {
  const project = await get<StoredProject>(projectId, projectStore);
  if (project) {
    // 先删除关联的所有模型 Blob
    for (const ref of project.modelRefs) {
      await deleteModelBlob(ref.assetId);
    }
  }
  // 最后删除项目元数据本身
  await del(projectId, projectStore);
}

// ============================================================================
// 模型 Blob 持久化 API
// ============================================================================

/**
 * 保存模型 ArrayBuffer 到 IndexedDB 的 modelStore。
 * @param assetId 模型资源唯一标识（通常为节点 id）
 * @param buffer 模型二进制数据
 */
export async function saveModelBlob(assetId: string, buffer: ArrayBuffer): Promise<void> {
  await set(assetId, buffer, modelStore);
}

/**
 * 从 IndexedDB 加载模型 ArrayBuffer。
 * @param assetId 模型资源唯一标识
 * @returns 模型二进制数据；若不存在返回 undefined
 */
export async function loadModelBlob(assetId: string): Promise<ArrayBuffer | undefined> {
  return get<ArrayBuffer>(assetId, modelStore);
}

/**
 * 删除单个模型 Blob。
 * @param assetId 模型资源唯一标识
 */
export async function deleteModelBlob(assetId: string): Promise<void> {
  await del(assetId, modelStore);
}