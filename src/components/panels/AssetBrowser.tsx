import { useState, useMemo, useRef } from 'react';
import {
  Box,
  TextField,
  Button,
  IconButton,
  InputAdornment,
  Typography,
  Tooltip,
  Alert,
} from '@mui/material';
import {
  Search,
  FolderOpen,
  Upload,
  ViewInAr,
  Image as ImageIcon,
  Code,
  InsertDriveFile,
  Add as AddIcon,
} from '@mui/icons-material';
import { useEditorStore, type AssetEntry } from '../../store/useEditorStore';

// 展示用资源条目：在 AssetEntry 基础上扩展 isUserScript 标记
type DisplayAsset = AssetEntry & { isUserScript?: boolean };

// 资源类型
type AssetType = 'model' | 'texture' | 'script' | 'other';

// 根据文件扩展名推断资源类型
function getAssetType(filename: string): AssetType {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['glb', 'gltf'].includes(ext)) return 'model';
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) return 'texture';
  if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) return 'script';
  return 'other';
}

// 按类型渲染图标
function renderTypeIcon(type: AssetType) {
  switch (type) {
    case 'model':
      return <ViewInAr />;
    case 'texture':
      return <ImageIcon />;
    case 'script':
      return <Code />;
    default:
      return <InsertDriveFile />;
  }
}

// 递归遍历最大深度
const MAX_DEPTH = 5;

// File System Access API 中 FileSystemDirectoryHandle.entries() 的类型补充
// （TypeScript lib.dom.d.ts 未完整定义 entries/keys/values 方法）
type DirHandleWithEntries = FileSystemDirectoryHandle & {
  entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
};

// 递归遍历目录句柄，收集文件条目（只读 name/path，不读取内容）
async function traverseDirectory(
  dirHandle: FileSystemDirectoryHandle,
  basePath: string,
  depth: number,
  results: AssetEntry[],
): Promise<void> {
  if (depth >= MAX_DEPTH) return;
  const entries = (dirHandle as DirHandleWithEntries).entries();
  let entry = await entries.next();
  while (!entry.done) {
    const [name, handle] = entry.value;
    const path = basePath ? `${basePath}/${name}` : name;
    if (handle.kind === 'file') {
      results.push({
        id: path,
        name,
        path,
        type: getAssetType(name),
        size: 0,
        fileHandle: handle as FileSystemFileHandle,
      });
    } else {
      await traverseDirectory(handle as FileSystemDirectoryHandle, path, depth + 1, results);
    }
    entry = await entries.next();
  }
}

// 回退模式：从 FileList 构建资源条目
function traverseFileList(files: FileList): AssetEntry[] {
  const results: AssetEntry[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    results.push({
      id: path,
      name: file.name,
      path,
      type: getAssetType(file.name),
      size: file.size,
      file,
    });
  }
  return results;
}

