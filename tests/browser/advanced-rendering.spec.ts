import {test,expect} from './fixtures';

test('atmosphere, fog and depth of field change WebGL pixels and release owned targets',async({page})=>{
 await page.goto('/runtime.html');await page.waitForFunction(()=>!!(window as any).ArkGlideAtmosphere);
 const r=await page.evaluate(async()=>{
  const w=window as any,B=w.BABYLON,canvas=document.createElement('canvas');canvas.width=160;canvas.height=128;document.body.append(canvas);
  const engine=new B.Engine(canvas,false,{preserveDrawingBuffer:true}),scene=new B.Scene(engine),camera=new B.FreeCamera('camera',new B.Vector3(0,1,-8),scene);camera.setTarget(new B.Vector3(0,1,0));camera.maxZ=100;
  scene.clearColor.set(0,0,0,1);
  const mesh=B.MeshBuilder.CreatePlane('checker',{size:5,sideOrientation:B.Mesh.DOUBLESIDE},scene);mesh.position.z=3;mesh.position.y=1;
  const data=new Uint8Array(32*32*4);for(let y=0;y<32;y++)for(let x=0;x<32;x++)data.set((x+y)%2?[255,255,255,255]:[20,20,20,255],(y*32+x)*4);
  const texture=B.RawTexture.CreateRGBATexture(data,32,32,scene,false,false,B.Texture.NEAREST_SAMPLINGMODE),mat=new B.StandardMaterial('checker',scene);mat.disableLighting=true;mat.emissiveTexture=texture;mesh.material=mat;
  const manager=w.ArkGlideRendering.create(B,scene);
  const draw=async()=>{await scene.whenReadyAsync();for(let i=0;i<10;i++){scene.render();await new Promise(r=>setTimeout(r,20));}return Array.from(await engine.readPixels(0,0,160,128)) as number[];};
  const diff=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+(i%4===3?0:Math.abs(v-b[i])),0);
  try{
   await manager.sync();const plain=await draw();manager.configure({fog:{mode:'exp2',color:'#2255CC',density:.15}});const fog=await draw();
   manager.configure({sky:{enabled:true,sunElevation:50}});const sky=await draw();manager.configure({sky:{enabled:true,sunElevation:-30}});const night=await draw();
   manager.configure({});const sharp=await draw();manager.configure({dof:{enabled:true,focusDistance:1,focalLength:150,fStop:.5,quality:1}});const blurred=await draw();const enabled=manager.stats();
   manager.clear();const cleared={...manager.stats(),depthTargets:Object.keys(scene._depthRenderer||{}).length,posts:camera._postProcesses.filter(Boolean).length};
   return {fog:diff(plain,fog),sky:diff(plain,sky),night:diff(sky,night),blur:diff(sharp,blurred),enabled,cleared};
  }finally{manager.dispose();scene.dispose();engine.dispose();canvas.remove();}
 });
 expect(r.fog).toBeGreaterThan(1000);expect(r.sky).toBeGreaterThan(1000);expect(r.night).toBeGreaterThan(1000);expect(r.blur).toBeGreaterThan(1000);expect(r.enabled.dofEnabled).toBe(true);expect(r.cleared.depthTargets).toBe(0);expect(r.cleared.posts).toBe(0);expect(r.cleared.atmosphereSky).toBe(false);
});

test('GPU particles emit using the native backend, freeze when paused and clean up owners',async({page})=>{
 await page.goto('/runtime.html');await page.waitForFunction(()=>!!(window as any).ArkGlideVisuals);
 const r=await page.evaluate(async()=>{
  const w=window as any,B=w.BABYLON,canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;document.body.append(canvas);
  const engine=new B.Engine(canvas,false,{preserveDrawingBuffer:true}),scene=new B.Scene(engine),camera=new B.FreeCamera('camera',new B.Vector3(0,0,-4),scene);camera.setTarget(B.Vector3.Zero());
  const releases=new Set<()=>void>(),owner={record:{active:true},track(fn:()=>void){releases.add(fn);return()=>releases.delete(fn);}};
  const visuals=w.ArkGlideVisuals.create(B,{scene,find:()=>null,getObject:()=>null}),api=visuals.forOwner(owner);
  try{
   const handle=api.createParticles({backend:'gpu',capacity:128,rate:120,lifetime:[1,2],size:[.1,.2],velocity:{min:{x:-.2,y:0,z:0},max:{x:.2,y:.5,z:0}},colors:['#FF5500','#FFFFFF'],gravity:{x:0,y:-.1,z:0},emitBox:{min:{x:-.4,y:0,z:0},max:{x:.4,y:0,z:0}},blendMode:'additive',angularSpeed:[-1,1]});
   for(let i=0;i<45;i++){engine.beginFrame();scene.render();engine.endFrame();await new Promise(r=>setTimeout(r,20));}
   const system=scene.particleSystems[0],pixels=Array.from(await engine.readPixels(0,0,96,96)) as number[];
   const active=system.getActiveCount(),stats=visuals.stats(),backend=handle.backend;
   visuals.setScale(0);const time=system._actualFrame;
   for(let i=0;i<8;i++){engine.beginFrame();scene.render();engine.endFrame();await new Promise(r=>setTimeout(r,20));}
   const frozen=system._actualFrame===time;
   owner.record.active=false;for(const release of [...releases])release();
   return {backend,active,stats,frozen,remaining:scene.particleSystems.length,resources:visuals.stats().visualResources,lit:pixels.filter((v,i)=>i%4!==3&&v>180).length};
  }finally{visuals.dispose();scene.dispose();engine.dispose();canvas.remove();}
 });
 expect(r.backend).toBe('gpu');expect(r.active).toBeGreaterThan(0);expect(r.stats.gpuParticleSystems).toBe(1);expect(r.lit).toBeGreaterThan(0);expect(r.frozen).toBe(true);expect(r.remaining).toBe(0);expect(r.resources).toBe(0);
});

