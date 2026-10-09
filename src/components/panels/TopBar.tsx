import { useState, useRef, useEffect } from 'react';
import {
  AppBar,
  Toolbar,
  Box,
  IconButton,
  Button,
  Menu,
  MenuItem,
  Tooltip,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Slider,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  CircularProgress,
  Typography,
} from '@mui/material';
import {
  PlayArrow,
  Pause,
  Stop,
  Download,
  Menu as MenuIcon,
  Delete as DeleteIcon,
  FolderOpen as LoadIcon,
  Upload as UploadIcon,
  Undo,
  Redo,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import RecoveryPanel from './RecoveryPanel';
import { validateProject } from '../../utils/projectValidation';
import { useEditorStore } from '../../store/useEditorStore';
import type { ProjectSettings } from '../../types/project';
import {
  listProjects,
  deleteProject,
  type StoredProject,
} from '../../utils/projectStorage';
import { exportProject, importProject } from '../../utils/projectExport';

// 顶部工具栏：菜单 + 播放控制 + 导出（固定，不进 Dockview）
// 菜单项接线：新建场景 → newProject()；打开项目 → 列表 Dialog；保存 → 命名 Dialog（首次）/ 直接保存
export default function TopBar() {
  // 播放控制 + 持久化方法/状态从 store 获取
  const playState = useEditorStore((s) => s.playState);
  const play = useEditorStore((s) => s.play);
  const pause = useEditorStore((s) => s.pause);
  const stop = useEditorStore((s) => s.stop);
  // 撤销/重做：从 store 获取方法 + past/future 长度判断可操作性
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const currentProjectId = useEditorStore((s) => s.currentProjectId);
  const saveCurrentProject = useEditorStore((s) => s.saveCurrentProject);
  const loadProjectById = useEditorStore((s) => s.loadProjectById);
  const newProject = useEditorStore((s) => s.newProject);

  // 菜单 anchor
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  // 保存命名 Dialog 状态
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [projectNameInput, setProjectNameInput] = useState('');
  const [saving, setSaving] = useState(false);

  // 打开项目列表 Dialog 状态
  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // 导入 .arkglide 文件：隐藏 input ref + 错误提示
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 项目设置 Dialog 状态
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  // 从 store 获取 settings 和 updateSettings
  const settings = useEditorStore((s) => s.settings);
  const updateSettings = useEditorStore((s) => s.updateSettings);
  // 本地编辑副本（Dialog 打开时从 store 复制，确认时写回）
  const [localSettings, setLocalSettings] = useState<ProjectSettings>(settings);

  // 关闭菜单
  const closeMenu = () => setAnchorEl(null);

  // 新建场景：关闭菜单 + 调用 newProject()
  const handleNewProject = () => {
    closeMenu();
    newProject();
  };

  // 打开项目：关闭菜单 + 打开 Dialog + 异步加载列表
  const handleOpenProject = async () => {
    closeMenu();
    setOpenDialogOpen(true);
    setLoadingProjects(true);
    try {
      const list = await listProjects();
      setProjects(list);
    } catch (err) {
      console.error('加载项目列表失败:', err);
      setProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  };

  // 保存：currentProjectId 为 null 则弹命名 Dialog，否则直接保存
  const handleSave = () => {
    closeMenu();
    if (currentProjectId === null) {
      // 首次保存：弹出命名 Dialog
      setProjectNameInput('');
      setSaveDialogOpen(true);
    } else {
      // 已保存过：直接保存（保持原名）
      void doSave();
    }
  };

  // 实际执行保存（共用逻辑）
  const doSave = async (name?: string) => {
    setSaving(true);
    try {
      await saveCurrentProject(name);
      useEditorStore.getState().addConsoleLog('log','项目已保存');
      setImportError(null);
      return true;
    } catch (err) {
      console.error('保存项目失败:', err);
      setImportError('保存项目失败: ' + String(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  // 命名 Dialog 确认：调用 doSave(inputName) → 关 Dialog
  const handleSaveConfirm = async () => {
    const name = projectNameInput.trim();
    if (!name) return; // 空名称不操作
    if (await doSave(name)) setSaveDialogOpen(false);
  };

  // 加载项目：调用 loadProjectById → 关 Dialog
  const handleLoadProject = async (projectId: string) => {
    try {
      await loadProjectById(projectId);
      setOpenDialogOpen(false);
    } catch (err) {
      console.error('加载项目失败:', err);
      setImportError('加载项目失败: ' + String(err));
    }
  };

  // 删除项目：调用 deleteProject → 刷新列表
  const handleDeleteProject = async (projectId: string) => {
    setDeletingId(projectId);
    try {
      await deleteProject(projectId);
      // 刷新列表
      const list = await listProjects();
      setProjects(list);
    } catch (err) {
      console.error('删除项目失败:', err);
    } finally {
      setDeletingId(null);
    }
  };

  // 导入项目：关闭菜单 + 触发隐藏 file input 点击
  const handleImportClick = () => {
    closeMenu();
    setImportError(null);
    fileInputRef.current?.click();
  };

  // 导入文件选择：读取文件 → importProject → 重置 input
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await importProject(file);
      setImportError(null);
    } catch (err) {
      console.error('导入项目失败:', err);
      setImportError(String(err));
    }
    e.target.value = ''; // 重置以便相同文件可再次选择
  };

  // 导出项目：关闭菜单 + 调用 exportProject()
  const handleExport = () => {
    closeMenu();
    try {
      exportProject();
    } catch (err) {
      console.error('导出项目失败:', err);
    }
  };

  // 打开项目设置 Dialog：关闭菜单 + 从 store 拷贝当前 settings 到本地副本
  const handleOpenSettings = () => {
    closeMenu();
    setLocalSettings({ ...settings, gravity: { ...settings.gravity } });
    setSettingsDialogOpen(true);
  };

  // 确认设置：调用 updateSettings 写回 store + 关闭 Dialog
  const handleSettingsConfirm = () => {
    try{
      validateProject({scene:{nodes:useEditorStore.getState().nodes},scripts:useEditorStore.getState().scripts,settings:localSettings});
      updateSettings(localSettings);setSettingsDialogOpen(false);setImportError(null);
    }catch(error){setImportError(String(error));}
  };

  // 全局撤销/重做快捷键：Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 或 Ctrl/Cmd+Y 重做
  // 焦点在 Monaco 编辑器内时不拦截，让 Monaco 自行处理其内部撤销/重做
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;
      if (!isCtrl) return;

      // Monaco 焦点检查：Monaco 容器带 class 'monaco-editor'
      const active = document.activeElement;
      if (active) {
        const monacoContainer = active.closest('.monaco-editor');
        if (monacoContainer) return; // 焦点在 Monaco 内，交给 Monaco 处理
      }

      // Ctrl/Cmd+Y = 重做
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        useEditorStore.getState().redo();
        return;
      }

      // Ctrl/Cmd+Z = 撤销，Ctrl/Cmd+Shift+Z = 重做
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) {
          useEditorStore.getState().redo();
        } else {
          useEditorStore.getState().undo();
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <AppBar position="static" color="default">
      <Toolbar variant="dense" disableGutters sx={{ px: 1, minHeight: 40 }}>
        <Tooltip title="菜单">
          <IconButton onClick={(e) => setAnchorEl(e.currentTarget)}>
            <MenuIcon />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={closeMenu}>
          <MenuItem onClick={handleNewProject}>新建场景</MenuItem>
          <MenuItem onClick={handleOpenProject}>打开项目</MenuItem>
          <MenuItem onClick={handleImportClick}>
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
              <UploadIcon fontSize="small" />
              导入项目(.arkglide)
            </Box>
          </MenuItem>
          <MenuItem onClick={handleSave}>保存</MenuItem>
          <MenuItem disabled={playState !== 'stopped'} onClick={handleOpenSettings}>
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
              <SettingsIcon fontSize="small" />
              项目设置
            </Box>
          </MenuItem>
          <MenuItem component="a" href="/math-benchmark.html" target="_blank" rel="noopener" onClick={closeMenu}>数学性能基准</MenuItem>
        </Menu>
        <Divider orientation="vertical" flexItem sx={{ mx: 1, my: 0.5 }} />
        <Tooltip title="播放">
          <IconButton disabled={playState === 'playing'} onClick={play} color={playState === 'playing' ? 'primary' : 'default'}>
            <PlayArrow />
          </IconButton>
        </Tooltip>
        <Tooltip title="暂停">
          <IconButton disabled={playState !== 'playing'} onClick={pause} color={playState === 'paused' ? 'primary' : 'default'}>
            <Pause />
          </IconButton>
        </Tooltip>
        <Tooltip title="停止">
          <IconButton disabled={playState === 'stopped'} onClick={stop} color={playState === 'stopped' ? 'primary' : 'default'}>
            <Stop />
          </IconButton>
        </Tooltip>
        <Divider orientation="vertical" flexItem sx={{ mx: 1, my: 0.5 }} />
        {/* 撤销/重做按钮：span 包裹解决 disabled 时 Tooltip 不显示问题 */}
        <Tooltip title="撤销 (Ctrl+Z)">
          <span>
            <IconButton onClick={undo} disabled={!canUndo || playState !== 'stopped'} size="small">
              <Undo />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="重做 (Ctrl+Y)">
          <span>
            <IconButton onClick={redo} disabled={!canRedo || playState !== 'stopped'} size="small">
              <Redo />
            </IconButton>
          </span>
        </Tooltip>
        <Box sx={{ flexGrow: 1 }} />
        <RecoveryPanel />
        <Tooltip title="导出为 .arkglide 文件">
          <Button variant="outlined" startIcon={<Download />} onClick={handleExport}>
            导出
          </Button>
        </Tooltip>
        {importError && (
          <Typography sx={{ ml: 1, fontSize: 11, color: 'error.main' }} noWrap>
            操作失败: {importError}
          </Typography>
        )}
      </Toolbar>

      {/* 保存命名 Dialog（首次保存） */}
      <Dialog
        open={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        PaperProps={{ sx: { borderRadius: 4, backgroundColor: '#1E1E1E' } }}
      >
        <DialogTitle sx={{ fontSize: 14, fontWeight: 600 }}>保存项目</DialogTitle>
        <DialogContent sx={{ minWidth: 360 }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="项目名称"
            value={projectNameInput}
            onChange={(e) => setProjectNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSaveConfirm();
            }}
            disabled={saving}
          />
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setSaveDialogOpen(false)} disabled={saving}>
            取消
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => void handleSaveConfirm()}
            disabled={saving || !projectNameInput.trim()}
          >
            {saving ? '保存中…' : '确认'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 打开项目列表 Dialog */}
      <Dialog
        open={openDialogOpen}
        onClose={() => setOpenDialogOpen(false)}
        PaperProps={{ sx: { borderRadius: 4, backgroundColor: '#1E1E1E' } }}
      >
        <DialogTitle sx={{ fontSize: 14, fontWeight: 600 }}>打开项目</DialogTitle>
        <DialogContent sx={{ minWidth: 360 }}>
          {loadingProjects ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : projects.length === 0 ? (
            <Typography sx={{ py: 2, textAlign: 'center', color: 'text.secondary', fontSize: 13 }}>
              暂无已保存项目
            </Typography>
          ) : (
            <List dense>
              {projects.map((p) => (
                <ListItem key={p.projectId} divider>
                  <ListItemText
                    primary={p.name}
                    secondary={new Date(p.updatedAt).toLocaleString('zh-CN')}
                    primaryTypographyProps={{ fontSize: 13, fontWeight: 500 }}
                    secondaryTypographyProps={{ fontSize: 11 }}
                  />
                  <ListItemSecondaryAction>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <Tooltip title="加载">
                        <IconButton
                          size="small"
                          onClick={() => void handleLoadProject(p.projectId)}
                          sx={{ border: '1px solid', borderColor: 'divider' }}
                        >
                          <LoadIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => void handleDeleteProject(p.projectId)}
                          disabled={deletingId === p.projectId}
                          sx={{ border: '1px solid', borderColor: 'divider' }}
                        >
                          {deletingId === p.projectId ? (
                            <CircularProgress size={14} />
                          ) : (
                            <DeleteIcon fontSize="small" />
                          )}
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setOpenDialogOpen(false)}>
            取消
          </Button>
        </DialogActions>
      </Dialog>

      {/* 项目设置 Dialog */}
      <Dialog
        open={settingsDialogOpen}
        onClose={() => setSettingsDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 4, backgroundColor: '#1E1E1E' } }}
      >
        <DialogTitle sx={{ fontSize: 14, fontWeight: 600 }}>项目设置</DialogTitle>
        <DialogContent sx={{ minWidth: 320, py: 2 }}>
          {/* 重力 */}
          <Typography variant="caption" sx={{ color: 'text.secondary', mb: 1, display: 'block' }}>
            重力 (Gravity)
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <TextField
              size="small"
              type="number"
              label="X"
              value={localSettings.gravity.x}
              onChange={(e) => setLocalSettings((s) => ({ ...s, gravity: { ...s.gravity, x: parseFloat(e.target.value) || 0 } }))}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              type="number"
              label="Y"
              value={localSettings.gravity.y}
              onChange={(e) => setLocalSettings((s) => ({ ...s, gravity: { ...s.gravity, y: parseFloat(e.target.value) || 0 } }))}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              type="number"
              label="Z"
              value={localSettings.gravity.z}
              onChange={(e) => setLocalSettings((s) => ({ ...s, gravity: { ...s.gravity, z: parseFloat(e.target.value) || 0 } }))}
              sx={{ flex: 1 }}
            />
          </Box>

          {/* 背景色 */}
          <Typography variant="caption" sx={{ color: 'text.secondary', mb: 1, display: 'block' }}>
            背景色 (Background)
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <TextField
              size="small"
              value={localSettings.backgroundColor}
              onChange={(e) => setLocalSettings((s) => ({ ...s, backgroundColor: e.target.value }))}
              sx={{ flex: 1 }}
              placeholder="#0D0D0D"
            />
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: 1,
                bgcolor: localSettings.backgroundColor,
                border: '1px solid',
                borderColor: 'divider',
                flexShrink: 0,
              }}
            />
          </Box>

          {/* 环境光强度 */}
          <Typography variant="caption" sx={{ color: 'text.secondary', mb: 1, display: 'block' }}>
            环境光强度: {localSettings.ambientIntensity.toFixed(2)}
          </Typography>
          <Slider
            size="small"
            min={0}
            max={2}
            step={0.05}
            value={localSettings.ambientIntensity}
            onChange={(_, v) => setLocalSettings((s) => ({ ...s, ambientIntensity: v as number }))}
            sx={{ mb: 2 }}
          />

          {/* 环境光颜色 */}
          <Typography variant="caption" sx={{ color: 'text.secondary', mb: 1, display: 'block' }}>
            环境光颜色 (Ambient)
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <TextField
              size="small"
              value={localSettings.ambientColor}
              onChange={(e) => setLocalSettings((s) => ({ ...s, ambientColor: e.target.value }))}
              sx={{ flex: 1 }}
              placeholder="#FFFFFF"
            />
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: 1,
                bgcolor: localSettings.ambientColor,
                border: '1px solid',
                borderColor: 'divider',
                flexShrink: 0,
              }}
            />
          </Box>

          <Typography variant="caption" sx={{display:'block',mb:1}}>游戏时间与固定步</Typography>
          <Box sx={{display:'flex',gap:1,mb:2}}>
            <TextField size="small" type="number" label="时间倍率" value={localSettings.timeScale} onChange={e=>setLocalSettings(s=>({...s,timeScale:Number(e.target.value)}))} />
            <TextField size="small" type="number" label="固定步 Hz" value={Math.round(1/localSettings.fixedTimeStep)} onChange={e=>setLocalSettings(s=>({...s,fixedTimeStep:1/Number(e.target.value)}))} />
            <TextField size="small" type="number" label="最大追赶步数" value={localSettings.maxSubSteps} onChange={e=>setLocalSettings(s=>({...s,maxSubSteps:Number(e.target.value)}))} />
          </Box>
          {/* 帧率上限 */}
          <Typography variant="caption" sx={{ color: 'text.secondary', mb: 1, display: 'block' }}>
            帧率上限 (0 = 无限制)
          </Typography>
          <TextField
            size="small"
            type="number"
            fullWidth
            value={localSettings.fpsCap}
            onChange={(e) => setLocalSettings((s) => ({ ...s, fpsCap: parseInt(e.target.value) || 0 }))}
            placeholder="60"
          />
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setSettingsDialogOpen(false)}>
            取消
          </Button>
          <Button size="small" variant="contained" onClick={handleSettingsConfirm}>
            应用
          </Button>
        </DialogActions>
      </Dialog>

      {/* 导入 .arkglide 隐藏 file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".arkglide"
        onChange={(e) => void handleImportFile(e)}
        style={{ display: 'none' }}
      />
    </AppBar>
  );
}