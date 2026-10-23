import test from 'node:test';import assert from 'node:assert/strict';import * as B from '@babylonjs/core';
import '../src/engine/rendering-config.js';import '../src/engine/rendering-runtime.js';
import '../src/engine/static-instances.js';import '../src/engine/scene-runtime.js';
const material=(id='rock',patch={})=>({id,name:id,baseColor:'#BB6633',emissiveColor:'#000000',metallic:0,roughness:.7,alpha:1,doubleSided:false,uvScale:{u:1,v:1},...patch});
const node=(id,patch={})=>({id,name:id,type:'mesh',primitive:'box',materialId:'rock',transform:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},optimization:{instancing:true},...patch});
function setup(hardware=true){const engine=new B.NullEngine(),scene=new B.Scene(engine);engine.getCaps().instancedArrays=hardware;const adapter=ArkGlideScene.createSceneAdapter(B,scene);return {engine,scene,adapter,close(){adapter.dispose();scene.dispose();engine.dispose();}};}
test('instance configuration is explicit, boolean and restricted to geometry nodes',()=>{
 for(const value of [1,'true',null])assert.throws(()=>ArkGlideRenderingConfig.validateNode(node('bad',{optimization:{instancing:value}})));
 assert.throws(()=>ArkGlideRenderingConfig.validateNode({type:'camera',optimization:{instancing:true}}));
 ArkGlideRenderingConfig.validateNode(node('valid'));
});
test('repeated primitive nodes share one native batch but keep transforms and managed material ownership',async()=>{
 const {scene,adapter,close}=setup();
 try{
  await adapter.sync([node('a'),node('b',{transform:{x:3,y:0,z:0}})],{}, {materials:{rock:material()}});
  const a=adapter.nodes.get('a'),b=adapter.nodes.get('b'),source=a.sourceMesh,mat=adapter.materials.get('rock');
  assert.ok(a.isAnInstance&&b.isAnInstance);assert.equal(a.sourceMesh,b.sourceMesh);assert.equal(source.isVisible,false);assert.equal(b.position.x,3);assert.equal(a.material,mat);assert.equal(b.material,mat);assert.equal(adapter.instanceStats().instanceBatches,1);assert.equal(adapter.instanceStats().instancedMeshes,2);
  adapter.prepareDestroy('a');a.dispose(false,true);
  assert.equal(adapter.nodes.has('a'),false);assert.equal(b.material,mat);assert.ok(scene.materials.includes(mat));assert.equal(adapter.instanceStats().instanceSkippedMeshes,0);assert.equal(adapter.instanceStats().instancedMeshes,1);
  b.dispose(false,true);assert.equal(source.isDisposed(),true);assert.equal(scene.meshes.length,0);assert.equal(adapter.instanceStats().instanceBatches,0);assert.ok(scene.materials.includes(mat));
  adapter.clear();assert.equal(scene.geometries.length,0);assert.equal(scene.materials.length,0);
 }finally{close();}
});
test('material and shadow edits regroup members and transparent edits safely restore ordinary meshes',async()=>{
 const {scene,adapter,close}=setup();const materials={rock:material(),blue:material('blue',{baseColor:'#2266DD'})};let nodes=[node('a'),node('b')];
 try{
  await adapter.sync(nodes,{}, {materials});const old=adapter.nodes.get('b');
  nodes=[nodes[0],{...nodes[1],materialId:'blue',receiveShadows:false}];await adapter.sync(nodes,{}, {materials});
  const b=adapter.nodes.get('b');assert.equal(old.isDisposed(),true);assert.equal(adapter.instanceStats().instanceBatches,2);assert.equal(b.material,adapter.materials.get('blue'));assert.equal(b.receiveShadows,false);
  await adapter.sync(nodes,{}, {materials:{...materials,blue:{...materials.blue,alpha:.5}}});assert.equal(adapter.nodes.get('b').isAnInstance,false);assert.equal(adapter.instanceStats().instanceSkippedMeshes,1);assert.equal(adapter.instanceStats().instanceBatches,1);
  adapter.clear();assert.equal(scene.meshes.length,0);assert.equal(scene.geometries.length,0);
 }finally{close();}
});
test('unsupported combinations and devices preserve normal geometry and diagnose requested fallbacks',async()=>{
 const {adapter,close}=setup();
 try{
  const nodes=[node('scripted',{scripts:['move.js']}),node('negative',{scale:{x:-1,y:1,z:1}}),node('lod',{optimization:{instancing:true,lod:{enabled:true,levels:[{distance:20,grid:4}]}}}),node('baked',{bakedLighting:{autoUV2:false,signature:'00000000'}}),node('mirror',{planarReflection:{enabled:true}}),node('dynamic',{physics:{motion:'dynamic'}})];
  await adapter.sync(nodes,{}, {materials:{rock:material()}});for(const n of nodes)assert.equal(adapter.nodes.get(n.id).isAnInstance,false);assert.equal(adapter.instanceStats().instanceSkippedMeshes,nodes.length);
 }finally{close();}
 const fallback=setup(false);try{await fallback.adapter.sync([node('a')],{},{materials:{rock:material()}});assert.equal(fallback.adapter.nodes.get('a').isAnInstance,false);assert.equal(fallback.adapter.instanceStats().instancingSupported,false);}finally{fallback.close();}
});
test('batched scene creation joins groups across slices and external source disposal completes without recursion',async()=>{
 const {scene,adapter,close}=setup();
 try{
  await adapter.syncBatched([node('a'),node('b'),node('c')],{},{materials:{rock:material()}},{},1);
  assert.equal(adapter.instanceStats().instanceBatches,1);assert.equal(adapter.instanceStats().instancedMeshes,3);
  adapter.nodes.get('a').sourceMesh.dispose(false,true);assert.equal(adapter.nodes.size,0);assert.equal(scene.meshes.length,0);assert.equal(adapter.instanceStats().instanceBatches,0);
 }finally{close();}
});
test('probe volumes only exclude intersecting batches and account for transformed parents and edits',async()=>{
 const {adapter,close}=setup();
 const probe={id:'pond',name:'Pond',mode:'realtime',position:{x:0,y:0,z:0},size:{x:8,y:8,z:8}};
 try{
  adapter.rendering.configure({probes:[probe]});
  const outside=node('outside',{transform:{x:20,y:0,z:0}}),inside=node('inside'),parent={id:'parent',type:'empty',transform:{x:20,y:0,z:0},rotation:{x:0,y:Math.PI/2,z:0},scale:{x:1,y:1,z:1}},child=node('child',{parentId:'parent',transform:{x:0,y:0,z:20}});
  const nearChild=node('nearChild',{parentId:'parent',transform:{x:0,y:0,z:-20}});
  await adapter.sync([outside,inside,parent,child,nearChild],{},{materials:{rock:material()}});
  assert.equal(adapter.nodes.get('outside').isAnInstance,true);
  assert.equal(adapter.nodes.get('inside').isAnInstance,false);
  // Babylon Y rotation moves this child further along X, away from the probe.
  assert.equal(adapter.nodes.get('child').isAnInstance,true);
  assert.equal(adapter.nodes.get('nearChild').isAnInstance,false);
  await adapter.sync([{...outside,transform:{x:0,y:0,z:0}},inside],{},{materials:{rock:material()}});
  assert.equal(adapter.nodes.get('outside').isAnInstance,false);
  assert.equal(adapter.instanceStats().instanceBatches,0);
 }finally{close();}
});
test('real Jolt triangle colliders built from native instances retain independent world hits',async()=>{
 await import('../public/lib/jolt-physics.js');await import('../src/engine/physics-advanced.js');await import('../src/engine/physics-runtime.js');await import('../src/engine/lifecycle-runtime.js');
 const J=await createArkGlideJolt(),{adapter,close}=setup();
 const body={motion:'static',shape:'mesh',size:{x:1,y:1,z:1},mass:1,friction:.5,restitution:0,sensor:false,lockRotation:true};
 const nodes=[node('a',{physics:body}),node('b',{physics:body,transform:{x:3,y:0,z:0}})],entities=new Map(nodes.map(n=>[n.id,{id:n.id,name:n.id,destroyed:false}]));
 const session=ArkGlideLifecycle.createSession(),owner=session.owner(null,'instance-collider');owner.attach({});session.startRecords([owner.record]);
 const physics=ArkGlidePhysics.createPhysics(J,B,{getObject:id=>adapter.nodes.get(id),find:id=>entities.get(id)});
 try{
  await adapter.sync(nodes,{}, {materials:{rock:material()}});assert.equal(adapter.nodes.get('a').isAnInstance,true);
  for(const n of nodes)physics.add(n);const api=physics.forOwner(owner);
  const a=api.raycast({x:0,y:3,z:0},{x:0,y:-5,z:0}),b=api.raycast({x:3,y:3,z:0},{x:0,y:-5,z:0});
  assert.equal(a.entity.id,'a');assert.equal(b.entity.id,'b');assert.ok(Math.abs(a.distance-2.5)<.02);assert.ok(Math.abs(b.distance-2.5)<.02);
 }finally{session.stop();physics.dispose();close();}
});
