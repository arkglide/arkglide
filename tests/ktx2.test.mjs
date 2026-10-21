import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {indexedDB} from 'fake-indexeddb';
import {unzipSync,strFromU8} from 'fflate';
import * as B from '@babylonjs/core';
import '../src/engine/ktx2-runtime.js';
import '../src/engine/package-runtime.js';
import '../src/engine/rendering-config.js';
import '../src/engine/rendering-runtime.js';
import '../src/engine/scene-runtime.js';
import {createStaticGame,RUNTIME_FILES} from '../src/export/static-game.mjs';
const K=globalThis.ArkGlideKTX2,fixture=name=>fs.readFile(new URL('fixtures/ktx2/'+name,import.meta.url));
test('KTX2 inspection preserves transfer, dimensions, mip storage and typed-array offsets',async()=>{
 for(const [name,encoding,space,mips]of [['colors-uastc.ktx2','uastc','srgb',7],['colors-etc1s.ktx2','etc1s','srgb',7],['normal.ktx2','uastc','linear',7],['colors-rgba.ktx2','rgba8','srgb',1]]){
  const bytes=await fixture(name),padded=new Uint8Array(bytes.length+30);padded.set(bytes,15);
  const info=K.inspect(padded.subarray(15,15+bytes.length));assert.equal(info.encoding,encoding);assert.equal(info.colorSpace,space);assert.equal(info.mipLevels,mips);assert.equal(info.width,64);assert.equal(info.estimatedRgbaBytes,mips===7?21844:16384);
 }
 const npot=K.inspect(await fixture('colors-npot.ktx2'));assert.equal(npot.width,30);assert.equal(npot.height,18);assert.equal(npot.estimatedRgbaBytes,2160);
});
test('KTX2 bounds reject overlaps, unsafe offsets, incomplete mips and unsupported layer/color formats',async()=>{
 const source=await fixture('colors-uastc.ktx2');
 const bad=edit=>{const b=source.slice(),d=new DataView(b.buffer,b.byteOffset,b.byteLength);edit(b,d);assert.throws(()=>K.inspect(b));};
 assert.throws(()=>K.inspect(source.subarray(0,100)));
 for(const [at,n]of [[20,9000],[24,0],[28,1],[32,1],[36,6],[40,2],[44,3],[12,97]])bad((b,d)=>d.setUint32(at,n,true));
 bad((b,d)=>d.setBigUint64(80,2n**63n,true));
 bad((b,d)=>d.setBigUint64(80,0n,true));
 bad((b,d)=>d.setBigUint64(96,1n,true));
 bad((b,d)=>{b[d.getUint32(48,true)+14]=0;});
 bad((b,d)=>{b[d.getUint32(48,true)+15]=1;});
 bad((b,d)=>{b[d.getUint32(48,true)+13]=9;});
 const etc=await fixture('colors-etc1s.ktx2'),d=new DataView(etc.buffer,etc.byteOffset,etc.byteLength);d.setUint32(Number(d.getBigUint64(64,true))+28,0xffffffff,true);assert.throws(()=>K.inspect(etc),/切片/);
});
test('bundled local WASM actually decodes ETC1S/UASTC, Zstd, normal alpha and RGBA8 mips',async()=>{
 const folder=new URL('../public/lib/ktx2/',import.meta.url);
 vm.runInThisContext(await fs.readFile(new URL('babylon.ktx2Decoder.js',folder),'utf8'));
 const D=globalThis.KTX2DECODER;K.configureModule(D,folder.href);
 for(const [name,file]of [['ASTC','uastc_astc.wasm'],['BC7','uastc_bc7.wasm'],['RGBA_UNORM','uastc_rgba8_unorm_v2.wasm'],['RGBA_SRGB','uastc_rgba8_srgb_v2.wasm'],['R8_UNORM','uastc_r8_unorm.wasm'],['RG8_UNORM','uastc_rg8_unorm.wasm']]){const b=await fs.readFile(new URL(file,folder));D['LiteTranscoder_UASTC_'+name].WasmBinary=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}
 const factory=new Function('module','exports','require','__dirname',await fs.readFile(new URL('msc_basis_transcoder.js',folder),'utf8')+';return MSC_TRANSCODER;');
 D.MSCTranscoder.JSModule=factory({exports:{}},{},createRequire(import.meta.url),fileURLToPath(folder));D.MSCTranscoder.UseFromWorkerThread=false;
 const wasm=await fs.readFile(new URL('msc_basis_transcoder.wasm',folder));D.MSCTranscoder.WasmBinary=wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength);
 D.ZSTDDecoder.WasmModuleURL='data:application/wasm;base64,'+(await fs.readFile(new URL('zstddec.wasm',folder))).toString('base64');
 for(const name of ['colors-uastc.ktx2','colors-etc1s.ktx2','normal.ktx2','normal-tilt.ktx2','detail.ktx2','mask.ktx2','colors-rgba.ktx2','colors-npot.ktx2','colors-npot-uastc.ktx2']){
  const bytes=await fixture(name),info=K.inspect(bytes);
  for(const caps of [{},{bptc:true}]){
   const decoded=await new D.KTX2Decoder().decode(bytes,caps);assert.ok(!decoded.errors,decoded.errors);assert.equal(decoded.mipmaps.length,info.mipLevels);assert.equal(decoded.mipmaps[0].width,info.width);assert.equal(decoded.mipmaps[0].height,info.height);assert.ok(decoded.mipmaps.every(m=>m.data?.byteLength));
   if(info.encoding!=='rgba8')assert.equal(decoded.transcodedFormat,caps.bptc?36492:32856);
   if(name==='colors-uastc.ktx2'&&!caps.bptc)assert.deepEqual(Array.from(decoded.mipmaps[0].data.slice(0,4)),[224,40,16,255]);
   if(name==='detail.ktx2'&&!caps.bptc){const first=decoded.mipmaps[0].data;assert.ok(Math.abs(first[0]-128)<2&&Math.abs(first[1]-96)<3&&Math.abs(first[3]-147)<3);}
  }
 }
 const broken=await fixture('colors-uastc.ktx2'),d=new DataView(broken.buffer,broken.byteOffset,broken.byteLength);broken.fill(255,Number(d.getBigUint64(80,true)),Number(d.getBigUint64(80,true)+d.getBigUint64(88,true)));
 await assert.rejects(new D.KTX2Decoder().decode(broken,{}));
});
test('linear map roles, encoded orientation and device-format storage stay distinct',async()=>{
 const info=K.inspect(await fixture('colors-uastc.ktx2'));
 for(const role of ['normal','coatNormal','ao','detail','metallicRoughness','thickness','lightmap'])assert.throws(()=>K.assertRole(info,role),/线性/);
 for(const role of ['albedo','emissive','sheen'])K.assertRole(info,role);
 const matrix=B.Matrix.Identity();matrix.setRowFromFloats(2,.2,.3,0,0);
 const internal={format:37808,isReady:true,width:1,height:1},texture={invertY:true,getTextureMatrix:()=>matrix,getInternalTexture:()=>internal};
 K.applyTexture(B,texture,info,'albedo');assert.equal(texture.getTextureMatrix().m[8],Math.fround(.2));assert.ok(Math.abs(texture.getTextureMatrix().m[9]-.7)<1e-6);assert.equal(internal.width,64);
 internal.format=5;assert.ok(Math.abs(texture.getTextureMatrix().m[9]-.3)<1e-6);
 assert.equal(K.storageBytes(5,64,64,7),21844);assert.equal(K.storageBytes(37808,64,64,7),5488);assert.equal(K.storageBytes(36492,64,64,7),5488);assert.equal(K.storageBytes(37492,64,64,7),2744);assert.equal(K.storageBytes(35840,1,1,1),32);assert.equal(K.storageBytes(999,64,64,7),null);
});
test('reflection variants share compressed normal/detail textures and retain their sampling plugin',async()=>{
 const engine=new B.NullEngine(),scene=new B.Scene(engine);
 class Cube {constructor(_url,_scene,_ext,_mip,_files,load){queueMicrotask(load);}isReady(){return false;}dispose(){}clone(){return {dispose(){}};}}
 const manager=ArkGlideRendering.create({...B,CubeTexture:Cube},scene),source=new B.PBRMaterial('source',scene),mesh=B.MeshBuilder.CreateBox('box',{},scene);
 const texture=B.RawTexture.CreateRGBATexture(new Uint8Array([128,128,255,255]),1,1,scene,false);
 const info=K.inspect(await fixture('normal.ktx2'));K.applyTexture(B,texture,info,'normal');source.bumpTexture=texture;source.detailMap.isEnabled=true;source.detailMap.texture=texture;source.metadata={arkglideManagedMaterial:true};K.applyMaterial(B,source);mesh.material=source;mesh.metadata={arkglideRendering:{}};
 manager.configure({probes:[{id:'room',name:'room',textureId:'env',position:{x:0,y:0,z:0},size:{x:4,y:4,z:4}}]});
 try{
  await manager.sync({textures:[{id:'env',mime:'application/x-babylon-env'}]},{env:new ArrayBuffer(1)});scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.notEqual(mesh.material,source);assert.equal(mesh.material.bumpTexture,texture);assert.equal(mesh.material.detailMap.texture,texture);assert.ok(mesh.material.pluginManager.getPlugin('ArkGlideKtxOrientation'));
  manager.clear();assert.equal(mesh.material,source);assert.ok(scene.textures.includes(texture));assert.ok(scene.materials.includes(source));
 }finally{manager.dispose();scene.dispose();engine.dispose();}
});
test('opaque-origin local decoder resources contain the exact shipped WASM binaries',async()=>{
 const folder=new URL('../public/lib/ktx2/',import.meta.url),context=vm.createContext({});vm.runInContext(await fs.readFile(new URL('decoder-resources.js',folder),'utf8'),context);
 const resources=context.ArkGlideKTX2Resources;
 for(const [key,file]of [['wasmUASTCToASTC','uastc_astc.wasm'],['wasmMSCTranscoder','msc_basis_transcoder.wasm'],['wasmZSTDDecoder','zstddec.wasm'],['jsDecoderModule','babylon.ktx2Decoder.js'],['jsMSCTranscoder','msc_basis_transcoder.js']]){
  const decoded=Buffer.from(resources[key].split(',')[1],'base64');assert.deepEqual(decoded,await fs.readFile(new URL(file,folder)));
 }
 assert.equal(Object.keys(resources).length,10);
});
test('stopping a scene during opaque decoder preparation cannot revive nodes or materials',async()=>{
 const helper=globalThis.ArkGlideKTX2,previous=globalThis.origin,prepare=helper.prepare;globalThis.origin='null';
 try{
  for(const method of ['sync','syncBatched','refreshMaterials']){
   let release;helper.prepare=()=>new Promise(resolve=>{release=resolve;});const engine=new B.NullEngine(),scene=new B.Scene(engine),adapter=ArkGlideScene.createSceneAdapter(B,scene);
   try{
    const content={textures:[{id:'pending',mime:'image/ktx2'}],materials:{pending:{id:'pending',baseColor:'#FFFFFF',emissiveColor:'#000000',roughness:1,metallic:0,alpha:1,uvScale:{u:1,v:1}}}},nodes=[{id:'box',type:'mesh',materialId:'pending'}];
    const pending=method==='refreshMaterials'?adapter.refreshMaterials(content,new Map()):adapter[method](nodes,new Map(),content,new Map());adapter.clear();release();
    if(method==='refreshMaterials')await pending;else await assert.rejects(pending,/取消/);
    assert.equal(adapter.nodes.size,0);assert.equal(adapter.materials.size,0);assert.equal(scene.meshes.length,0);
   }finally{adapter.dispose();scene.dispose();engine.dispose();}
  }
 }finally{helper.prepare=prepare;if(previous===undefined)delete globalThis.origin;else globalThis.origin=previous;}
});
let server,store,archive;
before(async()=>{globalThis.indexedDB=indexedDB;server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});({useEditorStore:store}=await server.ssrLoadModule('/src/store/useEditorStore.ts'));archive=await server.ssrLoadModule('/src/utils/projectExport.ts');});
after(async()=>{await server?.close();});
test('KTX2 bytes and metadata survive undo, clipboard, prefab, save and offline chunk export',async()=>{
 const s=()=>store.getState(),put=(id,b)=>s().importTexture({id,name:id+'.ktx2',mime:'image/ktx2',byteLength:b.byteLength},b);
 s().newProject();const bytes=await fixture('normal.ktx2'),buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);put('linear',buffer);
 const mat=s().createMaterial('KTX2');s().updateMaterial(mat,{normalTextureId:'linear'});s().setNodeMaterial('cube',mat);s().selectNode('cube');s().copyToClipboard();s().removeNode('cube');s().deleteMaterial(mat);s().deleteTexture('linear');s().pasteFromClipboard();
 assert.equal(s().content.textures[0].ktx2.colorSpace,'linear');assert.deepEqual(new Uint8Array(s().textureBuffers.get('linear')),new Uint8Array(buffer));
 const root=s().nodes.find(n=>n.materialId===mat).id,prefab=s().createPrefab(root);s().instantiatePrefab(prefab);assert.throws(()=>s().deleteTexture('linear'),/引用/);
 const old=s().textureBuffers.get('linear'),color=await fixture('colors-uastc.ktx2');assert.throws(()=>put('linear',color.buffer.slice(color.byteOffset,color.byteOffset+color.byteLength)),/线性/);assert.equal(s().textureBuffers.get('linear'),old);
 put('extra',buffer);s().undo();assert.ok(!s().textureBuffers.has('extra'));s().redo();assert.equal(s().content.textures.find(t=>t.id==='extra').ktx2.encoding,'uastc');
 await s().saveCurrentProject('KTX2 fixture');const id=s().currentProjectId;s().newProject();await s().loadProjectById(id);assert.equal(s().content.textures.find(t=>t.id==='linear').ktx2.mipLevels,7);
 const files=unzipSync(archive.createProjectArchive());assert.deepEqual(files['textures/linear.bin'],new Uint8Array(buffer));assert.equal(JSON.parse(strFromU8(files['project.json'])).content.textures.find(t=>t.id==='linear').ktx2.width,64);
 const runtime=Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async p=>[p,new Uint8Array(await fs.readFile(new URL('../public/'+p,import.meta.url)))]))),game=createStaticGame({...s(),scene:{nodes:s().nodes}},{textures:s().textureBuffers,models:s().modelBuffers,audio:s().audioBuffers},runtime);
 const client=ArkGlidePackage.create({read:async d=>game.files[d.path].slice(),importModule:async()=>({default(){}})});
 try{const loaded=await client.initialize(game.manifest.boot);assert.equal(loaded.project.content.textures.find(t=>t.id==='linear').ktx2.colorSpace,'linear');assert.deepEqual(new Uint8Array(loaded.textureData.linear),new Uint8Array(buffer));for(const name of ['lib/ktx2/validate-worker.js','lib/ktx2/msc_basis_transcoder.wasm','lib/ktx2/zstddec.wasm'])assert.ok(game.files[name]?.length);}finally{client.dispose();}
});
