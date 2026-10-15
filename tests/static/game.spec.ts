import fs from 'node:fs/promises';
import '../../src/engine/binary-runtime.js';
import {test,expect} from '@playwright/test';
const state=(page:any,value:string)=>expect(page.locator('body')).toHaveAttribute('data-state',value,{timeout:30000});
const start=async(page:any)=>{await page.waitForFunction(()=>!!(window as any).ArkGlidePlayer);await page.evaluate(()=>(window as any).ArkGlidePlayer.start());await state(page,'playing');return page.frames().find((f:any)=>f.url().includes('runtime.html?boot='))!;};
const stop=async(page:any)=>{await page.evaluate(()=>(window as any).ArkGlidePlayer.stop());await state(page,'stopped');expect(page.frames()).toHaveLength(1);};
async function dependency(kind:string) {
 const root=new URL('../../.static-test-fixtures/served/',import.meta.url),B=(globalThis as any).ArkGlideBinary;
 const manifest=JSON.parse(await fs.readFile(new URL('game-manifest.json',root),'utf8')),boot=B.decode(new Uint8Array(await fs.readFile(new URL(manifest.boot.path,root))));
 const nodes=[];for(const d of boot.scene)nodes.push(...B.decode(new Uint8Array(await fs.readFile(new URL(d.path,root)))));
 const id=kind==='model'?nodes.find((n:any)=>n.type==='model')?.id:(nodes.find((n:any)=>n.audioSource)?.audioSource.assetId||boot.preload.find((key:string)=>key.startsWith(kind+':'))?.slice(kind.length+1));
 for(const d of boot.indexes){const data=B.decode(new Uint8Array(await fs.readFile(new URL(d.path,root))));if(data[kind+':'+id])return data[kind+':'+id].path;}
 throw Error('Missing test dependency '+kind);
}
for(const url of ['/', '/deep/games/demo/'])test(`independent startup, full dependencies, audio/input, runtime prefab, restart and cleanup at ${url}`,async({page},info)=>{
 const errors:string[]=[],outside:string[]=[],logs:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>logs.push(m.text()));
 page.on('request',req=>{if(req.url().startsWith('http')&&!req.url().startsWith('http://127.0.0.1:5197'+url))outside.push(req.url());});
 await page.goto(url);
 const runtime=await start(page);
 await runtime.waitForFunction(()=> (window as any).scriptErrors===0 && (window as any).math.backend==='wasm' && (window as any).joltModule);
 expect(logs).toContain('export session counter 1');
 await expect.poll(()=>logs.includes('独立包中的字面量动态导入已就绪')).toBe(true);
 const initial=await runtime.evaluate(()=>({entities:(window as any).entityMap.size,controllers:(window as any).animationRuntime.stats().animationControllers,characters:(window as any).physicsRuntime.stats().physicsCharacters,images:document.querySelectorAll('[data-hud-id]').length}));
 expect(initial.controllers).toBe(2);expect(initial.characters).toBe(2);expect(initial.images).toBeGreaterThan(0);
 await runtime.locator('#renderCanvas').click({position:{x:150,y:150}});
 await expect.poll(()=>runtime.evaluate(()=>(window as any).audioRuntime.stats().audioState)).toBe('running');
 await runtime.locator('#renderCanvas').click({position:{x:150,y:150}});await page.keyboard.down('d');
 await runtime.waitForFunction(()=>(window as any).sceneAPI.find('Player').position.x>0.25);await page.keyboard.up('d');
 await page.evaluate(()=>(window as any).ArkGlidePlayer.pause());await state(page,'paused');
 await runtime.waitForFunction(()=>(window as any).desiredState==='paused' && !(window as any).running);
 const before=await runtime.evaluate(()=>(window as any).time.totalTime);await page.waitForTimeout(100);
 expect(await runtime.evaluate(()=>(window as any).time.totalTime)).toBe(before);
 await page.evaluate(()=>(window as any).ArkGlidePlayer.pause());await state(page,'playing');
 await runtime.evaluate(async()=>{const w=window as any;const template=w.prefabLibrary.api.list().find((p:any)=>p.name.includes('箱'));if(!template)throw Error('missing prefab');w.staticSpawn=await w.prefabLibrary.api.instantiate(template.id);});
 expect(await runtime.evaluate(()=>(window as any).entityMap.size)).toBeGreaterThan(initial.entities);
 await page.setViewportSize({width:900,height:700});
 expect(await runtime.locator('#renderCanvas').evaluate((e:HTMLCanvasElement)=>e.width)).toBeGreaterThan(0);
 await stop(page);const cleaned=await page.evaluate(()=>(window as any).ArkGlidePlayer.stats);
 for(const key of ['entities','meshes','scripts','timers','listeners','physicsBodies','physicsCharacters','physicsConstraints','audioVoices','audioBuffers','audioBlobURLs','hudElements','uiBlobURLs','animationControllers'])expect(cleaned[key],key).toBe(0);
 expect(cleaned.audioState).toBe('closed');
 for(let i=0;i<4;i++){const f=await start(page);expect(await f.evaluate(()=>(window as any).entityMap.size)).toBe(initial.entities);await stop(page);}
 expect(logs.filter(x=>x==='export session counter 1')).toHaveLength(5);
 expect(logs.some(x=>/^export session counter [2-9]/.test(x))).toBe(false);
 expect(outside).toEqual([]);expect(errors).toEqual([]);
 await info.attach('static-cleanup',{body:JSON.stringify({url,initial,cleaned,sessions:5,outside,errors},null,2),contentType:'application/json'});
});
test('missing asset HTTP errors are actionable and retry works',async({page})=>{
 const asset=await dependency('audio');await page.route('**/'+asset,route=>route.fulfill({status:404,body:'missing'}));await page.goto('/');await page.evaluate(()=>(window as any).ArkGlidePlayer.start());await state(page,'error');await expect(page.locator('#loadingLog')).toContainText('HTTP 404');expect(page.frames()).toHaveLength(1);
 await page.unroute('**/'+asset);await start(page);await stop(page);
});
test('truncated deployment file is detected before runtime startup',async({page})=>{
 await page.route('**/lib/jolt-physics.js',route=>route.fulfill({status:200,body:'broken'}));await page.goto('/');await page.evaluate(()=>(window as any).ArkGlidePlayer.start());await state(page,'error');await expect(page.locator('#loadingLog')).toContainText('运行时');expect(page.frames()).toHaveLength(1);
});
test('cancel downloading does not start later, then restart succeeds',async({page})=>{
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);let requested=false;
 const asset=await dependency('model');await page.route('**/'+asset,async route=>{requested=true;await gate;try{await route.continue();}catch{}});
 await page.goto('/');await page.evaluate(()=>(window as any).ArkGlidePlayer.start());await expect.poll(()=>requested).toBe(true);await stop(page);release();await page.unroute('**/'+asset);await page.waitForTimeout(100);await state(page,'stopped');await start(page);await stop(page);
});
test('cancel iframe/WASM initialization rejects stale ready messages',async({page})=>{
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);let requested=false;
 await page.route('**/runtime.html?boot=*',async route=>{requested=true;await gate;try{await route.continue();}catch{}});
 await page.goto('/');await page.evaluate(()=>(window as any).ArkGlidePlayer.start());await expect.poll(()=>requested).toBe(true);await stop(page);release();await page.unroute('**/runtime.html?boot=*');await start(page);await stop(page);
});
test('fixed aspect sizing and diagnostic startup failure are visible',async({page})=>{
 await page.route('**/game-manifest.json',async route=>{const response=await route.fetch();const manifest=await response.json();manifest.settings={...manifest.settings,fit:'contain',width:1280,height:720};await route.fulfill({json:manifest});});
 await page.goto('/deep/games/demo/');const runtime=await start(page);
 const rect=await page.locator('iframe').boundingBox();expect(rect!.width/rect!.height).toBeCloseTo(1280/720,2);await stop(page);
 // Corrupt a same-size binary scene chunk; the worker must reject its hash.
 const root=new URL('../../.static-test-fixtures/served/',import.meta.url),manifest=JSON.parse(await fs.readFile(new URL('game-manifest.json',root),'utf8'));
 const boot=(globalThis as any).ArkGlideBinary.decode(new Uint8Array(await fs.readFile(new URL(manifest.boot.path,root))));
 await page.route('**/'+boot.scene[0].path,async route=>{const response=await route.fetch(),raw=new Uint8Array(await response.body());raw[raw.length-1]^=1;await route.fulfill({body:Buffer.from(raw)});});
 await page.evaluate(()=>(window as any).ArkGlidePlayer.start());await state(page,'error');await expect(page.locator('#loadingLog')).toContainText('校验失败');expect(page.frames()).toHaveLength(1);
});