test('SSR and bounded planar reflections render real reflected geometry without duplicate captures',async({page})=>{
 await page.goto('/runtime.html');await page.waitForFunction(()=>!!(window as any).ArkGlideReflections);
 const r=await page.evaluate(async()=>{
  const w=window as any,B=w.BABYLON,canvas=document.createElement('canvas');canvas.width=160;canvas.height=128;document.body.append(canvas);
  const engine=new B.Engine(canvas,false,{preserveDrawingBuffer:true}),scene=new B.Scene(engine),camera=new B.FreeCamera('camera',new B.Vector3(0,3,-6),scene);camera.setTarget(new B.Vector3(0,.3,1));
  scene.clearColor.set(.005,.005,.005,1);
  const floor=B.MeshBuilder.CreateGround('mirror',{width:12,height:12},scene),source=new B.PBRMaterial('metal',scene);source.albedoColor.set(.8,.8,.8);source.metallic=1;source.roughness=.03;source.metadata={arkglideManagedMaterial:true};floor.material=source;
  floor.metadata={arkglideRendering:{planarReflection:{enabled:true,axis:'y'}}};
  const box=B.MeshBuilder.CreateBox('emitter',{size:1.6},scene);box.position.set(0,1,1);
  const lamp=new B.PBRMaterial('red',scene);lamp.emissiveColor.set(5,.05,.01);lamp.metallic=0;box.material=lamp;box.metadata={arkglideRendering:{}};
  const manager=w.ArkGlideRendering.create(B,scene);
  const draw=async(n=10)=>{await scene.whenReadyAsync();for(let i=0;i<n;i++){scene.render();await new Promise(r=>setTimeout(r,20));}return Array.from(await engine.readPixels(0,0,160,128)) as number[];};
  const diff=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+(i%4===3?0:Math.abs(v-b[i])),0);
  try{
   manager.configure({color:{toneMapping:'aces'}});await manager.sync();const plain=await draw();
   manager.configure({color:{toneMapping:'aces'},reflections:{ssr:{enabled:true,maxSteps:128,blur:0,downsample:0,thickness:.5}}});const ssr=await draw();const screen=manager.stats();
   manager.configure({color:{toneMapping:'aces'},reflections:{planar:{enabled:true,maxMirrors:1,maxPixels:10000,scale:1}}});const planar=await draw();
   const texture=floor.material.reflectionTexture;let captures=0;texture.onBeforeRenderObservable.add(()=>captures++);await draw(4);
   floor.position.y=.4;floor.rotation.z=.2;await draw(2);const plane=texture.mirrorPlane.asArray(),stats=manager.stats();
   floor.setEnabled(false);await draw(2);const hidden=manager.stats();manager.clear();
   return {ssr:diff(plain,ssr),planar:diff(plain,planar),screen,captures,plane,stats,hidden,cleared:manager.stats(),posts:camera._postProcesses.filter(Boolean).length,geometry:!!scene.geometryBufferRenderer,sourceUnchanged:source.reflectionTexture===null};
  }finally{manager.dispose();scene.dispose();engine.dispose();canvas.remove();}
 });
 await test.info().attach('reflections.json',{body:JSON.stringify(r,null,2),contentType:'application/json'});
 expect(r.ssr).toBeGreaterThan(1000);expect(r.planar).toBeGreaterThan(1000);expect(r.screen.ssrEnabled).toBe(true);expect(r.stats.planarRenderedViews).toBe(1);expect(r.stats.planarRenderedPixels).toBeLessThanOrEqual(10000);expect(r.captures).toBe(6);expect(r.plane[0]).toBeGreaterThan(.1);expect(r.sourceUnchanged).toBe(true);expect(r.hidden.planarReflections).toBe(0);expect(r.cleared.planarReflections).toBe(0);expect(r.posts).toBe(0);expect(r.geometry).toBe(false);
});
