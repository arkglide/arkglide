import { test, expect } from './fixtures';

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
    expect(await page.evaluate(()=>{
      const w=window as any,s=w.auditStore,before=s.getState();
      w.auditManager.gizmos.rotationGizmo.onDragStartObservable.notifyObservers({});
      w.auditManager.gizmos.rotationGizmo.onDragEndObservable.notifyObservers({});
      return s.getState().past===before.past&&s.getState().future===before.future;
    })).toBe(true);
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
    await page.evaluate(()=>{
      const w=window as any,sc=w.auditB.EngineStore.LastCreatedScene;
      w.auditManager.gizmos.rotationGizmo.onDragStartObservable.notifyObservers({});
      sc.getTransformNodeByName('__selection_pivot').position.x+=3;
      sc.onBeforeRenderObservable.notifyObservers(sc);
    });
    await page.evaluate(()=>(window as any).auditStore.getState().selectNode('cube'));
    await expect.poll(()=>page.evaluate(()=>(window as any).auditManager.attachedNode?.name)).toBe('cube');
    expect(await page.evaluate(({a,b})=>{
      const w=window as any,sc=w.auditB.EngineStore.LastCreatedScene;
      return [a,b].every(id=>{
        const data=w.auditStore.getState().nodes.find((n:any)=>n.id===id),mesh=sc.getMeshByName(id);
        return Math.abs(data.transform.x-mesh.position.x)<1e-6;
      });
    },created)).toBe(true);
    expect(await page.evaluate(()=>{
      const w=window as any,before=w.auditStore.getState(),g=w.auditManager.gizmos.rotationGizmo;
      g.onDragStartObservable.notifyObservers({});g.onDragEndObservable.notifyObservers({});
      return w.auditStore.getState().past===before.past;
    })).toBe(true);
    await page.evaluate(({a,b})=>(window as any).auditStore.getState().selectNodes([a,b]),created);
    await expect.poll(()=>page.evaluate(()=>(window as any).auditManager.attachedNode?.name)).toBe('__selection_pivot');
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
    await page.addInitScript(() => {
      window.addEventListener('DOMContentLoaded', () => {
        const w=window as any;
        if (!w.BABYLON) return;
        const original=w.BABYLON.SceneLoader.LoadAssetContainerAsync;
        w.BABYLON.SceneLoader.LoadAssetContainerAsync=async function(...args:any[]){w.__modelLoadingStarted=true;const c=await original.apply(this,args);await new Promise(r=>setTimeout(r,300));return c;};
      });
    });
    await page.evaluate(()=>(window as any).auditStore.getState().play());
    await runtime.waitForFunction(() => (window as any).__modelLoadingStarted === true, undefined, {polling:10});
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

  if(await page.getByRole('dialog',{name:'项目恢复'}).isVisible())await page.getByRole('button',{name:'稍后处理'}).click();
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

test('Delete in editable content preserves scene selection',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.evaluate(async()=>{
  const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');
  s.getState().selectNode('cube');
  const input=document.createElement('div');input.contentEditable='true';input.id='editable-shortcut-test';input.textContent='editable';document.body.appendChild(input);input.focus();
 });
 await page.keyboard.press('Delete');
 expect(await page.evaluate(async()=>{
  const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().nodes.some(n=>n.id==='cube');
 })).toBe(true);
});

test('text undo shortcuts preserve scene history',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 for(const tag of ['input','textarea','div']){
  await page.evaluate(async(tag)=>{
   const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');
   s.getState().newProject();s.getState().renameNode('cube','renamed cube');
   document.getElementById('text-history-test')?.remove();
   const input=document.createElement(tag);if(tag==='div')input.contentEditable='true';
   input.id='text-history-test';document.body.appendChild(input);input.focus();
  },tag);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(async()=>{
   const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().nodes.find(n=>n.id==='cube')?.name;
  })).toBe('renamed cube');
 }
});

