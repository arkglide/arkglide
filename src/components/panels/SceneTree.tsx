import { useState, useEffect, type ReactNode } from 'react';
import {
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Box,
  Typography,
  IconButton,
  Tooltip,
  TextField,
  Stack,
} from '@mui/material';
import {
  Folder,
  CropSquare,
  Lightbulb,
  PhotoCamera,
  DeleteOutline,
  CircleOutlined,
  ViewInAr,
  Warning,
  Visibility,
  VisibilityOff,
  Search,
} from '@mui/icons-material';
import { useEditorStore, type NodeType, type SceneNode } from '../../store/useEditorStore';

// 节点类型 → 图标
const NODE_ICON: Record<NodeType, ReactNode> = {
  mesh: <CropSquare />,
  light: <Lightbulb />,
  camera: <PhotoCamera />,
  empty: <CircleOutlined />,
  model: <ViewInAr />,
};

// 左侧场景树：工具栏创建节点 + Delete 删除 + 双击重命名 + 拖拽父子层级
export default function SceneTree() {
  const nodes = useEditorStore((s) => s.nodes);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const selectedNodeIds = useEditorStore((s) => s.selectedNodeIds);
  const selectNode = useEditorStore((s) => s.selectNode);
  const selectNodes = useEditorStore((s) => s.selectNodes);
  const toggleNodeSelection = useEditorStore((s) => s.toggleNodeSelection);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const copyToClipboard = useEditorStore((s) => s.copyToClipboard);
  const pasteFromClipboard = useEditorStore((s) => s.pasteFromClipboard);
  const duplicateNode = useEditorStore((s) => s.duplicateNode);
  const toggleVisibility = useEditorStore((s) => s.toggleVisibility);
  const addNode = useEditorStore((s) => s.addNode);
  const removeNode = useEditorStore((s) => s.removeNode);
  const renameNode = useEditorStore((s) => s.renameNode);
  const setParent = useEditorStore((s) => s.setParent);
  // 资源丢失的模型节点 ID 集合：在节点图标右下角显示红色警告角标
  const missingModelIds = useEditorStore((s) => s.missingModelIds);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // 搜索框文本：实时过滤场景树节点（保持层级结构：匹配节点 + 祖先链）
  const [searchQuery, setSearchQuery] = useState('');

  // Delete 键监听：删除选中节点（重命名中或焦点在输入框时不触发）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selectedNodeId && renamingId === null) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          removeNode(selectedNodeId);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedNodeId, renamingId, removeNode]);

  // Ctrl/Cmd + C/V/D 快捷键：复制 / 粘贴 / 复制副本
  // 过滤 INPUT/TEXTAREA/contentEditable/Monaco 焦点，避免与代码编辑器冲突
  // 使用 useEditorStore.getState() 取最新值，handler 无需依赖项
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      // Monaco 编辑器聚焦时跳过，避免拦截代码编辑器的复制粘贴
      if (target.closest('.monaco-editor')) return;

      const isCtrl = e.ctrlKey || e.metaKey;
      if (!isCtrl) return;

      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        useEditorStore.getState().copyToClipboard();
      } else if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        useEditorStore.getState().pasteFromClipboard();
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        const selectedId = useEditorStore.getState().selectedNodeId;
        if (selectedId) useEditorStore.getState().duplicateNode(selectedId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // 检查 nodeId 是否是 ancestorId 的子孙节点（防循环拖拽）
  const isDescendant = (nodeId: string, ancestorId: string): boolean => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || !node.parentId) return false;
    if (node.parentId === ancestorId) return true;
    return isDescendant(node.parentId, ancestorId);
  };

  // 节点点击选择逻辑：
  // - Ctrl/Cmd+点击：加选/减选（toggle）
  // - Shift+点击：范围选（从上次选中节点到当前节点在扁平列表中的区间）
  // - 普通点击：单选
  const handleNodeClick = (e: React.MouseEvent, nodeId: string) => {
    if (e.ctrlKey || e.metaKey) {
      toggleNodeSelection(nodeId);
    } else if (e.shiftKey) {
      const flatIds = nodes.map((n) => n.id);
      const lastId = selectedNodeIds[selectedNodeIds.length - 1];
      if (lastId) {
        const startIdx = flatIds.indexOf(lastId);
        const endIdx = flatIds.indexOf(nodeId);
        if (startIdx >= 0 && endIdx >= 0) {
          const [from, to] = [
            Math.min(startIdx, endIdx),
            Math.max(startIdx, endIdx),
          ];
          selectNodes(flatIds.slice(from, to + 1));
          return;
        }
      }
      selectNodes([nodeId]);
    } else {
      selectNode(nodeId);
    }
  };

  // 搜索过滤：保持树的层级结构
  // 匹配节点 + 其所有祖先链都显示（让用户能看到匹配节点在树中的位置）
  const filteredNodes: SceneNode[] = (() => {
    if (!searchQuery) return nodes;
    const lowerQuery = searchQuery.toLowerCase();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const matchingIds = new Set<string>();
    nodes.forEach((n) => {
      if (n.name.toLowerCase().includes(lowerQuery)) {
        // 添加匹配节点及其所有祖先
        let current: SceneNode | undefined = n;
        while (current) {
          matchingIds.add(current.id);
          current = current.parentId ? nodeMap.get(current.parentId) : undefined;
        }
      }
    });
    return nodes.filter((n) => matchingIds.has(n.id));
  })();

  // 递归渲染节点树
  const renderNode = (node: SceneNode, depth: number): ReactNode => {
    const children = filteredNodes.filter((n) => n.parentId === node.id);
    const isRenaming = renamingId === node.id;
    const isDragOver = dragOverId === node.id;
    const isSelected = selectedNodeIds.includes(node.id);

    return (
      <div key={node.id}>
        <ListItem disablePadding>
          <ListItemButton
            selected={isSelected}
            onClick={(e) => handleNodeClick(e, node.id)}
            onDoubleClick={() => {
              setRenamingId(node.id);
              setRenameValue(node.name);
            }}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              setDraggedId(node.id);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (draggedId && draggedId !== node.id && !isDescendant(node.id, draggedId)) {
                setDragOverId(node.id);
              }
            }}
            onDragLeave={() => setDragOverId(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverId(null);
              if (draggedId && draggedId !== node.id && !isDescendant(node.id, draggedId)) {
                setParent(draggedId, node.id);
              }
              setDraggedId(null);
            }}
            sx={{
              pl: 1 + depth * 2,
              py: 0.25,
              bgcolor: isDragOver ? 'rgba(124, 156, 255, 0.15)' : undefined,
              borderLeft: isDragOver ? '2px solid #7C9CFF' : '2px solid transparent',
            }}
          >
            <ListItemIcon sx={{ minWidth: 28, position: 'relative' }}>
              {NODE_ICON[node.type]}
              {missingModelIds.has(node.id) && (
                <Warning
                  sx={{
                    color: '#ff6b6b',
                    fontSize: 14,
                    position: 'absolute',
                    right: -2,
                    bottom: -2,
                  }}
                />
              )}
            </ListItemIcon>
            {isRenaming ? (
              <TextField
                size="small"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    renameNode(node.id, renameValue);
                    setRenamingId(null);
                  } else if (e.key === 'Escape') {
                    setRenamingId(null);
                  }
                }}
                onBlur={() => setRenamingId(null)}
                sx={{ '& input': { fontSize: 13, py: 0 } }}
              />
            ) : (
              <ListItemText
                primary={node.name}
                secondary={`P(${node.transform.x.toFixed(1)}, ${node.transform.y.toFixed(1)}, ${node.transform.z.toFixed(1)})`}
                primaryTypographyProps={{ fontSize: 13 }}
                secondaryTypographyProps={{ fontSize: 11 }}
              />
            )}
            {/* 可见性 toggle：眼睛图标，点击切换 node.visible */}
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                toggleVisibility(node.id);
              }}
              sx={{ p: 0.5 }}
            >
              {node.visible !== false ? (
                <Visibility sx={{ fontSize: 14, color: 'rgba(255,255,255,0.6)' }} />
              ) : (
                <VisibilityOff sx={{ fontSize: 14, color: 'rgba(255,255,255,0.3)' }} />
              )}
            </IconButton>
          </ListItemButton>
        </ListItem>
        {children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  const rootNodes = filteredNodes.filter((n) => !n.parentId);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 顶部工具栏：创建按钮 + 删除按钮 */}
      <Stack
        direction="row"
        spacing={0.5}
        sx={{ px: 1, py: 0.5, borderBottom: '1px solid #333333' }}
      >
        <Tooltip title="创建 Cube">
          <IconButton size="small" onClick={() => addNode('mesh', 'Cube')}>
            <CropSquare fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="创建 Sphere">
          <IconButton size="small" onClick={() => addNode('mesh', 'Sphere')}>
            <CircleOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="创建 Light">
          <IconButton size="small" onClick={() => addNode('light')}>
            <Lightbulb fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="创建 Camera">
          <IconButton size="small" onClick={() => addNode('camera')}>
            <PhotoCamera fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="创建 Empty">
          <IconButton size="small" onClick={() => addNode('empty')}>
            <Folder fontSize="small" />
          </IconButton>
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="删除选中">
          <IconButton
            size="small"
            onClick={() => selectedNodeId && removeNode(selectedNodeId)}
            disabled={!selectedNodeId}
          >
            <DeleteOutline fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      {/* 搜索框：实时过滤场景树节点 */}
      <TextField
        size="small"
        fullWidth
        placeholder="搜索节点..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        sx={{ mt: 0.5, '& .MuiInputBase-input': { fontSize: 12 } }}
        InputProps={{
          startAdornment: (
            <Search sx={{ fontSize: 14, mr: 0.5, color: 'rgba(255,255,255,0.4)' }} />
          ),
        }}
      />
      <Typography variant="caption" sx={{ px: 1, py: 0.5, color: 'text.secondary' }}>
        场景树
      </Typography>
      <List
        sx={{ flex: 1, overflow: 'auto', py: 0 }}
        onClick={(e) => {
          // 点击列表空白处清空选择（仅当点击目标为 List 本身时）
          if (e.target === e.currentTarget) {
            clearSelection();
          }
        }}
      >
        <ListItem disablePadding>
          <ListItemButton sx={{ pl: 1, py: 0.25 }}>
            <ListItemIcon sx={{ minWidth: 28 }}>
              <Folder />
            </ListItemIcon>
            <ListItemText primary="Scene" primaryTypographyProps={{ fontSize: 13 }} />
          </ListItemButton>
        </ListItem>
        {rootNodes.map((node) => renderNode(node, 1))}
      </List>
    </Box>
  );
}