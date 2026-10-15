// Versioned game-state providers plus built-in world/portal snapshots.
(function(root){
 'use strict';
 function create(o){
  const clone=root.ArkGlideState.clone,providers=new Map();let dead=false,busy=false;
  const guard=owner=>{if(dead||(owner&&(!owner.record.active||owner.record.destroying)))throw Error('Checkpoint service expired');};
  function entries(){return [...providers].filter(([,p])=>!p.owner||p.owner.record.active);}
  function register(owner,id,p){
   guard(owner);if(typeof id!=='string'||!id||(!owner&&!id.startsWith('engine.'))||(owner&&id.startsWith('engine.'))||providers.has(id)||!p||!Number.isInteger(p.version)||p.version<1||typeof p.capture!=='function'||typeof p.restore!=='function'||(p.validate!==undefined&&typeof p.validate!=='function'))throw Error('Invalid/duplicate checkpoint provider');
   const record={...p,owner};providers.set(id,record);let off;
   const remove=()=>{if(providers.get(id)===record)providers.delete(id);off?.();};if(owner)off=owner.track(remove);return remove;
  }
  function capture(){guard();if(o.levels.isLoading?.())throw Error('Cannot capture during a level transition');const data=Object.fromEntries(entries().map(([id,p])=>[id,{version:p.version,state:clone(p.capture())}]));return clone({format:'arkglide-checkpoint-1',levelId:o.levels.currentId(),providers:data});}
  function validate(snapshot){
   if(!snapshot||snapshot.format!=='arkglide-checkpoint-1'||!snapshot.providers||typeof snapshot.providers!=='object'||(snapshot.levelId!==null&&typeof snapshot.levelId!=='string'))throw Error('Invalid checkpoint format');
   const active=entries();if(Object.keys(snapshot.providers).length!==active.length)throw Error('Checkpoint provider set differs');
   for(const [id,p]of active){const saved=snapshot.providers[id];if(!saved||saved.version!==p.version)throw Error('Incompatible checkpoint provider: '+id);if(p.validate){const result=p.validate(saved.state);if(result&&typeof result.then==='function')throw Error('Checkpoint validation must be synchronous');if(result===false)throw Error('Checkpoint provider rejected state: '+id);}}
  }
  async function apply(snapshot){
   if(snapshot.levelId!==null)await o.levels.load(snapshot.levelId);
   else if(o.levels.currentId()!==null)o.levels.unload();
   guard();validate(snapshot);o.beforeRestore?.();
   for(const [id,p]of entries()){guard();await p.restore(clone(snapshot.providers[id].state));}
  }
  async function restore(snapshot){
   guard();if(busy)throw Error('Checkpoint operation already in progress');snapshot=clone(snapshot);if(snapshot.format!=='arkglide-checkpoint-1'||!snapshot.providers||Array.isArray(snapshot.providers)||typeof snapshot.providers!=='object'||(snapshot.levelId!==null&&typeof snapshot.levelId!=='string')||Object.values(snapshot.providers).some(p=>!p||!Number.isInteger(p.version)||p.version<1||!Object.hasOwn(p,'state')))throw Error('Invalid checkpoint format');
   const backup=capture(),scale=o.time.timeScale;busy=true;o.time.timeScale=0;
   try{await apply(snapshot);}catch(error){if(!dead)try{await apply(backup);}catch(rollback){throw new AggregateError([error,rollback],'Checkpoint restore and rollback failed');}throw error;}
   finally{busy=false;if(!dead)o.time.timeScale=scale;}
  }
  if(o.world)register(null,'engine.world',{version:1,...o.world});
  if(o.portals)register(null,'engine.portals',{version:1,capture:()=>o.portals.captureState(o.levels.entityKey),validate:s=>o.portals.validateState(s,o.levels.resolve),restore:s=>o.portals.restoreState(s,o.levels.resolve)});
  return {forOwner(owner){guard(owner);const storage=o.storage.forOwner(owner);return Object.freeze({register:(id,p)=>register(owner,id,p),capture(){guard(owner);return capture();},restore(snapshot){guard(owner);return restore(snapshot);},async save(slot){guard(owner);const snapshot=capture();await storage.write('checkpoint:'+slot,snapshot);},async load(slot){guard(owner);const snapshot=await storage.read('checkpoint:'+slot);guard(owner);if(snapshot===null)return false;await restore(snapshot);return true;}});},capture,restore,stats:()=>({checkpointProviders:providers.size,checkpointRestoring:busy}),dispose(){dead=true;providers.clear();}};
 }
 function createWorld(B,o){
  const S=root.ArkGlideSpatial;
  function entities(){return o.scene.findAll().filter(e=>!o.getObject(e.id)?.metadata?.arkglideTransient);}
  function jointKey(j){return j.entities.map(o.levels.entityKey).sort().join('|')+'|'+j.kind;}
  function joints(){const counts=new Map();return o.physicsAPI.getJoints().map(j=>{const base=jointKey(j),n=counts.get(base)||0;counts.set(base,n+1);return {key:base+'|'+n,handle:j};});}
  function capture(){return {entities:entities().map(e=>{
   const m=o.getObject(e.id),q=m.rotationQuaternion,local={position:e.getPosition(),rotation:q?S.plainQ(q):S.plainQ(B.Quaternion.FromEulerVector(m.rotation)),scale:e.getScale(),visible:e.visible,name:e.name};
   let state=null,config=null;try{state=o.physics.getState(e);config=state.kind==='character'?o.physicsAPI.character(e).getConfig():o.physicsAPI.getProperties(e);}catch{}
   return {key:o.levels.entityKey(e),local,state,config};
  }),joints:joints().map(j=>({key:j.key,state:j.handle.getState()}))};}
  function validate(snapshot){
   if(!snapshot||!Array.isArray(snapshot.entities)||!Array.isArray(snapshot.joints)||snapshot.entities.length!==entities().length||new Set(snapshot.entities.map(r=>r.key)).size!==snapshot.entities.length)throw Error('World checkpoint topology differs');
   for(const saved of snapshot.entities){const e=o.levels.resolve(saved.key);if(!e)throw Error('Checkpoint entity missing: '+saved.key);const local=saved.local;S.vec(local.position);S.quat(local.rotation);S.vec(local.scale);if(typeof local.visible!=='boolean'||typeof local.name!=='string')throw Error('Invalid entity state');
    if(['x','y','z'].some(k=>local.scale[k]!==e.getScale()[k])&&saved.state)throw Error('Checkpoint physics scale differs');
    let current=null;try{current=o.physics.getState(e);}catch{}if(!!current!==!!saved.state||current&&current.kind!==saved.state.kind)throw Error('Checkpoint motion component differs');
    if(saved.state){S.vec(saved.state.position);S.quat(saved.state.rotation);S.vec(saved.state.velocity);S.vec(saved.state.angularVelocity);if(!saved.config||!Number.isFinite(saved.config.mass??saved.state.mass)||(saved.config.mass??saved.state.mass)<=0)throw Error('Invalid checkpoint physics configuration');}
   }
   const current=joints();if(current.length!==snapshot.joints.length||snapshot.joints.some(j=>!current.some(c=>c.key===j.key)))throw Error('Checkpoint joint topology differs');
  }
  function restore(snapshot){
   validate(snapshot);
   for(const saved of snapshot.entities){const e=o.levels.resolve(saved.key),m=o.getObject(e.id);e.position=saved.local.position;e.scale=saved.local.scale;m.rotationQuaternion=new B.Quaternion(saved.local.rotation.x,saved.local.rotation.y,saved.local.rotation.z,saved.local.rotation.w);e.visible=saved.local.visible;e.name=saved.local.name;}
   for(const saved of snapshot.entities)if(saved.state)o.physics.setState(o.levels.resolve(saved.key),saved.state);
   for(const saved of snapshot.entities)if(saved.state){const e=o.levels.resolve(saved.key);if(saved.state.kind==='character'){if(!o.physicsAPI.character(e).configure(Object.fromEntries(Object.entries(saved.config).filter(([k])=>k!=='group')),{keepFeet:false}))throw Error('Checkpoint character shape obstructed');}
    else{const properties=o.physicsAPI.getProperties(e);if(properties.shape!==saved.config.shape||JSON.stringify(properties.size)!==JSON.stringify(saved.config.size))o.physicsAPI.updateShape(e,{shape:saved.config.shape,size:saved.config.size,...(saved.config.parts?{parts:saved.config.parts}:{})});
     const patch={friction:saved.config.friction,restitution:saved.config.restitution};if(saved.state.kind!=='static')for(const k of ['mass','gravityFactor','linearDamping','angularDamping'])if(saved.config[k]!==undefined)patch[k]=saved.config[k];o.physicsAPI.configure(e,patch);}
    o.physics.setState(e,saved.state);
   }
   const current=new Map(joints().map(j=>[j.key,j.handle]));for(const saved of snapshot.joints){const j=current.get(saved.key);if(j.kind!=='fixed')j.setLimits(saved.state.min,saved.state.max);if(['hinge','slider'].includes(j.kind))j.setMotor(saved.state.motor);}
  }
  return {capture,validate,restore};
 }
 root.ArkGlideCheckpoints={create,createWorld};
})(globalThis);
