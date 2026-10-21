import type {EditorState} from '../store/useEditorStore';
import {getEditorScene} from '../engine/editor-scene';
import '../engine/ktx2-runtime.js';
export async function scanResourceBudget(state:EditorState,signal:AbortSignal,onProgress:(value:number)=>void=()=>{}){
 const {scene,adapter}=getEditorScene(),checks=()=>{if(signal.aborted)throw new DOMException('扫描已取消','AbortError');if(scene.isDisposed)throw Error('编辑视口已关闭，请重新扫描');};
 const meshes=scene.meshes.filter(m=>m.metadata?.arkglideId&&!m.metadata?.arkglideRenderInternal&&m.getTotalVertices()>0),geometries=new Set(meshes.map(m=>(m as any).isAnInstance?(m as any).sourceMesh.geometry:(m as any).geometry).filter(Boolean));
 const geometryBytes=[...geometries].reduce((sum,g)=>{if(!g)return sum;let bytes=g.getTotalIndices()*4;for(const kind of g.getVerticesDataKinds())bytes+=(g.getVerticesData(kind)?.length||0)*4;return sum+bytes;},0);
 const files=[...state.modelBuffers].map(([id,bytes])=>({id,kind:'model',bytes})).concat([...state.textureBuffers].map(([id,bytes])=>({id,kind:'texture',bytes})));
 const groups=new Map<string,string[]>(),textures: {id:string;name:string;fileBytes:number;width:number|null;height:number|null;estimatedBytes:number|null;ktx2?:unknown;error?:string}[]=[];
 let processed=0;
 for(const file of files){checks();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',file.bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');checks();const list=groups.get(hash)||[];list.push(file.kind+':'+file.id);groups.set(hash,list);processed++;onProgress(processed/(files.length+state.content.textures.length||1));}
 for(const texture of state.content.textures){
  checks();const bytes=state.textureBuffers.get(texture.id),item={id:texture.id,name:texture.name,fileBytes:bytes?.byteLength||0,width:null as number|null,height:null as number|null,estimatedBytes:null as number|null,ktx2:undefined as any,error:undefined as string|undefined};
  if(!bytes)item.error='资源字节缺失';
  else if(texture.mime==='image/ktx2'){
   try{const k=(globalThis as any).ArkGlideKTX2.inspect(bytes);item.width=k.width;item.height=k.height;item.estimatedBytes=k.estimatedRgbaBytes;item.ktx2=k;}catch(e){item.error='KTX2 容器损坏：'+String(e);}
  }else if(['image/png','image/jpeg','image/webp'].includes(texture.mime)){
   let image:ImageBitmap|undefined;
   try{image=await createImageBitmap(new Blob([bytes],{type:texture.mime}));checks();item.width=image.width;item.height=image.height;item.estimatedBytes=Math.ceil(image.width*image.height*4*4/3);}catch(e){checks();item.error='图片解码失败：'+String(e);}finally{image?.close();}
  }
  textures.push(item);processed++;onProgress(processed/(files.length+state.content.textures.length||1));await new Promise(resolve=>setTimeout(resolve,0));
 }
 checks();
 const loadedKtx2Textures=scene.textures.filter(t=>(t as any).metadata?.arkglideKTX2).map(t=>{const k=(t as any).metadata.arkglideKTX2,native=t.getInternalTexture(),format=native?.isReady?native.format:null;return {name:t.name,width:k.width,height:k.height,mipLevels:k.mipLevels,format,compressed:format!==null&&![5,6,7].includes(format),estimatedBytes:format===null?null:(globalThis as any).ArkGlideKTX2.storageBytes(format,k.width,k.height,k.mipLevels) as number|null};});
 return {date:new Date().toISOString(),project:state.currentProjectName,documentId:state.documentId,
  geometry:{meshes:meshes.length,uniqueGeometries:geometries.size,sharedGeometryMeshes:meshes.length-geometries.size,sourceTriangles:meshes.reduce((sum,m)=>sum+m.getTotalIndices()/3,0),vertexAndIndexBytes:geometryBytes,largest:meshes.map(m=>({nodeId:m.metadata.arkglideId,name:m.name,vertices:m.getTotalVertices(),triangles:m.getTotalIndices()/3})).sort((a,b)=>b.triangles-a.triangles).slice(0,20)},
  assets:{modelBytes:[...state.modelBuffers.values()].reduce((n,b)=>n+b.byteLength,0),textureFileBytes:[...state.textureBuffers.values()].reduce((n,b)=>n+b.byteLength,0),estimatedTextureBytes:textures.reduce((n,t)=>n+(t.estimatedBytes||0),0),textures,loadedKtx2Textures,loadedKtx2EstimatedBytes:loadedKtx2Textures.some(t=>t.estimatedBytes===null)?null:loadedKtx2Textures.reduce((sum,t)=>sum+(t.estimatedBytes||0),0),duplicateFiles:[...groups.values()].filter(g=>g.length>1),missingModels:[...state.missingModelIds]},
  optimization:{...adapter.optimization?.stats(),...adapter.instanceStats?.()},
  limits:'Per-asset estimates use one RGBA8 copy and mips (KTX2 uses the source mip count). Loaded KTX2 copies separately report block-storage estimates for the current device format. Excludes embedded model textures, extra copies outside the reported list, render targets, MSAA, environment cubes and driver overhead. Geometry sharing saves buffers; actual instancing draw calls require measurement. Source triangles do not measure selected LOD.',
 };
}
export function downloadBudget(report:unknown,name='arkglide-resource-budget.json'){const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
