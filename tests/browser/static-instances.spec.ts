import {test,expect} from './fixtures';
import {writeFile} from 'node:fs/promises';

test('native instance batches preserve WebGL pixels and picking while reducing actual draws',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/runtime.html');await page.waitForFunction(()=>!!(window as any).ArkGlideStaticInstances);
 const result=await page.evaluate(async()=>{
  const w=window as any,B=w.BABYLON,canvas=document.createElement('canvas');canvas.width=192;canvas.height=144;document.body.append(canvas);
  const engine=new B.Engine(canvas,false,{preserveDrawingBuffer:true}),scene=new B.Scene(engine),camera=new B.FreeCamera('main',new B.Vector3(0,13,-18),scene);camera.setTarget(new B.Vector3(0,0,10));camera.maxZ=100;
  new B.HemisphericLight('ambient',B.Axis.Y,scene).intensity=.8;
  const light=new B.DirectionalLight('sun',new B.Vector3(.4,-1,.2),scene);light.metadata={arkglideRendering:{}};
  const material=(id:string,color:string)=>({id,name:id,baseColor:color,emissiveColor:'#000000',metallic:0,roughness:.8,alpha:1,doubleSided:false,uvScale:{u:1,v:1}});
  const content={materials:{rock:material('rock','#B97942'),blue:material('blue','#4A8CDE')},textures:[]};
  const parent={id:'parent',name:'parent',type:'empty',transform:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};
  const boxes=Array.from({length:64},(_,i)=>({id:'box-'+i,name:'box '+i,type:'mesh',primitive:'box',parentId:'parent',materialId:'rock',transform:{x:(i%8-3.5)*1.8,y:.5,z:Math.floor(i/8)*2.1},scale:{x:1,y:1,z:1},optimization:{instancing:false}}));
  const floor={id:'floor',name:'floor',type:'mesh',primitive:'plane',materialId:'rock',transform:{x:0,y:0,z:10},scale:{x:20,y:1,z:24}};
  const adapter=w.ArkGlideScene.createSceneAdapter(B,scene),draw=async()=>{await scene.whenReadyAsync();for(let i=0;i<6;i++){scene.render();await new Promise(r=>setTimeout(r,15));}return Array.from(await engine.readPixels(0,0,192,144)) as number[];};
  const difference=(a:number[],b:number[])=>a.reduce((sum,v,i)=>sum+(i%4===3?0:Math.abs(v-b[i])),0)/(192*144*3);
  try {
   await adapter.sync([parent,...boxes,floor],{},content,{});const plain=await draw(),baseline=adapter.rendering.stats();
   const settings={shadows:{enabled:true,mapSize:512},volumetric:{enabled:true,density:.015,falloff:.1,noiseStrength:0,steps:32,shadowMapSize:256,shadowDistance:30}};
   adapter.rendering.configure(settings);const plainEffects=await draw();
   const instanced=boxes.map(n=>({...n,optimization:{instancing:true}}));await adapter.sync([parent,...instanced,floor],{},content,{});const batchedEffects=await draw(),withEffects=adapter.rendering.stats();
   adapter.rendering.configure({});const batched=await draw(),batches=adapter.rendering.stats();
   const object=adapter.nodes.get('box-3'),point=object.getAbsolutePosition(),direction=point.subtract(camera.globalPosition).normalize();
   const hit=scene.pickWithRay(new B.Ray(camera.globalPosition,direction), (m:any)=>m===object);
   const picked=hit.pickedMesh?.metadata?.arkglideId;
   adapter.nodes.get('parent').position.x=1;await draw();const parentDelta=adapter.nodes.get('box-4').getAbsolutePosition().x-boxes[4].transform.x;
   object.position.x+=2;object.setEnabled(false);await draw();const hidden=adapter.rendering.stats();object.dispose(false,true);await draw();
   const ownedMaterial=adapter.materials.get('rock'),afterDelete={...adapter.instanceStats(),materialKept:scene.materials.includes(ownedMaterial),otherMaterial:adapter.nodes.get('box-4').material===ownedMaterial};
   const remaining=instanced.filter(n=>n.id!=='box-3').map(n=>n.id==='box-4'?{...n,materialId:'blue',receiveShadows:false}:n);await adapter.sync([parent,...remaining,floor],{},content,{});await draw();const regrouped=adapter.rendering.stats();
   adapter.clear();const cleared={meshes:scene.meshes.length,geometries:scene.geometries.length,materials:scene.materials.length,stats:adapter.instanceStats(),depths:Object.keys(scene._depthRenderer||{}).length};
   return {baseline,batches,withEffects,pixelDifference:difference(plain,batched),effectPixelDifference:difference(plainEffects,batchedEffects),picked,hit:hit.hit,parentDelta,hidden,afterDelete,regrouped,cleared};
  }finally{adapter.dispose();scene.dispose();engine.dispose();canvas.remove();}
 });
 await writeFile('work/static-instances-browser.json',JSON.stringify(result,null,2)+'\n');await test.info().attach('instance-batches.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 expect(errors).toEqual([]);expect(result.baseline.renderDrawCalls).toBeGreaterThan(50);expect(result.batches.renderDrawCalls).toBeLessThanOrEqual(3);expect(result.batches.instanceBatches).toBe(1);expect(result.batches.instancedMeshes).toBe(64);expect(result.pixelDifference).toBeLessThan(.1);expect(result.effectPixelDifference).toBeLessThan(1);expect(result.baseline.renderMainTriangles).toBe(result.batches.renderMainTriangles);expect(result.picked).toBe('box-3');
 expect(result.hidden.renderMainTriangles).toBeLessThan(result.batches.renderMainTriangles);expect(result.afterDelete.materialKept).toBe(true);expect(result.afterDelete.otherMaterial).toBe(true);expect(result.afterDelete.instancedMeshes).toBe(63);expect(result.afterDelete.instanceSkippedMeshes).toBe(0);expect(result.regrouped.instanceBatches).toBe(2);expect(result.cleared.meshes).toBe(0);expect(result.cleared.geometries).toBe(0);expect(result.cleared.materials).toBe(0);expect(result.cleared.depths).toBe(0);
 expect(result.parentDelta).toBeCloseTo(1,4);
});