test('project settings apply with existing material references',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.evaluate(async()=>{
  const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');
  const id=s.getState().createMaterial('settings material');s.getState().setNodeMaterial('cube',id);
 });
 await page.getByRole('button',{name:'菜单',exact:true}).click();
 await page.getByRole('menuitem',{name:'项目设置'}).click();
 const dialog=page.getByRole('dialog',{name:'项目设置'});
 await dialog.getByPlaceholder('60').fill('30');
 await dialog.getByRole('button',{name:'应用',exact:true}).click();
 await expect(dialog).toBeHidden();
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().settings.fpsCap;})).toBe(30);
});

test('invalid project settings show an error inside the open dialog',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.getByRole('button',{name:'菜单',exact:true}).click();
 await page.getByRole('menuitem',{name:'项目设置'}).click();
 const dialog=page.getByRole('dialog',{name:'项目设置'});
 await dialog.getByLabel('时间倍率').fill('-1');
 await dialog.getByRole('button',{name:'应用',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('无效时间设置');
 await dialog.getByLabel('时间倍率').fill('1');await dialog.getByRole('button',{name:'应用',exact:true}).click();
 await expect(dialog).toBeHidden();
});

test('gravity fields support typing negative values through intermediate input states',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.getByRole('button',{name:'菜单',exact:true}).click();
 await page.getByRole('menuitem',{name:'项目设置'}).click();
 const dialog=page.getByRole('dialog',{name:'项目设置'}),input=dialog.getByLabel('Y',{exact:true});
 await input.fill('');await input.pressSequentially('-5.5');
 await expect(input).toHaveValue('-5.5');
 await dialog.getByRole('button',{name:'应用',exact:true}).click();
 await expect(dialog).toBeHidden();
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().settings.gravity.y;})).toBe(-5.5);
});

test('time scale fields retain decimal input until settings are applied',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.getByRole('button',{name:'菜单',exact:true}).click();
 await page.getByRole('menuitem',{name:'项目设置'}).click();
 const dialog=page.getByRole('dialog',{name:'项目设置'}),input=dialog.getByLabel('时间倍率');
 await input.fill('');await input.pressSequentially('0.5');await expect(input).toHaveValue('0.5');
 const hz=dialog.getByLabel('固定步 Hz');await hz.fill('');await hz.pressSequentially('59.94');await expect(hz).toHaveValue('59.94');
 await dialog.getByRole('button',{name:'应用',exact:true}).click();await expect(dialog).toBeHidden();
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().settings.timeScale;})).toBe(0.5);
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().settings.fixedTimeStep;})).toBeCloseTo(1/59.94,10);
});

test('inspector position retains signed decimal typing',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');s.getState().selectNode('cube');});
 const input=page.getByLabel('Pos X',{exact:true});
 await input.fill('');await input.pressSequentially('-2.75');await input.press('Tab');
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().nodes.find(n=>n.id==='cube')?.transform.x;})).toBe(-2.75);
});

test('script creation stays locked during playback and pause',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.getByRole('tab',{name:'项目资源',exact:true}).click();
 const button=page.getByRole('button',{name:'新建脚本',exact:true});await expect(button).toBeEnabled();
 await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');s.getState().play();});
 await expect(button).toBeDisabled();
 await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');s.getState().pause();});
 await expect(button).toBeDisabled();
 await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');s.getState().stop();});
 await expect(button).toBeEnabled();await button.click();
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return Object.keys(s.getState().scripts).length;})).toBe(2);
});

test('scene tree range selection excludes nodes hidden by search',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.evaluate(async()=>{
  const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');const base=s.getState().nodes.find(n=>n.id==='cube')!;
  s.setState({nodes:[['range-a','Match A'],['range-hidden','Hidden'],['range-b','Match B']].map(([id,name])=>({...structuredClone(base),id,name,parentId:null})),selectedNodeId:null,selectedNodeIds:[]});
 });
 await page.getByPlaceholder('搜索节点...').fill('Match');
 await page.getByText('Match A',{exact:true}).click();await page.getByText('Match B',{exact:true}).click({modifiers:['Shift']});
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().selectedNodeIds;})).toEqual(['range-a','range-b']);
});

