import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {serveStatic} from '../../scripts/serve-static.mjs';
const root=new URL('../../',import.meta.url),fixture=new URL('work/advanced-rendering-static/',root);
await fs.rm(fixture,{recursive:true,force:true});await fs.rm(new URL('work/advanced-rendering-static.zip',root),{force:true});
execFileSync(process.execPath,['scripts/create-advanced-rendering-example.mjs'],{cwd:root});
execFileSync(process.execPath,['scripts/export-static-game.mjs','examples/advanced-rendering-lab.arkglide','work/advanced-rendering-static'],{cwd:root});
const server=await serveStatic(fixture.pathname,0);let browser;
test.before(async()=>{browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
test('advanced lighting export combines atmosphere, GPU particles, layered materials, mirrors and live SSR presets',{timeout:120000},async()=>{
 const page=await browser.newPage({viewport:{width:512,height:384}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('iframe');const frame=page.frames().find(f=>f.url().includes('/runtime.html'));
  await frame.waitForFunction(()=>globalThis.running&&sceneAdapter?.rendering.stats().planarRenderedViews>0&&visualsRuntime?.stats().gpuParticleSystems>0,undefined,{timeout:90000});
  const initial=await frame.evaluate(()=>({...sceneAdapter.rendering.stats(),...visualsRuntime.stats(),errors:scriptErrors,coat:sceneAdapter.materials.get('paint').clearCoat.isEnabled,sheen:sceneAdapter.materials.get('rough').sheen.isEnabled,anisotropy:sceneAdapter.materials.get('metal').anisotropy.isEnabled,transmission:sceneAdapter.materials.get('glass').subSurface.isRefractionEnabled}));
  assert.equal(initial.atmosphereSky,true);assert.equal(initial.dofEnabled,true);assert.equal(initial.planarReflections,1);assert.equal(initial.gpuParticleSystems,1);assert.equal(initial.errors,0);assert.ok(initial.coat&&initial.sheen&&initial.anisotropy&&initial.transmission);
  await page.evaluate(()=>ArkGlidePlayer.pause());await frame.waitForFunction(()=>!running);
  const paused=await frame.evaluate(()=>scene.particleSystems[0]._actualFrame);await page.waitForTimeout(300);assert.equal(await frame.evaluate(()=>scene.particleSystems[0]._actualFrame),paused);
  await page.evaluate(()=>ArkGlidePlayer.pause());await frame.waitForFunction(()=>running);
  await frame.locator('#renderCanvas').click();await page.keyboard.press('3');await frame.waitForFunction(()=>sceneAdapter.rendering.stats().ssrEnabled,undefined,{timeout:30000});
  const high=await frame.evaluate(()=>({...sceneAdapter.rendering.stats(),...portalRuntime.stats()}));assert.ok(high.planarRenderedPixels<=4194304);
  await page.screenshot({path:new URL('work/advanced-rendering-lab.png',root).pathname});
  await page.locator('iframe').evaluate(iframe=>iframe.contentWindow.postMessage({type:'stop',runId:globalThis.__arkglidePlayer?.getState?.().runId},'*'));
  await frame.waitForFunction(()=>!running&&sceneAdapter.rendering.stats().planarReflections===0);
  const stopped=await frame.evaluate(()=>({...sceneAdapter.rendering.stats(),particles:scene.particleSystems.length,depthTargets:Object.keys(scene._depthRenderer||{}).length}));
  assert.equal(stopped.atmosphereSky,false);assert.equal(stopped.picturePipelines,0);assert.equal(stopped.particles,0);assert.equal(stopped.depthTargets,0);assert.deepEqual(errors,[]);
  await fs.writeFile(new URL('work/advanced-rendering-static-results.json',root),JSON.stringify({initial,high,stopped},null,2));
 }finally{await page.close();}
});
