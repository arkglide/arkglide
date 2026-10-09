import { test, expect } from '@playwright/test';
import {zipSync,strToU8} from 'fflate';

test('batch one: clock, cleanup, diagnostics and crash recovery',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  async function connect(){
    await page.waitForSelector('#viewport');
    await page.evaluate(async()=>{const {useEditorStore}=await import('/src/store/useEditorStore.ts');(window as any).batchStore=useEditorStore;});
    const frame=page.frames().find(f=>f.url().endsWith('/runtime.html'))!;
    await frame.waitForFunction(()=>(window as any).math?.backend==='wasm',undefined,{polling:50});
    return frame;
  }
  await page.goto('/');let runtime=await connect();
  await test.step('fixed hooks, scaled timers and pause-safe simulation',async()=>{
    await page.evaluate(()=>{
      const s=(window as any).batchStore;
      s.getState().updateSettings({timeScale:2});
      s.getState().updateScript('main.js',`const owner=this.entity;
        timers.every(.05,()=>owner.position.x++);
        setInterval(()=>owner.position.z++,100);
        events.on('score',()=>{});
        events.listen(window,'batch-ping',()=>owner.position.y++);
        return {fixed:0,onFixedUpdate(){this.fixed++;},onDestroy(){console.log('clean:'+this.entity.id);}};`);
    });
    await page.getByRole('button',{name:'播放',exact:true}).click();
    await runtime.waitForFunction(()=>(window as any).time.totalTime>.15,undefined,{polling:50});
    expect(await runtime.evaluate(()=>(window as any).lifecycleInstances[0].instance.fixed)).toBeGreaterThan(0);
    await page.getByRole('button',{name:'暂停',exact:true}).click();
    await runtime.waitForFunction(()=>!(window as any).running,undefined,{polling:50});
    const paused=await runtime.evaluate(()=>({total:(window as any).time.totalTime,x:(window as any).sceneAPI.find('cube').position.x}));
    await page.waitForTimeout(250);
    expect(await runtime.evaluate(()=>({total:(window as any).time.totalTime,x:(window as any).sceneAPI.find('cube').position.x}))).toEqual(paused);
    await page.getByRole('button',{name:'播放',exact:true}).click();
    await runtime.waitForFunction(()=>(window as any).time.totalTime>0.2,undefined,{polling:50});
    await page.getByRole('tab',{name:'运行诊断',exact:true}).click();
    await expect(page.getByText('计时器 / 事件订阅 / 原生监听',{exact:true})).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>(window as any).batchStore.getState().runtimeStats?.timers)).toBe(2);
    await page.getByRole('button',{name:'停止',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).batchStore.getState().runtimeStats?.entities)).toBe(0);
    const stats=await runtime.evaluate(()=>(window as any).session.stats());
    for(const key of ['scripts','timers','subscriptions','listeners'])expect(stats[key]).toBe(0);
    expect(await runtime.evaluate(()=>(window as any).scene.materials.filter((m:any)=>m.name==='cube:material').length)).toBe(0);
    expect(await page.evaluate(()=>(window as any).batchStore.getState().consoleLogs.some((l:any)=>l.text==='clean:cube'))).toBe(true);
  });
  await test.step('error source mapping opens the actual Monaco line',async()=>{
    await page.evaluate(()=>{
      const s=(window as any).batchStore;
      s.getState().updateScript('main.js',"return {\n onUpdate(){\n  throw new Error('定位测试');\n }\n};");
    });
    await page.getByRole('button',{name:'播放',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).batchStore.getState().consoleLogs.filter((l:any)=>l.text==='定位测试').length)).toBe(1);
    const location=await page.evaluate(()=>(window as any).batchStore.getState().consoleLogs.find((l:any)=>l.text==='定位测试').location);
    expect(location.file).toBe('main.js');expect(location.line).toBe(3);expect(location.hook).toBe('onUpdate');
    await page.getByRole('tab',{name:'控制台',exact:true}).click();
    await page.getByRole('button',{name:'main.js:3 · onUpdate',exact:true}).click();
    await expect(page.getByRole('tab',{name:'代码编辑器',exact:true})).toHaveAttribute('aria-selected','true');
    await expect.poll(()=>page.evaluate(async()=>{
      const url=performance.getEntriesByType('resource').map(r=>r.name).find(n=>n.includes('/monaco-editor.js?'));if(!url)return null;
      const m=await import(url);return m.editor.getEditors().find((e:any)=>e.getModel()?.uri.toString().includes('/scripts/'))?.getPosition()?.lineNumber;
    })).toBe(3);
    await page.getByRole('button',{name:'停止',exact:true}).click();
  });
  await test.step('auto-save survives reload and preserves binary assets',async()=>{
    await page.evaluate(()=>{
      const s=(window as any).batchStore;s.getState().newProject();s.setState({currentProjectName:'恢复验收项目'});
      s.getState().renameNode('cube','恢复后的立方体');
      const id=s.getState().addNode('model','binary');s.getState().setModelBuffer(id,new Uint8Array([1,2,3,4]).buffer);
      s.getState().updateScript('main.js','return {onStart(){console.log("recovered");}};');
      (window as any).recoveredModel=id;
    });
    const model=await page.evaluate(()=>(window as any).recoveredModel);
    await expect.poll(()=>page.evaluate(()=>(window as any).batchStore.getState().recoveryStatus)).toBe('saved');
    await page.reload();runtime=await connect();
    const dialog=page.getByRole('dialog',{name:'项目恢复'});await expect(dialog).toBeVisible();
    await dialog.getByText('恢复验收项目',{exact:true}).locator('..').locator('..').getByRole('button',{name:'恢复',exact:true}).click();
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(()=>{const s=(window as any).batchStore.getState();return s.nodes.find((n:any)=>n.id==='cube').name;})).toBe('恢复后的立方体');
    expect(await page.evaluate(id=>Array.from(new Uint8Array((window as any).batchStore.getState().modelBuffers.get(id))),model)).toEqual([1,2,3,4]);
    expect(await page.evaluate(()=>(window as any).batchStore.getState().past.length)).toBe(0);
  });
  await test.step('unknown versions fail atomically and missing models appear in diagnostics',async()=>{
    const before=await page.evaluate(()=>(window as any).batchStore.getState().nodes.map((n:any)=>n.id));
    const bytes=Array.from(zipSync({'project.json':strToU8(JSON.stringify({version:'99',scene:{nodes:[]},scripts:{}}))}));
    const failure=await page.evaluate(async(bytes)=>{
      const {importProject}=await import('/src/utils/projectExport.ts');
      try{await importProject(new File([new Uint8Array(bytes)],'future.arkglide'));return null;}catch(e){return String(e);}
    },bytes);
    expect(failure).toContain('版本');expect(await page.evaluate(()=>(window as any).batchStore.getState().nodes.map((n:any)=>n.id))).toEqual(before);
    await page.evaluate(()=>{const s=(window as any).batchStore;s.setState({missingModelIds:new Set(['absent'])});});
    await page.getByRole('tab',{name:'运行诊断',exact:true}).click();await expect(page.getByText('缺失模型资源',{exact:true})).toBeVisible();
  });
  expect(errors).toEqual([]);
});
