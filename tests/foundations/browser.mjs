import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {chromium}from 'playwright';import {RUNTIME_FILES,createStaticGame}from '../../src/export/static-game.mjs';import {serveStatic}from '../../scripts/serve-static.mjs';
const fixture=new URL('../../.foundations-browser-test/',import.meta.url);
const script=`export default ({scene,physics,visuals,surfaces,fields,levels,storage,saves,portals,time,triggers,assets})=>{
 const probe=globalThis.foundationProbe={ready:false,error:null};
 const body={motion:'dynamic',shape:'box',size:{x:1,y:1,z:1},mass:2,friction:.3,restitution:0,sensor:false,lockRotation:false,linearDamping:0,angularDamping:0};
 function box(id,position,scale,motion='static'){const e=scene.create('box',id);e.position=position;e.scale=scale;physics.add(e,{...body,motion});return e;}
 return {onStart(){(async()=>{await assets.load('texture','texture');
  time.timeScale=0;
  const wallA=box('wallA',{x:0,y:0,z:0},{x:10,y:10,z:.2}),wallB=box('wallB',{x:8,y:0,z:0},{x:.2,y:10,z:10}),actor=box('actor',{x:0,y:2,z:3},{x:.5,y:.5,z:.5},'dynamic');
  const texture=visuals.createTexture({assetId:'texture'});await texture.ready;const material=visuals.createMaterial({color:'#ffffff',emissive:'#224466',texture});material.apply(actor);
  surfaces.paint(wallA,{position:{x:0,y:0,z:.1},normal:{x:0,y:0,z:1},width:6,height:6,depth:.1,shape:'rectangle',tags:['portalable'],properties:{friction:0}});
  portals.addSurface(wallA,{canPlace:c=>surfaces.covers(c.entity,c.footprint,'portalable')});portals.addSurface(wallB);const a=portals.create({id:'A'}),b=portals.create({id:'B'});if(!a.place({x:0,y:0,z:3},{x:0,y:0,z:-6}).placed||!b.place({x:6,y:0,z:0},{x:4,y:0,z:0}).placed)throw Error('Placement failed');a.link(b);
  const volume=portals.projectVolume({origin:{x:0,y:0,z:3},direction:{x:0,y:0,z:-7},profile:[{x:-2,y:-.1},{x:2,y:-.1},{x:2,y:.1},{x:-2,y:.1}],thickness:.01});probe.path=volume.path;
  for(const segment of volume.segments){const mesh=visuals.createMesh(segment.geometry,{material});physics.add(mesh.entity,{...body,motion:'static',shape:'convex'});}
  visuals.createBeam({segments:portals.raycast({x:0,y:1,z:3},{x:0,y:0,z:-7}).segments,radius:.02,color:'#ff0000'});
  visuals.createParticles({capacity:32,rate:8,lifetime:[.5,1],size:[.03,.06],velocity:{min:{x:-1,y:0,z:0},max:{x:1,y:1,z:0}},colors:['#ff8800','#ffffff'],entity:actor});
  triggers.create({volumes:[{shape:{kind:'sphere',radius:2},position:{x:0,y:2,z:3}},{shape:{kind:'sphere',radius:2},position:{x:0,y:2,z:3}}],filterEntity:e=>e.id==='actor',onEnter:e=>{probe.triggerEntered=(probe.triggerEntered||0)+1;probe.triggerEntity=e.entity.id;}});
  fields.create({volumes:[{shape:{kind:'box',size:{x:2,y:2,z:2}},position:{x:0,y:2,z:3}}],mode:'acceleration',vector:{x:0,y:1,z:0}});
  levels.register('room',{prefabId:'room'});await levels.load('room');probe.level=levels.current().id;
  let plot={chapter:2};saves.register('plot',{version:1,capture:()=>plot,validate:s=>Number.isInteger(s.chapter),restore:s=>{plot=s;}});
  physics.setState(actor,{velocity:{x:2,y:0,z:0}});await saves.save('probe');plot.chapter=9;physics.teleport(actor,{x:5,y:2,z:3});await saves.load('probe');probe.chapter=plot.chapter;probe.restored=physics.getState(actor).position;probe.velocity=physics.getVelocity(actor);
  const previous=await storage.read('runs');probe.previousRuns=previous||0;await storage.write('runs',probe.previousRuns+1);probe.ready=true;
 })().catch(e=>{probe.error=e.message;});}};
};`;
const node=(id,extra={})=>({id,name:id,type:'mesh',primitive:'box',transform:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},visible:true,scripts:[],...extra});
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=','base64'));
const project={version:'1',name:'Foundations Validation',projectId:'foundations-browser-validation',scene:{nodes:[node('bootstrap',{type:'empty',scripts:['main.js']})]},scripts:{'main.js':script},assets:[],modelRefs:[],content:{textures:[{id:'texture',name:'test texture',mime:'image/png',byteLength:png.length}],prefabs:{room:{id:'room',name:'room',revision:1,rootId:'root',nodes:[node('root',{transform:{x:0,y:0,z:12}})],modelKeys:{}}},audio:[]},settings:{gravity:{x:0,y:0,z:0},fixedTimeStep:1/60,maxSubSteps:8,timeScale:1,fpsCap:30}};
await fs.rm(fixture,{recursive:true,force:true});await fs.mkdir(fixture,{recursive:true});
const runtime=Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async p=>[p,new Uint8Array(await fs.readFile(new URL('../../public/'+p,import.meta.url)))])));
const game=createStaticGame(project,{models:new Map(),textures:new Map([['texture',png]]),audio:new Map()},runtime);
for(const [name,raw]of Object.entries(game.files)){const target=new URL(name,fixture);await fs.mkdir(new URL('./',target),{recursive:true});await fs.writeFile(target,raw);}
const server=await serveStatic(fixture.pathname,0);let browser;
test.before(async()=>{browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});});
test.after(async()=>{await browser?.close();await new Promise(r=>server.close(r));});
test('independent opaque-origin runtime renders assets, injects every foundation API, restores saves and retains persistence across restart',{timeout:60000},async()=>{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(() => ArkGlidePlayer.start());await page.waitForFunction(()=>document.body.dataset.state==='playing');
  async function frameReady(){const frame=page.frames().find(f=>f.url().includes('runtime.html?boot='));await frame.waitForFunction(()=>foundationProbe?.ready||foundationProbe?.error);const probe=await frame.evaluate(()=>foundationProbe);assert.equal(probe.error,null);assert.equal(probe.chapter,2);assert.deepEqual(probe.path,['A']);assert.equal(probe.level,'room');assert.ok(Math.abs(probe.restored.x)<.001);assert.ok(Math.abs(probe.velocity.x-2)<.001);assert.equal(await frame.evaluate(()=>scriptErrors),0);return {frame,probe};}
  const first=await frameReady();assert.equal(first.probe.previousRuns,0);assert.ok(await first.frame.evaluate(()=>scene.particleSystems.length>0&&scene.textures.length>0));
  await first.frame.evaluate(()=>{time.timeScale=1;});await first.frame.waitForFunction(()=>fieldsRuntime.forOwner({record:{active:true}})&&physicsRuntime.stats().physicsBodies>0);
  await first.frame.waitForFunction(()=>foundationProbe.triggerEntered===1);assert.equal(await first.frame.evaluate(()=>foundationProbe.triggerEntity),'actor');
  await first.frame.evaluate(()=>{window.__beforeStopStats={physicsBodies:physicsRuntime.stats().physicsBodies};});
  await page.evaluate(() => ArkGlidePlayer.stop());await page.waitForFunction(()=>document.body.dataset.state==='stopped');
  const stats=await page.evaluate(()=>ArkGlidePlayer.stats);for(const name of ['physicsBodies','physicsFields','physicsTriggers','triggerMembers','surfacePatches','visualResources','checkpointProviders','storageRequests','scripts'])assert.equal(stats[name],0,name);
  await page.evaluate(() => ArkGlidePlayer.start());await page.waitForFunction(()=>document.body.dataset.state==='playing');const second=await frameReady();assert.equal(second.probe.previousRuns,1);assert.deepEqual(errors,[]);
  await page.evaluate(() => ArkGlidePlayer.stop());await page.waitForFunction(()=>document.body.dataset.state==='stopped');
 }finally{await page.close();}
});
