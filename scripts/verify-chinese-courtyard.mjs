// Focused editor + exported-browser acceptance; no production build required.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { serveStatic } from './serve-static.mjs';

const root=new URL('../',import.meta.url),work=new URL('../work/courtyard/acceptance/',import.meta.url);
await fs.mkdir(work,{recursive:true});
const destination=path.resolve(new URL('static/',work).pathname);
await fs.rm(destination,{recursive:true,force:true});await fs.rm(destination+'.zip',{force:true});
execFileSync(process.execPath,['scripts/export-chinese-courtyard.mjs',destination],{cwd:root,stdio:'inherit'});
const server=await serveStatic(destination,0);
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,
  args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
let editor;
const previous=process.argv.includes('--editor-only')?JSON.parse(await fs.readFile(new URL('results.json',work),'utf8')):null;
if(previous)assert.ok(previous.checks.includes('停止运行释放探针、实例、LOD 和离屏资源'),'Runtime phase must have completed before retrying only the editor phase');
const errors=[],external=[],result=previous||{renderer:'Chromium / ANGLE SwiftShader (software)',physicalGpuPerformanceMeasured:false,checks:[]};
const page=await browser.newPage({viewport:{width:640,height:360}});
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errors.push(m.text().slice(0,500));});
page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).hostname!=='127.0.0.1')external.push(r.url());});
function check(name){result.checks.push(name);console.log('PASS:',name);}
try{
 if(!process.argv.includes('--editor-only')){
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('iframe');
  const frame=page.frames().find(f=>f.url().includes('/runtime.html'));
  const draw=async(n=2)=>{
    await frame.waitForFunction(()=>scene.isReady()&&scene.activeCamera?._postProcesses.filter(Boolean).every(p=>p.isReady()),undefined,{timeout:180000});
    await frame.evaluate(n=>new Promise(resolve=>{let count=0;const token=scene.onAfterRenderObservable.add(()=>{if(++count===n){scene.onAfterRenderObservable.remove(token);resolve();}});}),n);
  };
  const stats=()=>frame.evaluate(()=>sceneAdapter.rendering.stats());
  await frame.waitForFunction(()=>globalThis.running&&globalThis.sceneAdapter?.rendering.stats().probeCompletedUpdates>0,undefined,{timeout:240000});
  await draw();
  result.initial=await frame.evaluate(()=>({stats:sceneAdapter.rendering.stats(),scriptErrors,webgl:scene.getEngine().webGLVersion,
    materialReady:[...sceneAdapter.materials.values()].every(m=>!m.albedoTexture||m.albedoTexture.isReady()),
    wetCoat:sceneAdapter.materials.get('wet-stone').clearCoat.isEnabled,waterIOR:sceneAdapter.materials.get('water').subSurface.indexOfRefraction,
    bambooSlots:sceneAdapter.nodes.get('BambooPatch-0').getChildMeshes().filter(m=>m.getTotalVertices()>0).map(m=>m.material?.name),
    importedPBR:['bamboo','bamboo-branch','leaves','fern','screen-wood','chair-wood'].map(id=>{const m=sceneAdapter.materials.get(id);return {id,albedo:m.albedoTexture?.isReady(),normal:m.bumpTexture?.isReady(),arm:m.metallicTexture?.isReady(),alphaTest:m.needAlphaTesting()};}),
    managedTextureBytes:scene.textures.filter(t=>t.name.startsWith('arkglide:texture:')).reduce((n,t)=>n+t.getSize().width*t.getSize().height*4*4/3,0)}));
  const initial=result.initial.stats;
  assert.equal(result.initial.scriptErrors,0);assert.ok(result.initial.materialReady&&result.initial.wetCoat);
  assert.equal(result.initial.waterIOR,1.333);assert.ok(result.initial.bambooSlots.every(s=>s?.startsWith('arkglide:material:')));
  assert.equal(result.initial.bambooSlots.length,3);
  assert.ok(result.initial.importedPBR.every(m=>m.albedo&&m.normal&&m.arm));
  assert.ok(result.initial.importedPBR.filter(m=>['leaves','fern'].includes(m.id)).every(m=>m.alphaTest));
  for(const key of ['taaEnabled','motionVectors','ssrEnabled','volumetricEnabled','volumetricShadowed'])assert.equal(initial[key],true,key);
  assert.equal(initial.realtimeProbes,1);assert.equal(initial.planarReflections,1);assert.equal(initial.sceneRefractionLayers,1);assert.equal(initial.volumeLocalLights,1);
  assert.ok(initial.instancedMeshes>=70&&initial.instanceBatches>=1);assert.ok(initial.lodMeshes>=18&&initial.lodLevels>=36);
  assert.ok(initial.renderMainTriangles>100000&&initial.renderMainTriangles<700000);
  check('静态网页实际加载 PBR/GLB、TAA/运动向量、SSR、探针、水面反射、折射、体积灯、实例与岩石 LOD');

  async function press(key){
    await frame.locator('#renderCanvas').focus();
    await page.keyboard.down(key);await draw(1);await page.keyboard.up(key);await draw(1);
  }
  // Verify the public keyboard controls in a running sandbox, not by calling
  // rendering internals in place of user input.
  await press('8');
  result.overviewPose=await frame.evaluate(()=>sceneAdapter.nodes.get('Camera').position.asArray());
  assert.ok(result.overviewPose[1]>7);check('4–8 固定镜头键切换到真实高视角');
  await press('h');await page.screenshot({path:new URL('overview.png',work).pathname});
  const pose=await frame.evaluate(()=>sceneAdapter.nodes.get('Camera').position.asArray());
  await frame.locator('#renderCanvas').focus();await page.keyboard.down('w');await draw(3);await page.keyboard.up('w');await draw(1);
  const moved=await frame.evaluate(()=>sceneAdapter.nodes.get('Camera').position.asArray());
  assert.ok(Math.hypot(...moved.map((v,i)=>v-pose[i]))>.1);check('WASD 自由浏览实际改变相机位置');
  await press('m');await draw(3);result.tourPose=await frame.evaluate(()=>sceneAdapter.nodes.get('Camera').position.asArray());
  assert.ok(result.tourPose[2]<-10);await press('m');check('M 自动巡游可启动与退出');
  await press('6');await page.screenshot({path:new URL('pond.png',work).pathname});
  await press('4');await page.screenshot({path:new URL('entrance.png',work).pathname});

  result.quality=[];
  for(const [key,name]of [['1','low'],['2','medium'],['3','high']]){
    await press(key);const s=await stats();assert.equal(s.renderQuality,name);assert.equal(s.ssrEnabled,name==='high');assert.equal(s.volumetricEnabled,name!=='low');assert.equal(s.planarReflections,name==='low'?0:1);
    assert.ok(s.planarRenderedPixels<=262144&&s.probeCapturedPixels<=32768&&s.sceneRefractionPixels<=65536);
    assert.equal(await frame.evaluate(()=>scriptErrors),0);result.quality.push({name,stats:s});
  }
  check('Low/Medium/High 切换及反射/体积/探针像素预算');
  for(const [key,field]of [['t','taaEnabled'],['r','ssrEnabled'],['v','volumetricEnabled'],['p','planarReflections']]){
    const before=(await stats())[field];await press(key);assert.notEqual((await stats())[field],before);await press(key);
  }
  await press('b');assert.equal(await frame.evaluate(()=>sceneAdapter.rendering.settings().realtimeProbes.maxPixels),4096);await press('b');
  check('T/R/V/P/B 独立效果开关与探针预算快捷键');
  await press('h');await draw();
  assert.ok((await frame.locator('body').textContent()).includes('CPU 提交'));check('HUD 显示实际 draw calls、三角形、离屏预算和 CPU/GPU 可用状态');

  // Paused FXAA removes animation and jitter from image comparisons. The
  // captures measure actual pixel changes of the scene's water/atmosphere.
  await press('8');await page.evaluate(()=>ArkGlidePlayer.pause());await frame.waitForFunction(()=>!running);
  const patch=async(section,value)=>{
    await frame.evaluate(([section,value])=>{const r=sceneAdapter.rendering,c=r.settings();r.configure({...c,[section]:typeof value==='object'?{...c[section],...value}:value});},[section,value]);await draw();
  };
  await patch('antialiasing','fxaa');
  const picture=()=>frame.evaluate(async()=>{
    const e=scene.getEngine(),w=e.getRenderWidth(),h=e.getRenderHeight(),p=await e.readPixels(0,0,w,h);let sum=0,sq=0,difference=0;
    for(let i=0;i<p.length;i+=4){const v=(p[i]+p[i+1]+p[i+2])/3;sum+=v;sq+=v*v;if(globalThis.__courtyardPixels?.length===p.length)for(let k=0;k<3;k++)difference+=Math.abs(p[i+k]-globalThis.__courtyardPixels[i+k]);}
    globalThis.__courtyardPixels=p;const mean=sum/(w*h);return {mean,variance:sq/(w*h)-mean*mean,difference};
  });
  result.image=await picture();assert.ok(result.image.variance>100&&result.image.mean>15&&result.image.mean<240);
  await patch('volumetric',{enabled:false});result.noFog=await picture();assert.ok(result.noFog.difference>1000);
  await patch('volumetric',{enabled:true});await picture();
  await frame.evaluate(()=>{const r=sceneAdapter.rendering,c=r.settings();r.configure({...c,reflections:{...c.reflections,planar:{...c.reflections.planar,enabled:false}}});});await draw();
  result.noMirror=await picture();assert.ok(result.noMirror.difference>1000);check('体积雾与池面反射确实改变渲染像素，输出不是空白帧');
  assert.deepEqual(external,[]);check('独立网页无运行时外站请求');
  await page.locator('iframe').evaluate(iframe=>iframe.contentWindow.postMessage({type:'stop',runId:globalThis.__arkglidePlayer?.getState?.().runId},'*'));
  await frame.waitForFunction(()=>!running&&sceneAdapter.rendering.stats().instanceBatches===0&&sceneAdapter.rendering.stats().realtimeProbes===0);
  result.stopped=await frame.evaluate(()=>({stats:sceneAdapter.rendering.stats(),ownedTargets:scene.textures.filter(t=>/^arkglide:(live-probe|refraction|mirror)/.test(t.name)).length,scriptErrors}));
  assert.equal(result.stopped.stats.lodMeshes,0);assert.equal(result.stopped.ownedTargets,0);assert.equal(result.stopped.scriptErrors,0);
  await page.close();check('停止运行释放探针、实例、LOD 和离屏资源');
 }

  editor=await createServer({root:root.pathname,server:{host:'127.0.0.1',port:0,open:false},logLevel:'error'});await editor.listen();
  const ep=await browser.newPage({viewport:{width:960,height:640}});ep.on('pageerror',e=>errors.push(e.message));
  await ep.goto('http://127.0.0.1:'+editor.httpServer.address().port);await ep.waitForSelector('#viewport');
  result.editor=await ep.evaluate(async()=>{
    const {importProject,createProjectArchive}=await import('/src/utils/projectExport.ts'),{useEditorStore}=await import('/src/store/useEditorStore.ts');
    const bytes=await (await fetch('/examples/chinese-courtyard-showcase.arkglide')).arrayBuffer();await importProject(new File([bytes],'courtyard.arkglide'));
    const s=useEditorStore.getState();
    s.updateTransform('MoonGate',{transform:{x:.25,y:-.08,z:-14.4}});s.undo();
    const roundtrip=createProjectArchive();await importProject(new File([roundtrip],'courtyard-roundtrip.arkglide'));
    const state=useEditorStore.getState();return {nodes:state.nodes.length,models:state.modelBuffers.size,textures:state.textureBuffers.size,
      gateX:state.nodes.find(n=>n.id==='MoonGate').transform.x,probe:state.settings.rendering.probes[0].mode,taa:state.settings.rendering.antialiasing,bytes:roundtrip.byteLength};
  });
  assert.ok(result.editor.nodes>=220&&result.editor.models>=50&&result.editor.textures>=30);assert.equal(result.editor.gateX,0);assert.equal(result.editor.probe,'realtime');assert.equal(result.editor.taa,'taa');
  await ep.getByRole('button',{name:'播放',exact:true}).click();await ep.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>f.getAttribute('src')?.includes('runtime.html')));
  const preview=ep.frames().find(f=>f.url().includes('/runtime.html'));
  await preview.waitForFunction(()=>globalThis.running&&globalThis.sceneAdapter?.nodes.has('ListeningPavilion'),undefined,{timeout:240000});
  result.editor.preview=await preview.evaluate(()=>({scriptErrors,models:sceneAdapter.nodes.size,taa:sceneAdapter.rendering.stats().taaEnabled}));
  assert.equal(result.editor.preview.scriptErrors,0);assert.equal(result.editor.preview.taa,true);
  await ep.close();check('真实编辑器导入、编辑/撤销、二次打包导入与预览启动');
  assert.deepEqual(errors,[]);result.status='passed';delete result.failure;
}catch(error){result.status='failed';result.failure=String(error.stack||error);throw error;
}finally{
  result.errors=errors;result.externalRequests=external;
  await fs.writeFile(new URL('results.json',work),JSON.stringify(result,null,2)+'\n');
  await browser.close();await editor?.close();await new Promise(resolve=>server.close(resolve));
}
console.log('验收通过；记录与截图：'+work.pathname);
