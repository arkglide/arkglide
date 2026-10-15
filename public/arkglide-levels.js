// Prefab-backed levels have their own ownership; initiating scripts may unload.
(function(root){
 'use strict';
 function create(o){
  const clone=root.ArkGlideState.clone,definitions=new Map(),listeners=new Set();let dead=false,current=null,busy=false,pendingOwner=null,serial=0;
  function guard(owner){if(dead||(owner&&(!owner.record.active||owner.record.destroying)))throw Error('Level service expired');}
  function descriptor(c){return c?{id:c.id,prefabId:c.definition.prefabId,root:c.handle.root,entities:[...c.handle.entities]}:null;}
  function publish(event){for(const l of [...listeners])if(l.owner.record.active)try{l.fn(event);}catch(error){o.onError?.({file:l.owner.record.file,hook:'levels.change',error});l.off();}}
  function register(id,c){guard();if(typeof id!=='string'||!id||!c||typeof c.prefabId!=='string'||!o.prefabs.api.list().some(p=>p.id===c.prefabId))throw Error('Level needs an existing prefab');if(definitions.has(id))throw Error('Level already registered');definitions.set(id,{prefabId:c.prefabId,spawn:clone(c.spawn||{})});}
  async function load(id){
   guard();if(busy)throw Error('A level transition is already in progress');const definition=definitions.get(id);if(!definition)throw Error('Unknown level');
   busy=true;const owner=o.createOwner('level:'+id+':'+ ++serial);pendingOwner=owner;owner.attach({});let next;
   try{
    const handle=await o.prefabs.forOwner(owner).instantiate(definition.prefabId,{...definition.spawn,deferScripts:true,visible:false});guard();
    next={id,definition,handle,owner};owner.track(()=>handle.destroy());
    // The old level remains valid until every new asset and script is ready.
    const old=current;old?.owner.abort();current=next;
    handle.root.visible=definition.spawn.visible??(o.getPrefab(definition.prefabId)?.nodes.find(n=>n.id===o.getPrefab(definition.prefabId).rootId)?.visible!==false);
    handle.startScripts();
    publish({phase:'loaded',previousId:old?.id||null,current:descriptor(current)});return descriptor(current);
   }catch(error){owner.abort();throw error;}finally{if(pendingOwner===owner)pendingOwner=null;busy=false;}
  }
  function unload(){guard();if(busy)throw Error('Cannot unload during a level transition');const old=current;current=null;old?.owner.abort();if(old)publish({phase:'unloaded',previousId:old.id,current:null});}
  function resolve(key){if(typeof key!=='string')return null;if(key.startsWith('level:')){if(!current)return null;const source=decodeURIComponent(key.slice(6));return current.handle.find(source);}return key.startsWith('scene:')?o.scene.find(decodeURIComponent(key.slice(6))):null;}
  function entityKey(entity){if(current){const template=o.getPrefab(current.definition.prefabId);for(const n of template?.nodes||[])if(current.handle.find(n.id)===entity)return 'level:'+encodeURIComponent(n.id);}return 'scene:'+encodeURIComponent(entity.id);}
  return {register,load,unload,resolve,entityKey,currentId:()=>current?.id||null,isLoading:()=>busy,
   forOwner(owner){guard(owner);return Object.freeze({register(id,c){guard(owner);register(id,c);},list(){guard(owner);return [...definitions].map(([id,c])=>({id,prefabId:c.prefabId}));},current(){guard(owner);return descriptor(current);},load(id){guard(owner);return load(id);},unload(){guard(owner);unload();},find(localId){guard(owner);return current?.handle.find(localId)||null;},onChange(fn){guard(owner);if(typeof fn!=='function')throw Error('Expected level callback');const l={owner,fn};l.off=owner.track(()=>listeners.delete(l));listeners.add(l);return l.off;}});},
   stats:()=>({levelCount:definitions.size,levelLoading:busy,levelId:current?.id||null}),
   dispose(){if(dead)return;dead=true;pendingOwner?.abort();current?.owner.abort();current=null;listeners.clear();definitions.clear();}
  };
 }
 root.ArkGlideLevels={create};
})(globalThis);
