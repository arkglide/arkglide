import {test,expect} from './fixtures';

test('editor bakes real lightmaps in a WASM worker and undoes the resource transaction',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.waitForSelector('#viewport');
 const initial=await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');s.getState().newProject();s.getState().detachScript('cube','main.js');s.getState().selectNode('cube');return {textures:s.getState().content.textures.length,materials:Object.keys(s.getState().content.materials).length};});
 await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('menuitem',{name:'静态光照烘焙…',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'静态光照烘焙',exact:true});await dialog.getByLabel('每个网格的光照分辨率',{exact:true}).click();await page.getByRole('option',{name:'32 × 32',exact:true}).click();
 await dialog.getByRole('button',{name:'开始烘焙',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible({timeout:60000});await expect(dialog.getByRole('alert')).toContainText('已生成 1 张光照图');
 const baked=await page.evaluate(async()=>{
  const {useEditorStore:s}=await import('/src/store/useEditorStore.ts'),{getEditorScene}=await import('/src/engine/editor-scene.ts'),state=s.getState(),node=state.nodes.find(n=>n.id==='cube')!,mat=state.content.materials[node.materialId!],buffer=state.textureBuffers.get(mat.lightmapTextureId!)!;
  const image=await createImageBitmap(new Blob([buffer],{type:'image/png'})),canvas=new OffscreenCanvas(32,32),ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);image.close();const pixels=ctx.getImageData(0,0,32,32).data;
  const mesh=getEditorScene().adapter.nodes.get('cube');return {baked:mat.bakedDirectLighting,signature:node.bakedLighting?.signature,png:buffer.byteLength,uv2:mesh.isVerticesDataPresent('uv2'),direct:mesh.material.directIntensity,max:Math.max(...pixels.filter((_,i)=>i%4!==3)),min:Math.min(...pixels.filter((_,i)=>i%4!==3))};
 });
 expect(baked.baked).toBe(true);expect(baked.signature).toMatch(/^[\da-f]{8}$/);expect(baked.png).toBeGreaterThan(80);expect(baked.uv2).toBe(true);expect(baked.direct).toBe(0);expect(baked.max).toBeGreaterThan(baked.min+20);
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();
 const undone=await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');s.getState().undo();const state=s.getState();return {textures:state.content.textures.length,materials:Object.keys(state.content.materials).length,bake:state.nodes.find(n=>n.id==='cube')?.bakedLighting};});
 expect(undone.textures).toBe(initial.textures);expect(undone.materials).toBe(initial.materials);expect(undone.bake).toBeUndefined();expect(errors).toEqual([]);
});

test('cascaded directional shadows render pixels, follow the main camera and release layered targets',async({page})=>{
 await page.goto('/runtime.html');await page.waitForFunction(()=>!!(window as any).ArkGlideRendering);
 const r=await page.evaluate(async()=>{
  const w=window as any,B=w.BABYLON,canvas=document.createElement('canvas');canvas.width=160;canvas.height=128;document.body.append(canvas);
  const engine=new B.Engine(canvas,false,{preserveDrawingBuffer:true}),scene=new B.Scene(engine),camera=new B.FreeCamera('camera',new B.Vector3(4,4,-6),scene);camera.setTarget(B.Vector3.Zero());camera.maxZ=80;
  const light=new B.DirectionalLight('sun',new B.Vector3(-.3,-1,.3),scene);light.position.set(4,8,-4);light.metadata={arkglideRendering:{castShadows:true}};
  const floor=B.MeshBuilder.CreateGround('floor',{width:12,height:12},scene),box=B.MeshBuilder.CreateBox('box',{size:1.5},scene);box.position.y=.75;
  const mat=new B.StandardMaterial('surface',scene);mat.diffuseColor.set(.8,.8,.8);mat.specularColor.set(0,0,0);for(const mesh of [floor,box]){mesh.material=mat;mesh.metadata={arkglideRendering:{castShadows:true,receiveShadows:true}};}
  const manager=w.ArkGlideRendering.create(B,scene),draw=async()=>{await scene.whenReadyAsync();for(let i=0;i<5;i++){scene.render();await new Promise(r=>setTimeout(r,15));}return Array.from(await engine.readPixels(0,0,160,128)) as number[];};
  try{
   manager.configure({});await manager.sync();const plain=await draw();
   manager.configure({shadows:{enabled:true,maxDistance:50,cascades:{enabled:true,count:3}}});const shadowed=await draw();
   const generator=light.getShadowGenerator(camera),native=generator instanceof B.CascadedShadowGenerator,count=generator.numCascades;
   const second=new B.FreeCamera('second',new B.Vector3(5,3,-7),scene);second.setTarget(B.Vector3.Zero());scene.activeCamera=second;await draw();const switched=light.getShadowGenerator(second)!==generator;
   manager.clear();return {native,count,switched,diff:plain.reduce((sum,v,i)=>sum+(i%4===3?0:Math.abs(v-shadowed[i])),0),remaining:scene.textures.filter((t:any)=>t.name.includes('shadowMap')).length};
  }finally{manager.dispose();scene.dispose();engine.dispose();canvas.remove();}
 });
 expect(r.native).toBe(true);expect(r.count).toBe(3);expect(r.switched).toBe(true);expect(r.diff).toBeGreaterThan(1000);expect(r.remaining).toBe(0);
});

