import { useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, MenuItem, TextField, Typography } from '@mui/material';
import { useEditorStore } from '../../store/useEditorStore';
import { exportStaticGame } from '../../utils/staticGameExport';
export default function StaticExportDialog({open, onClose}: {open:boolean; onClose:()=>void}) {
  const projectName = useEditorStore(s => s.currentProjectName);
  const playState = useEditorStore(s => s.playState);
  const [title, setTitle] = useState(''), [fit, setFit] = useState<'responsive'|'contain'>('responsive');
  const [width, setWidth] = useState('1280'), [height, setHeight] = useState('720');
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [error, setError] = useState('');
  const controller = useRef<AbortController|null>(null);
  const close = () => { controller.current?.abort(); if (!busy) onClose(); };
  const run = async () => {
    controller.current = new AbortController(); setBusy(true); setError(''); setProgress(0);
    try {
      const manifest = await exportStaticGame({title:title || projectName, fit, width:Number(width), height:Number(height)}, controller.current.signal, (done,total) => setProgress(done/total*100));
      useEditorStore.getState().addConsoleLog('log', `独立游戏已导出：${manifest.resources.length} 个资源，${manifest.files.length} 份文件。请通过静态服务器运行。`);
      onClose();
    } catch (error) { setError(error instanceof Error ? error.name === 'AbortError' ? '导出已取消' : error.message : String(error)); }
    finally { controller.current = null; setBusy(false); }
  };
  return <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
    <DialogTitle>导出独立游戏</DialogTitle>
    <DialogContent>
      <Typography sx={{mb:2}}>生成可部署的静态 ZIP，包含运行时、WASM、脚本和全部项目资源。解压后使用 HTTP/HTTPS 静态服务器打开 index.html，支持子目录部署。</Typography>
      <TextField fullWidth label="游戏标题" value={title} placeholder={projectName} onChange={e=>setTitle(e.target.value)} disabled={busy} sx={{mt:1}}/>
      <TextField fullWidth select label="运行尺寸" value={fit} onChange={e=>setFit(e.target.value as typeof fit)} disabled={busy} sx={{mt:2}}>
        <MenuItem value="responsive">适应窗口</MenuItem><MenuItem value="contain">按设计比例缩放（留黑边）</MenuItem>
      </TextField>
      <Box sx={{display:'flex',gap:2,mt:2}}>
        <TextField type="number" label="设计宽度" value={width} onChange={e=>setWidth(e.target.value)} disabled={busy}/>
        <TextField type="number" label="设计高度" value={height} onChange={e=>setHeight(e.target.value)} disabled={busy}/>
      </Box>
      <Typography variant="body2" sx={{mt:2}}>全部预制体会被打包，供脚本运行时生成。未登记的 fetch/远程资源不会自动下载。音频需游戏内用户点击解锁。</Typography>
      {playState !== 'stopped' && <Alert severity="warning" sx={{mt:2}}>请先停止编辑器运行。</Alert>}
      {busy && <Box sx={{mt:2}}><LinearProgress variant="determinate" value={progress}/><Typography variant="caption">准备运行时与项目资源 {Math.round(progress)}%</Typography></Box>}
      {error && <Alert severity="error" sx={{mt:2}}>{error}</Alert>}
    </DialogContent>
    <DialogActions><Button onClick={close}>{busy ? '取消导出' : '关闭'}</Button><Button variant="contained" disabled={busy || playState !== 'stopped'} onClick={run}>下载游戏 ZIP</Button></DialogActions>
  </Dialog>;
}
