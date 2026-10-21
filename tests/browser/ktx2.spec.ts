import {test,expect} from './fixtures';
import {writeFile} from 'node:fs/promises';

test('offline WASM KTX2 decoding uploads compressed mip chains with matching color, UVs, alpha and RGBA fallback',async({page})=>{
 const errors:string[]=[],external:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:'))external.push(r.url());});
 await page.goto('/runtime.html');await page.waitForFunction(()=>!!(window as any).ArkGlideKTX2);
 const result=await page.evaluate(async()=>{
  const w=window as any,B=w.BABYLON,K=w.ArkGlideKTX2,canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;document.body.append(canvas);
  const engine=new B.Engine(canvas,false,{preserveDrawingBuffer:true}),scene=new B.Scene(engine),camera=new B.FreeCamera('camera',new B.Vector3(0,0,-3),scene);camera.mode=B.Camera.ORTHOGRAPHIC_CAMERA;camera.orthoLeft=-1.2;camera.orthoRight=1.2;camera.orthoTop=1.2;camera.orthoBottom=-1.2;camera.setTarget(B.Vector3.Zero());scene.clearColor.set(.02,.02,.02,1);
  const names=['colors.png','colors-uastc.ktx2','colors-etc1s.ktx2','colors-rgba.ktx2','colors-lu.ktx2','colors-npot.png','colors-npot.ktx2','colors-npot-uastc.ktx2','mask.png','mask.ktx2'],buffers=new Map<string,ArrayBuffer>(await Promise.all(names.map(async name=>[name,await(await fetch('/tests/fixtures/ktx2/'+name)).arrayBuffer()] as [string,ArrayBuffer]))),textures=names.map(id=>({id,name:id,mime:id.endsWith('.ktx2')?'image/ktx2':'image/png',byteLength:buffers.get(id)!.byteLength}));
  const node={id:'surface',name:'surface',type:'mesh',primitive:'box',materialId:'surface',transform:{x:0,y:0,z:0},scale:{x:2,y:2,z:.1}};
  const base={id:'surface',name:'surface',baseColor:'#000000',emissiveColor:'#FFFFFF',metallic:0,roughness:1,alpha:1,doubleSided:false,uvScale:{u:1,v:1}};
  const adapter=w.ArkGlideScene.createSceneAdapter(B,scene),oldForce=B.KhronosTextureContainer2.DefaultDecoderOptions.forceRGBA;
  const draw=async(id:string,patch:any={})=>{await adapter.sync([node],{}, {materials:{surface:{...base,emissiveTextureId:id,...patch}},textures},buffers);await scene.whenReadyAsync();const material=adapter.materials.get('surface');for(const texture of [material.emissiveTexture,material.albedoTexture])texture?.updateSamplingMode(B.Texture.NEAREST_SAMPLINGMODE);for(let i=0;i<5;i++){scene.render();await new Promise(r=>setTimeout(r,15));}return Array.from(await engine.readPixels(0,0,128,128)) as number[];};
  const diff=(a:number[],b:number[])=>a.reduce((sum,v,i)=>sum+(i%4===3?0:Math.abs(v-b[i])),0)/(128*128*3);
  try{
   const caps=Object.fromEntries(['astc','bptc','s3tc','pvrtc','etc2','etc1'].map(k=>[k,!!engine.getCaps()[k]])),validation=await K.validate(buffers.get('colors-uastc.ktx2'),caps);
   const png=await draw('colors.png'),uastc=await draw('colors-uastc.ktx2'),uastcTexture=adapter.materials.get('surface').emissiveTexture,uastcInfo={format:uastcTexture.getInternalTexture().format,size:uastcTexture.getSize(),stats:adapter.rendering.stats()};
   const rgba=await draw('colors-rgba.ktx2'),lu=await draw('colors-lu.ktx2'),npotPng=await draw('colors-npot.png'),npot=await draw('colors-npot.ktx2'),npotCompressed=await draw('colors-npot-uastc.ktx2'),npotFormat=adapter.materials.get('surface').emissiveTexture.getInternalTexture().format;await K.validate(buffers.get('colors-npot-uastc.ktx2'),caps);const etc=await draw('colors-etc1s.ktx2'),etcTexture=adapter.materials.get('surface').emissiveTexture,etcInfo={format:etcTexture.getInternalTexture().format,size:etcTexture.getSize(),stats:adapter.rendering.stats()};
   const transform={uvScale:{u:1.4,v:.8},uvOffset:{u:.13,v:-.27},uvRotation:.4};const pngUv=await draw('colors.png',transform),ktxUv=await draw('colors-uastc.ktx2',transform);
   adapter.clear();B.KhronosTextureContainer2.DefaultDecoderOptions.forceRGBA=true;const fallback=await draw('colors-uastc.ktx2'),texture=adapter.materials.get('surface').emissiveTexture,fallbackInfo={format:texture.getInternalTexture().format,size:texture.getSize(),stats:adapter.rendering.stats()};B.KhronosTextureContainer2.DefaultDecoderOptions.forceRGBA=oldForce;
   const pngMask=await draw('mask.png',{alphaMode:'mask',albedoTextureId:'mask.png'}),ktxMask=await draw('mask.ktx2',{alphaMode:'mask',albedoTextureId:'mask.ktx2'});
   adapter.clear();const cleared={textures:scene.textures.filter((t:any)=>t.name.startsWith('arkglide:texture:')).length,stats:adapter.rendering.stats()};
   return {caps,validation,uastcInfo,etcInfo,fallbackInfo,lit:png.filter((v,i)=>i%4!==3&&v>150).length,color:diff(png,uastc),rgba:diff(png,rgba),lu:diff(png,lu),npot:diff(npotPng,npot),npotUastc:diff(npotPng,npotCompressed),npotFormat,etc:diff(png,etc),uv:diff(pngUv,ktxUv),fallback:diff(png,fallback),mask:diff(pngMask,ktxMask),cleared};
  }finally{B.KhronosTextureContainer2.DefaultDecoderOptions.forceRGBA=oldForce;adapter.dispose();scene.dispose();engine.dispose();canvas.remove();}
 });
 await writeFile('work/ktx2-webgl.json',JSON.stringify(result,null,2)+'\n');await test.info().attach('ktx2-webgl.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 expect(errors).toEqual([]);expect(external).toEqual([]);expect(result.color).toBeLessThan(1);expect(result.rgba).toBeLessThan(1);expect(result.lu).toBeLessThan(1);expect(result.npot).toBeLessThan(1);expect(result.npotUastc).toBeLessThan(2);expect(result.npotFormat).toBe(5);expect(result.etc).toBeLessThan(3);expect(result.uv).toBeLessThan(1);expect(result.fallback).toBeLessThan(1);expect(result.mask).toBeLessThan(1);expect(result.uastcInfo.size).toEqual({width:64,height:64});expect(result.fallbackInfo.size).toEqual({width:64,height:64});expect(result.fallbackInfo.format).toBe(5);expect(result.fallbackInfo.stats.ktx2EstimatedGpuBytes).toBe(21844);expect(result.cleared.textures).toBe(0);expect(result.cleared.stats.ktx2Textures).toBe(0);
 if(Object.values(result.caps).some(Boolean))expect(result.etcInfo.format).not.toBe(5);
 expect(result.lit).toBeGreaterThan(1000);
});

test('KTX2 normal maps keep PNG tangent directions for derivative and authored tangent frames',async({page})=>{
 await page.goto('/runtime.html');await page.waitForFunction(()=>!!(window as any).ArkGlideKTX2);
 const result=await page.evaluate(async()=>{
  const w=window as any,B=w.BABYLON,canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;document.body.append(canvas);const engine=new B.Engine(canvas,false,{preserveDrawingBuffer:true}),scene=new B.Scene(engine),camera=new B.FreeCamera('main',new B.Vector3(0,0,-3),scene);camera.setTarget(B.Vector3.Zero());
  new B.DirectionalLight('sun',new B.Vector3(.3,-.7,1),scene).intensity=2;
  const buffers=new Map<string,ArrayBuffer>();for(const name of ['normal-tilt.png','normal-tilt.ktx2','detail.png','detail.ktx2'])buffers.set(name,await(await fetch('/tests/fixtures/ktx2/'+name)).arrayBuffer());
  const textures=[...buffers].map(([id,b])=>({id,name:id,mime:id.endsWith('.ktx2')?'image/ktx2':'image/png',byteLength:b.byteLength}));
  const node={id:'surface',name:'surface',type:'mesh',primitive:'box',materialId:'surface',transform:{x:0,y:0,z:0},scale:{x:2,y:2,z:1}};
  const base={id:'surface',name:'surface',baseColor:'#AAAAAA',emissiveColor:'#000000',metallic:0,roughness:.7,alpha:1,doubleSided:false,uvScale:{u:1,v:1}},adapter=w.ArkGlideScene.createSceneAdapter(B,scene);const centers:number[]=[];
  const draw=async(id:string,tangents:boolean,patch:any={})=>{adapter.clear();await adapter.sync([node],{}, {materials:{surface:{...base,normalTextureId:id,...patch}},textures},buffers);const mesh=adapter.nodes.get('surface');if(tangents){const data=new Float32Array(mesh.getTotalVertices()*4);for(let i=0;i<data.length;i+=4)data.set([1,0,0,-1],i);mesh.setVerticesData(B.VertexBuffer.TangentKind,data);}const mat=adapter.materials.get('surface');mat.markAsDirty(B.Material.AllDirtyFlag);await scene.whenReadyAsync();for(const t of [mat.bumpTexture,mat.clearCoat.bumpTexture,mat.detailMap.texture])t?.updateSamplingMode(B.Texture.NEAREST_SAMPLINGMODE);for(let i=0;i<5;i++){scene.render();await new Promise(r=>setTimeout(r,15));}const pixels=Array.from(await engine.readPixels(0,0,96,96)) as number[];centers.push(pixels[(48*96+48)*4]);return pixels;};
  const diff=(a:number[],b:number[])=>a.reduce((sum,v,i)=>sum+(i%4===3?0:Math.abs(v-b[i])),0)/(96*96*3);
  try{
   const png=await draw('normal-tilt.png',false),ktx=await draw('normal-tilt.ktx2',false),pngTangent=await draw('normal-tilt.png',true),ktxTangent=await draw('normal-tilt.ktx2',true);
   const coat=(id:string)=>({normalTextureId:undefined,baseColor:'#222222',roughness:.9,clearCoat:{enabled:true,roughness:.35,normalScale:1},clearCoatNormalTextureId:id}),coatPng=await draw('normal-tilt.png',false,coat('normal-tilt.png')),coatKtx=await draw('normal-tilt.ktx2',false,coat('normal-tilt.ktx2')),coatOff=await draw('normal-tilt.png',false,{...coat('normal-tilt.png'),clearCoatNormalTextureId:undefined});
   const detail=(id:string)=>({normalTextureId:undefined,clearCoat:{enabled:false},detail:{enabled:true,scale:1,diffuse:0,normal:1,roughness:0},detailTextureId:id}),detailPng=await draw('normal-tilt.png',false,detail('detail.png')),detailKtx=await draw('normal-tilt.ktx2',false,detail('detail.ktx2'));
   const detailTangentPng=await draw('normal-tilt.png',true,detail('detail.png')),detailTangentKtx=await draw('normal-tilt.ktx2',true,detail('detail.ktx2'));
   return {derivative:diff(png,ktx),tangents:diff(pngTangent,ktxTangent),coat:diff(coatPng,coatKtx),coatNormalEffect:diff(coatPng,coatOff),detail:diff(detailPng,detailKtx),detailTangents:diff(detailTangentPng,detailTangentKtx),centers};
  }finally{adapter.dispose();scene.dispose();engine.dispose();canvas.remove();}
 });
 await writeFile('work/ktx2-normals.json',JSON.stringify(result,null,2)+'\n');expect(result.derivative).toBeLessThan(1.5);expect(result.tangents).toBeLessThan(1.5);
 expect(result.coat).toBeLessThan(1.5);expect(result.coatNormalEffect).toBeGreaterThan(.2);expect(result.detail).toBeLessThan(1.5);
 expect(result.detailTangents).toBeLessThan(1.5);expect(result.centers.every(v=>v>10)).toBe(true);
});

test('editor validates KTX2 in a worker and preserves state on corrupt data, linear-role replacement and stale imports',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.waitForSelector('#viewport');
 const result=await page.evaluate(async()=>{
  const {useEditorStore:s}=await import('/src/store/useEditorStore.ts'),{importTextureFile}=await import('/src/utils/textureImport.ts'),{createProjectArchive,importProject}=await import('/src/utils/projectExport.ts');
  const buffers=Object.fromEntries(await Promise.all(['colors-uastc.ktx2','colors-etc1s.ktx2','normal.ktx2'].map(async name=>[name,await(await fetch('/tests/fixtures/ktx2/'+name)).arrayBuffer()]))),file=(name:string)=>new File([buffers[name]],name,{type:'image/ktx2'});
  const color=await importTextureFile(file('colors-uastc.ktx2')),normal=await importTextureFile(file('normal.ktx2')),mat=s.getState().createMaterial('KTX2');s.getState().updateMaterial(mat,{albedoTextureId:color,normalTextureId:normal});s.getState().setNodeMaterial('cube',mat);
  const metadata=s.getState().content.textures.find(t=>t.id===color)!.ktx2,oldNormal=s.getState().textureBuffers.get(normal);let roleError='';try{await importTextureFile(file('colors-uastc.ktx2'),normal);}catch(e){roleError=String(e);}
  const normalPreserved=s.getState().textureBuffers.get(normal)===oldNormal;
  const bytes=new Uint8Array(buffers['colors-uastc.ktx2'].slice(0)),d=new DataView(bytes.buffer),at=Number(d.getBigUint64(80,true)),size=Number(d.getBigUint64(88,true));bytes.fill(255,at,at+size);const before=s.getState().content.textures.length;let corrupt='';try{await importTextureFile(new File([bytes],'broken.ktx2'));}catch(e){corrupt=String(e);}
  const corruptPreserved=s.getState().content.textures.length===before;
  const older=importTextureFile(file('colors-uastc.ktx2'),color).then(()=>'',e=>String(e)),newer=importTextureFile(file('colors-etc1s.ktx2'),color);await newer;const olderError=await older;const newest=s.getState().content.textures.find(t=>t.id===color)!.name;
  const archive=createProjectArchive();await importProject(new File([archive],'ktx-project.arkglide'));const restored=s.getState().content.textures.find(t=>t.id===normal)!.ktx2;
  const pending=importTextureFile(file('colors-uastc.ktx2')).then(()=>'',e=>String(e));s.getState().newProject();const staleError=await pending;
  return {metadata,roleError,normalPreserved,corrupt,corruptPreserved,olderError,newest,restored,staleError,remaining:s.getState().content.textures.length};
 });
 await writeFile('work/ktx2-editor.json',JSON.stringify(result,null,2)+'\n');expect(errors).toEqual([]);expect(result.metadata?.width).toBe(64);expect(result.metadata?.mipLevels).toBe(7);expect(result.metadata?.colorSpace).toBe('srgb');expect(result.roleError).toContain('线性');expect(result.normalPreserved).toBe(true);expect(result.corrupt).toContain('解码');expect(result.corruptPreserved).toBe(true);expect(result.olderError).toContain('更新');expect(result.newest).toBe('colors-etc1s.ktx2');expect(result.restored?.colorSpace).toBe('linear');expect(result.staleError).toContain('切换');expect(result.remaining).toBe(0);
});

