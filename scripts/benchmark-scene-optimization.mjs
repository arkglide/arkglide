import fs from 'node:fs/promises';
import * as B from '@babylonjs/core';
import factory from '../src/wasm/arkglide_math.js';
import '../src/engine/geometry-cluster.js';
import '../src/engine/scene-benchmark-metrics.js';
const module=await factory(),native=new module.GeometryBatch(),cases=[],samples=15;
try{
 for(const segments of [16,32,64]){
  const data=B.VertexData.CreateSphere({segments}),vertices=data.positions.length/3,input=new Float64Array(vertices*8);for(let i=0;i<vertices;i++)input.set([...data.positions.slice(i*3,i*3+3),...data.normals.slice(i*3,i*3+3),...data.uvs.slice(i*2,i*2+2)],i*8);
  native.reserve(vertices,data.indices.length);
  const js=()=>ArkGlideGeometryCluster.simplify(input,data.indices,8),wasm=()=>{native.inputView().set(input);native.indexView().set(data.indices);const n=native.simplify(vertices,data.indices.length,8);if(n<0)throw Error('Native LOD failed');return {vertices:native.outputView().slice(),indices:native.outputIndexView().slice(0,n)};};
  const a=js(),b=wasm();if(a.indices.length!==b.indices.length||a.indices.some((n,i)=>n!==b.indices[i]))throw Error('LOD parity failed');let maxDifference=0;for(let i=0;i<a.vertices.length;i++)maxDifference=Math.max(maxDifference,Math.abs(a.vertices[i]-b.vertices[i]));if(maxDifference>1e-6)throw Error('Vertex parity failed');
  const times={javascript:[],wasmWithCopies:[]};for(let i=0;i<samples;i++){let start=performance.now();js();times.javascript.push(performance.now()-start);start=performance.now();wasm();times.wasmWithCopies.push(performance.now()-start);}
  cases.push({vertices,sourceTriangles:data.indices.length/3,lodTriangles:a.indices.length/3,maxDifference,javascriptMs:ArkGlideSceneBenchmarkMetrics.summary(times.javascript),wasmWithCopiesMs:ArkGlideSceneBenchmarkMetrics.summary(times.wasmWithCopies)});
 }
 const report={date:new Date().toISOString(),node:process.version,samples,scope:'Static LOD CPU clustering kernels, including input/output bridge copies. Excludes model decoding, Babylon object creation, GPU uploads and game FPS.',cases};const path=process.env.BENCH_OUTPUT||'work/scene-optimization-performance.json';await fs.mkdir(new URL('../work/',import.meta.url),{recursive:true});await fs.writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{native.delete();}
