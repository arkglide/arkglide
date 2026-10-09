import { test, expect } from '@playwright/test';

test('editor roadmap: model authoring, persistence, runtime, isolation and WASM', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.waitForSelector('#viewport');
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(r => r.name.includes('/@babylonjs_core.js?')));
  await page.evaluate(async () => {
    const coreUrl = performance.getEntriesByType('resource').map(r=>r.name).find(n=>n.includes('/@babylonjs_core.js?'))!;
    (window as any).auditB = await import(coreUrl);
    const B = (window as any).auditB, attach = B.GizmoManager.prototype.attachToNode;
    B.GizmoManager.prototype.attachToNode = function(node:any) { (window as any).auditManager = this; return attach.call(this,node); };
    const { useEditorStore } = await import('/src/store/useEditorStore.ts');
    (window as any).auditStore = useEditorStore;
  });
  let runtime = page.frames().find(frame => frame.url().endsWith('/runtime.html'))!;
  await runtime.waitForFunction(() => (window as any).math?.backend === 'wasm',undefined,{polling:50});

  await test.step('GLB loader, asset drag/drop and restored model geometry', async () => {
    expect(await page.evaluate(() => (window as any).auditB.SceneLoader.IsPluginForExtensionAvailable('.glb'))).toBe(true);
    expect(await runtime.evaluate(() => (window as any).BABYLON.SceneLoader.IsPluginForExtensionAvailable('.glb'))).toBe(true);
    await page.evaluate(() => {
      const data=new Float32Array([0,0,0,1,0,0,0,1,0]);
      const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],buffers:[{byteLength:data.byteLength}],bufferViews:[{buffer:0,byteOffset:0,byteLength:data.byteLength}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}]};
      const raw=new TextEncoder().encode(JSON.stringify(json)),n=Math.ceil(raw.length/4)*4;
      const buf=new ArrayBuffer(12+8+n+8+data.byteLength),v=new DataView(buf);
      v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,buf.byteLength,true);v.setUint32(12,n,true);v.setUint32(16,0x4e4f534a,true);
      new Uint8Array(buf,20,n).fill(32);new Uint8Array(buf,20,raw.length).set(raw);v.setUint32(20+n,data.byteLength,true);v.setUint32(24+n,0x004e4942,true);new Uint8Array(buf,28+n).set(new Uint8Array(data.buffer));
      const s=(window as any).auditStore;
      s.getState().setAssets([{id:'triangle',name:'triangle.glb',path:'triangle.glb',type:'model',size:buf.byteLength,file:new File([buf],'triangle.glb')}]);
      const dt=new DataTransfer();dt.setData('application/json',JSON.stringify({assetId:'triangle',name:'triangle.glb',path:'triangle.glb'}));
      document.querySelector('#viewport')!.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true}));
    });
    await expect.poll(() => page.evaluate(() => {
      const s=(window as any).auditStore,sc=(window as any).auditB.EngineStore.LastCreatedScene;
      const n=s.getState().nodes.find((n:any)=>n.type==='model');
      return n ? sc.getTransformNodeByName(n.id)?.getChildMeshes().reduce((sum:number,m:any)=>sum+m.getTotalVertices(),0) : 0;
    })).toBe(3);
    await page.evaluate(async () => {
      const s=(window as any).auditStore;
      (window as any).modelId=s.getState().nodes.find((n:any)=>n.type==='model').id;
      await s.getState().saveCurrentProject('Browser roundtrip');
      (window as any).savedId=s.getState().currentProjectId;
      const {createProjectArchive}=await import('/src/utils/projectExport.ts');
      (window as any).projectZip=createProjectArchive();
      s.getState().newProject();
      await s.getState().loadProjectById((window as any).savedId);
    });
    await expect.poll(() => page.evaluate(() => (window as any).auditB.EngineStore.LastCreatedScene.getTransformNodeByName((window as any).modelId)?.getChildMeshes().reduce((sum:number,m:any)=>sum+m.getTotalVertices(),0))).toBe(3);
  });

  let ids: { cube:string;group:string;light:string;camera:string };
  await test.step('shape, groups, light, camera and scripts on all entity types', async () => {
    ids=await page.evaluate(() => {
      const s=(window as any).auditStore;
      const group=s.getState().addNode('empty','Group');s.getState().updateTransform(group,{transform:{x:10,y:0,z:0}});
      const cube=s.getState().addNode('mesh','Cube');s.getState().updateTransform(cube,{transform:{x:2,y:0,z:0}});s.getState().setParent(cube,group);
      const light=s.getState().addNode('light','Test light');s.getState().updateTransform(light,{lightType:'point',intensity:0});
      const camera=s.getState().addNode('camera','Test camera');s.getState().updateTransform(camera,{fov:90,activeCamera:true});
      s.getState().createScript('check.js');s.getState().updateScript('check.js',"return {onStart(){console.log('bound:'+this.entity.id+':'+math.backend);}};");
      [group,light,camera].forEach(id=>s.getState().attachScript(id,'check.js'));
      return {cube,group,light,camera};
    });
    const editor=await page.evaluate(({cube,light,camera})=>{
      const sc=(window as any).auditB.EngineStore.LastCreatedScene,m=sc.getMeshByName(cube);m.computeWorldMatrix(true);
      return {vertices:m.getTotalVertices(),worldX:m.getAbsolutePosition().x,intensity:sc.getLightByName(light+':light').intensity,fov:sc.getCameraByName(camera+':camera').fov};
    },ids!);
    expect(editor.vertices).toBe(24);expect(editor.worldX).toBe(12);expect(editor.intensity).toBe(0);expect(editor.fov).toBeCloseTo(Math.PI/2);
    await page.evaluate(()=> (window as any).auditStore.getState().play());
    await runtime.waitForFunction(() => (window as any).lifecycleInstances.length >= 4,undefined,{polling:50});
    const actual=await runtime.evaluate(({cube,camera})=>{
      const w=window as any,m=w.scene.getMeshByName(cube);m.computeWorldMatrix(true);
      return {vertices:m.getTotalVertices(),worldX:m.getAbsolutePosition().x,apiWorldX:w.sceneAPI.find(cube).getWorldPosition().x,activeCamera:w.scene.activeCamera.name,backend:w.math.backend};
    },ids!);
    expect(actual).toEqual({vertices:24,worldX:12,apiWorldX:12,activeCamera:ids!.camera+':camera',backend:'wasm'});
    const logText=await page.evaluate(()=>(window as any).auditStore.getState().consoleLogs.map((l:any)=>l.text).join('\n'));
    for(const id of [ids!.group,ids!.light,ids!.camera])expect(logText).toContain('bound:'+id+':wasm');
    await page.evaluate(()=>(window as any).auditStore.getState().stop());
    await runtime.waitForFunction(()=>(window as any).sceneAPI.getEntityCount()===0,undefined,{polling:50});
  });

  await test.step('coordinates, group rotation/scale, copy and undo', async () => {
    const created=await page.evaluate(() => {
      const s=(window as any).auditStore;
      const a=s.getState().addNode('mesh','Cube'),b=s.getState().addNode('mesh','Cube');
      s.getState().updateTransform(a,{transform:{x:-1,y:0,z:0}});s.getState().updateTransform(b,{transform:{x:1,y:0,z:0}});
      s.getState().selectNodes([a,b]);return {a,b};
    });
    await page.getByRole('button',{name:'Local',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).auditManager.coordinatesMode)).toBe(await page.evaluate(()=>(window as any).auditB.GizmoCoordinatesMode.Local));
    await page.getByRole('button',{name:'Global',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).auditManager.coordinatesMode)).toBe(await page.evaluate(()=>(window as any).auditB.GizmoCoordinatesMode.World));
    // Exercise the actual drag observers, render synchronization and store commit.
    await page.evaluate(()=>(window as any).auditStore.getState().setGizmoMode('rotate'));
    await expect.poll(()=>page.evaluate(()=>(window as any).auditManager.rotationGizmoEnabled)).toBe(true);
    const rotation=await page.evaluate(({a,b})=>{
      const w=window as any,s=w.auditStore,B=w.auditB,manager=w.auditManager,sc=B.EngineStore.LastCreatedScene;
      const history=s.getState().past.length;
      manager.gizmos.rotationGizmo.onDragStartObservable.notifyObservers({});
      const pivot=sc.getTransformNodeByName('__selection_pivot');pivot.rotationQuaternion=B.Quaternion.RotationAxis(B.Vector3.Up(),Math.PI/2);
      sc.onBeforeRenderObservable.notifyObservers(sc);
      manager.gizmos.rotationGizmo.onDragEndObservable.notifyObservers({});
      return {nodes:[a,b].map(id=>s.getState().nodes.find((n:any)=>n.id===id)),historyDelta:s.getState().past.length-history};
    },created);
    expect(rotation.nodes[0].transform.z).toBeCloseTo(1);expect(rotation.nodes[1].transform.z).toBeCloseTo(-1);expect(rotation.historyDelta).toBe(1);
    await page.evaluate(()=>(window as any).auditStore.getState().setGizmoMode('scale'));
    await expect.poll(()=>page.evaluate(()=>(window as any).auditManager.scaleGizmoEnabled)).toBe(true);
    const scale=await page.evaluate(({a,b})=>{
      const w=window as any,manager=w.auditManager,sc=w.auditB.EngineStore.LastCreatedScene;
      manager.gizmos.scaleGizmo.onDragStartObservable.notifyObservers({});sc.getTransformNodeByName('__selection_pivot').scaling.setAll(2);
      sc.onBeforeRenderObservable.notifyObservers(sc);manager.gizmos.scaleGizmo.onDragEndObservable.notifyObservers({});
      return [a,b].map(id=>w.auditStore.getState().nodes.find((n:any)=>n.id===id));
    },created);
    expect(scale[0].transform.z).toBeCloseTo(2);expect(scale[1].transform.z).toBeCloseTo(-2);expect(scale[0].scale.x).toBeCloseTo(2);
    const copied=await page.evaluate(()=>{
      const s=(window as any).auditStore;s.getState().selectNode((window as any).modelId);s.getState().copyToClipboard();s.getState().pasteFromClipboard();
      const copy=s.getState().selectedNodeId,hasBinary=s.getState().modelBuffers.has(copy);s.getState().undo();
      return {hasBinary,copyGone:!s.getState().nodes.some((n:any)=>n.id===copy)};
    });
    expect(copied).toEqual({hasBinary:true,copyGone:true});
  });

  await test.step('stop cancels delayed model load and pending scripts', async () => {
    await runtime.evaluate(() => {
      const w=window as any,original=w.BABYLON.SceneLoader.LoadAssetContainerAsync;
      w.BABYLON.SceneLoader.LoadAssetContainerAsync=async function(...args:any[]){const c=await original.apply(this,args);await new Promise(r=>setTimeout(r,300));return c;};
    });
    await page.evaluate(()=>(window as any).auditStore.getState().play());
    await page.waitForTimeout(80);
    await page.evaluate(()=>(window as any).auditStore.getState().stop());
    await page.waitForTimeout(450);
    expect(await runtime.evaluate(()=>({entities:(window as any).entityMap.size,meshes:(window as any).scene.meshes.length,running:(window as any).running}))).toEqual({entities:0,meshes:0,running:false});
    await page.evaluate(async()=>{
      const {importProject}=await import('/src/utils/projectExport.ts');
      await importProject(new File([(window as any).projectZip],'roundtrip.arkglide'));
      (window as any).auditStore.getState().undo();
    });
    expect(await page.evaluate(()=>(window as any).auditStore.getState().past.length)).toBe(0);
  });

  await test.step('viewport additive selection and flight/shortcut focus',async()=>{
    await page.evaluate(()=>{
      const w=window as any,store=w.auditStore,sc=w.auditB.EngineStore.LastCreatedScene;
      store.getState().selectNode('cube');
      const sphere=sc.getMeshByName('sphere');
      sc.onPointerObservable.notifyObservers({type:w.auditB.PointerEventTypes.POINTERDOWN,event:{button:0,ctrlKey:true},pickInfo:{hit:true,pickedMesh:sphere}});
    });
    expect(await page.evaluate(()=>(window as any).auditStore.getState().selectedNodeIds)).toEqual(['cube','sphere']);
    await page.locator('#viewport').focus();await page.keyboard.press('e');
    expect(await page.evaluate(()=>(window as any).auditStore.getState().gizmoMode)).toBe('rotate');
    await page.keyboard.press('r');expect(await page.evaluate(()=>(window as any).auditStore.getState().gizmoMode)).toBe('scale');
    await page.keyboard.press('w');expect(await page.evaluate(()=>(window as any).auditStore.getState().gizmoMode)).toBe('move');
    await page.keyboard.press('f');
    await page.locator('#viewport').dispatchEvent('mousedown',{button:2});
    await expect(page.getByText('飞行中',{exact:true})).toBeVisible();
    await page.locator('#viewport').dispatchEvent('mouseup',{button:2});
    await expect(page.getByText('飞行中',{exact:true})).toHaveCount(0);
  });

  await test.step('stop before iframe handshake clears the pending project',async()=>{
    await page.route('**/lib/arkglide_math.js',async route=>{await new Promise(resolve=>setTimeout(resolve,700));await route.continue();});
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForSelector('#viewport');
    await page.evaluate(async()=>{
      const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');(window as any).auditStore=s;s.getState().play();
    });
    await page.waitForTimeout(50);
    await page.evaluate(()=>(window as any).auditStore.getState().stop());
    runtime=page.frames().find(frame=>frame.url().endsWith('/runtime.html'))!;
    await runtime.waitForFunction(()=>(window as any).math?.backend==='wasm',undefined,{polling:50});
    await page.waitForTimeout(100);
    expect(await runtime.evaluate(()=>({entities:(window as any).entityMap.size,running:(window as any).running}))).toEqual({entities:0,running:false});
    await page.unroute('**/lib/arkglide_math.js');
  });

  await test.step('Monaco math API completion and browser benchmark', async () => {
    await page.getByRole('tab',{name:'代码编辑器',exact:true}).click();
    await page.waitForFunction(async()=>{
      const url=performance.getEntriesByType('resource').map(r=>r.name).find(n=>n.includes('/monaco-editor.js?'));
      if(!url)return false;
      const m=await import(url);return m.editor.getModels().some((m:any)=>m.uri.toString().startsWith('file:///arkglide/scripts/'));
    });
    const completions=await page.evaluate(async()=>{
      const url=performance.getEntriesByType('resource').map(r=>r.name).find(n=>n.includes('/monaco-editor.js?'))!;
      const m=await import(url),s=(window as any).auditStore;
      s.getState().updateScript('main.js','return { onUpdate() { const result = math.vec3.add({x:1,y:2,z:3},{x:4,y:5,z:6}); } };');
      await new Promise(r=>setTimeout(r,100));
      const model=m.editor.getModels().find((m:any)=>m.uri.toString().startsWith('file:///arkglide/scripts/'));
      const factory=await m.typescript.getJavaScriptWorker(),worker=await factory(model.uri);
      return (await worker.getCompletionsAtPosition(model.uri.toString(),model.getValue().indexOf('math.vec3.add')+'math.vec3.'.length)).entries.map((e:any)=>e.name);
    });
    expect(completions).toContain('add');expect(completions).toContain('cross');
    await page.goto('/math-benchmark.html');
    await page.getByRole('button',{name:'运行基准'}).click();
    await expect(page.locator('#status')).toHaveText('完成');
    await expect(page.locator('#results tr')).toHaveCount(5);
  });
  expect(errors).toEqual([]);
});
