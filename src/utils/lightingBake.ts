import * as B from '@babylonjs/core';
import {useEditorStore,type SceneNode} from '../store/useEditorStore';
import {defaultMaterial,type MaterialAsset} from '../types/content';
import {getEditorScene} from '../engine/editor-scene';
import '../engine/lighting-uv.js';
import {bakeOptions,sceneLightingSignature} from '../engine/light-bake.mjs';

function staticNode(n:SceneNode){return !n.animation&&!n.character&&!n.scripts?.length&&(!n.physics||n.physics.motion==='static');}
function meshData(mesh:B.AbstractMesh,uvs?:ArrayLike<number>){
 const p=mesh.getVerticesData(B.VertexBuffer.PositionKind),n=mesh.getVerticesData(B.VertexBuffer.NormalKind),indices=mesh.getIndices();
 if(!p||!n||!indices)throw Error('对象缺少 CPU 可读顶点、法线或索引');
 const world=mesh.computeWorldMatrix(true);if(Math.abs(world.determinant())<1e-12)throw Error('零缩放对象不能烘焙');
 const normalMatrix=world.clone().invert().transpose(),positions=new Float64Array(p.length),normals=new Float64Array(n.length);
 for(let i=0;i<p.length;i+=3){const point=B.Vector3.TransformCoordinates(B.Vector3.FromArray(p,i),world),normal=B.Vector3.TransformNormal(B.Vector3.FromArray(n,i),normalMatrix).normalize();positions.set([point.x,point.y,point.z],i);normals.set([normal.x,normal.y,normal.z],i);}
 return {positions,normals,indices:new Uint32Array(indices),uvs:new Float64Array(uvs||[])};
}

