import {test,expect} from './fixtures';

test('editor controls persist atmosphere, reflection and advanced material settings',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');const id=s.getState().createMaterial('Layered');s.getState().setNodeMaterial('cube',id);s.getState().selectNode('cube');});
 const panel=page.getByTestId('advanced-material');
 await panel.getByLabel('清漆层',{exact:true}).check();await panel.getByLabel('清漆粗糙度',{exact:true}).fill('0.2');
 await panel.getByLabel('织物光泽',{exact:true}).check();await panel.getByLabel('各向异性',{exact:true}).check();
 const uv=panel.getByLabel('UV 偏移 U',{exact:true});await uv.click();await uv.press('ControlOrMeta+A');await uv.pressSequentially('-0.3');await expect(uv).toHaveValue('-0.3');
 await panel.getByLabel('透明模式',{exact:true}).click();await page.getByRole('option',{name:'透明裁切',exact:true}).click();
 await page.getByLabel('平面反射（需在画面设置中开启）',{exact:true}).check();
 await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('menuitem',{name:'项目设置',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'项目设置',exact:true});
 await dialog.getByLabel('大气雾',{exact:true}).click();await page.getByRole('option',{name:'指数平方雾',exact:true}).click();
 await dialog.getByLabel('程序大气天空',{exact:true}).check();await dialog.getByLabel('景深（主视图）',{exact:true}).check();
 const elevation=dialog.getByLabel('太阳高度（度）',{exact:true});await elevation.click();await elevation.press('ControlOrMeta+A');await elevation.pressSequentially('-5.5');await expect(elevation).toHaveValue('-5.5');
 await dialog.getByLabel('屏幕空间反射（SSR，主视图）',{exact:true}).check();await dialog.getByLabel('平面反射（在节点属性中指定反射面）',{exact:true}).check();
 await dialog.getByRole('button',{name:'应用',exact:true}).click();await expect(dialog).toBeHidden();
 const r=await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');const state=s.getState(),node=state.nodes.find(n=>n.id==='cube')!;return {rendering:state.settings.rendering!,material:state.content.materials[node.materialId!],planar:node.planarReflection};});
 expect(r.rendering.fog?.mode).toBe('exp2');expect(r.rendering.sky?.enabled).toBe(true);expect(r.rendering.dof?.enabled).toBe(true);expect(r.rendering.reflections?.ssr?.enabled).toBe(true);expect(r.material.clearCoat?.roughness).toBe(.2);expect(r.material.sheen?.enabled).toBe(true);expect(r.material.anisotropy?.enabled).toBe(true);expect(r.material.alphaMode).toBe('mask');expect(r.planar?.enabled).toBe(true);expect(errors).toEqual([]);
 expect(r.material.uvOffset?.u).toBe(-.3);expect(r.rendering.sky?.sunElevation).toBe(-5.5);
});

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
 await page.goto('/runtime.html');await page.waitForFunction(()=>!!(window as any).ArkGlideReflections&&!!(window as any).coreModule);
 const r=await page.evaluate(async()=>{
  const w=window as any,B=w.BABYLON,canvas=document.createElement('canvas');canvas.width=160;canvas.height=128;document.body.append(canvas);
  const engine=new B.Engine(canvas,false,{preserveDrawingBuffer:true}),scene=new B.Scene(engine),camera=new B.FreeCamera('camera',new B.Vector3(0,3,-6),scene);camera.setTarget(new B.Vector3(0,.3,1));
  scene.clearColor.set(.005,.005,.005,1);
  const floor=B.MeshBuilder.CreateGround('mirror',{width:12,height:12},scene),source=new B.PBRMaterial('metal',scene);source.albedoColor.set(.8,.8,.8);source.metallic=1;source.roughness=.03;source.metadata={arkglideManagedMaterial:true};floor.material=source;
  source.emissiveColor.set(.02,.04,.06);
  floor.metadata={arkglideRendering:{planarReflection:{enabled:true,axis:'y'}}};
  const box=B.MeshBuilder.CreateBox('emitter',{size:1.6},scene);box.position.set(0,1,1);
  const lamp=new B.PBRMaterial('red',scene);lamp.emissiveColor.set(5,.05,.01);lamp.metallic=0;box.material=lamp;box.metadata={arkglideRendering:{}};
  const compute=w.ArkGlideRenderCompute.create(B,w.coreModule,{viewsMinPortals:0}),manager=w.ArkGlideRendering.create(B,scene,{renderCompute:compute});
  const draw=async(n=10)=>{await scene.whenReadyAsync();for(let i=0;i<n;i++){scene.render();await new Promise(r=>setTimeout(r,20));}return Array.from(await engine.readPixels(0,0,160,128)) as number[];};
  const diff=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+(i%4===3?0:Math.abs(v-b[i])),0);
  try{
   manager.configure({color:{toneMapping:'aces'}});await manager.sync();const plain=await draw();
   manager.configure({color:{toneMapping:'aces'},reflections:{ssr:{enabled:true,maxSteps:8,maxDistance:.1,thickness:.001,blur:0,downsample:0}}});const missed=await draw();
   manager.configure({color:{toneMapping:'aces'},reflections:{ssr:{enabled:true,maxSteps:128,blur:0,downsample:0,thickness:.5}}});const ssr=await draw();const screen=manager.stats();
   manager.configure({color:{toneMapping:'aces'},reflections:{planar:{enabled:true,maxMirrors:1,maxPixels:10000,scale:1}}});const planar=await draw();
   const texture=floor.material.reflectionTexture;let captures=0;texture.onBeforeRenderObservable.add(()=>captures++);await draw(4);
   floor.position.y=.4;floor.rotation.z=.2;await draw(2);const plane=texture.mirrorPlane.asArray(),stats=manager.stats();
   floor.setEnabled(false);await draw(2);const hidden=manager.stats();manager.clear();
   const cleared=manager.stats(),posts=camera._postProcesses.filter(Boolean).length,geometry=!!scene.geometryBufferRenderer;
   const borrowed=scene.enableGeometryBufferRenderer(),oldReflectivity=borrowed.enableReflectivity,depth=scene.enableDepthRenderer(camera);
   manager.configure({reflections:{ssr:{enabled:true}},ao:{enabled:true},dof:{enabled:true}});await manager.sync();await draw(3);manager.clear();
   const borrowedKept=scene.geometryBufferRenderer===borrowed&&borrowed.enableReflectivity===oldReflectivity&&scene._depthRenderer[camera.uniqueId]===depth;
   const red=(image:number[])=>{let count=0;for(let y=0;y<55;y++)for(let x=0;x<160;x++){const at=(y*160+x)*4;if(image[at]>80&&image[at]>image[at+1]*1.8&&image[at]>image[at+2]*1.8)count++;}return count;};
   return {plainRed:red(plain),ssrRed:red(ssr),planarRed:red(planar),missed:diff(plain,missed),ssr:diff(plain,ssr),planar:diff(plain,planar),screen,captures,plane,stats,hidden,cleared,posts,geometry,borrowedKept,nativeBatches:compute.stats().viewBudgetNativeBatches,sourceUnchanged:source.reflectionTexture===null};
  }finally{manager.dispose();compute.dispose();scene.dispose();engine.dispose();canvas.remove();}
 });
 await test.info().attach('reflections.json',{body:JSON.stringify(r,null,2),contentType:'application/json'});
 expect(r.ssr).toBeGreaterThan(1000);expect(r.planar).toBeGreaterThan(1000);expect(r.screen.ssrEnabled).toBe(true);expect(r.stats.planarRenderedViews).toBe(1);expect(r.stats.planarRenderedPixels).toBeLessThanOrEqual(10000);expect(r.captures).toBe(6);expect(r.plane[0]).toBeGreaterThan(.1);expect(r.sourceUnchanged).toBe(true);expect(r.hidden.planarReflections).toBe(0);expect(r.cleared.planarReflections).toBe(0);expect(r.posts).toBe(0);expect(r.geometry).toBe(false);
 expect(r.borrowedKept).toBe(true);expect(r.nativeBatches).toBeGreaterThan(0);
 expect(r.missed).toBeLessThan(3000);
 expect(r.ssrRed).toBeGreaterThan(r.plainRed+20);expect(r.planarRed).toBeGreaterThan(r.plainRed+20);
});

