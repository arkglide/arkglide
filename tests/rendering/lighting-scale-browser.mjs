import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';import {serveStatic} from '../../scripts/serve-static.mjs';
const root=new URL('../../',import.meta.url),fixture=new URL('work/lighting-scale-static/',root);
await fs.rm(fixture,{recursive:true,force:true});await fs.rm(new URL('work/lighting-scale-static.zip',root),{force:true});
execFileSync(process.execPath,['scripts/create-lighting-scale-example.mjs'],{cwd:root});
execFileSync(process.execPath,['scripts/export-static-game.mjs','examples/lighting-scale-lab.arkglide','work/lighting-scale-static'],{cwd:root});
const server=await serveStatic(fixture.pathname,0);let browser;
test.before(async()=>{browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
test('independent baked lighting/LOD lab loads all helpers, switches cameras and cleans up CSM and LOD targets',{timeout:180000},async()=>{
 const page=await browser.newPage({viewport:{width:512,height:384}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('iframe');const frame=page.frames().find(f=>f.url().includes('/runtime.html'));
  await frame.waitForFunction(()=>globalThis.running&&sceneAdapter?.rendering.stats().lodLevels>=120&&sceneAdapter.rendering.stats().cascadedShadowLights===1,undefined,{timeout:120000});
  const initial=await frame.evaluate(()=>({stats:sceneAdapter.rendering.stats(),floor:{direct:sceneAdapter.materials.get('floor').directIntensity,uv:sceneAdapter.materials.get('floor').lightmapTexture.coordinatesIndex,baked:sceneAdapter.materials.get('floor').metadata.arkglideBakedDirectLighting},errors:scriptErrors}));
  assert.equal(initial.floor.direct,0);assert.equal(initial.floor.uv,1);assert.equal(initial.floor.baked,true);assert.equal(initial.errors,0);assert.equal(initial.stats.lodNativeBuilds,2);
  await frame.locator('#renderCanvas').click();await page.keyboard.press('5');await frame.waitForFunction(()=>scene.activeCamera.globalPosition.z<-45&&sceneAdapter.nodes.get('LOD-0').getLOD(scene.activeCamera)!==sceneAdapter.nodes.get('LOD-0'));
  await page.screenshot({path:new URL('work/lighting-scale-lab.png',root).pathname});
  const far=await frame.evaluate(()=>({stats:sceneAdapter.rendering.stats(),cameraZ:scene.activeCamera.globalPosition.z,source:sceneAdapter.nodes.get('LOD-0').getTotalIndices()/3,selected:sceneAdapter.nodes.get('LOD-0').getLOD(scene.activeCamera).getTotalIndices()/3}));assert.ok(far.selected<far.source/2);assert.ok(far.cameraZ<-45);
  await page.locator('iframe').evaluate(iframe=>iframe.contentWindow.postMessage({type:'stop',runId:globalThis.__arkglidePlayer?.getState?.().runId},'*'));
  await frame.waitForFunction(()=>!running&&sceneAdapter.rendering.stats().lodLevels===0&&sceneAdapter.rendering.stats().cascadedShadowLights===0);
  const stopped=await frame.evaluate(()=>({stats:sceneAdapter.rendering.stats(),lodMeshes:scene.meshes.filter(m=>m.metadata?.arkglideLOD).length,targets:scene.textures.filter(t=>t.name.includes('shadowMap')||t.name.startsWith('arkglide:texture:')).length}));assert.equal(stopped.lodMeshes,0);assert.equal(stopped.targets,0);assert.deepEqual(errors,[]);
  await fs.writeFile(new URL('work/lighting-scale-static-results.json',root),JSON.stringify({initial,far,stopped},null,2)+'\n');
 }finally{await page.close();}
});
