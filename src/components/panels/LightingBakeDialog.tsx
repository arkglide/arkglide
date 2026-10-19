import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Dialog,DialogActions,DialogContent,DialogTitle,LinearProgress,MenuItem,Stack,TextField,Typography} from '@mui/material';
import {ScalarField} from '../ScalarField';
import {useEditorStore} from '../../store/useEditorStore';
import {startLightingBake} from '../../utils/lightingBake';
import {sceneLightingSignature} from '../../engine/light-bake.mjs';

export default function LightingBakeDialog({open,onClose}:{open:boolean;onClose:()=>void}){
 const state=useEditorStore(),[resolution,setResolution]=useState(128),[aoSamples,setSamples]=useState(16),[aoDistance,setDistance]=useState(2),[bias,setBias]=useState(.002),[progress,setProgress]=useState<number|null>(null),[message,setMessage]=useState(''),[error,setError]=useState('');
 const job=useRef<ReturnType<typeof startLightingBake>|null>(null);
 useEffect(()=>()=>job.current?.cancel(),[]);
 if(!open)return null;
 const selected=state.nodes.filter(n=>state.selectedNodeIds.includes(n.id)&&['mesh','model'].includes(n.type));
 const signature=sceneLightingSignature(state),stale=selected.some(n=>n.bakedLighting&&n.bakedLighting.signature!==signature);
 const close=()=>{job.current?.cancel();onClose();};
 const bake=async()=>{
  setError('');setMessage('');setProgress(0);
  try{job.current=startLightingBake({resolution,aoSamples,aoDistance,bias},setProgress);const result=await job.current.promise;setMessage(`已生成 ${result.maps} 张光照图，完成 ${result.rays.toLocaleString()} 条 WASM/BVH 射线。可以撤销恢复。`);}
  catch(e){setError(String(e));}finally{job.current=null;setProgress(null);}
 };
 return <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
  <DialogTitle>静态光照烘焙</DialogTitle>
  <DialogContent><Stack spacing={2} sx={{pt:1}}>
   <Typography>已选择 {selected.length} 个网格/模型。烘焙保存静态直射光与环境 AO，适用于固定的不透明场景。</Typography>
   <Typography variant="caption">基础几何自动生成 UV2；导入模型需已有不重叠 UV2，并分配自有 PBR 材质。移动几何或灯光后应重新烘焙。已烘焙材质关闭实时直射，环境贴图仍可用于反射。</Typography>
   {stale&&<Alert severity="warning">场景已变化，选中对象的光照需要重新烘焙。</Alert>}
   <TextField label="每个网格的光照分辨率" select size="small" disabled={progress!==null} value={resolution} onChange={e=>setResolution(Number(e.target.value))}>{[32,64,128,256,512,1024].map(n=><MenuItem key={n} value={n}>{n} × {n}</MenuItem>)}</TextField>
   <TextField label="AO 射线采样" select size="small" disabled={progress!==null} value={aoSamples} onChange={e=>setSamples(Number(e.target.value))}>{[0,8,16,32,64,128].map(n=><MenuItem key={n} value={n}>{n===0?'关闭':n}</MenuItem>)}</TextField>
   <ScalarField label="AO 距离（世界单位）" size="small" value={aoDistance} disabled={progress!==null} inputProps={{min:.001,max:10000,step:.1}} onValueChange={setDistance}/>
   <ScalarField label="射线表面偏移" size="small" value={bias} disabled={progress!==null} inputProps={{min:.000001,max:1,step:.001}} onValueChange={setBias}/>
   {progress!==null&&<LinearProgress variant="determinate" value={progress*100}/>}
   {error&&<Alert severity="error">{error}</Alert>}{message&&<Alert severity="success">{message}</Alert>}
  </Stack></DialogContent>
  <DialogActions><Button onClick={close}>{progress===null?'关闭':'取消烘焙'}</Button><Button onClick={()=>void bake()} disabled={progress!==null||!selected.length||state.playState!=='stopped'} variant="contained">开始烘焙</Button></DialogActions>
 </Dialog>;
}