test('advanced PBR layers, environment transmission, detail maps and alpha masks change real pixels',async({page})=>{
 await page.goto('/runtime.html');await page.waitForFunction(()=>!!(window as any).ArkGlideRenderingConfig.material);
 const r=await page.evaluate(async()=>{
  const w=window as any,B=w.BABYLON,canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;document.body.append(canvas);
  const engine=new B.Engine(canvas,false,{preserveDrawingBuffer:true}),scene=new B.Scene(engine),camera=new B.FreeCamera('camera',new B.Vector3(0,.4,-4),scene);camera.setTarget(B.Vector3.Zero());scene.clearColor.set(.03,.1,.3,1);
  const light=new B.PointLight('light',new B.Vector3(-2,3,-3),scene);light.intensity=45;const hemi=new B.HemisphericLight('ambient',B.Axis.Y,scene);hemi.intensity=.2;
  const adapter=w.ArkGlideScene.createSceneAdapter(B,scene),textures:any[]=[],buffers=new Map<string,ArrayBuffer>();
  const png=async(id:string,color:number[])=>{const c=document.createElement('canvas');c.width=4;c.height=4;const context=c.getContext('2d')!,pixels=context.createImageData(4,4);for(let y=0;y<4;y++)for(let x=0;x<4;x++)pixels.data.set(id==='mask'?[255,255,255,(x+y)%2?0:255]:color,(y*4+x)*4);context.putImageData(pixels,0,0);const blob=await new Promise<Blob>(r=>c.toBlob(b=>r(b!)));const data=await blob.arrayBuffer();buffers.set(id,data);textures.push({id,name:id+'.png',mime:'image/png',byteLength:data.byteLength});};
  await png('coat',[255,32,0,255]);await png('sheen',[255,100,40,128]);await png('direction',[255,128,255,255]);await png('detail',[190,128,60,128]);await png('mask',[255,255,255,255]);
  const header=new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 4 +X 8\n'),hdr=new Uint8Array(header.length+128);hdr.set(header);for(let i=header.length;i<hdr.length;i+=4)hdr.set([130,160,210,129],i);
  buffers.set('env',hdr.buffer);textures.push({id:'env',name:'env.hdr',mime:'image/vnd.radiance',byteLength:hdr.byteLength});
  adapter.rendering.configure({environment:{textureId:'env',intensity:.6},color:{toneMapping:'aces'}});
  const nodes=[{id:'surface',name:'surface',type:'mesh',primitive:'sphere',transform:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:2,y:2,z:2},visible:true,materialId:'surface'}];
  const base={id:'surface',name:'Surface',baseColor:'#907050',emissiveColor:'#000000',metallic:0,roughness:.7,alpha:1,doubleSided:false,uvScale:{u:1,v:1}};
  const draw=async(patch:any={})=>{await adapter.sync(nodes,new Map(),{textures,materials:{surface:{...base,...patch}}},buffers);await scene.whenReadyAsync();for(let i=0;i<5;i++){scene.render();await new Promise(r=>setTimeout(r,20));}return Array.from(await engine.readPixels(0,0,128,128)) as number[];};
  const diff=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+(i%4===3?0:Math.abs(v-b[i])),0);
  try{
   const plain=await draw(),coat=await draw({clearCoat:{enabled:true,roughness:.02},clearCoatTextureId:'coat'}),sheen=await draw({sheen:{enabled:true,color:'#FFEEDD',roughness:.4},sheenTextureId:'sheen'});
   const metal=await draw({metallic:1,roughness:.4}),anisotropic=await draw({metallic:1,roughness:.4,anisotropy:{enabled:true,intensity:.95,rotation:1},anisotropyTextureId:'direction'});
   const transmission=await draw({transmission:{enabled:true,intensity:1,ior:1.6,thickness:1,tintColor:'#55CC88',tintDistance:1}});
   const detail=await draw({detail:{enabled:true,scale:8,diffuse:1,normal:0,roughness:1},detailTextureId:'detail'});
   const opaque=await draw({albedoTextureId:'mask',alphaMode:'opaque'}),masked=await draw({albedoTextureId:'mask',alphaMode:'mask',alphaCutoff:.5});
   const material=adapter.materials.get('surface');return {coat:diff(plain,coat),sheen:diff(plain,sheen),anisotropy:diff(metal,anisotropic),transmission:diff(plain,transmission),detail:diff(plain,detail),mask:diff(opaque,masked),alpha:material.transparencyMode,hasAlpha:material.albedoTexture.hasAlpha};
  }finally{adapter.dispose();scene.dispose();engine.dispose();canvas.remove();}
 });
 await test.info().attach('advanced-materials.json',{body:JSON.stringify(r,null,2),contentType:'application/json'});
 for(const field of ['coat','sheen','anisotropy','transmission','detail','mask'] as const)expect(r[field],field).toBeGreaterThan(100);
 expect(r.hasAlpha).toBe(true);expect(r.alpha).toBe(1);
});
