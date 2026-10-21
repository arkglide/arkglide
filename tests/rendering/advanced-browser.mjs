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
  const settle=async()=>{
    await frame.waitForFunction(()=>scene.isReady()&&scene.activeCamera._postProcesses.filter(Boolean).every(p=>p.isReady()));
    await frame.evaluate(()=>new Promise(resolve=>{let frames=0;const token=scene.onAfterRenderObservable.add(()=>{if(++frames===3){scene.onAfterRenderObservable.remove(token);resolve();}});}));
  };
  const image=()=>frame.evaluate(async()=>{
    const e=scene.getEngine(),width=e.getRenderWidth(),height=e.getRenderHeight(),pixels=await e.readPixels(0,0,width,height);let sum=0,squared=0,difference=0;
    for(let i=0;i<pixels.length;i+=4){const value=(pixels[i]+pixels[i+1]+pixels[i+2])/3;sum+=value;squared+=value*value;if(globalThis.__advancedPixels?.length===pixels.length)for(let k=0;k<3;k++)difference+=Math.abs(pixels[i+k]-globalThis.__advancedPixels[i+k]);}
    globalThis.__advancedPixels=pixels;const mean=sum/(width*height);
    return {mean,variance:squared/(width*height)-mean*mean,difference,divisor:e._gl.getVertexAttrib(0,e._gl.VERTEX_ATTRIB_ARRAY_DIVISOR),activeParticles:scene.particleSystems[0].getActiveCount()};
  });
  await frame.locator('#renderCanvas').click();await page.keyboard.press('3');await frame.waitForFunction(()=>sceneAdapter.rendering.stats().ssrEnabled,undefined,{timeout:30000});
  await settle();const highImage=await image();
  const high=await frame.evaluate(()=>({...sceneAdapter.rendering.stats(),...portalRuntime.stats()}));assert.ok(high.planarRenderedPixels<=4194304);
  // GPU-particle shader rebinding used to leave position divisor=1, freezing
  // High's image and making the next resize/switch permanently black.
  await page.keyboard.press('1');await frame.waitForFunction(()=>sceneAdapter.rendering.stats().renderQuality==='low');await settle();const lowImage=await image();
  await page.keyboard.press('3');await frame.waitForFunction(()=>sceneAdapter.rendering.stats().ssrEnabled);await settle();const highAgainImage=await image();
  await frame.evaluate(()=>{scene.activeCamera.position.x+=.5;});await settle();const movedImage=await image();
  for(const sample of [highImage,lowImage,highAgainImage,movedImage]){assert.ok(sample.mean>20,'quality switch must present scene color');assert.ok(sample.variance>25,'scene must not become a flat clear color');assert.equal(sample.divisor,0);assert.ok(sample.activeParticles>0);}
  assert.ok(movedImage.difference>10000,'High must continue presenting camera movement');
  await page.screenshot({path:new URL('work/advanced-rendering-lab.png',root).pathname});
  await page.locator('iframe').evaluate(iframe=>iframe.contentWindow.postMessage({type:'stop',runId:globalThis.__arkglidePlayer?.getState?.().runId},'*'));
  await frame.waitForFunction(()=>!running&&sceneAdapter.rendering.stats().planarReflections===0);
  const stopped=await frame.evaluate(()=>({...sceneAdapter.rendering.stats(),particles:scene.particleSystems.length,depthTargets:Object.keys(scene._depthRenderer||{}).length}));
  assert.equal(stopped.atmosphereSky,false);assert.equal(stopped.picturePipelines,0);assert.equal(stopped.particles,0);assert.equal(stopped.depthTargets,0);assert.deepEqual(errors,[]);
  await fs.writeFile(new URL('work/advanced-rendering-static-results.json',root),JSON.stringify({initial,high,highImage,lowImage,highAgainImage,movedImage,stopped},null,2));
 }finally{await page.close();}
});
