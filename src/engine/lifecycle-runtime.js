// Renderer-independent simulation clock and script-owned resources.
(function(root) {
  'use strict';
  function createSession(options = {}) {
    const records = [], scheduled = new Map(), subscriptions = new Set();
    let nextId = 0, last = null, accumulator = 0, active = false, stopping = false;
    let scriptMs = 0, droppedTime = 0, errors = 0;
    const now = options.now || (() => performance.now());
    const time = { deltaTime:0, unscaledDeltaTime:0, totalTime:0, unscaledTotalTime:0,
      frameCount:0, fixedDeltaTime:1/60, fixedTotalTime:0, fixedFrameCount:0, interpolationAlpha:0 };
    let scale = 1, maxSubSteps = 8;
    Object.defineProperty(time, 'timeScale', { enumerable:true, get:()=>scale, set:value=>{
      if (!Number.isFinite(value) || value < 0 || value > 100) throw new RangeError('timeScale must be between 0 and 100');
      scale=value;
    }});
    function report(record, hook, error) {
      errors++;
      options.onError?.({file:record?.file, entityId:record?.entity?.id, hook, error});
    }
    function call(record, hook, callback, args = []) {
      if (!record.active || typeof callback !== 'function') return;
      const started=now();
      try { callback.apply(record.instance, args); return true; }
      catch(error) { report(record,hook,error); record.failed.add(hook); return false; }
      finally { scriptMs += Math.max(0,now()-started); }
    }
    function cleanup(record) {
      for (const release of [...record.cleanup]) {
        try { release(); } catch(error) { report(record,'cleanup',error); }
      }
      record.cleanup.clear();
    }
    function release(record) {
      if (!record.active || record.destroying) return;
      record.destroying=true;
      call(record,'onDestroy',record.instance?.onDestroy);
      record.active=false;
      cleanup(record);
    }
    function owner(entity, file) {
      const record={entity,file,instance:null,active:true,destroying:false,cleanup:new Set(),failed:new Set()};
      records.push(record);
      const allowed=()=>record.active && !record.destroying && !stopping && !record.entity?.destroyed;
      const track=release=>{
        let live=true;
        const dispose=()=>{if(live){live=false;record.cleanup.delete(dispose);release();}};
        if(allowed())record.cleanup.add(dispose);else dispose();
        return dispose;
      };
      function timer(seconds, callback, interval) {
        if (!Number.isFinite(seconds) || seconds<0 || (interval && seconds===0) || typeof callback!=='function') throw new TypeError('Expected a delay in seconds and a function');
        const id=++nextId;
        const item={id,record,callback,due:time.totalTime+seconds,interval:interval?seconds:0};
        item.cancel=track(()=>scheduled.delete(id));
        if(allowed())scheduled.set(id,item);
        return item.cancel;
      }
      function subscribe(name, callback, once) {
        if(typeof name!=='string'||!name||typeof callback!=='function')throw new TypeError('Expected an event name and a function');
        const item={record,name,callback,once};
        item.cancel=track(()=>subscriptions.delete(item));
        if(allowed())subscriptions.add(item);
        return item.cancel;
      }
      const events={
        on:(name,callback)=>subscribe(name,callback,false),
        once:(name,callback)=>subscribe(name,callback,true),
        emit(name,payload){
          if(!allowed())return;
          for(const item of [...subscriptions])if(item.name===name&&item.record.active){
            if(item.once)item.cancel();
            if(call(item.record,'event:'+name,item.callback,[payload])===false)item.cancel();
          }
        },
        listen(target,name,callback,options){
          if(!target?.addEventListener||typeof callback!=='function')throw new TypeError('Expected an EventTarget and a function');
          let dispose;
          const wrapped=event=>{
            if(active&&allowed()&&call(record,'listener:'+name,callback,[event])===false)dispose();
            if(typeof options==='object'&&options?.once)dispose();
          };
          if(allowed())target.addEventListener(name,wrapped,options);
          dispose=track(()=>target.removeEventListener(name,wrapped,options));return dispose;
        },
      };
      const timers={after:(seconds,callback)=>timer(seconds,callback,false),every:(seconds,callback)=>timer(seconds,callback,true)};
      const nativeTimers=new Map();
      function nativeTimer(callback,ms,interval,args){
        const id=++nextId;
        nativeTimers.set(id,timer(Math.max(0,Number(ms)||0)/1000,()=>{
          if(!interval)nativeTimers.delete(id);
          callback(...args);
        },interval));
        return id;
      }
      const globals={
        setTimeout:(callback,ms=0,...args)=>nativeTimer(callback,ms,false,args),
        setInterval:(callback,ms=0,...args)=>nativeTimer(callback,Math.max(1,Number(ms)||1),true,args),
        clearTimeout:id=>{nativeTimers.get(id)?.();nativeTimers.delete(id);},
        clearInterval:id=>{nativeTimers.get(id)?.();nativeTimers.delete(id);},
      };
      track(()=>nativeTimers.clear());
      return {record,events,timers,globals,attach(instance){record.instance=instance;},abort(){record.active=false;cleanup(record);}};
    }
    function start(settings={}) {
      const step=settings.fixedTimeStep ?? 1/60,substeps=settings.maxSubSteps ?? 8;
      if(!Number.isFinite(step)||step<1/240||step>0.1||!Number.isInteger(substeps)||substeps<1||substeps>32)throw new RangeError('Invalid fixed time step settings');
      time.fixedDeltaTime=step;
      maxSubSteps=settings.maxSubSteps ?? 8;
      time.timeScale=settings.timeScale ?? 1;
      // All factories have completed before any onStart. Registration order is stable.
      for(const record of records){
        if(record.entity?.destroyed){release(record);continue;}
        call(record,'onStart',record.instance?.onStart);
      }
      active=true;last=null;
    }
    function destroyEntity(id) {
      for(const record of records)if(record.entity?.id===id)release(record);
    }
    function tick(timestamp) {
      scriptMs=0;
      if(!active)return;
      const raw=last===null?0:Math.max(0,(timestamp-last)/1000);last=timestamp;
      const clamped=Math.min(raw,0.25);
      time.unscaledDeltaTime=clamped;time.deltaTime=clamped*scale;
      time.unscaledTotalTime+=clamped;time.totalTime+=time.deltaTime;time.frameCount++;
      droppedTime+=Math.max(0,raw-clamped)*scale;
      for(const record of records)if(record.entity?.destroyed)release(record);
      accumulator+=time.deltaTime;
      let steps=0;
      while(accumulator+1e-10>=time.fixedDeltaTime && steps<maxSubSteps){
        accumulator-=time.fixedDeltaTime;steps++;
        time.fixedTotalTime+=time.fixedDeltaTime;time.fixedFrameCount++;
        for(const record of records)if(!record.failed.has('onFixedUpdate'))call(record,'onFixedUpdate',record.instance?.onFixedUpdate);
      }
      if(accumulator>=time.fixedDeltaTime){const discarded=Math.floor(accumulator/time.fixedDeltaTime)*time.fixedDeltaTime;droppedTime+=discarded;accumulator-=discarded;}
      time.interpolationAlpha=Math.max(0,accumulator/time.fixedDeltaTime);
      // At most one callback per repeating timer per rendered frame; missed intervals are coalesced.
      for(const item of [...scheduled.values()]){
        if(!scheduled.has(item.id)||item.due>time.totalTime+1e-10||scale===0)continue;
        if(!item.interval)item.cancel();else item.due=time.totalTime+item.interval;
        if(call(item.record,'timer:'+item.id,item.callback)===false)item.cancel();
      }
      for(const record of records)if(!record.failed.has('onUpdate'))call(record,'onUpdate',record.instance?.onUpdate);
    }
    function pause(){active=false;last=null;time.deltaTime=0;time.unscaledDeltaTime=0;}
    function resume(){active=true;last=null;}
    function stop(){
      if(stopping)return;
      stopping=true;active=false;
      // Reverse registration order gives child scripts a chance to release first.
      for(const record of [...records].reverse())release(record);
      records.length=0;scheduled.clear();subscriptions.clear();
      last=null;accumulator=0;
      for(const key of ['deltaTime','unscaledDeltaTime','totalTime','unscaledTotalTime','frameCount','fixedTotalTime','fixedFrameCount','interpolationAlpha'])time[key]=0;
    }
    function stats(){return {scripts:records.filter(r=>r.active).length,timers:scheduled.size,
      subscriptions:subscriptions.size,listeners:records.reduce((n,r)=>n+r.cleanup.size,0)-scheduled.size-subscriptions.size-records.filter(r=>r.active).length,
      scriptMs,droppedTime,errors,fixedSteps:time.fixedFrameCount,timeScale:scale};}
    return {time,records,owner,start,tick,pause,resume,stop,destroyEntity,stats};
  }
  root.ArkGlideLifecycle={createSession};
})(globalThis);
