import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {serveStatic} from '../../scripts/serve-static.mjs';
const root=new URL('../../',import.meta.url),fixture=new URL('work/completion-focused/',root);
// This is one focused standalone scenario, not the full editor/static suites.
await fs.rm(fixture,{recursive:true,force:true});await fs.rm(new URL('work/completion-focused.zip',root),{force:true});
execFileSync(process.execPath,['scripts/create-rendering-completion-example.mjs'],{cwd:root});
execFileSync(process.execPath,['scripts/export-static-game.mjs','examples/rendering-completion-lab.arkglide',fixture.pathname],{cwd:root});
const server=await serveStatic(fixture.pathname,0);let browser;
test.before(async()=>{browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
test('standalone probes, velocity/TAA, layered refraction and volume compose and survive quality changes',{timeout:360000},async()=>{
 const page=await browser.newPage({viewport:{width:256,height:192}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errors.push(m.text().slice(0,500));});page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
 try{
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('iframe');const frame=page.frames().find(f=>f.url().includes('/runtime.html'));
  const settle=async(frames=4)=>{await frame.waitForFunction(()=>scene.isReady()&&scene.activeCamera?._postProcesses.filter(Boolean).every(p=>p.isReady()),undefined,{timeout:90000});await frame.evaluate(n=>new Promise(resolve=>{let count=0;const token=scene.onAfterRenderObservable.add(()=>{if(++count===n){scene.onAfterRenderObservable.remove(token);resolve();}});}),frames);};
  const stats=()=>frame.evaluate(()=>sceneAdapter.rendering.stats());
  const sample=()=>frame.evaluate(async()=>{
   const e=scene.getEngine(),w=e.getRenderWidth(),h=e.getRenderHeight(),p=await e.readPixels(0,0,w,h);let sum=0,sq=0,diff=0;
   for(let i=0;i<p.length;i+=4){const v=(p[i]+p[i+1]+p[i+2])/3;sum+=v;sq+=v*v;if(globalThis.__completionPixels?.length===p.length)for(let k=0;k<3;k++)diff+=Math.abs(p[i+k]-globalThis.__completionPixels[i+k]);}
   globalThis.__completionPixels=p;const mean=sum/(w*h);return {mean,variance:sq/(w*h)-mean*mean,difference:diff,divisor:e._gl.getVertexAttrib(0,e._gl.VERTEX_ATTRIB_ARRAY_DIVISOR)};
  });
  const patch=async section=>{await frame.evaluate(patch=>{const r=sceneAdapter.rendering,c=r.settings();r.configure({...c,...Object.fromEntries(Object.entries(patch).map(([k,v])=>[k,typeof v==='object'?{...c[k],...v}:v]))});},section);await settle();};
  await frame.waitForFunction(()=>globalThis.running&&globalThis.sceneAdapter?.rendering.stats().probeCompletedUpdates>=2,undefined,{timeout:90000});await settle();
  const initial=await stats(),initialImage=await sample();assert.equal(initial.taaEnabled,true);assert.equal(initial.motionVectors,true);assert.equal(initial.realtimeProbes,1);assert.ok(initial.probeCapturedFaces<=2&&initial.probeCapturedPixels<=32768);assert.equal(initial.sceneRefractionLayers,2);assert.equal(initial.layeredTransparency,true);assert.equal(initial.volumeClouds,true);assert.equal(initial.volumeLocalLights,2);assert.equal(await frame.evaluate(()=>visualsRuntime.stats().gpuParticleSystems),1);
  const captures=await frame.evaluate(()=>new Promise(resolve=>{let draws=0,frames=0;const values=[],targets=scene.textures.filter(t=>t.name.startsWith('arkglide:refraction:')),tokens=targets.map(t=>[t,t.onBeforeBindObservable.add(()=>draws++)]);const token=scene.onAfterRenderObservable.add(()=>{if(frames++>0)values.push(draws);draws=0;if(frames===4){scene.onAfterRenderObservable.remove(token);for(const[t,k]of tokens)t.onBeforeBindObservable.remove(k);resolve(values);}});}));assert.ok(captures.every(n=>n===2),'each refraction layer must capture once per main frame');
  const velocity=await frame.evaluate(async()=>{const p=scene.prePassRenderer,t=p.defaultRT.textures[p.getIndex(11)],data=await t.readPixels();let sum=0,max=0,finite=true;for(let i=0;i<data.length;i+=4){sum+=Math.abs(data[i])+Math.abs(data[i+1]);max=Math.max(max,Math.abs(data[i]),Math.abs(data[i+1]));finite&&=Number.isFinite(data[i])&&Number.isFinite(data[i+1]);}return {sum,max,finite};});assert.ok(velocity.finite&&velocity.sum>0,'moving object must write real motion vectors '+JSON.stringify(velocity));
  await page.evaluate(()=>ArkGlidePlayer.pause());await frame.waitForFunction(()=>!running);await settle(12);
  const pausedTime=await frame.evaluate(()=>scene._arkglideRenderTime);await settle(3);assert.equal(await frame.evaluate(()=>scene._arkglideRenderTime),pausedTime);
  // Freeze all animation and choose FXAA so each image difference measures the
  // requested effect, rather than jitter, wind or the moving emitter.
  await patch({antialiasing:'fxaa',realtimeProbes:{transition:0}});
  const cube=()=>frame.evaluate(async()=>{
   const t=sceneAdapter.nodes.get('Reflector').material.reflectionTexture,data=await t.readPixels(1);let red=0,blue=0;
   for(let i=0;i<data.length;i+=4){red+=data[i];blue+=data[i+2];}return {red,blue,texture:t.name};
  });
  const refresh=async()=>{const n=(await stats()).probeCompletedUpdates;await frame.evaluate(()=>sceneAdapter.rendering.refreshProbes('live'));await frame.waitForFunction(n=>sceneAdapter.rendering.stats().probeCompletedUpdates>n,n);await settle();};
  await refresh();const redCube=await cube();await frame.evaluate(()=>{sceneAdapter.materials.get('red').albedoColor.set(0,0,1);sceneAdapter.materials.get('red').emissiveColor.set(0,0,1);});await refresh();const blueCube=await cube();
  assert.ok(blueCube.blue>redCube.blue+.1&&blueCube.red<redCube.red-.1,'completed cube must capture a material change');
  await frame.evaluate(()=>{sceneAdapter.materials.get('red').albedoColor.copyFrom(BABYLON.Color3.FromHexString('#F52312'));sceneAdapter.materials.get('red').emissiveColor.copyFrom(BABYLON.Color3.FromHexString('#F52312'));});await refresh();const combinedImage=await sample();
  await patch({clouds:{enabled:false}});const noCloudImage=await sample();assert.ok(noCloudImage.difference>10000,'cloud integration must change the sky');
  await patch({volumeLighting:{maxLocalLights:0}});const noLocalImage=await sample();assert.ok(noLocalImage.difference>100,'local scattering must affect pixels');
  await patch({volumeLighting:{maxLocalLights:2,multipleScattering:0}});await sample();
  await patch({volumeLighting:{multipleScattering:.4}});const multipleImage=await sample();assert.ok(multipleImage.difference>50,'higher scattering orders must contribute');
  await patch({refraction:{enabled:false}});const envRefractionImage=await sample();assert.ok(envRefractionImage.difference>1000,'scene refraction must sample scene geometry');
  await patch({refraction:{enabled:true}});const sceneRefractionImage=await sample();
  // Recreate OIT once, exercising ownership and native scene-component reuse.
  await patch({transparency:{enabled:false}});await patch({transparency:{enabled:true}});assert.equal((await stats()).layeredTransparency,true);
  await patch({antialiasing:'taa',clouds:{enabled:true}});const beforeCut=await stats();
  await frame.evaluate(()=>{scene.activeCamera.position.x+=8;});await settle();const afterCut=await stats();assert.ok(afterCut.taaHistoryResets>beforeCut.taaHistoryResets);
  await frame.evaluate(()=>{scene.activeCamera.position.x-=8;});await settle();
  const quality=[];
  for(const name of ['high','low','high']){
   await frame.evaluate(name=>sceneAdapter.rendering.configure(ArkGlideRenderingConfig.preset(sceneAdapter.rendering.settings(),name)),name);await settle();const state=await stats(),picture=await sample();quality.push({name,state,picture});
   assert.equal(state.taaEnabled,true);assert.ok(picture.mean>10&&picture.variance>20,'quality switch must present a nonblank frame');assert.equal(picture.divisor,0);assert.ok(state.probeCapturedPixels<=sceneBudget(name));
  }
  await frame.evaluate(()=>{scene.activeCamera.position.x+=.7;});await settle();const movedImage=await sample();assert.ok(movedImage.difference>10000,'high quality must continue presenting movement');
  await page.screenshot({path:new URL('work/rendering-completion-lab.png',root).pathname});
  await page.locator('iframe').evaluate(iframe=>iframe.contentWindow.postMessage({type:'stop',runId:globalThis.__arkglidePlayer?.getState?.().runId},'*'));
  await frame.waitForFunction(()=>!running&&sceneAdapter.rendering.stats().realtimeProbes===0);const stopped=await frame.evaluate(()=>({...sceneAdapter.rendering.stats(),probes:scene.reflectionProbes?.length||0,ownedTextures:scene.textures.filter(t=>/^arkglide:(live-probe|refraction)/.test(t.name)).length,depth:Object.keys(scene._depthRenderer||{}).length,prepass:!!scene.prePassRenderer,oit:!!scene._depthPeelingRenderer,scriptErrors}));
  assert.equal(stopped.probes,0);assert.equal(stopped.ownedTextures,0);assert.equal(stopped.depth,0);assert.equal(stopped.prepass,false);assert.equal(stopped.oit,false);assert.equal(stopped.scriptErrors,0);assert.deepEqual(errors,[]);
  assert.ok(requests.every(url=>new URL(url).hostname==='127.0.0.1'),'standalone must use local resources');
  await fs.writeFile(new URL('work/rendering-completion-results.json',root),JSON.stringify({initial,initialImage,velocity,captures,redCube,blueCube,combinedImage,noCloudImage,noLocalImage,multipleImage,envRefractionImage,sceneRefractionImage,beforeCut,afterCut,quality,movedImage,stopped,errors,requestCount:requests.length,physicalGpuPerformanceMeasured:false},null,2));
 }catch(error){console.error(JSON.stringify({errors,boot:await page.locator('#loadingLog').textContent().catch(()=>null)}));throw error;}finally{await page.close();}
});
function sceneBudget(name){return name==='high'?262144:16384;}