test('scene tree range selection follows displayed hierarchy rather than storage order',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.evaluate(async()=>{
  const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');const base=s.getState().nodes.find(n=>n.id==='cube')!;
  s.setState({nodes:[['range-parent','Range Parent',null],['range-sibling','Range Sibling',null],['range-child','Range Child','range-parent']].map(([id,name,parentId])=>({...structuredClone(base),id:id!,name:name!,parentId})),selectedNodeId:null,selectedNodeIds:[]});
 });
 await page.getByText('Range Parent',{exact:true}).click();await page.getByText('Range Child',{exact:true}).click({modifiers:['Shift']});
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().selectedNodeIds;})).toEqual(['range-parent','range-child']);
});

test('modal dialog keyboard input does not delete or undo the background scene',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');s.getState().selectNode('cube');s.getState().renameNode('cube','Modal protected');});
 await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('menuitem',{name:'项目设置'}).click();
 const dialog=page.getByRole('dialog',{name:'项目设置'});await dialog.getByRole('button',{name:'应用',exact:true}).focus();
 await page.keyboard.press('Delete');
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().nodes.find(n=>n.id==='cube')?.name;})).toBe('Modal protected');
 await page.keyboard.press('Control+z');
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().nodes.find(n=>n.id==='cube')?.name;})).toBe('Modal protected');
 await expect(dialog).toBeVisible();
});

test('popup menu focus isolates scene editing shortcuts',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');s.getState().selectNode('cube');});
 await page.getByRole('button',{name:'菜单',exact:true}).click();await expect(page.getByRole('menu')).toBeVisible();
 await page.keyboard.press('Delete');
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().nodes.some(n=>n.id==='cube');})).toBe(true);
});

test('repeated Shift selection retains the original scene tree anchor',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.evaluate(async()=>{
  const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');const base=s.getState().nodes.find(n=>n.id==='cube')!;
  s.setState({nodes:['A','B','C'].map(name=>({...structuredClone(base),id:'anchor-'+name,name:'Anchor '+name,parentId:null})),selectedNodeId:null,selectedNodeIds:[]});
 });
 await page.getByText('Anchor A',{exact:true}).click();await page.getByText('Anchor C',{exact:true}).click({modifiers:['Shift']});
 await page.getByText('Anchor B',{exact:true}).click({modifiers:['Shift']});
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().selectedNodeIds;})).toEqual(['anchor-A','anchor-B']);
});

test('unchanged inspector coordinates preserve redo for single and multiple selections',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 for(const ids of [['cube'],['cube','light']]){
  await page.evaluate(async(ids)=>{
   const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');s.getState().newProject();
   s.getState().renameNode('cube','changed');s.getState().undo();s.getState().selectNodes(ids);
   (window as any).unchangedEditBefore=s.getState();
  },ids);
  const input=page.getByLabel('Pos X',{exact:true});await input.fill('0.0');await input.press('Tab');
  expect(await page.evaluate(async()=>{
   const {useEditorStore:s}=await import('/src/store/useEditorStore.ts'),before=(window as any).unchangedEditBefore;
   return s.getState().nodes===before.nodes&&s.getState().past===before.past&&s.getState().future===before.future;
  })).toBe(true);
 }
});

test('scene tree renders a deep hierarchy without recursive stack overflow',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.evaluate(async()=>{
  const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');
  s.setState({nodes:Array.from({length:3000},(_,i)=>({id:`deep-${i}`,name:`Deep ${i}`,type:'empty' as const,parentId:i?`deep-${i-1}`:null,transform:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},visible:true})),selectedNodeIds:[],selectedNodeId:null});
 });
 try { await expect(page.getByText('Deep 2999',{exact:true})).toBeAttached(); }
 catch(error){throw new Error(`${errors.join('\n')}\n${error}`);}
 expect(errors).toEqual([]);
});

