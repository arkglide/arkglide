import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '@babylonjs/core';
import factory from '../src/wasm/arkglide_math.js';
import '../src/engine/geometry-cluster.js';
import '../src/engine/scene-optimization.js';
import '../src/engine/rendering-config.js';
import '../src/engine/rendering-runtime.js';
import '../src/engine/scene-runtime.js';
const module=await factory();
function source(){const data=B.VertexData.CreateSphere({segments:32}),vertices=data.positions.length/3,input=new Float64Array(vertices*8);for(let i=0;i<vertices;i++)input.set([...data.positions.slice(i*3,i*3+3),...data.normals.slice(i*3,i*3+3),...data.uvs.slice(i*2,i*2+2)],i*8);return {input,indices:data.indices};}
test('WASM static clustering matches JS with UV seams and conservative face winding',()=>{
 const data=source(),native=new module.GeometryBatch();
 try{assert.ok(native.reserve(data.input.length/8,data.indices.length));native.inputView().set(data.input);native.indexView().set(data.indices);
  for(const grid of [4,8,16]){const expected=ArkGlideGeometryCluster.simplify(data.input,data.indices,grid),n=native.simplify(data.input.length/8,data.indices.length,grid),actual=native.outputView();assert.equal(n,expected.indices.length);assert.deepEqual(Array.from(native.outputIndexView()),Array.from(expected.indices));assert.equal(actual.length,expected.vertices.length);let difference=0;for(let i=0;i<actual.length;i++)difference=Math.max(difference,Math.abs(actual[i]-expected.vertices[i]));assert.ok(difference<1e-6);assert.ok(n<data.indices.length*.6,'reduction at grid '+grid);assert.ok(Array.from(actual).every(Number.isFinite));}
  assert.equal(native.simplify(data.input.length/8,data.indices.length,0),-1);native.indexView()[0]=data.input.length;assert.equal(native.simplify(data.input.length/8,data.indices.length,4),-1);
 }finally{native.delete();}
});
test('shared base and LOD geometries retain independent transforms, materials and source picking meshes',async()=>{
 const engine=new B.NullEngine(),scene=new B.Scene(engine),camera=new B.FreeCamera('main',new B.Vector3(0,0,-5),scene),adapter=ArkGlideScene.createSceneAdapter(B,scene,{loadModule:async()=>module});
 const node=id=>({id,name:id,type:'mesh',primitive:'sphere',color:id==='a'?'#FF0000':'#00FF00',transform:{x:id==='a'?-1:1,y:0,z:0},optimization:{lod:{enabled:true,levels:[{distance:10,grid:8},{distance:30,grid:4}]}}});
 try{
  const definitions=[node('a'),node('b')];await adapter.sync(definitions);
  const a=adapter.nodes.get('a'),b=adapter.nodes.get('b');assert.equal(a.geometry,b.geometry);assert.notEqual(a.material,b.material);assert.notEqual(a.position.x,b.position.x);assert.equal(a.isPickable,true);
  assert.equal(a.getLOD(camera),a);camera.position.z=-50;camera.getViewMatrix(true);const lowA=a.getLOD(camera),lowB=b.getLOD(camera);assert.notEqual(lowA,a);assert.equal(lowA.geometry,lowB.geometry);assert.ok(lowA.getTotalIndices()<a.getTotalIndices()/2);assert.equal(a.getTotalVertices(),b.getTotalVertices());
  assert.equal(adapter.optimization.stats().lodNativeBuilds,2);assert.equal(adapter.optimization.stats().lodLevels,4);
  definitions[0]={...definitions[0],optimization:{shareGeometry:false,lod:{enabled:false}}};definitions[1]={...definitions[1],optimization:{lod:{enabled:false}}};await adapter.sync(definitions);assert.notEqual(adapter.nodes.get('a').geometry,adapter.nodes.get('b').geometry);assert.equal(adapter.nodes.get('a').getLODLevels().length,0);assert.equal(scene.meshes.some(m=>m.metadata?.arkglideLOD),false);
  adapter.clear();assert.equal(scene.meshes.length,0);assert.equal(scene.geometries.length,0);assert.equal(adapter.optimization.stats().lodLevels,0);
 }finally{adapter.dispose();scene.dispose();engine.dispose();}
});
test('deforming and externally configured LOD meshes retain their original geometry',async()=>{
 const engine=new B.NullEngine(),scene=new B.Scene(engine),adapter=ArkGlideScene.createSceneAdapter(B,scene);
 try{await adapter.sync([{id:'animated',name:'animated',type:'mesh',primitive:'sphere',scripts:['move.js'],optimization:{lod:{enabled:true,levels:[{distance:10,grid:4}]}}}]);assert.equal(adapter.nodes.get('animated').getLODLevels().length,0);assert.equal(adapter.optimization.stats().lodSkippedMeshes,1);}finally{adapter.dispose();scene.dispose();engine.dispose();}
});
test('LOD configuration rejects invalid distances and grid sizes',()=>{
 const validate=optimization=>ArkGlideRenderingConfig.validateNode({type:'mesh',optimization});
 assert.throws(()=>validate({shareGeometry:1}));assert.throws(()=>validate({lod:{enabled:true,levels:[]}}));assert.throws(()=>validate({lod:{enabled:true,levels:[{distance:10,grid:4},{distance:5,grid:2}]}}));assert.throws(()=>validate({lod:{enabled:true,levels:[{distance:10,grid:1}]}}));validate({shareGeometry:true,lod:{enabled:true,levels:[{distance:10,grid:4}]}});
});

test('clearing during a delayed WASM load cannot install LOD resources later',async()=>{
 let finish;const pendingModule=new Promise(resolve=>finish=resolve),engine=new B.NullEngine(),scene=new B.Scene(engine),adapter=ArkGlideScene.createSceneAdapter(B,scene,{loadModule:()=>pendingModule});
 try{const loading=adapter.sync([{id:'a',name:'a',type:'mesh',primitive:'sphere',optimization:{lod:{enabled:true,levels:[{distance:10,grid:4}]}}}]);await new Promise(resolve=>setTimeout(resolve,0));adapter.clear();finish(module);await loading;assert.equal(scene.meshes.length,0);assert.equal(scene.geometries.length,0);assert.equal(adapter.optimization.stats().lodLevels,0);}finally{adapter.dispose();scene.dispose();engine.dispose();}
});
