import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Dialog,DialogActions,DialogContent,DialogTitle,LinearProgress,Stack,Typography} from '@mui/material';
import {useEditorStore} from '../../store/useEditorStore';
import {scanResourceBudget,downloadBudget} from '../../utils/resourceBudget';
const mib=(n:number)=>(n/1048576).toFixed(1)+' MiB';
export default function ResourceBudgetDialog({open,onClose}:{open:boolean;onClose:()=>void}){
 const [report,setReport]=useState<Awaited<ReturnType<typeof scanResourceBudget>>|null>(null),[progress,setProgress]=useState<number|null>(null),[error,setError]=useState(''),abort=useRef<AbortController|null>(null);
 useEffect(()=>()=>abort.current?.abort(),[]);
 if(!open)return null;
 const close=()=>{abort.current?.abort();onClose();};
 const scan=async()=>{abort.current?.abort();const controller=new AbortController();abort.current=controller;setProgress(0);setError('');const state=useEditorStore.getState();try{const result=await scanResourceBudget(state,controller.signal,setProgress),now=useEditorStore.getState();if(now.documentId!==state.documentId||now.nodes!==state.nodes||now.content!==state.content||now.modelBuffers!==state.modelBuffers||now.textureBuffers!==state.textureBuffers)throw Error('场景或资源已变化，请重新扫描');setReport(result);}catch(e){if(!controller.signal.aborted)setError(String(e));}finally{if(abort.current===controller)setProgress(null);}};
 return <Dialog open onClose={close} fullWidth maxWidth="sm"><DialogTitle>资源预算检查</DialogTitle><DialogContent><Stack spacing={1.5} sx={{pt:1}}>
  <Typography>扫描当前场景的几何、贴图和重复文件，帮助定位资源开销。报告反映扫描时的状态。</Typography>
  {progress!==null&&<LinearProgress variant="determinate" value={progress*100}/>}{error&&<Alert severity="error">{error}</Alert>}
  {report&&<>
   <Typography variant="caption">{report.project} · {new Date(report.date).toLocaleString()}</Typography>
   <Typography>源网格 {report.geometry.meshes}，独立几何 {report.geometry.uniqueGeometries}，共享网格 {report.geometry.sharedGeometryMeshes}</Typography>
   <Typography>源三角形 {report.geometry.sourceTriangles.toLocaleString()}，顶点/索引约 {mib(report.geometry.vertexAndIndexBytes)}</Typography>
   <Typography>模型文件 {mib(report.assets.modelBytes)}，贴图文件 {mib(report.assets.textureFileBytes)}，RGBA8 贴图含 Mip 估算 {mib(report.assets.estimatedTextureBytes)}</Typography>
   <Typography>相同字节的文件组 {report.assets.duplicateFiles.length}，缺失模型 {report.assets.missingModels.length}</Typography>
   {report.assets.estimatedTextureBytes>256*1048576&&<Alert severity="warning">静态贴图估算超过 256 MiB，可优先检查大尺寸贴图和复用关系；目标预算仍需按设备确定。</Alert>}
   {report.assets.textures.map(t=><Typography variant="caption" key={t.id}>{t.name}：{t.width?`${t.width} × ${t.height}，约 ${mib(t.estimatedBytes||0)}`:t.error||'该格式未估算显存'}</Typography>)}
   <Typography variant="caption">估算不包含阴影、反射、后处理、MSAA 和驱动开销。几何共享减少缓冲，不代表绘制调用合批。</Typography>
  </>}
 </Stack></DialogContent><DialogActions><Button onClick={close}>{progress!==null?'取消':'关闭'}</Button><Button disabled={!report||progress!==null} onClick={()=>downloadBudget(report)}>下载 JSON</Button><Button variant="contained" disabled={progress!==null||useEditorStore.getState().playState!=='stopped'} onClick={()=>void scan()}>扫描资源</Button></DialogActions></Dialog>;
}
