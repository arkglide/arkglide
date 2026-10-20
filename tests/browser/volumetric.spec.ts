import {test,expect} from './fixtures';
import {writeFile} from 'node:fs/promises';

test('GPU volume integrates height/depth, forms occluded light shafts and preserves zero density',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/runtime.html');await page.waitForFunction(()=>!!(window as any).ArkGlideVolumetric);
 const result=await page.evaluate(async()=>{
  const w=window as any,B=w.BABYLON,canvas=document.createElement('canvas');canvas.width=192;canvas.height=144;document.body.append(canvas);
  const engine=new B.Engine(canvas,false,{preserveDrawingBuffer:true}),scene=new B.Scene(engine),camera=new B.FreeCamera('main',new B.Vector3(0,1,-4),scene);camera.minZ=.1;camera.maxZ=100;camera.setTarget(new B.Vector3(0,1,4));scene.clearColor.set(0,0,0,1);
  const material=new B.StandardMaterial('black',scene);material.disableLighting=true;material.emissiveColor.set(.25,.1,.05);
  const wall=B.MeshBuilder.CreatePlane('wall',{size:30,sideOrientation:B.Mesh.DOUBLESIDE},scene);wall.position.set(0,1,8);wall.material=material;wall.metadata={arkglideRendering:{castShadows:false}};
  const block=B.MeshBuilder.CreateBox('block',{width:1.5,height:6,depth:1},scene);block.position.set(1,2,3);block.material=material;block.metadata={arkglideRendering:{castShadows:true}};
  const light=new B.DirectionalLight('sun',new B.Vector3(-.6,-.7,-.3),scene);light.intensity=1;
  const manager=w.ArkGlideRendering.create(B,scene);
  const draw=async()=>{await scene.whenReadyAsync();for(let i=0;i<8;i++){scene.render();await new Promise(r=>setTimeout(r,15));}return Array.from(await engine.readPixels(0,0,192,144)) as number[];};
  const diff=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+(i%4===3?0:Math.abs(v-b[i])),0);
  const center=(a:number[])=>a[(72*192+96)*4];
  const base={enabled:true,color:'#FFFFFF',density:.08,height:0,falloff:0,maxDistance:30,ambient:1,lightIntensity:0,noiseStrength:0,steps:64,scale:.5,shadowDistance:20,shadowMapSize:512};
  try {
   manager.configure({color:{toneMapping:'none'}});await manager.sync();const plain=await draw();
   manager.configure({volumetric:{...base,density:0}});const zero=await draw();
   material.emissiveColor.set(0,0,0);
   manager.configure({volumetric:base});const fog=await draw();const full=manager.stats();
   manager.configure({volumetric:{...base,falloff:4}});const high=await draw();
   const beam={...base,density:.055,ambient:.02,lightIntensity:1,anisotropy:.4};
   manager.configure({volumetric:{...beam,shadows:false}});const unshadowed=await draw();
   manager.configure({volumetric:{...beam,shadows:true}});const shadowed=await draw();const stats=manager.stats();
   block.metadata.arkglideRendering.castShadows=false;const ignored=await draw();block.metadata.arkglideRendering.castShadows=true;
   block.position.x=-2;const moved=await draw();
   light.setEnabled(false);const ambient=await draw();const noLight=manager.stats();
   manager.clear();const cleared={...manager.stats(),posts:camera._postProcesses.filter(Boolean).length,depths:Object.keys(scene._depthRenderer||{}).length,volumes:scene.textures.filter(t=>t.name.startsWith('arkglide:volume')).length};
   return {zero:diff(plain,zero),zeroMax:Math.max(...plain.map((v,i)=>Math.abs(v-zero[i]))),fog:center(fog),high:center(high),shadow:diff(unshadowed,shadowed),ignored:diff(unshadowed,ignored),moved:diff(shadowed,moved),ambient:diff(shadowed,ambient),full,stats,noLight,cleared};
  }finally{manager.dispose();scene.dispose();engine.dispose();canvas.remove();}
 });
 await test.info().attach('volume-pixels.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 await writeFile('work/volumetric-pixels.json',JSON.stringify(result,null,2)+'\n');
 expect(errors).toEqual([]);expect(result.zeroMax).toBeLessThanOrEqual(1);expect(result.fog).toBeGreaterThan(150);expect(result.high).toBeLessThan(80);expect(result.shadow).toBeGreaterThan(2000);expect(result.ignored).toBeLessThan(200);expect(result.moved).toBeGreaterThan(2000);expect(result.ambient).toBeGreaterThan(2000);
 expect(result.stats.volumetricEnabled).toBe(true);expect(result.stats.volumetricPixels).toBe(96*72);expect(result.stats.volumetricShadowed).toBe(true);expect(result.stats.volumetricShadowSize).toBe(512);expect(result.noLight.volumetricShadowSize).toBe(0);expect(result.cleared.posts).toBe(0);expect(result.cleared.depths).toBe(0);expect(result.cleared.volumes).toBe(0);
 expect(result.full.renderMainTriangles).toBe(16);expect(result.full.renderSceneTriangles).toBe(44);
});

