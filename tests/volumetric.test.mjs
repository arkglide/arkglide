import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '@babylonjs/core';
import '../src/engine/rendering-config.js';
import '../src/engine/atmosphere-runtime.js';
import '../src/engine/volumetric-runtime.js';
import '../src/engine/rendering-runtime.js';
const C=globalThis.ArkGlideRenderingConfig,V=globalThis.ArkGlideVolumetric;

test('volume remains opt-in, rejects unsafe budgets and preserves authored media across quality changes',()=>{
 assert.equal(C.settings().volumetric.enabled,false);
 for(const patch of [{enabled:1},{density:NaN},{density:-.1},{height:Infinity},{falloff:-1},{maxDistance:0},{color:'#fff'},{steps:100},{steps:32.5},{scale:0},{maxPixels:1},{maxPixels:16384.5},{shadowMapSize:8192},{shadowBias:-.1},{anisotropy:1},{noiseStrength:2},{noiseScale:0},{shadows:1},{unexpected:true}])assert.throws(()=>C.settings({volumetric:patch}));
 const input={volumetric:{enabled:true,density:.06,height:-3,lightIntensity:2}},high=C.preset(input,'high'),low=C.preset(high,'low'),medium=C.preset(low,'medium');
 assert.equal(high.volumetric.enabled,true);assert.equal(low.volumetric.enabled,true);
 assert.equal(medium.volumetric.density,.06);assert.equal(medium.volumetric.height,-3);assert.equal(medium.volumetric.lightIntensity,2);
 assert.ok(high.volumetric.steps>low.volumetric.steps);assert.equal(low.volumetric.shadows,false);assert.equal(medium.volumetric.shadows,true);
 assert.equal(input.volumetric.steps,undefined);
});
test('volume allocations respect pixel and GPU texture limits for wide, tall and high-DPI targets',()=>{
 for(const [width,height] of [[1,1],[1920,1080],[7680,4320],[50000,300],[300,50000]])for(const maxPixels of [16384,262144,4194304])for(const scale of [.25,.5,1]) {
  const target=V.budget(width,height,{maxPixels,scale},2048);
  assert.ok(target.width*target.height<=maxPixels);assert.ok(target.width<=2048&&target.height<=2048);assert.ok(target.width>=1&&target.height>=1);
 }
});
test('unsupported hosts retain distance fog and allocate no volume resources; script patches validate atomically',async()=>{
 const engine=new B.NullEngine(),scene=new B.Scene(engine),manager=globalThis.ArkGlideRendering.create(B,scene);
 new B.FreeCamera('main',B.Vector3.Zero(),scene);
 try {
  manager.configure({volumetric:{enabled:true},fog:{mode:'exp2'}});await manager.sync();manager.prepareFrame();
  assert.equal(manager.stats().volumetricEnabled,false);assert.equal(scene.fogMode,B.Scene.FOGMODE_EXP2);assert.equal(scene.textures.length,0);
  const owner={record:{active:true}},api=manager.forOwner(owner);api.setVolumetric({density:.1});assert.equal(api.getSettings().volumetric.density,.1);
  assert.throws(()=>api.setVolumetric({density:-1}));assert.equal(api.getSettings().volumetric.density,.1);
  assert.throws(()=>api.setVolumetric(null));owner.record.active=false;assert.throws(()=>api.setVolumetric({enabled:false}),/expired/);
  manager.clear();assert.equal(scene.fogMode,B.Scene.FOGMODE_NONE);
 }finally{manager.dispose();scene.dispose();engine.dispose();}
});