test('failed clipboard shortcuts show the scene error without an uncaught exception',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/');await page.waitForSelector('#viewport');
 for(const reset of ['copy','project']){
 await page.evaluate(async()=>{
  const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');
  s.getState().newProject();
  const physics={motion:'dynamic' as const,shape:'box' as const,size:{x:1,y:1,z:1},mass:1,friction:0.5,restitution:0,sensor:false,lockRotation:false};
  s.getState().updateTransform('sphere',{physics});
  s.getState().updateTransform('cube',{physics,joints:[{id:'joint',kind:'fixed',targetId:'sphere',anchor:{x:0,y:0,z:0},anchor2:{x:0,y:0,z:0},axis:{x:1,y:0,z:0},min:0,max:0}]});
  s.getState().selectNode('cube');s.getState().copyToClipboard();s.getState().removeNode('sphere');
 });
 await page.keyboard.press('Control+v');
 const alert=page.getByRole('region',{name:'场景树',exact:true}).getByRole('alert');
 await expect(alert).toContainText('关节目标刚体缺失');
 expect(errors).toEqual([]);
 if(reset==='copy')await page.keyboard.press('Control+c');
 else await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');s.getState().newProject();});
 await expect(alert).toBeHidden();
 }
});

test('project switching clears scene tree rename and search drafts',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 const tree=page.getByRole('region',{name:'场景树',exact:true});
 await tree.getByPlaceholder('搜索节点...').fill('Cube');
 await tree.getByText('Cube',{exact:true}).dblclick();
 await expect(tree.getByRole('textbox')).toHaveCount(2);
 await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');s.getState().newProject();});
 await expect(tree.getByRole('textbox')).toHaveCount(1);
 await expect(tree.getByPlaceholder('搜索节点...')).toHaveValue('');
 await expect(tree.getByText('Sphere',{exact:true})).toBeVisible();
});

test('cancelled scene drags do not reparent nodes during a later external drop',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 const tree=page.getByRole('region',{name:'场景树',exact:true}),transfer=await page.evaluateHandle(()=>new DataTransfer());
 const cube=tree.locator('[draggable="true"]').filter({has:page.getByText('Cube',{exact:true})});
 const sphere=tree.locator('[draggable="true"]').filter({has:page.getByText('Sphere',{exact:true})});
 await cube.dispatchEvent('dragstart',{dataTransfer:transfer});
 await cube.dispatchEvent('dragend',{dataTransfer:transfer});
 await sphere.dispatchEvent('drop',{dataTransfer:transfer});
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().nodes.find(n=>n.id==='cube')?.parentId??null;})).toBe(null);
 await cube.dispatchEvent('dragstart',{dataTransfer:transfer});
 await sphere.dispatchEvent('drop',{dataTransfer:transfer});
 await cube.dispatchEvent('dragend',{dataTransfer:transfer});
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().nodes.find(n=>n.id==='cube')?.parentId;})).toBe('sphere');
 await sphere.dispatchEvent('dragstart',{dataTransfer:transfer});
 await cube.dispatchEvent('dragover',{dataTransfer:transfer});
 await cube.dispatchEvent('drop',{dataTransfer:transfer});
 await sphere.dispatchEvent('dragend',{dataTransfer:transfer});
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().nodes.find(n=>n.id==='sphere')?.parentId??null;})).toBe(null);
});

test('dropping a scene node onto Scene restores it to the root hierarchy',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');s.getState().setParent('cube','sphere');});
 const tree=page.getByRole('region',{name:'场景树',exact:true}),transfer=await page.evaluateHandle(()=>new DataTransfer());
 const cube=tree.locator('[draggable="true"]').filter({has:page.getByText('Cube',{exact:true})});
 await cube.dispatchEvent('dragstart',{dataTransfer:transfer});
 await tree.getByText('Scene',{exact:true}).dispatchEvent('dragover',{dataTransfer:transfer});
 await tree.getByText('Scene',{exact:true}).dispatchEvent('drop',{dataTransfer:transfer});
 await cube.dispatchEvent('dragend',{dataTransfer:transfer});
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().nodes.find(n=>n.id==='cube')?.parentId??null;})).toBe(null);
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');s.getState().undo();return s.getState().nodes.find(n=>n.id==='cube')?.parentId;})).toBe('sphere');
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');s.getState().redo();return s.getState().nodes.find(n=>n.id==='cube')?.parentId??null;})).toBe(null);
});

