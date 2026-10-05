import type { SceneNode } from '../store/useEditorStore';

// 资源引用
export interface AssetRef {
  id: string;
  name: string;
  type: 'model' | 'texture' | 'script';
  ref: string;
}

// 项目设置：重力/背景色/环境光/帧率上限等运行时配置
export interface ProjectSettings {
  gravity: { x: number; y: number; z: number }; // 重力向量（默认 0,-9.8,0）
  backgroundColor: string; // 背景色 hex（默认 '#0D0D0D'）
  ambientIntensity: number; // 环境光强度（默认 0.5）
  ambientColor: string; // 环境光颜色 hex（默认 '#FFFFFF'）
  fpsCap: number; // 帧率上限，0=无限（默认 60）
}

// 项目 JSON：编辑器 → iframe 沙箱的完整数据包
export interface ProjectJSON {
  version: string;
  scene: { nodes: SceneNode[] };
  assets: AssetRef[];
  script: string; // 用户 JS 脚本字符串（保留兼容：当前活跃脚本内容）
  scripts?: Record<string, string>; // 多脚本字典：fileName → 代码内容
  activeFileId?: string; // 当前活跃脚本文件名
  // 新增持久化字段
  projectId?: string; // 项目唯一标识
  name?: string; // 项目显示名称
  updatedAt?: number; // 最后更新时间戳
  settings?: ProjectSettings; // 项目设置（重力/背景色/环境光/帧率上限）
}

// 默认项目设置常量
export const DEFAULT_SETTINGS: ProjectSettings = {
  gravity: { x: 0, y: -9.8, z: 0 },
  backgroundColor: '#0D0D0D',
  ambientIntensity: 0.5,
  ambientColor: '#FFFFFF',
  fpsCap: 60,
};