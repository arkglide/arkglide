(function(root){
 'use strict';
 function create(B,scene,options={}){
  const records=new Map(),cache=new WeakMap();let generation=0,dead=false,native=null,modulePromise=null;
  const counters={lodMeshes:0,lodLevels:0,lodNativeBuilds:0,lodJSBuilds:0,lodSkippedMeshes:0};
  function release(mesh,record){for(const level of record.levels){if(!mesh.isDisposed())mesh.removeLODLevel(level);level.dispose(false,false);}records.delete(mesh);}
  function clear(){generation++;for(const [mesh,record]of records)release(mesh,record);native?.delete();native=null;for(const k of Object.keys(counters))counters[k]=0;}
  function eligible(node,mesh){
   return !node.bakedLighting&&!node.animation&&!node.character&&!node.scripts?.length&&(!node.physics||node.physics.motion==='static')&&!mesh.skeleton&&!mesh.morphTargetManager&&!mesh.isAnInstance&&!mesh.hasThinInstances&&!mesh.material?.subMaterials&&!mesh.material?.lightmapTexture&&!mesh.isVerticesDataPresent(B.VertexBuffer.ColorKind)&&mesh.getTotalIndices()>=384&&mesh.getTotalVertices()<=100000;
  }
  function packed(mesh){const p=mesh.getVerticesData(B.VertexBuffer.PositionKind),n=mesh.getVerticesData(B.VertexBuffer.NormalKind),uv=mesh.getVerticesData(B.VertexBuffer.UVKind),indices=mesh.getIndices();if(!p||!n||!indices||n.length!==p.length)return null;const input=new Float64Array(p.length/3*8);for(let i=0;i<p.length/3;i++)input.set([p[i*3],p[i*3+1],p[i*3+2],n[i*3],n[i*3+1],n[i*3+2],uv?.[i*2]||0,uv?.[i*2+1]||0],i*8);return {input,indices};}
  function geometry(mesh,grid){
   let bucket=cache.get(mesh.geometry);if(!bucket){bucket=new Map();cache.set(mesh.geometry,bucket);}const old=bucket.get(grid);if(old&&!old.isDisposed())return old;
   const source=packed(mesh);if(!source)return null;
   let result;
   if(native){
    if(!native.reserve(source.input.length/8,source.indices.length))return null;
    native.inputView().set(source.input);native.indexView().set(source.indices);const count=native.simplify(source.input.length/8,source.indices.length,grid);
    if(count<0)throw Error('静态 LOD 简化失败');result={vertices:native.outputView().slice(),indices:native.outputIndexView().slice(0,count)};counters.lodNativeBuilds++;
   }else {result=root.ArkGlideGeometryCluster.simplify(source.input,source.indices,grid);counters.lodJSBuilds++;}
   if(result.indices.length<3||result.indices.length>=source.indices.length*.95)return null;
   const data=new B.VertexData(),count=result.vertices.length/8;data.positions=new Float32Array(count*3);data.normals=new Float32Array(count*3);data.uvs=new Float32Array(count*2);data.indices=result.indices;
   for(let i=0;i<count;i++){data.positions.set(result.vertices.subarray(i*8,i*8+3),i*3);data.normals.set(result.vertices.subarray(i*8+3,i*8+6),i*3);data.uvs.set(result.vertices.subarray(i*8+6,i*8+8),i*2);}
   const g=new B.Geometry('arkglide:lod-geometry:'+mesh.uniqueId+':'+grid,scene,data,false);bucket.set(grid,g);return g;
  }
  function prepare(){for(const [mesh,record]of records)for(const level of record.levels){level.material=mesh.material;level.receiveShadows=mesh.receiveShadows;level.visibility=mesh.visibility;}}
  async function sync(nodes,definitions){
   const token=++generation,wanted=new Set(),tasks=[];counters.lodSkippedMeshes=0;
   for(const node of definitions){
    if(!node.optimization?.lod?.enabled)continue;
    const object=nodes.get(node.id),meshes=node.type==='mesh'?[object]:object?.getChildMeshes(false).filter(m=>m.metadata?.arkglideId===node.id&&m.getTotalVertices()>0)||[];
    for(const mesh of meshes){if(!mesh||!eligible(node,mesh)){counters.lodSkippedMeshes++;continue;}wanted.add(mesh);const signature=JSON.stringify(node.optimization.lod.levels),old=records.get(mesh);if(old&&old.geometry===mesh.geometry&&old.signature===signature)continue;if(old)release(mesh,old);if(mesh.getLODLevels().length){counters.lodSkippedMeshes++;continue;}tasks.push({node,mesh,signature});}
   }
   for(const [mesh,record]of records)if(!wanted.has(mesh)||mesh.isDisposed())release(mesh,record);
   if(tasks.length){
    if(!modulePromise)modulePromise=Promise.resolve().then(()=>options.loadModule?.()).catch(()=>null);
    const module=await modulePromise;if(dead||token!==generation)return;if(!native&&module?.GeometryBatch)native=new module.GeometryBatch();
    for(const {node,mesh,signature}of tasks){
     if(dead||token!==generation||mesh.isDisposed())return;
     const levels=[];
     for(const setting of node.optimization.lod.levels){
      const g=geometry(mesh,setting.grid);if(!g)continue;
      const level=new B.Mesh('arkglide:lod:'+node.id+':'+setting.distance,scene);g.applyToMesh(level);level.material=mesh.material;level.isPickable=false;level.metadata={arkglideRenderInternal:true,arkglideLOD:true};mesh.addLODLevel(setting.distance,level);levels.push(level);
     }
     records.set(mesh,{levels,signature,geometry:mesh.geometry});if(!levels.length)counters.lodSkippedMeshes++;
     await new Promise(resolve=>setTimeout(resolve,0));
    }
   }
   counters.lodMeshes=[...records.values()].filter(r=>r.levels.length>0).length;counters.lodLevels=[...records.values()].reduce((n,r)=>n+r.levels.length,0);prepare();
  }
  return {sync,prepare,clear,dispose(){dead=true;clear();},stats:()=>({...counters})};
 }
 root.ArkGlideSceneOptimization={create};
})(globalThis);