test('scene search retains shared nonmatching ancestors and hides unrelated branches',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.evaluate(async()=>{
  const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');const base=s.getState().nodes[0];
  s.setState({nodes:[['parent','Container',null],['a','Needle A','parent'],['b','Needle B','parent'],['other','Other',null]].map(([id,name,parentId])=>({...structuredClone(base),id:id!,name:name!,parentId})),selectedNodeId:null,selectedNodeIds:[]});
 });
 const tree=page.getByRole('region',{name:'场景树',exact:true});await tree.getByPlaceholder('搜索节点...').fill('Needle');
 for(const name of ['Container','Needle A','Needle B'])await expect(tree.getByText(name,{exact:true})).toBeVisible();
 await expect(tree.getByText('Other',{exact:true})).toBeHidden();
 await tree.getByPlaceholder('搜索节点...').fill('');await expect(tree.getByText('Other',{exact:true})).toBeVisible();
});

test('scene rename waits for IME composition confirmation before committing Enter',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 const tree=page.getByRole('region',{name:'场景树',exact:true});await tree.getByText('Cube',{exact:true}).dblclick();
 const field=tree.locator('input:not([placeholder])');await field.fill('新名称');
 await field.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().nodes.find(n=>n.id==='cube')?.name;})).toBe('Cube');
 await field.dispatchEvent('keydown',{key:'Escape',code:'Escape',isComposing:true});
 await expect(field).toHaveValue('新名称');await field.press('Enter');
 await expect(tree.getByText('新名称',{exact:true})).toBeVisible();
 await tree.getByText('新名称',{exact:true}).dblclick();await field.fill('取消名称');await field.press('Escape');
 await expect(tree.getByText('新名称',{exact:true})).toBeVisible();
});

test('save project waits for IME confirmation before submitting its name',async({page})=>{
 await page.goto('/');await page.waitForSelector('#viewport');
 await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('menuitem',{name:'保存',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'保存项目'}),field=dialog.getByLabel('项目名称');
 await field.fill('   ');await field.press('Enter');
 await expect(dialog.getByRole('button',{name:'确认',exact:true})).toBeDisabled();
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().currentProjectId;})).toBe(null);
 await field.fill('中文项目');await field.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});
 await expect(dialog).toBeVisible();
 expect(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store/useEditorStore.ts');return s.getState().currentProjectId;})).toBe(null);
 await field.press('Enter');await expect(dialog).toBeHidden();
});