test('depth-guided upsampling keeps thin orthographic foregrounds clear with forward and reverse depth',async({page})=>{
 await page.goto('/runtime.html');await page.waitForFunction(()=>!!(window as any).ArkGlideVolumetric);
 const result=await page.evaluate(async()=>{
  const w=window as any,B=w.BABYLON,results=[];
  for(const reverse of [false,true]){
   const canvas=document.createElement('canvas');canvas.width=128;canvas.height=96;document.body.append(canvas);const engine=new B.Engine(canvas,false,{preserveDrawingBuffer:true});engine.useReverseDepthBuffer=reverse;
   const scene=new B.Scene(engine),camera=new B.FreeCamera('ortho',new B.Vector3(0,0,-2),scene);camera.setTarget(B.Vector3.Zero());camera.mode=B.Camera.ORTHOGRAPHIC_CAMERA;camera.orthoLeft=-2;camera.orthoRight=2;camera.orthoTop=1.5;camera.orthoBottom=-1.5;camera.maxZ=30;camera.minZ=.1;
   const wall=B.MeshBuilder.CreatePlane('back',{size:10,sideOrientation:B.Mesh.DOUBLESIDE},scene);wall.position.z=12;const black=new B.StandardMaterial('black',scene);black.disableLighting=true;wall.material=black;
   const bar=B.MeshBuilder.CreatePlane('thin',{width:.04,height:2,sideOrientation:B.Mesh.DOUBLESIDE},scene);bar.position.set(.015625,0,-1);const red=new B.StandardMaterial('red',scene);red.disableLighting=true;red.emissiveColor.set(1,0,0);bar.material=red;
   const manager=w.ArkGlideRendering.create(B,scene);
   try{
    manager.configure({volumetric:{enabled:true,density:.12,falloff:0,color:'#FFFFFF',ambient:1,lightIntensity:0,noiseStrength:0,scale:.25,shadows:false}});await manager.sync();await scene.whenReadyAsync();for(let i=0;i<8;i++){scene.render();await new Promise(r=>setTimeout(r,15));}
    const pixels=await engine.readPixels(0,0,128,96),at=(48*128+64)*4,background=(48*128+80)*4;
    results.push({reverse,foreground:Array.from(pixels.slice(at,at+3)),background:Array.from(pixels.slice(background,background+3))});
   }finally{manager.dispose();scene.dispose();engine.dispose();canvas.remove();}
  }
  return results;
 });
 await test.info().attach('volume-depth-conventions.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 for(const entry of result){expect(entry.foreground[0]).toBeGreaterThan(240);expect(entry.foreground[1]).toBeLessThan(120);expect(entry.background[1]).toBeGreaterThan(200);}
});

test('volume budgets resize, share the post chain and leave borrowed depth intact across camera switches',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/runtime.html');await page.waitForFunction(()=>!!(window as any).ArkGlideVolumetric);
 const result=await page.evaluate(async()=>{
  const w=window as any,B=w.BABYLON,canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;document.body.append(canvas);
  const engine=new B.Engine(canvas,false),scene=new B.Scene(engine),a=new B.FreeCamera('a',new B.Vector3(0,2,-6),scene),b=new B.FreeCamera('b',new B.Vector3(2,3,-5),scene);a.setTarget(B.Vector3.Zero());b.setTarget(B.Vector3.Zero());scene.activeCamera=a;
  const mesh=B.MeshBuilder.CreateSphere('mesh',{segments:12},scene);mesh.material=new B.PBRMaterial('surface',scene);mesh.metadata={arkglideRendering:{}};
  const light=new B.DirectionalLight('sun',new B.Vector3(.4,-1,.2),scene);light.metadata={arkglideRendering:{}};
  const borrowed=scene.enableDepthRenderer(a),manager=w.ArkGlideRendering.create(B,scene);
  const settings={volumetric:{enabled:true,maxPixels:16384,scale:1,shadowMapSize:256,shadowDistance:20},shadows:{enabled:true,mapSize:256,cascades:{enabled:true,count:3}},ao:{enabled:true},reflections:{ssr:{enabled:true,maxSteps:8}},dof:{enabled:true}};
  const draw=async()=>{await scene.whenReadyAsync();for(let i=0;i<5;i++){scene.render();await new Promise(r=>setTimeout(r,20));}};
  try {
   manager.configure(settings);await manager.sync();await draw();const initial=manager.stats();
   const actual=a._postProcesses.find((p:any)=>p?.name==='arkglide:volume-composite').inputTexture;
   const actualSize={width:actual.width,height:actual.height};
   engine.setSize(480,200);await draw();const resized=manager.stats();
   const depthSize=Object.values(scene._depthRenderer).filter((r:any)=>r.getDepthMap().name==='arkglide:volume-depth').map((r:any)=>r.getDepthMap().getSize());
   scene.activeCamera=b;await draw();const switched={stats:manager.stats(),oldPosts:a._postProcesses.filter(Boolean).length};
   for(let i=0;i<3;i++){manager.clear();manager.configure(settings);await manager.sync();await draw();}
   manager.clear();const cleared={stats:manager.stats(),aPosts:a._postProcesses.filter(Boolean).length,bPosts:b._postProcesses.filter(Boolean).length,depths:Object.keys(scene._depthRenderer).length,borrowed:scene._depthRenderer[a.uniqueId]===borrowed,cameras:scene.cameras.length,volumeTextures:scene.textures.filter(t=>t.name.startsWith('arkglide:volume')).length};
   manager.dispose();
   const fallback=w.ArkGlideRendering.create({...B,DepthRenderer:null},scene);fallback.configure({volumetric:{enabled:true},fog:{mode:'exp'}});await fallback.sync();await draw();const unsupported={...fallback.stats(),fog:scene.fogMode};fallback.dispose();
   return {initial,actual:actualSize,resized,depthSize,switched,cleared,unsupported};
  }finally{manager.dispose();scene.dispose();engine.dispose();canvas.remove();}
 });
 await test.info().attach('volume-lifecycle.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 await writeFile('work/volumetric-lifecycle.json',JSON.stringify(result,null,2)+'\n');
 expect(errors).toEqual([]);expect(result.initial.volumetricPixels).toBeLessThanOrEqual(16384);expect(result.initial.ssrEnabled).toBe(true);expect(result.initial.aoEnabled).toBe(true);expect(result.initial.dofEnabled).toBe(true);expect(result.initial.cascadedShadowLights).toBe(1);
 expect(result.actual).toEqual({width:result.initial.volumetricWidth,height:result.initial.volumetricHeight});expect(result.resized.volumetricPixels).toBeLessThanOrEqual(16384);expect(result.depthSize).toEqual([{width:480,height:200}]);expect(result.switched.oldPosts).toBe(0);expect(result.cleared.aPosts).toBe(0);expect(result.cleared.bPosts).toBe(0);expect(result.cleared.borrowed).toBe(true);expect(result.cleared.depths).toBe(1);expect(result.cleared.cameras).toBe(2);expect(result.cleared.volumeTextures).toBe(0);expect(result.unsupported.volumetricEnabled).toBe(false);expect(result.unsupported.fog).toBe(1);
});

test('editor volume controls survive archive, reload and undo',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('menuitem',{name:'项目设置',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'项目设置',exact:true});
 await dialog.getByLabel('体积大气（主视图）',{exact:true}).check();
 await dialog.getByLabel('体积雾密度',{exact:true}).fill('0.045');
 const height=dialog.getByLabel('体积雾基准高度',{exact:true});await height.click();await height.press('ControlOrMeta+A');await height.pressSequentially('-2.5');
 await dialog.getByLabel('体积采样步数',{exact:true}).click();await page.getByRole('option',{name:'64',exact:true}).click();
 await dialog.getByRole('button',{name:'应用',exact:true}).click();await expect(dialog).toBeHidden();
 const result=await page.evaluate(async()=>{
  const {useEditorStore:s}=await import('/src/store/useEditorStore.ts'),{createProjectArchive,importProject}=await import('/src/utils/projectExport.ts');
  const before=s.getState().settings.rendering!.volumetric;const buffer=createProjectArchive();
  await s.getState().saveCurrentProject('Volumetric control test');const id=s.getState().currentProjectId!;s.getState().newProject();await s.getState().loadProjectById(id);
  const loaded=s.getState().settings.rendering!.volumetric;await importProject(new File([buffer],'volume.arkglide'));const parsed=s.getState().settings.rendering!.volumetric;
  s.getState().updateSettings({rendering:{...s.getState().settings.rendering,volumetric:{...loaded,enabled:false}}});s.getState().undo();
  return {before,parsed,loaded,undone:s.getState().settings.rendering!.volumetric};
 });
 expect(result.before?.enabled).toBe(true);expect(result.before?.density).toBe(.045);expect(result.before?.height).toBe(-2.5);expect(result.before?.steps).toBe(64);
 expect(result.parsed).toEqual(result.before);expect(result.loaded).toEqual(result.before);expect(result.undone).toEqual(result.before);
});