// 项目资源管理器：File System Access API + 回退 input[file]
export default function AssetBrowser() {
  const [keyword, setKeyword] = useState('');
  const assets = useEditorStore(s => s.assets);
  const setAssets = useEditorStore(s => s.setAssets);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 同步到全局 store（供后续阶段使用）
  const setStoreAssets = useEditorStore((s) => s.setAssets);
  // 多脚本数据层引用
  const createScript = useEditorStore((s) => s.createScript);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const scripts = useEditorStore((s) => s.scripts);
  const activeFileId = useEditorStore((s) => s.activeFileId);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);

  // 新建脚本：生成唯一文件名并创建
  const handleCreateScript = () => {
    const name = `script_${Date.now().toString(36).slice(-4)}.js`;
    createScript(name);
  };

  // 打开文件夹：优先使用 File System Access API
  const handleOpenFolder = async () => {
    setError(null);
    setLoading(true);
    try {
      if (!('showDirectoryPicker' in window)) throw new Error('UNSUPPORTED');
      const dirHandle = await (
        window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }
      ).showDirectoryPicker();
      const results: AssetEntry[] = [];
      await traverseDirectory(dirHandle, '', 0, results);
      setAssets(results);
      setStoreAssets(results);
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      if (err?.name === 'AbortError') {
        // 用户取消选择，无需提示
      } else if (err?.message === 'UNSUPPORTED') {
        setError('当前环境不支持直接访问文件夹，请使用上传模式');
      } else {
        setError('打开文件夹失败：' + String(err?.message || e));
      }
    } finally {
      setLoading(false);
    }
  };

  // 回退模式：input[file] 选择文件
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    if (e.target.files && e.target.files.length > 0) {
      const results = traverseFileList(e.target.files);
      setAssets(results);
      setStoreAssets(results);
    }
  };

  // 关键字过滤（文件系统资源）
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return assets;
    return assets.filter(
      (a) => a.name.toLowerCase().includes(kw) || a.path.toLowerCase().includes(kw),
    );
  }, [keyword, assets]);

  // 用户脚本条目：将 store.scripts 转为 DisplayAsset 格式用于显示
  const scriptEntries = useMemo<DisplayAsset[]>(() => {
    const kw = keyword.trim().toLowerCase();
    return Object.keys(scripts)
      .filter((name) => !kw || name.toLowerCase().includes(kw))
      .map((name) => ({
        id: 'script:' + name,
        name,
        path: 'scripts/' + name,
        type: 'script' as AssetType,
        size: scripts[name].length,
        isUserScript: true,
      }));
  }, [scripts, keyword]);

  // 合并资源：用户脚本在前，文件系统资源在后
  const allAssets: DisplayAsset[] = useMemo(
    () => [...scriptEntries, ...filtered],
    [scriptEntries, filtered],
  );

  // 类型计数（基于 allAssets）
  const counts = useMemo(() => {
    const c = { model: 0, texture: 0, script: 0, other: 0 };
    allAssets.forEach((a) => {
      c[a.type]++;
    });
    return c;
  }, [allAssets]);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 顶部工具栏：搜索框 + 打开文件夹 + 上传 */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          py: 0.5,
          borderBottom: '1px solid #333333',
        }}
      >
        <TextField
          size="small"
          placeholder="搜索资源..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          sx={{ flex: 1, minWidth: 0 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search sx={{ fontSize: 16 }} />
              </InputAdornment>
            ),
          }}
        />
        <Button
          size="small"
          variant="outlined"
          startIcon={<FolderOpen />}
          onClick={handleOpenFolder}
          disabled={loading}
        >
          {loading ? '加载中...' : '打开文件夹'}
        </Button>
        <Tooltip title="新建脚本">
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={handleCreateScript}
          >
            新建脚本
          </Button>
        </Tooltip>
        <Tooltip title="上传文件（回退模式）">
          <IconButton size="small" onClick={() => fileInputRef.current?.click()}>
            <Upload />
          </IconButton>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          // @ts-ignore - webkitdirectory 是非标准属性，TypeScript 不识别
          webkitdirectory=""
          style={{ display: 'none' }}
          onChange={handleFileInput}
        />
      </Box>
      {error && (
        <Alert
          severity="warning"
          sx={{ mx: 1, mt: 0.5, fontSize: 12 }}
          onClose={() => setError(null)}
        >
          {error}
        </Alert>
      )}
      {allAssets.length > 0 && (
        <Typography variant="caption" sx={{ px: 1, py: 0.25, color: 'text.secondary' }}>
          共 {allAssets.length} 个文件（模型 {counts.model} / 贴图 {counts.texture} / 脚本{' '}
          {counts.script}）
        </Typography>
      )}
      {/* 资源网格 */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, 72px)',
            gap: 0.5,
          }}
        >
          {allAssets.map((a) => {
            // 当前活跃脚本高亮
            const isActiveScript = a.name === activeFileId && a.type === 'script';
            return (
            <Box
              key={a.id}
              title={a.path}
              draggable={a.type === 'model'}
              onClick={async () => {
                if (a.isUserScript) {
                  // 用户脚本：直接切换 activeFileId
                  setActiveFile(a.name);
                  setSelectedAsset(a.id);
                } else if (a.type === 'script') {
                  // 文件系统中的 .js 文件：若已在 scripts 中则切换 activeFileId
                  try {
                    if (!Object.hasOwn(scripts,a.name)) {
                      const file = a.fileHandle ? await a.fileHandle.getFile() : a.file;
                      if (!file) throw new Error('无法读取脚本');
                      const code = await file.text();
                      createScript(a.name);
                      useEditorStore.getState().updateScript(a.name,code);
                    }
                    setActiveFile(a.name);
                  } catch(error) { setError(String(error)); }
                  setSelectedAsset(a.id);
                } else {
                  setSelectedAsset(a.id);
                }
              }}
              onDragStart={(e) => {
                if (a.type !== 'model') return;
                e.dataTransfer.effectAllowed = 'copy';
                // 携带文件信息（JSON 字符串，因为 dataTransfer 只能存字符串）
                // fileHandle 不可序列化，无法通过 dataTransfer 传递，
                // Viewport 通过 store.assets 查找对应 AssetEntry 获取 fileHandle/file
                e.dataTransfer.setData(
                  'application/json',
                  JSON.stringify({
                    assetId: a.id,
                    name: a.name,
                    path: a.path,
                  }),
                );
              }}
              sx={{
                width: 72,
                height: 72,
                borderRadius: 4,
                background: '#2A2A2A',
                border: isActiveScript
                  ? '1px solid #7C9CFF'
                  : selectedAsset === a.id
                    ? '1px solid #7C9CFF'
                    : '1px solid transparent',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 0.5,
                cursor: a.type === 'model' ? 'grab' : 'pointer',
                '&:hover': { background: '#333333' },
              }}
            >
              <Box sx={{ color: 'text.secondary', '& .MuiSvgIcon-root': { fontSize: 28 } }}>
                {renderTypeIcon(a.type)}
              </Box>
              <Typography
                sx={{
                  fontSize: 12,
                  color: 'text.secondary',
                  maxWidth: 64,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {a.name}
              </Typography>
            </Box>
            );
          })}
        </Box>
        {allAssets.length === 0 && !loading && (
          <Typography sx={{ fontSize: 12, color: 'text.secondary', p: 1, textAlign: 'center' }}>
            {assets.length === 0 ? '点击"打开文件夹"挂载本地资源，或"新建脚本"' : '无匹配资源'}
          </Typography>
        )}
      </Box>
    </Box>
  );
}