test('editor instance flag persists, creates a shared batch and contributes correct resource geometry',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');s.getState().detachScript('cube','main.js');const material=s.getState().createMaterial('Instances');s.getState().setNodeMaterial('cube',material);s.getState().selectNode('cube');});
 await page.getByLabel('静态实例批次',{exact:true}).check();
 const result=await page.evaluate(async()=>{
  const {useEditorStore:s}=await import('/src/store/useEditorStore.ts'),{getEditorScene}=await import('/src/engine/editor-scene.ts'),{scanResourceBudget}=await import('/src/utils/resourceBudget.ts');
  await new Promise(r=>setTimeout(r,250));const initial=s.getState().nodes.find(n=>n.id==='cube')!.optimization;
  const cube=s.getState().nodes.find(n=>n.id==='cube')!;const copy={...cube,id:'instance-copy',name:'instance copy',transform:{...cube.transform,x:3}};
  const state=s.getState();s.setState({nodes:[...state.nodes,copy]});
  const {scene,adapter}=getEditorScene();await adapter.sync(s.getState().nodes,s.getState().modelBuffers,s.getState().content,s.getState().textureBuffers);const stats=adapter.instanceStats();
  const report=await scanResourceBudget(s.getState(),new AbortController().signal);
  await s.getState().saveCurrentProject('Instance setting test');const id=s.getState().currentProjectId!;s.getState().newProject();await s.getState().loadProjectById(id);
  return {initial,stats,geometry:report.geometry,optimization:report.optimization,saved:s.getState().nodes.find(n=>n.id==='cube')!.optimization};
 });
 expect(result.initial?.instancing).toBe(true);expect(result.saved?.instancing).toBe(true);expect(result.stats.instanceBatches).toBe(1);expect(result.stats.instancedMeshes).toBe(2);expect(result.geometry.uniqueGeometries).toBeLessThan(result.geometry.meshes);expect(result.geometry.vertexAndIndexBytes).toBeGreaterThan(0);expect(result.optimization.instanceBatches).toBe(1);
});
