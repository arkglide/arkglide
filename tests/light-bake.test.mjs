import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '@babylonjs/core';
import {unzlibSync} from 'fflate';
import factory from '../src/wasm/arkglide_math.js';
import {bakeOptions,rasterizeLightmap,encodeLightmap,padLightmap,sceneLightingSignature} from '../src/engine/light-bake.mjs';
import '../src/engine/lighting-uv.js';
const module=await factory();
function bake(triangles,samples,lights,ao=0){const batch=new module.LightBakeBatch();try{assert.ok(batch.reserve(triangles.length/9,samples.length/6,lights.length/10));batch.triangleView().set(triangles);batch.sampleView().set(samples);batch.lightView().set(lights);assert.ok(batch.prepare(triangles.length/9));assert.ok(batch.bake(samples.length/6,lights.length/10,ao,5,.001));return {rgb:Array.from(batch.outputView()),rays:batch.rayCount()};}finally{batch.delete();}}
test('native BVH rays distinguish lit, blocked and reverse-facing diffuse samples',()=>{
 const light=[0,0,-1,0,2,1,.5,0,0,0],samples=[0,0,0,0,1,0,3,0,0,0,1,0,0,0,0,0,-1,0];
 const wall=[-1,1,-1,1,1,-1,0,1,1],result=bake(wall,samples,light);
 assert.deepEqual(result.rgb,[0,0,0,2,1,.5,0,0,0]);assert.equal(result.rays,2);
 assert.deepEqual(bake([],samples.slice(0,6),light).rgb,[2,1,.5]);
});
test('native hemispheric AO is deterministic and preserves open ambient',()=>{
 const hemi=[2,0,1,0,1,.5,.25,0,0,0],sample=[0,0,0,0,1,0];
 assert.deepEqual(bake([],sample,hemi,32).rgb,[1,.5,.25]);
 const roof=[-100,.5,-100,100,.5,-100,100,.5,100,-100,.5,-100,100,.5,100,-100,.5,100];
 const blocked=bake(roof,sample,hemi,32);assert.ok(blocked.rgb[0]<.1);assert.equal(blocked.rays,32);assert.deepEqual(blocked,bake(roof,sample,hemi,32));
});
test('native point lights attenuate by squared distance and validate malformed buffers',()=>{
 const light=[1,0,2,0,4,2,1,0,0,0],sample=[0,0,0,0,1,0],result=bake([],sample,light).rgb;assert.ok(Math.abs(result[0]-1)<.002);
 const b=new module.LightBakeBatch();try{assert.equal(b.reserve(1000001,1,1),false);assert.ok(b.reserve(1,1,1));b.triangleView()[0]=NaN;assert.equal(b.prepare(1),false);assert.equal(b.bake(2,0,0,1,.001),false);}finally{b.delete();}
});
test('all stock primitive UV2 layouts rasterize without overlapping surfaces',()=>{
 const engine=new B.NullEngine(),scene=new B.Scene(engine);
 try{for(const [primitive,builder]of [['box','CreateBox'],['sphere','CreateSphere'],['plane','CreateGround'],['cylinder','CreateCylinder'],['capsule','CreateCapsule'],['torus','CreateTorus']]){
  const mesh=B.MeshBuilder[builder](primitive,{},scene),uvs=ArkGlideLightingUV.generateUV2(B,mesh,primitive,false);
  const data=rasterizeLightmap({positions:mesh.getVerticesData('position'),normals:mesh.getVerticesData('normal'),indices:mesh.getIndices(),uvs},64);
  assert.ok(data.coverage>.15,primitive+' coverage');assert.equal(mesh.isVerticesDataPresent('uv2'),false);mesh.dispose();
 }}finally{scene.dispose();engine.dispose();}
});
test('UV raster rejects stacked surfaces and preserves interpolated normals',()=>{
 const quad={positions:[0,0,0,1,0,0,0,0,1],normals:[0,1,0,0,1,0,0,1,0],uvs:[0,0,1,0,0,1],indices:[0,1,2]},r=rasterizeLightmap(quad,32);assert.ok(r.pixels.length>400);assert.equal(r.samples[4],1);
 assert.throws(()=>rasterizeLightmap({...quad,positions:[...quad.positions,0,1,0,1,1,0,0,1,1],normals:[...quad.normals,...quad.normals],uvs:[...quad.uvs,...quad.uvs],indices:[0,1,2,3,4,5]},32),/重叠/);
});
test('linear PNG preserves dynamic range, vertical UV orientation and atlas padding',()=>{
 const rgb=new Float32Array(32*32*3);rgb.set([2,1,.5],0);padLightmap(rgb,new Uint32Array([0]),32,1);assert.equal(rgb[3],2);
 const {png,scale}=encodeLightmap(rgb,32);assert.equal(scale,2);assert.deepEqual(Array.from(png.slice(0,8)),[137,80,78,71,13,10,26,10]);
 let at=8,raw;while(at<png.length){const length=new DataView(png.buffer).getUint32(at);if(new TextDecoder().decode(png.slice(at+4,at+8))==='IDAT')raw=unzlibSync(png.slice(at+8,at+8+length));at+=length+12;}
 assert.deepEqual(Array.from(raw.slice(31*97+1,31*97+4)),[255,128,64]);assert.equal(raw[1],0);
});
test('bake configuration and stale signatures account for lights and parents',()=>{
 assert.throws(()=>bakeOptions({resolution:123}));assert.throws(()=>bakeOptions({bias:0}));
 const state={nodes:[{id:'light',intensity:1}],settings:{ambientColor:'#FFFFFF',ambientIntensity:.3}},signature=sceneLightingSignature(state);
 assert.equal(sceneLightingSignature({...state,nodes:[{...state.nodes[0],bakedLighting:{signature:'00000000'}}]}),signature);
 assert.notEqual(sceneLightingSignature({...state,nodes:[{id:'light',intensity:2}]}),signature);
 assert.equal(sceneLightingSignature({...state,nodes:[{intensity:1,id:'light'}]}),signature);
});