test('new scripts can be named and renamed from tabs or assets without native prompts', async ({ page }) => {
 await page.goto('/'); await page.waitForSelector('#viewport');
 await page.getByRole('tab', { name: '项目资源', exact: true }).click();
 const nativeDialogs: string[] = [];
 page.on('dialog', async dialog => { nativeDialogs.push(dialog.type()); await dialog.dismiss(); });
 await page.getByRole('button', { name: '新建脚本', exact: true }).click();
 const dialog = page.getByRole('dialog', { name: '重命名脚本', exact: true });
 await expect(dialog).toBeVisible();
 const oldName = await dialog.getByLabel('脚本文件名', { exact: true }).inputValue();
 await page.evaluate(async name => {
  const { useEditorStore: s } = await import('/src/store/useEditorStore.ts');
  s.getState().updateScript(name, 'export default 42;');
  s.getState().updateScript('main.js', `import value from './${name}';\nconsole.log(value);`);
  s.getState().attachScript('cube', name);
 }, oldName);
 await dialog.getByLabel('脚本文件名', { exact: true }).fill('logic/玩家');
 await dialog.getByRole('button', { name: '重命名', exact: true }).click();
 await expect(dialog).toBeHidden();
 await page.getByRole('tab', { name: '代码编辑器', exact: true }).click();
 const tab = page.getByRole('tab', { name: 'logic/玩家.js', exact: true });
 await expect(tab).toHaveAttribute('aria-selected', 'true');
 await expect(page.locator('.monaco-editor .view-lines')).toContainText('export default 42;');
 expect(await page.evaluate(async oldName => {
  const { useEditorStore: s } = await import('/src/store/useEditorStore.ts');
  return { oldExists: Object.hasOwn(s.getState().scripts, oldName), source: s.getState().scripts['logic/玩家.js'],
   main: s.getState().scripts['main.js'], attached: s.getState().nodes.find(n => n.id === 'cube')?.scripts };
 }, oldName)).toEqual({ oldExists: false, source: 'export default 42;', main: expect.stringContaining('./logic/玩家.js'), attached: ['main.js', 'logic/玩家.js'] });
 await tab.dblclick(); await expect(dialog).toBeVisible();
 const history = await page.evaluate(async () => (await import('/src/store/useEditorStore.ts')).useEditorStore.getState().past.length);
 await dialog.getByLabel('脚本文件名', { exact: true }).fill('main.js');
 await dialog.getByRole('button', { name: '重命名', exact: true }).click();
 await expect(dialog.getByRole('alert')).toContainText('已存在');
 await dialog.getByLabel('脚本文件名', { exact: true }).fill('../bad');
 await dialog.getByRole('button', { name: '重命名', exact: true }).click();
 await expect(dialog.getByRole('alert')).toContainText('无效脚本文件路径');
 expect(await page.evaluate(async () => (await import('/src/store/useEditorStore.ts')).useEditorStore.getState().past.length)).toBe(history);
 await dialog.getByRole('button', { name: '取消', exact: true }).click();
 await page.getByRole('tab', { name: '项目资源', exact: true }).click();
 await page.getByRole('button', { name: '脚本 logic/玩家.js', exact: true }).dblclick();
 await expect(dialog).toBeVisible();
 await dialog.getByLabel('脚本文件名', { exact: true }).fill('hero');
 await dialog.getByLabel('脚本文件名', { exact: true }).press('Enter');
 await page.getByRole('tab', { name: '代码编辑器', exact: true }).click();
 await expect(page.getByRole('tab', { name: 'hero.js', exact: true })).toBeVisible();
 await page.getByRole('tab', { name: 'hero.js', exact: true }).press('F2');
 await expect(dialog).toBeVisible(); await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
 await page.evaluate(async () => (await import('/src/store/useEditorStore.ts')).useEditorStore.getState().undo());
 await expect(tab).toBeVisible();
 await page.evaluate(async () => (await import('/src/store/useEditorStore.ts')).useEditorStore.getState().redo());
 await expect(page.getByRole('tab', { name: 'hero.js', exact: true })).toBeVisible();
 expect(nativeDialogs).toEqual([]);
});

test('script rename respects IME confirmation and clears its draft when switching documents', async ({ page }) => {
 await page.goto('/'); await page.waitForSelector('#viewport');
 await page.getByRole('tab', { name: '项目资源', exact: true }).click();
 await page.getByRole('button', { name: '新建脚本', exact: true }).click();
 const dialog = page.getByRole('dialog', { name: '重命名脚本', exact: true });
 const field = dialog.getByLabel('脚本文件名', { exact: true });
 await expect(dialog).toBeVisible();
 await field.fill('中文');
 await field.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 });
 await expect(dialog).toBeVisible(); await field.press('Enter');
 await page.getByRole('tab', { name: '代码编辑器', exact: true }).click();
 await expect(page.getByRole('tab', { name: '中文.js', exact: true })).toBeVisible();
 await page.getByRole('tab', { name: '中文.js', exact: true }).dblclick(); await field.fill('未确认');
 await page.evaluate(async () => { const { useEditorStore: s } = await import('/src/store/useEditorStore.ts'); s.getState().newProject(); s.getState().createScript('中文.js', 'new document'); });
 await expect(dialog).toBeHidden();
 expect(await page.evaluate(async () => (await import('/src/store/useEditorStore.ts')).useEditorStore.getState().scripts['中文.js'])).toBe('new document');
});