test('editor asset browser imports KTX2 and budgets distinguish file bytes, RGBA mips and live GPU copies',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.getByRole('tab',{name:'项目资源',exact:true}).click();
 await page.locator('input[webkitdirectory]').setInputFiles('tests/fixtures/ktx2');
 const asset=await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');const a=s.getState().assets.find(a=>a.name==='colors-uastc.ktx2')!;return {path:a.path,type:a.type};});
 expect(asset.type).toBe('texture');await page.getByTitle(asset.path,{exact:true}).click();
 await expect.poll(()=>page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().content.textures.some(t=>t.name==='colors-uastc.ktx2');})).toBe(true);
 const report=await page.evaluate(async()=>{
  const {useEditorStore:s}=await import('/src/store/useEditorStore.ts'),{getEditorScene}=await import('/src/engine/editor-scene.ts'),{scanResourceBudget}=await import('/src/utils/resourceBudget.ts');
  const id=s.getState().content.textures.find(t=>t.name==='colors-uastc.ktx2')!.id,mat=s.getState().createMaterial('Budget');s.getState().updateMaterial(mat,{albedoTextureId:id});s.getState().setNodeMaterial('cube',mat);
  // Let the editor's store subscription finish its sync before scanning.
  const {adapter}=getEditorScene();for(let i=0;i<200&&(adapter.rendering.stats().ktx2EstimatedGpuBytes||0)<=0;i++)await new Promise(r=>setTimeout(r,25));
  return scanResourceBudget(s.getState(),new AbortController().signal);
 });
 await writeFile('work/ktx2-budget.json',JSON.stringify(report,null,2)+'\n');
 const texture=report.assets.textures.find(t=>t.name==='colors-uastc.ktx2')!;expect(texture.width).toBe(64);expect(texture.height).toBe(64);expect(texture.estimatedBytes).toBe(21844);expect(texture.fileBytes).toBeLessThan(texture.estimatedBytes!);expect(report.assets.loadedKtx2Textures.length).toBeGreaterThan(0);expect(report.assets.loadedKtx2EstimatedBytes).toBeGreaterThan(0);expect(report.assets.loadedKtx2EstimatedBytes).toBeLessThanOrEqual(21844);if(report.assets.loadedKtx2Textures.every(t=>t.compressed))expect(report.assets.loadedKtx2EstimatedBytes).toBeLessThan(21844);
});
