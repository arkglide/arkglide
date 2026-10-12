import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {unzipSync, strFromU8} from 'fflate';
import {createServer} from 'vite';
import {RUNTIME_FILES, createStaticGame, validateScriptGraph, exportSettings} from '../src/export/static-game.mjs';
let project,maps,runtime,server;
before(async()=>{
  server=await createServer({server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
  const {normalizeProject}=await server.ssrLoadModule('/src/utils/projectValidation.ts');
  const archive=unzipSync(new Uint8Array(await fs.readFile(new URL('../examples/fourth-static.arkglide',import.meta.url))));
  project=normalizeProject(JSON.parse(strFromU8(archive['project.json'])));
  maps={models:new Map(project.modelRefs.map(r=>[r.assetId,archive['assets/'+r.fileName]?.slice().buffer])),textures:new Map(project.content.textures.map(t=>[t.id,archive['textures/'+encodeURIComponent(t.id)+'.bin'].slice().buffer])),audio:new Map(project.content.audio.map(a=>[a.id,archive['audio/'+encodeURIComponent(a.id)+'.bin'].slice().buffer]))};
  runtime=Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async p=>[p,new Uint8Array(await fs.readFile(new URL('../public/'+p,import.meta.url)))])));
});
after(async()=>{await server?.close();});
const build=(p=project,m=maps,r=runtime)=>createStaticGame(p,m,r);
test('independent package includes every runtime/WASM, module, material, HUD, animation and prefab dependency',()=>{
 const game=build(),zip=unzipSync(game.zip());
 assert.equal(Object.keys(zip).length,game.manifest.files.length+1);
 for(const file of game.manifest.files) assert.equal(zip[file.path].length,file.byteLength,file.path);
 assert.equal(game.manifest.wasm,'embedded-single-file');
 assert.ok(game.manifest.resources.some(r=>r.kind==='model'&&r.id.startsWith('prefab:')));
 assert.deepEqual(JSON.parse(strFromU8(zip['project.json'])).content,JSON.parse(JSON.stringify(project.content)));
 assert.ok(game.manifest.modules.graph['export-demo.js'].includes('lib/export-label.js'));
 assert.ok(!Object.keys(zip).some(p=>/react|monaco|vite|editor|benchmark/i.test(p)));
 assert.ok(!strFromU8(zip['runtime.html']).includes('src="/'));
});
test('missing runtime-only prefab model is rejected before a ZIP is produced',()=>{
 const models=new Map(maps.models),id=[...models.keys()].find(k=>k.startsWith('prefab:'));models.delete(id);
 assert.throws(()=>build(project,{...maps,models}),/资源缺失/);
});
test('missing texture and audio bytes cannot silently produce incomplete packages',()=>{
 for(const kind of ['textures','audio'])assert.throws(()=>build(project,{...maps,[kind]:new Map()}),/资源缺失/);
});
test('texture and audio byte-length mismatches are rejected',()=>{
 for(const kind of ['textures','audio']){const map=new Map(maps[kind]);map.set(map.keys().next().value,new ArrayBuffer(2));assert.throws(()=>build(project,{...maps,[kind]:map}),/大小不一致/);}
});
test('external glTF sidecars and remote images are rejected',()=>{
 for(const uri of ['missing.bin','https://example.com/image.png']){
 const models=new Map(maps.models);models.set(project.modelRefs[0].assetId,new TextEncoder().encode(JSON.stringify({asset:{version:'2.0'},images:[{uri}]})).buffer);
 assert.throws(()=>build(project,{...maps,models}),/外部资源/);
 }
});
test('compressed decoder dependencies are rejected explicitly',()=>{
 for(const extension of ['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu']){
 const models=new Map(maps.models);models.set(project.modelRefs[0].assetId,new TextEncoder().encode(JSON.stringify({asset:{version:'2.0'},extensionsUsed:[extension]})).buffer);
 assert.throws(()=>build(project,{...maps,models}),/未内置该解码器/);
 }
});
test('malformed GLB data does not pass export validation',()=>{
 const models=new Map(maps.models);models.set(project.modelRefs[0].assetId,new ArrayBuffer(20));assert.throws(()=>build(project,{...maps,models}),/有效 GLB/);
});
test('self-contained glTF with data URIs can be packaged',()=>{
 const models=new Map(maps.models);models.set(project.modelRefs[0].assetId,new TextEncoder().encode(JSON.stringify({asset:{version:'2.0'},buffers:[{uri:'data:application/octet-stream;base64,AAAA',byteLength:3}]})).buffer);
 assert.ok(build(project,{...maps,models}).files['project.json']);
});
test('literal import(), static imports and reexports all appear in the graph',()=>{
 const graph=validateScriptGraph({'main.js':"import {x} from './bridge.js';return {onStart(){import('./later.js')}}",'bridge.js':"export {x} from './tools.js'",'tools.js':'export const x=1','later.js':'export const y=2'},[{scripts:['main.js']}]);
 assert.deepEqual(graph.graph['main.js'],['bridge.js','later.js']);assert.deepEqual(graph.graph['bridge.js'],['tools.js']);
});
test('missing, remote, npm, variable imports, top-level await and cycles fail export preflight',()=>{
 for(const source of ["import './missing.js'","import 'pkg'","import 'https://example.com/a.js'","const p='./a.js';import(p)",'await Promise.resolve()',"import './cycle.js'"]){
 const scripts={'main.js':source,'cycle.js':"import './main.js';export const x=1"};assert.throws(()=>validateScriptGraph(scripts,[{scripts:['main.js']}]));
 }
});
test('script traversal, non-JS, missing bindings and old-style script imports are rejected',()=>{
 for(const name of ['../evil.js','a\\b.js','a.ts','/a.js'])assert.throws(()=>validateScriptGraph({[name]:''},[]),/项目内 .js/);
 assert.throws(()=>validateScriptGraph({'main.js':''},[{scripts:['gone.js']}]),/绑定缺失/);
 assert.throws(()=>validateScriptGraph({'main.js':"import './old.js'",'old.js':'return {}'},[{scripts:['main.js']}]),/旧式/);
});
test('runtime dependency registry cannot silently omit a script',()=>{
 const r={...runtime};r['runtime.html']=new TextEncoder().encode('<script src="./omitted.js"></script>');assert.throws(()=>build(project,maps,r),/清单遗漏/);
});
test('invalid display settings are rejected; titles are retained as plain data',()=>{
 assert.throws(()=>exportSettings({width:0}));assert.throws(()=>exportSettings({fit:'stretch'}));assert.equal(exportSettings({title:'<script>alert(1)</script>'}).title,'<script>alert(1)</script>');
});
