import type {EditorState} from '../store/useEditorStore';
import {getEditorScene} from '../engine/editor-scene';
export async function scanResourceBudget(state:EditorState,signal:AbortSignal,onProgress:(value:number)=>void=()=>{}){
 const {scene,adapter}=getEditorScene(),checks=()=>{if(signal.aborted)throw new DOMException('扫描已取消','AbortError');if(scene.isDisposed)throw Error('编辑视口已关闭，请重新扫描');};
 const meshes=scene.meshes.filter(m=>m.metadata?.arkglideId&&!m.metadata?.arkglideRenderInternal&&m.getTotalVertices()>0),geometries=new Set(meshes.map(m=>(m as any).geometry));
 const geometryBytes=[...geometries].reduce((sum,g)=>{if(!g)return sum;let bytes=g.getTotalIndices()*4;for(const kind of g.getVerticesDataKinds())bytes+=(g.getVerticesData(kind)?.length||0)*4;return sum+bytes;},0);
 const files=[...state.modelBuffers].map(([id,bytes])=>({id,kind:'model',bytes})).concat([...state.textureBuffers].map(([id,bytes])=>({id,kind:'texture',bytes})));
 const groups=new Map<string,string[]>(),textures: {id:string;name:string;fileBytes:number;width:number|null;height:number|null;estimatedBytes:number|null;error?:string}[]=[];
 let processed=0;
 for(const file of files){checks();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',file.bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');checks();const list=groups.get(hash)||[];list.push(file.kind+':'+file.id);groups.set(hash,list);processed++;onProgress(processed/(files.length+state.content.textures.length||1));}
 for(const texture of state.content.textures){
  checks();const bytes=state.textureBuffers.get(texture.id),item={id:texture.id,name:texture.name,fileBytes:bytes?.byteLength||0,width:null as number|null,height:null as number|null,estimatedBytes:null as number|null,error:undefined as string|undefined};
  if(!bytes)item.error='资源字节缺失';
  else if(['image/png','image/jpeg','image/webp'].includes(texture.mime)){
   let image:ImageBitmap|undefined;
   try{image=await createImageBitmap(new Blob([bytes],{type:texture.mime}));checks();item.width=image.width;item.height=image.height;item.estimatedBytes=Math.ceil(image.width*image.height*4*4/3);}catch(e){checks();item.error='图片解码失败：'+String(e);}finally{image?.close();}
  }
  textures.push(item);processed++;onProgress(processed/(files.length+state.content.textures.length||1));await new Promise(resolve=>setTimeout(resolve,0));
 }
 checks();
 return {date:new Date().toISOString(),project:state.currentProjectName,documentId:state.documentId,
  geometry:{meshes:meshes.length,uniqueGeometries:geometries.size,sharedGeometryMeshes:meshes.length-geometries.size,sourceTriangles:meshes.reduce((sum,m)=>sum+m.getTotalIndices()/3,0),vertexAndIndexBytes:geometryBytes,largest:meshes.map(m=>({nodeId:m.metadata.arkglideId,name:m.name,vertices:m.getTotalVertices(),triangles:m.getTotalIndices()/3})).sort((a,b)=>b.triangles-a.triangles).slice(0,20)},
  assets:{modelBytes:[...state.modelBuffers.values()].reduce((n,b)=>n+b.byteLength,0),textureFileBytes:[...state.textureBuffers.values()].reduce((n,b)=>n+b.byteLength,0),estimatedTextureBytes:textures.reduce((n,t)=>n+(t.estimatedBytes||0),0),textures,duplicateFiles:[...groups.values()].filter(g=>g.length>1),missingModels:[...state.missingModelIds]},
  optimization:adapter.optimization?.stats()||{},
  limits:'One copy per standalone RGBA8 image asset with a full mip chain is estimated; excludes embedded model textures, additional material-role copies, render targets, MSAA, compressed formats, environment cubes and driver overhead. Geometry sharing saves buffers, not draw calls. Source triangle counts do not measure the selected render LOD.',
 };
}
export function downloadBudget(report:unknown,name='arkglide-resource-budget.json'){const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
