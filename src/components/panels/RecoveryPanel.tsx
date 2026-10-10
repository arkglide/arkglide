import { useEffect, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { useEditorStore } from '../../store/useEditorStore';
import { listRecoveries, deleteRecovery, type RecoverySummary } from '../../utils/projectStorage';
import { restoreRecovery } from '../../utils/projectRecovery';

export default function RecoveryPanel() {
  const [open,setOpen]=useState(false),[records,setRecords]=useState<RecoverySummary[]>([]);
  const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const status=useEditorStore(s=>s.recoveryStatus),updated=useEditorStore(s=>s.recoveryUpdatedAt);
  const documentId=useEditorStore(s=>s.documentId);
  const recoveryError=useEditorStore(s=>s.recoveryError),playState=useEditorStore(s=>s.playState);
  async function refresh(){setRecords(await listRecoveries());}
  useEffect(()=>{
    let live=true;
    listRecoveries().then(items=>{if(live){setRecords(items);if(items.length)setOpen(true);}}).catch(e=>{if(live)setError(String(e));});
    return()=>{live=false;};
  },[]);
  async function show(){setOpen(true);setBusy(true);try{await refresh();setError(null);}catch(e){setError(String(e));}finally{setBusy(false);}}
  async function restore(id:string){setBusy(true);try{await restoreRecovery(id);setOpen(false);setError(null);}catch(e){setError(String(e));}finally{setBusy(false);}}
  async function discard(id:string){setBusy(true);try{await deleteRecovery(id);await refresh();}catch(e){setError(String(e));}finally{setBusy(false);}}
  const labels={idle:'自动保存已启用',pending:'等待自动保存',saving:'正在自动保存',saved:'恢复副本已保存',error:'自动保存失败'};
  return <>
    <Button size="small" onClick={()=>void show()} color={status==='error'?'error':'inherit'} title={recoveryError || (updated?new Date(updated).toLocaleString():'编辑后自动保存恢复副本')}>
      {labels[status]} · 恢复
    </Button>
    <Dialog open={open} onClose={()=>{if(!busy)setOpen(false);}} maxWidth="sm" fullWidth>
      <DialogTitle>项目恢复</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{mb:2}}>恢复副本包含场景、脚本、模型、材质、贴图和预制体。恢复会替换当前编辑内容；手动保存的项目版本会保留。</Typography>
        {(error || recoveryError)&&<Alert severity="error">{error || recoveryError}</Alert>}
        {!records.length&&<Typography color="text.secondary">暂无恢复记录。编辑内容会在约 1.2 秒后自动保存，持续编辑时最长约 10 秒。</Typography>}
        {records.map(record=><Box key={record.recoveryId} sx={{py:1,borderBottom:'1px solid',borderColor:'divider',display:'flex',alignItems:'center',gap:1}}>
          <Box sx={{flex:1,minWidth:0}}><Typography noWrap>{record.project?.name || '损坏的恢复记录'}</Typography>
            <Typography variant="caption" color="text.secondary">{new Date(record.updatedAt).toLocaleString()} · {record.project?.scene?.nodes?.length ?? '?'} 个节点</Typography></Box>
          <Button disabled={busy||playState!=='stopped'} onClick={()=>void restore(record.recoveryId)}>恢复</Button>
          <Button color="error" title={record.recoveryId===documentId?"当前副本会在手动保存后清除":undefined} disabled={busy||record.recoveryId===documentId} onClick={()=>void discard(record.recoveryId)}>删除副本</Button>
        </Box>)}
      </DialogContent>
      <DialogActions><Button disabled={busy} onClick={()=>setOpen(false)}>稍后处理</Button></DialogActions>
    </Dialog>
  </>;
}
