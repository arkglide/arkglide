import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { useEditorStore } from '../store/useEditorStore';
import type { SceneNode } from '../store/useEditorStore';
import type { ProjectSettings } from '../types/project';
import { DEFAULT_SETTINGS } from '../types/project';

// 导出项目 JSON 结构（.arkglide 包内的 project.json）
interface ExportedProject {
  version: string;
  name: string;
  exportedAt: number;
  scene: { nodes: SceneNode[] };
  scripts: Record<string, string>;
  activeFileId: string;
  // 模型资源引用：assetId → assets/ 文件夹中的文件名
  modelRefs: { assetId: string; fileName: string }[];
  settings?: ProjectSettings; // 项目设置（可选，兼容旧导出包）
}

/**
 * 导出当前编辑器状态为 .arkglide 文件（ZIP 包）。
 * 包内结构：
 *   project.json  — 项目元数据（nodes/scripts/activeFileId/modelRefs）
 *   assets/<fileName> — 模型二进制文件（使用原始文件名，不重命名为 UUID）
 * 导出后触发浏览器下载。
 */
export function exportProject(): void {
  const state = useEditorStore.getState();
  const nodes = state.nodes;
  const scripts = state.scripts;
  const modelBuffers = state.modelBuffers;

  // 收集模型引用和文件数据
  const modelRefs: { assetId: string; fileName: string }[] = [];
  const files: Record<string, Uint8Array> = {};

  // project.json 元数据
  const projectData: ExportedProject = {
    version: '0.1',
    name: state.currentProjectName || '未命名项目',
    exportedAt: Date.now(),
    scene: { nodes },
    scripts,
    activeFileId: state.activeFileId,
    modelRefs,
    settings: state.settings,
  };

  // 遍历 model 节点，把 ArrayBuffer 放进 assets/ 文件夹
  // 使用原始文件名（node.modelUrl），不用 UUID
  // 同名文件加序号避免冲突
  const usedFileNames = new Set<string>();
  for (const node of nodes) {
    if (node.type === 'model') {
      const buffer = modelBuffers.get(node.id);
      if (!buffer) continue; // 无缓冲数据则跳过（不导出该模型）

      let fileName = node.modelUrl || `${node.id}.glb`;
      // 确保文件名不冲突（同名文件加序号）
      if (usedFileNames.has(fileName)) {
        const dotIdx = fileName.lastIndexOf('.');
        const base = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
        const ext = dotIdx > 0 ? fileName.slice(dotIdx) : '';
        let seq = 1;
        do {
          fileName = `${base}_${seq}${ext}`;
          seq++;
        } while (usedFileNames.has(fileName));
      }
      usedFileNames.add(fileName);

      const assetPath = `assets/${fileName}`;
      files[assetPath] = new Uint8Array(buffer);
      projectData.modelRefs.push({ assetId: node.id, fileName });
    }
  }

  // 添加 project.json
  files['project.json'] = strToU8(JSON.stringify(projectData, null, 2));

  // 打包 ZIP
  const zipped = zipSync(files);

  // 触发浏览器下载
  const blob = new Blob([zipped], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectData.name}.arkglide`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 从 .arkglide 文件（ZIP 包）导入项目。
 * 解压 → 解析 project.json → 恢复 store 状态 → 加载模型到 modelBuffers。
 * 模型文件缺失时计入 missingModelIds 并在控制台输出警告。
 *
 * @param file 用户选择的 .arkglide 文件
 */
export async function importProject(file: File): Promise<void> {
  // 读取文件为 ArrayBuffer
  const arrayBuffer = await file.arrayBuffer();
  // 解压 ZIP
  const files = unzipSync(new Uint8Array(arrayBuffer));

  // 解析 project.json
  const projectJsonBytes = files['project.json'];
  if (!projectJsonBytes) {
    throw new Error('无效的 .arkglide 文件：缺少 project.json');
  }
  const projectJsonText = strFromU8(projectJsonBytes);
  const projectData: ExportedProject = JSON.parse(projectJsonText);

  const store = useEditorStore.getState();

  // 恢复基础状态
  // 注意：导入后视为新项目（currentProjectId = null），再次保存会生成新 ID
  useEditorStore.setState({
    nodes: projectData.scene.nodes,
    scripts: projectData.scripts,
    activeFileId: projectData.activeFileId,
    script: projectData.scripts[projectData.activeFileId] || '',
    currentProjectId: null, // 导入后是新项目
    currentProjectName: projectData.name,
    playState: 'stopped',
    selectedNodeId: projectData.scene.nodes[0]?.id || null,
    selectedNodeIds: projectData.scene.nodes[0]?.id ? [projectData.scene.nodes[0].id] : [],
    consoleLogs: [],
    missingModelIds: new Set(),
    settings: projectData.settings ?? { ...DEFAULT_SETTINGS },
    modelBuffers: new Map(),
  });

  // 加载模型文件到 modelBuffers
  for (const ref of projectData.modelRefs) {
    const assetPath = `assets/${ref.fileName}`;
    const fileData = files[assetPath];
    if (fileData) {
      // 把 Uint8Array 转为 ArrayBuffer（避免共享底层 buffer 的切片问题）
      const buffer = fileData.buffer.slice(
        fileData.byteOffset,
        fileData.byteOffset + fileData.byteLength
      );
      store.setModelBuffer(ref.assetId, buffer);
    } else {
      // 模型文件缺失：计入 missingModelIds 并输出警告日志
      useEditorStore.setState((state) => ({
        missingModelIds: new Set(state.missingModelIds).add(ref.assetId),
        consoleLogs: [
          ...state.consoleLogs,
          {
            id: Date.now() + Math.random(),
            level: 'warn' as const,
            text: '资源丢失: ' + ref.fileName,
            time: Date.now(),
          },
        ],
      }));
    }
  }

  // 成功日志
  useEditorStore.setState((state) => ({
    consoleLogs: [
      ...state.consoleLogs,
      {
        id: Date.now() + Math.random(),
        level: 'log' as const,
        text: `项目已导入: ${projectData.name}（${projectData.scene.nodes.length} 个节点，${Object.keys(projectData.scripts).length} 个脚本）`,
        time: Date.now(),
      },
    ],
  }));
}