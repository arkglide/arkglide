import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';import {serveStatic} from '../../scripts/serve-static.mjs';
const root=new URL('../../',import.meta.url),folder=new URL('work/ktx2-static/',root),fixture=new URL('nested/game/',folder);
await fs.rm(folder,{recursive:true,force:true});
execFileSync(process.execPath,['scripts/create-ktx2-example.mjs'],{cwd:root});
execFileSync(process.execPath,['scripts/export-static-game.mjs','examples/ktx2-lab.arkglide',fileURLToPath(fixture)],{cwd:root});
const server=await serveStatic(fileURLToPath(folder),0);let browser;
test.before(async()=>{browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
for(const rgba of [false,true])test('offline subdirectory KTX2 export loads local WASM, '+(rgba?'RGBA fallback':'compressed GPU formats')+' and releases textures',{timeout:180000},async()=>{
 const page=await browser.newPage({viewport:{width:720,height:480}}),errors=[],external=[],failed=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{requests.push(r.url());if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:'))external.push(r.url());});page.on('response',r=>{if(r.status()>=400)failed.push(r.url());});
 if(rgba)await page.addInitScript(()=>{const timer=setInterval(()=>{if(globalThis.BABYLON?.KhronosTextureContainer2){BABYLON.KhronosTextureContainer2.DefaultDecoderOptions.forceRGBA=true;clearInterval(timer);}},0);});
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/nested/game/');await page.waitForSelector('iframe');const frame=page.frames().find(f=>f.url().includes('/runtime.html'));
  await frame.waitForFunction(()=>globalThis.running&&sceneAdapter?.rendering.stats().ktx2Textures===6&&sceneAdapter.rendering.stats().ktx2EstimatedGpuBytes>0,undefined,{timeout:120000});
  const initial=await frame.evaluate(()=>({stats:sceneAdapter.rendering.stats(),errors:scriptErrors,textures:scene.textures.filter(t=>t.metadata?.arkglideKTX2).map(t=>({name:t.name,size:t.getSize(),format:t.getInternalTexture().format,gamma:t.gammaSpace})),plugins:scene.materials.filter(m=>m.metadata?.arkglideKTX2NormalMaps).map(m=>m.name)}));
  assert.equal(initial.errors,0);assert.ok(initial.plugins.length>=2);assert.ok(initial.textures.every(t=>t.size.width===64&&t.size.height===64));assert.equal(initial.stats.ktx2CompressedTextures,rgba?0:6);
  assert.ok(requests.some(url=>url.includes('/nested/game/lib/ktx2/decoder-resources.js')));assert.ok(!requests.some(url=>/^https?:/.test(url)&&!url.includes('/nested/game/')));
  await page.screenshot({path:fileURLToPath(new URL('work/ktx2-lab-'+(rgba?'rgba':'compressed')+'.png',root))});
  await page.evaluate(()=>ArkGlidePlayer.pause());await frame.waitForFunction(()=>!running);await page.evaluate(()=>ArkGlidePlayer.pause());await frame.waitForFunction(()=>running);
  await page.locator('iframe').evaluate(iframe=>iframe.contentWindow.postMessage({type:'stop',runId:globalThis.__arkglidePlayer?.getState?.().runId},'*'));
  await frame.waitForFunction(()=>!running&&sceneAdapter.rendering.stats().ktx2Textures===0);
  const stopped=await frame.evaluate(()=>({stats:sceneAdapter.rendering.stats(),textures:scene.textures.filter(t=>t.metadata?.arkglideKTX2).length,materials:scene.materials.filter(m=>m.metadata?.arkglideKTX2NormalMaps).length}));assert.equal(stopped.textures,0);assert.equal(stopped.materials,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(failed,[]);
  await fs.writeFile(new URL('work/ktx2-static-'+(rgba?'rgba':'compressed')+'.json',root),JSON.stringify({initial,stopped,decoderRequests:requests.filter(r=>/^https?:/.test(r)&&r.includes('/ktx2/'))},null,2)+'\n');
 }finally{await page.close();}
});
