import test from 'node:test';
import assert from 'node:assert/strict';
import * as Babylon from '@babylonjs/core';
import '../src/engine/rendering-config.js';
import '../src/engine/realtime-probes.js';
const C=globalThis.ArkGlideRenderingConfig;
const probe=(id='a')=>({id,name:id,mode:'realtime',position:{x:0,y:2,z:0},size:{x:10,y:8,z:10},resolution:32,interval:0,blendDistance:1});
test('new rendering fields round-trip and old material/config defaults retain their behavior',()=>{
 const old=C.settings();assert.equal(old.antialiasing,'none');assert.equal(old.clouds.enabled,false);assert.equal(old.refraction.enabled,false);assert.equal(old.transparency.enabled,false);assert.equal(old.volumeLighting.multipleScattering,0);assert.equal(C.material({transmission:{enabled:true}}).transmission.source,'environment');
 const c=C.settings({antialiasing:'taa',probes:[probe()],clouds:{enabled:true},refraction:{enabled:true},transparency:{enabled:true}});C.validateResources(c,{textures:[]});assert.deepEqual(C.settings(JSON.parse(JSON.stringify(c))),c);assert.equal(C.preset(c,'high').antialiasing,'taa');assert.equal(C.selectProbe({x:0,y:2,z:0},c.probes),0);assert.equal(C.selectProbe({x:0,y:2,z:0},c.probes,'a'),-1);assert.equal(C.selectProbe({x:6,y:2,z:0},c.probes),-1);
 assert.throws(()=>C.settings({probes:[{...probe(),mode:'static'}]}));assert.throws(()=>C.settings({realtimeProbes:{facesPerFrame:7}}));assert.throws(()=>C.settings({refraction:{maxLayers:99}}));assert.throws(()=>C.settings({clouds:{lightSteps:99}}));assert.throws(()=>C.material({transmission:{source:'invalid'}}));
});
test('probe scheduler publishes six complete faces, bounds pixel/faces and alternates peers before reusing a cube',()=>{
 let disposed=0,wasmSelections=0;const draws=[];
 class ReflectionProbe{
  constructor(name,size){this.position=Babylon.Vector3.Zero();const texture=this.cubeTexture={name,getSize:()=>({width:size,height:size}),_renderToTarget:face=>draws.push({name,face}),render(){for(let face=0;face<6;face++)this._renderToTarget(face);},isReadyForRendering:()=>true};this.texture=texture;}
  dispose(){disposed++;}
 }
 const engine={webGLVersion:2,isWebGPU:false,getCaps:()=>({textureLOD:true,maxCubemapTextureSize:1024,textureHalfFloatRender:true})};
 const scene={getEngine:()=>engine,activeCamera:{globalPosition:Babylon.Vector3.Zero(),minZ:.1,maxZ:100},meshes:[],_arkglideRenderTime:0};
 const runtime=globalThis.ArkGlideRealtimeProbes.create({...Babylon,ReflectionProbe},scene,{renderCompute:{select(list,planes){wasmSelections++;assert.equal(planes.length,6);return list;}}});
 const c=C.settings({probes:[probe('a'),probe('b')],realtimeProbes:{facesPerFrame:2,maxPixels:2048,transition:.25}});
 for(let frame=1;frame<=6;frame++){
  scene._arkglideRenderTime=frame*.1;runtime.prepare(c.realtimeProbes,c.probes,frame);const s=runtime.stats();assert.ok(s.probeCapturedFaces<=2&&s.probeCapturedPixels<=2048);
  if(frame<6)assert.equal(runtime.binding('a'),null);
 }
 assert.equal(runtime.stats().probeCompletedUpdates,2);assert.equal(draws.length,12);assert.equal(wasmSelections,12);assert.equal(runtime.binding('a').mix,1);
 const first=runtime.binding('a').texture;
 for(let frame=7;frame<=8;frame++){scene._arkglideRenderTime=frame*.1;runtime.prepare(c.realtimeProbes,c.probes,frame);assert.equal(runtime.stats().probeCapturedFaces,0);}
 for(let frame=9;frame<=14;frame++){scene._arkglideRenderTime=frame*.1;runtime.prepare(c.realtimeProbes,c.probes,frame);}
 assert.notEqual(runtime.binding('a').texture,first);assert.equal(runtime.binding('a').previous,first);assert.equal(runtime.binding('a').mix,0);
 runtime.clear();assert.equal(disposed,4);assert.equal(runtime.stats().realtimeProbes,0);
});
test('probe resize/move cancels incomplete captures and releases both owned cubes',()=>{
 let disposed=0;
 class ReflectionProbe{constructor(name,size){this.position=Babylon.Vector3.Zero();this.cubeTexture={getSize:()=>({width:size}),_renderToTarget(){},render(){for(let i=0;i<6;i++)this._renderToTarget(i);},isReadyForRendering:()=>true};}dispose(){disposed++;}}
 const scene={getEngine:()=>({webGLVersion:2,getCaps:()=>({textureLOD:true})}),activeCamera:{globalPosition:Babylon.Vector3.Zero(),minZ:.1,maxZ:100},meshes:[]};
 const runtime=globalThis.ArkGlideRealtimeProbes.create({...Babylon,ReflectionProbe},scene),c=C.settings({probes:[probe()],realtimeProbes:{facesPerFrame:1,maxPixels:1024}});
 runtime.prepare(c.realtimeProbes,c.probes,1);c.probes[0].position.x=5;runtime.prepare(c.realtimeProbes,c.probes,2);assert.equal(disposed,2);assert.equal(runtime.binding('a'),null);assert.equal(runtime.stats().probeCompletedUpdates,0);
 runtime.prepare(c.realtimeProbes,[],3);assert.equal(disposed,4);assert.equal(runtime.stats().realtimeProbes,0);
});