test('baked irradiance renders textured PBR albedo instead of adding white light',async({page})=>{
 await page.goto('/runtime.html');await page.waitForFunction(()=>!!(window as any).ArkGlideBakedLighting);
 const r=await page.evaluate(async()=>{
  const {encodeLightmap}=await import('/src/engine/light-bake.mjs');
  const w=window as any,B=w.BABYLON,canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;document.body.append(canvas);
  const engine=new B.Engine(canvas,false,{preserveDrawingBuffer:true}),scene=new B.Scene(engine),camera=new B.FreeCamera('camera',new B.Vector3(0,3,-.01),scene);camera.setTarget(B.Vector3.Zero());scene.clearColor.set(0,0,0,1);
  const rgb=new Float32Array(32*32*3).fill(1),png=encodeLightmap(rgb,32).png,content={materials:{baked:{id:'baked',name:'baked',baseColor:'#20C040',emissiveColor:'#000000',metallic:0,roughness:1,alpha:1,doubleSided:false,uvScale:{u:1,v:1},lightmapTextureId:'lm',lightmapUV:1,bakedDirectLighting:true}},textures:[{id:'lm',name:'light.png',mime:'image/png',byteLength:png.byteLength}]};
  const adapter=w.ArkGlideScene.createSceneAdapter(B,scene),nodes=[{id:'floor',name:'floor',type:'mesh',primitive:'plane',materialId:'baked',bakedLighting:{autoUV2:true,signature:'00000000'},transform:{x:0,y:0,z:0},scale:{x:4,y:1,z:4}}];
  try{
   await adapter.sync(nodes,{},content,{lm:png.buffer});await scene.whenReadyAsync();for(let i=0;i<5;i++){scene.render();await new Promise(r=>setTimeout(r,15));}
   const image=await engine.readPixels(0,0,96,96),at=(48*96+48)*4,green=Array.from(image.slice(at,at+3));
   const material=adapter.nodes.get('floor').material;adapter.clear();return {green,direct:material.directIntensity,textures:scene.textures.filter((t:any)=>t.name.startsWith('arkglide:texture:')).length};
  }finally{adapter.dispose();scene.dispose();engine.dispose();canvas.remove();}
 });
 expect(r.green[1]).toBeGreaterThan(r.green[0]*1.5);expect(r.green[1]).toBeGreaterThan(r.green[2]*1.3);expect(r.green[1]).toBeGreaterThan(100);expect(r.direct).toBe(0);expect(r.textures).toBe(0);
});

test('cancel terminates the actual bake worker without writing partial assets',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');s.getState().newProject();s.getState().detachScript('cube','main.js');s.getState().selectNode('cube');});
 await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('menuitem',{name:'静态光照烘焙…',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'静态光照烘焙',exact:true});await dialog.getByLabel('每个网格的光照分辨率',{exact:true}).click();await page.getByRole('option',{name:'1024 × 1024',exact:true}).click();
 await dialog.getByRole('button',{name:'开始烘焙',exact:true}).click();await dialog.getByRole('button',{name:'取消烘焙',exact:true}).click();await expect(dialog).toBeHidden();
 await expect.poll(()=>page.workers().filter(w=>w.url().includes('light-bake.worker')).length).toBe(0);
 const state=await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return {textures:s.getState().content.textures.length,baked:s.getState().nodes.some(n=>n.bakedLighting)};});
 expect(state.textures).toBe(0);expect(state.baked).toBe(false);
});