export function startLightingBake(options:unknown,onProgress:(value:number)=>void){
 const state=useEditorStore.getState(),{scene,adapter}=getEditorScene(),config=bakeOptions(options);
 if(state.playState!=='stopped')throw Error('请先停止运行');
 const selected=new Set(state.selectedNodeIds),targets:any[]=[],bindings=new Map<string,{source:MaterialAsset;slot?:string}[]>(),triangles:number[]=[],lights:number[]=[];
 const byId=new Map(state.nodes.map(n=>[n.id,n]));
 const fixedHierarchy=(node:SceneNode)=>{for(let n:SceneNode|undefined=node;n;n=byId.get(n.parentId||''))if(!staticNode(n))return false;return true;};
 for(const node of state.nodes){
  if(!selected.has(node.id)||!['mesh','model'].includes(node.type))continue;
  if(!staticNode(node))throw Error(node.name+'：只能烘焙没有脚本、动画和动态物理的静态对象');
  for(let parent=byId.get(node.parentId||'');parent;parent=byId.get(parent.parentId||''))if(!staticNode(parent))throw Error(node.name+'：父级会运动，不能烘焙');
  const object=adapter.nodes.get(node.id),meshes=node.type==='mesh'?[object]:object?.getChildMeshes(false).filter((m:any)=>m.metadata?.arkglideId===node.id&&m.getTotalVertices()>0)||[];
  if(!meshes.length)throw Error(node.name+'：模型尚未加载');
  for(const mesh of meshes){
   if(!mesh.isEnabled()||!mesh.isVisible||mesh.skeleton||mesh.morphTargetManager)throw Error(node.name+'：不可见或变形网格不支持烘焙');
   const part=mesh.metadata?.arkglidePartKey||'mesh',uvs=node.type==='mesh'?(globalThis as any).ArkGlideLightingUV.generateUV2(B,mesh,node.primitive||(globalThis as any).ArkGlideScene.primitiveOf(node),false):mesh.getVerticesData(B.VertexBuffer.UV2Kind);
   if(!uvs)throw Error(node.name+'：导入模型需要不重叠的 UV2');
   const mats=mesh.material?.subMaterials||[mesh.material],list=[];
   for(let i=0;i<mats.length;i++){
    const slot=part+'/slot:'+i,ref=Object.hasOwn(node.materialSlots||{},slot)?node.materialSlots![slot]:node.materialId;
    if(node.type==='model'&&!state.content.materials[ref||''])throw Error(node.name+'：请先给模型部件分配自有 PBR 材质');
    const source=ref?state.content.materials[ref]:{...defaultMaterial('',node.name),baseColor:node.color||'#FFFFFF'};
    if(!source||source.alpha<1||['mask','blend'].includes(source.alphaMode||'')||source.transmission?.enabled)throw Error(node.name+'：透明或透射材质不能作为烘焙接收面');
    list.push({source,slot:node.type==='model'?slot:undefined});
   }
   bindings.set(node.id+':'+part,list);targets.push({...meshData(mesh,uvs),nodeId:node.id,part,autoUV2:node.type==='mesh'});
  }
 }
 if(!targets.length)throw Error('请先选择需要烘焙的静态网格或模型');
 if(targets.length*config.resolution*config.resolution>4194304)throw Error('烘焙总像素超过 4 MP，请减少选择或分辨率');
 for(const mesh of scene.meshes){
  const node=byId.get(mesh.metadata?.arkglideId);if(!node||!fixedHierarchy(node)||!mesh.isEnabled()||!mesh.isVisible||!mesh.getTotalVertices()||node.castShadows===false||mesh.skeleton||mesh.morphTargetManager)continue;
  const mat:any=mesh.material;if((mat?.subMaterials||[mat]).some((m:any)=>m?.alpha<1||m?.needAlphaBlending?.()||m?.needAlphaTesting?.()))continue;
  const data=meshData(mesh);for(const index of data.indices)for(let k=0;k<3;k++)triangles.push(data.positions[index*3+k]);
  if(triangles.length/9>1000000)throw Error('烘焙遮挡几何超过 100 万三角形预算');
 }
 const ambient=B.Color3.FromHexString(state.settings.ambientColor).scale(state.settings.ambientIntensity);lights.push(2,0,1,0,ambient.r,ambient.g,ambient.b,0,0,0);
 for(const light of scene.lights){
  if(!light.isEnabled()||!byId.has(light.parent?.metadata?.arkglideId))continue;
  const node=byId.get(light.parent!.metadata.arkglideId)!;if(!fixedHierarchy(node))continue;
  light.computeWorldMatrix(true);const l:any=light;l.computeTransformedInformation?.();
  const point=light.getClassName()==='PointLight',hemi=light.getClassName()==='HemisphericLight',v=point?l.getAbsolutePosition():hemi?B.Vector3.TransformNormal(l.direction,light.getWorldMatrix()):l.transformedDirection||l.direction;
  const c=light.diffuse.scale(light.intensity),g=hemi?l.groundColor.scale(light.intensity):B.Color3.Black();lights.push(hemi?2:point?1:0,v.x,v.y,v.z,c.r,c.g,c.b,g.r,g.g,g.b);
 }
 if(lights.length/10>256)throw Error('烘焙最多支持 256 盏灯');
 const worker=new Worker(new URL('../engine/light-bake.worker.ts',import.meta.url),{type:'module'});let settled=false;
 let rejectResult:(error:Error)=>void;
 const promise=new Promise<{backend:string;rays:number;maps:number}>((resolve,reject)=>{
  rejectResult=reject;
  worker.onerror=e=>{settled=true;worker.terminate();reject(Error(e.message||'烘焙工作线程失败'));};
  worker.onmessage=({data})=>{
   if(data.type==='progress'){onProgress(data.value);return;}
   settled=true;worker.terminate();
   if(data.type==='error'){reject(Error(data.message));return;}
   try{
    const now=useEditorStore.getState();
    if(now.documentId!==state.documentId||now.nodes!==state.nodes||now.settings!==state.settings||now.content!==state.content||now.modelBuffers!==state.modelBuffers||now.textureBuffers!==state.textureBuffers||now.playState!=='stopped')throw Error('场景或项目在烘焙期间已变化，请重新烘焙');
    const materials:Record<string,MaterialAsset>={},textures:any[]=[],nodes=structuredClone(state.nodes);
    for(const result of data.results){
     const textureId=crypto.randomUUID(),node=nodes.find(n=>n.id===result.nodeId)!;
     textures.push({asset:{id:textureId,name:node.name+' 光照.png',mime:'image/png',byteLength:result.png.byteLength},bytes:result.png});
     for(const binding of bindings.get(node.id+':'+result.part)!){
      const id=crypto.randomUUID();materials[id]={...structuredClone(binding.source),id,name:binding.source.name+'（已烘焙）',lightmapTextureId:textureId,lightmapUV:1,lightmapIntensity:result.scale,bakedDirectLighting:true};
      if(binding.slot)node.materialSlots={...node.materialSlots,[binding.slot]:id};else node.materialId=id;
     }
     node.bakedLighting={autoUV2:result.autoUV2,signature:'00000000'};
    }
    const signature=sceneLightingSignature({...state,nodes});for(const node of nodes)if(node.bakedLighting&&selected.has(node.id))node.bakedLighting.signature=signature;
    now.applyLightingBake(nodes,materials,textures,state.documentId);resolve({backend:data.backend,rays:data.rays,maps:data.results.length});
   }catch(e){reject(e instanceof Error?e:Error(String(e)));}
  };
 });
 worker.postMessage({options:config,targets,triangles:new Float64Array(triangles),lights:new Float64Array(lights)});
 return {promise,cancel(){if(!settled){settled=true;worker.terminate();rejectResult(Error('烘焙已取消'));}}};
}
