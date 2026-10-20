import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';import {serveStatic} from '../../scripts/serve-static.mjs';
const root=new URL('../../',import.meta.url),fixture=new URL('work/instances-static/',root);
await fs.rm(fixture,{recursive:true,force:true});await fs.rm(new URL('work/instances-static.zip',root),{force:true});
execFileSync(process.execPath,['scripts/create-instance-example.mjs'],{cwd:root});
execFileSync(process.execPath,['scripts/export-static-game.mjs','examples/instance-lab.arkglide','work/instances-static'],{cwd:root});
const server=await serveStatic(fixture.pathname,0);let browser;
test.before(async()=>{browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
test('exported instance corridor combines volume, shadows, a real instance collider and complete cleanup',{timeout:180000},async()=>{
 const page=await browser.newPage({viewport:{width:640,height:480}}),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:'))external.push(r.url());});
 try{
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('iframe');const frame=page.frames().find(f=>f.url().includes('/runtime.html'));
  await frame.waitForFunction(()=>globalThis.running&&sceneAdapter?.rendering.stats().instancedMeshes===24&&sceneAdapter.rendering.stats().volumetricShadowed,undefined,{timeout:120000});
  const initial=await frame.evaluate(()=>{const hit=physicsRuntime.forOwner({record:{active:true}}).raycast({x:0,y:5,z:0},{x:0,y:-10,z:0});return {stats:sceneAdapter.rendering.stats(),floorInstance:sceneAdapter.nodes.get('Floor').isAnInstance,hit:hit?.entity.id,distance:hit?.distance,errors:scriptErrors,sources:scene.meshes.filter(m=>m.metadata?.arkglideInstanceSource).length};});
  assert.equal(initial.errors,0);assert.equal(initial.stats.instanceBatches,1);assert.equal(initial.floorInstance,true);assert.equal(initial.hit,'Floor');assert.ok(Math.abs(initial.distance-5)<.02);assert.equal(initial.sources,1);
  await page.screenshot({path:new URL('work/instances-lab.png',root).pathname});
  await frame.locator('#renderCanvas').click();await page.keyboard.press('1');await frame.waitForFunction(()=>sceneAdapter.rendering.stats().volumetricSteps===16);
  assert.equal(await frame.evaluate(()=>sceneAdapter.rendering.stats().instancedMeshes),24);
  await page.evaluate(()=>ArkGlidePlayer.pause());await frame.waitForFunction(()=>!running);await page.evaluate(()=>ArkGlidePlayer.pause());await frame.waitForFunction(()=>running);
  await page.locator('iframe').evaluate(iframe=>iframe.contentWindow.postMessage({type:'stop',runId:globalThis.__arkglidePlayer?.getState?.().runId},'*'));
  await frame.waitForFunction(()=>!running&&sceneAdapter.rendering.stats().instancedMeshes===0);
  const stopped=await frame.evaluate(()=>({stats:sceneAdapter.rendering.stats(),sources:scene.meshes.filter(m=>m.metadata?.arkglideInstanceSource).length,depths:Object.keys(scene._depthRenderer||{}).length}));assert.equal(stopped.sources,0);assert.equal(stopped.depths,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await fs.writeFile(new URL('work/instances-static-results.json',root),JSON.stringify({initial,stopped},null,2)+'\n');
 }finally{await page.close();}
});
