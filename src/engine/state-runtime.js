// Strict JSON state and a correlated asynchronous parent-host storage bridge.
(function(root){
  'use strict';
  const defaults = Object.freeze({ maxBytes: 4 * 1024 * 1024, maxDepth: 64, timeoutMs: 15000 });
  function clone(value, limits = defaults) {
    const seen = new Set();
    function visit(v, depth) {
      if (depth > (limits.maxDepth ?? defaults.maxDepth)) throw Error('State nesting budget exceeded');
      if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
      if (typeof v === 'number' && Number.isFinite(v)) return;
      if (!v || typeof v !== 'object' || seen.has(v) || (!Array.isArray(v) && Object.getPrototypeOf(v) !== null && (Object.prototype.toString.call(v) !== '[object Object]' || Object.getPrototypeOf(v)?.constructor?.name !== 'Object'))) throw Error('State must be finite, acyclic JSON data');
      seen.add(v); for (const item of Object.values(v)) visit(item,depth+1); seen.delete(v);
    }
    visit(value,0); const text = JSON.stringify(value);
    if (new TextEncoder().encode(text).length > (limits.maxBytes ?? defaults.maxBytes)) throw Error('State byte budget exceeded');
    return JSON.parse(text);
  }
  function createStorage(o) {
    const pending=new Map(); let serial=0,dead=false;
    function request(op,key,value,owner){
      if(dead || !owner.record.active || owner.record.destroying) return Promise.reject(Error('Storage session expired'));
      if(typeof key!=='string' || !key || key.length>256 || /[\u0000-\u001f]/.test(key)) return Promise.reject(Error('Invalid storage key'));
      let data; try { if(op==='write')data=clone(value,o.limits); }catch(error){return Promise.reject(error);}
      const requestId=++serial;
      return new Promise((resolve,reject)=>{
        let off,timer;
        const finish=(error,value)=>{if(!pending.has(requestId))return;pending.delete(requestId);clearTimeout(timer);off?.();error?reject(error):resolve(value);};
        pending.set(requestId,{finish});
        off=owner.track(()=>finish(Error('Storage operation canceled')));
        timer=setTimeout(()=>finish(Error('Storage request timed out')),o.limits?.timeoutMs ?? defaults.timeoutMs);
        try{o.send({type:'storage',requestId,op,key,...(data===undefined?{}:{value:data})});}catch(error){finish(error);}
      });
    }
    return {forOwner(owner){return Object.freeze({read:key=>request('read',key,undefined,owner),write:(key,value)=>request('write',key,value,owner),remove:key=>request('remove',key,undefined,owner)});},receive(msg){const p=pending.get(msg.requestId);if(!p)return;try{p.finish(msg.error?Error(msg.error):null,msg.value===undefined?null:clone(msg.value,o.limits));}catch(error){p.finish(error);}},dispose(){if(dead)return;for(const p of [...pending.values()])p.finish(Error('Storage session stopped'));dead=true;},stats:()=>({storageRequests:pending.size})};
  }
  root.ArkGlideState={clone,defaults,createStorage};
})(globalThis);
