import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';import {serveStatic} from '../../scripts/serve-static.mjs';
const root=new URL('../../',import.meta.url),fixture=new URL('work/volumetric-static/',root);
await fs.rm(fixture,{recursive:true,force:true});await fs.rm(new URL('work/volumetric-static.zip',root),{force:true});
execFileSync(process.execPath,['scripts/create-volumetric-example.mjs'],{cwd:root});
execFileSync(process.execPath,['scripts/export-static-game.mjs','examples/volumetric-lab.arkglide','work/volumetric-static'],{cwd:root});
const server=await serveStatic(fixture.pathname,0);let browser;
test.before(async()=>{browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
test('independent volumetric lab renders shafts, toggles media and budgets, pauses and releases all owned targets',{timeout:180000},async()=>{
 const page=await browser.newPage({viewport:{width:960,height:640}}),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:'))external.push(r.url());});
 try{
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('iframe');const frame=page.frames().find(f=>f.url().includes('/runtime.html'));
  await frame.waitForFunction(()=>globalThis.running&&sceneAdapter?.rendering.stats().volumetricShadowed,undefined,{timeout:120000});
  await frame.evaluate(async()=>{globalThis.__volumeOn=Array.from(await scene.getEngine().readPixels(0,0,scene.getEngine().getRenderWidth(),scene.getEngine().getRenderHeight()));});
  const initial=await frame.evaluate(()=>({...sceneAdapter.rendering.stats(),errors:scriptErrors}));assert.equal(initial.errors,0);assert.equal(initial.volumetricSteps,48);assert.equal(initial.cascadedShadowLights,1);
  await page.screenshot({path:new URL('work/volumetric-lab.png',root).pathname});
  await frame.locator('#renderCanvas').click();await page.keyboard.press('v');await frame.waitForFunction(()=>!sceneAdapter.rendering.stats().volumetricEnabled);await page.waitForTimeout(300);
  const off=await frame.evaluate(async()=>{const image=Array.from(await scene.getEngine().readPixels(0,0,scene.getEngine().getRenderWidth(),scene.getEngine().getRenderHeight()));return {stats:sceneAdapter.rendering.stats(),difference:image.reduce((s,v,i)=>s+(i%4===3?0:Math.abs(v-globalThis.__volumeOn[i])),0)};});
  assert.ok(off.difference>10000);assert.equal(off.stats.volumetricShadowSize,0);await page.screenshot({path:new URL('work/volumetric-lab-off.png',root).pathname});
  await page.keyboard.press('v');await frame.waitForFunction(()=>sceneAdapter.rendering.stats().volumetricEnabled);
  await page.keyboard.press('1');await frame.waitForFunction(()=>sceneAdapter.rendering.stats().volumetricSteps===16&&!sceneAdapter.rendering.stats().volumetricShadowed);
  const low=await frame.evaluate(()=>sceneAdapter.rendering.stats());assert.ok(low.volumetricPixels<=262144);
  await page.keyboard.press('2');await frame.waitForFunction(()=>sceneAdapter.rendering.stats().volumetricSteps===32&&sceneAdapter.rendering.stats().volumetricShadowSize===512);
  await page.keyboard.press('5');await frame.waitForFunction(()=>scene.activeCamera.globalPosition.y>9);
  await page.evaluate(()=>ArkGlidePlayer.pause());await frame.waitForFunction(()=>!running);await page.evaluate(()=>ArkGlidePlayer.pause());await frame.waitForFunction(()=>running);
  await page.locator('iframe').evaluate(iframe=>iframe.contentWindow.postMessage({type:'stop',runId:globalThis.__arkglidePlayer?.getState?.().runId},'*'));
  await frame.waitForFunction(()=>!running&&!sceneAdapter.rendering.stats().volumetricEnabled);
  const stopped=await frame.evaluate(()=>({...sceneAdapter.rendering.stats(),depths:Object.keys(scene._depthRenderer||{}).length,targets:scene.textures.filter(t=>t.name.startsWith('arkglide:volume')).length,posts:scene.cameras.reduce((n,c)=>n+c._postProcesses.filter(Boolean).length,0)}));
  assert.equal(stopped.depths,0);assert.equal(stopped.targets,0);assert.equal(stopped.posts,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await fs.writeFile(new URL('work/volumetric-static-results.json',root),JSON.stringify({initial,off,low,stopped},null,2)+'\n');
 }finally{await page.close();}
});
