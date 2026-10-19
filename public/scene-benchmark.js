const B=globalThis.BABYLON,M=globalThis.ArkGlideSceneBenchmarkMetrics;
const button=document.querySelector('#start'),cancel=document.querySelector('#cancel'),download=document.querySelector('#download'),status=document.querySelector('#status'),output=document.querySelector('#result'),canvas=document.querySelector('#canvas'),resolution=document.querySelector('#resolution');
let controller=null,modulePromise=null;
function check(signal){if(signal.aborted)throw new DOMException('测试已停止','AbortError');if(document.hidden||!document.hasFocus())throw Error('页面不在前台，测试已中止；请保持页面聚焦后重试');}
function waitFrame(signal){return new Promise((resolve,reject)=>{if(signal.aborted){reject(new DOMException('测试已停止','AbortError'));return;}const abort=()=>{cancelAnimationFrame(id);reject(new DOMException('测试已停止','AbortError'));};const id=requestAnimationFrame(time=>{signal.removeEventListener('abort',abort);resolve(time);});signal.addEventListener('abort',abort,{once:true});});}
async function guarded(promise,signal){let abort;const aborted=new Promise((_,reject)=>{abort=()=>reject(new DOMException('测试已停止','AbortError'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});try{return await Promise.race([promise,aborted]);}finally{signal.removeEventListener('abort',abort);}}
function sceneNodes(count,lod){
 const columns=Math.ceil(Math.sqrt(count)),nodes=[];
 for(let i=0;i<count;i++)nodes.push({id:'sample-'+i,name:'sample-'+i,type:'mesh',primitive:'sphere',materialId:'surface-'+i%4,transform:{x:(i%columns-columns/2)*3,y:1,z:(Math.floor(i/columns)-columns/2)*3},scale:{x:2,y:2,z:2},optimization:{lod:{enabled:lod,levels:[{distance:20,grid:8},{distance:50,grid:4}]}}});
 nodes.push({id:'floor',name:'floor',type:'mesh',primitive:'plane',materialId:'floor',scale:{x:columns*4,y:1,z:columns*4},transform:{x:0,y:0,z:0}});
 return nodes;
}
async function measure(config,scene,engine,adapter,camera,instrumentation,signal,label){
 const frames=[],cpu=[],gpu=[],triangles=[],draws=[];let previous=null,lastGpu=instrumentation.gpuFrameTimeCounter.count;
 for(let frame=0;frame<config.warmup+config.samples;frame++){
  const time=await waitFrame(signal);check(signal);
  const angle=frame/(config.warmup+config.samples)*Math.PI*2,radius=Math.sqrt(config.meshes)*3;
  camera.position.set(Math.cos(angle)*radius,radius*.45,Math.sin(angle)*radius);camera.setTarget(B.Vector3.Zero());
  engine.beginFrame();const start=performance.now();scene.render();const elapsed=performance.now()-start;engine.endFrame();
  if(frame>=config.warmup&&previous!==null){frames.push(time-previous);cpu.push(elapsed);const stats=adapter.rendering.stats();triangles.push(stats.renderMainTriangles);draws.push(stats.renderDrawCalls);if(instrumentation.gpuFrameTimeCounter.count>lastGpu){gpu.push(instrumentation.gpuFrameTimeCounter.current/1000000);}}
  lastGpu=instrumentation.gpuFrameTimeCounter.count;previous=time;
  if(frame%15===0)status.textContent=label+'：'+(frame<config.warmup?'预热 '+(frame+1)+' / '+config.warmup:'采样 '+(frame-config.warmup+1)+' / '+config.samples);
 }
 return {frameMs:M.summary(frames),cpuRenderMs:M.summary(cpu),gpuMs:M.summary(gpu),triangles:M.summary(triangles),drawCalls:M.summary(draws),optimization:adapter.optimization.stats()};
}
async function run(input={}){
 if(controller)throw Error('测试正在进行');const config=M.config(input),abort=new AbortController();controller=abort;button.disabled=true;resolution.disabled=true;cancel.disabled=false;download.disabled=true;globalThis.__arkglideBenchmark={state:'running',config};output.textContent='';
 let engine,scene,adapter,instrumentation;const lost=()=>abort.abort(),hidden=()=>{if(document.hidden)abort.abort();},blur=()=>abort.abort();canvas.addEventListener('webglcontextlost',lost);document.addEventListener('visibilitychange',hidden);window.addEventListener('blur',blur);
 try{
  check(abort.signal);status.textContent='正在准备场景与 WASM…';
  modulePromise??=globalThis.createArkGlideMath().catch(e=>{modulePromise=null;throw e;});const module=await guarded(modulePromise,abort.signal);check(abort.signal);
  engine=new B.Engine(canvas,false,{stencil:true,preserveDrawingBuffer:false});engine.setSize(config.width,config.height,true);
  scene=new B.Scene(engine);scene.clearColor.set(.025,.035,.05,1);const camera=new B.FreeCamera('benchmark',new B.Vector3(0,30,-60),scene);camera.maxZ=2000;
  new B.HemisphericLight('ambient',B.Vector3.Up(),scene).intensity=.7;new B.DirectionalLight('sun',new B.Vector3(-.4,-1,.3),scene).intensity=1;
  const materials={};for(const [i,color]of ['#CB6A45','#75B9A3','#759BCC','#C4AD74','#657080'].entries())materials[i===4?'floor':'surface-'+i]={id:i===4?'floor':'surface-'+i,name:'surface',baseColor:color,emissiveColor:'#000000',metallic:.15,roughness:.55,alpha:1,doubleSided:false,uvScale:{u:1,v:1}};
  adapter=globalThis.ArkGlideScene.createSceneAdapter(B,scene,{loadModule:()=>Promise.resolve(module)});
  instrumentation=new B.EngineInstrumentation(engine);const timerSupported=!!engine.getCaps().timerQuery;if(timerSupported)instrumentation.captureGPUFrameTime=true;
  const content={materials,textures:[]},results=[];
  for(const [label,lod]of [['原始几何',false],['静态 LOD',true]]){
   check(abort.signal);status.textContent=label+'：准备中…';await guarded(adapter.sync(sceneNodes(config.meshes,lod),{},content,{}),abort.signal);check(abort.signal);await guarded(scene.whenReadyAsync(),abort.signal);
   results.push({name:label,lod,...await measure(config,scene,engine,adapter,camera,instrumentation,abort.signal,label)});
  }
  const info=engine.getGlInfo(),renderer=info.renderer||'',mode=M.renderMode(renderer),report={date:new Date().toISOString(),browser:navigator.userAgent,renderer:info,renderMode:mode,hardwareBudgetVerified:false,devicePixelRatio:devicePixelRatio,resolution:{width:engine.getRenderWidth(),height:engine.getRenderHeight()},config,timerSupported,results,
   target:{fps:60,frameMs:1000/60,note:mode==='software'?'软件渲染仅验证流程，不用于目标显卡预算。':'此记录只覆盖当前基准场景；需在目标设备与完整游戏中审核预算。'},
   limits:'Static geometry with basic PBR lights. No shadow/SSR/DOF/physics/script workload; same frame-index camera path in both cases. CPU/GPU/RAF are separate measurements; GPU samples include only newly completed valid timer queries. Hardware is reported by the browser and not independently certified.'};
  globalThis.__arkglideBenchmark={state:'complete',report};output.textContent=JSON.stringify(report,null,2);status.textContent=`测试完成（${mode}）。可下载记录；静态 LOD 三角形中位数 ${results[1].triangles.median.toLocaleString()}。`;download.disabled=false;return report;
 }catch(error){globalThis.__arkglideBenchmark={state:'error',error:String(error)};status.textContent=String(error);throw error;}
 finally{canvas.removeEventListener('webglcontextlost',lost);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('blur',blur);instrumentation?.dispose();adapter?.dispose();scene?.dispose();engine?.dispose();controller=null;button.disabled=false;resolution.disabled=false;cancel.disabled=true;}
}
globalThis.ArkGlideSceneBenchmark={run,cancel:()=>controller?.abort()};
button.addEventListener('click',()=>{const params=new URLSearchParams(location.search),input={};for(const name of ['meshes','width','height','warmup','samples'])if(params.has(name))input[name]=Number(params.get(name));if(!params.has('width'))[input.width,input.height]=resolution.value.split(',').map(Number);void run(input).catch(()=>{});});
cancel.addEventListener('click',()=>controller?.abort());
download.addEventListener('click',()=>{const report=globalThis.__arkglideBenchmark?.report;if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='arkglide-scene-benchmark.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
