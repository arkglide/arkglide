// Script-owned force/acceleration volumes; callbacks and rules remain game logic.
(function(root){
  'use strict';
  function create(o){
    const S=root.ArkGlideSpatial,fields=new Set();let dead=false;
    function guard(owner){if(dead||!owner.record.active||owner.record.destroying)throw Error('Field owner expired');}
    function validate(c){
      if(!c||!['force','acceleration'].includes(c.mode)||!Array.isArray(c.volumes)||!c.volumes.length)throw Error('Field needs volumes and force/acceleration mode');
      if(typeof c.vector!=='function')S.vec(c.vector);
      for(const v of c.volumes){S.vec(v.position);if(v.rotation)S.quat(v.rotation);if(v.vector)S.vec(v.vector);if(!v.shape||!['box','sphere','capsule','convex'].includes(v.shape.kind))throw Error('Invalid field shape');}
      for(const k of ['filterEntity','onEnter','onStay','onExit'])if(c[k]!==undefined&&typeof c[k]!=='function')throw Error('Expected field callback');
      if(c.enabled!==undefined&&typeof c.enabled!=='boolean')throw Error('Invalid field enabled');
      return {...c,volumes:structuredClone(c.volumes),filter:c.filter?{...c.filter,...(c.filter.ignore?{ignore:[...c.filter.ignore]}:{})}:{sensors:false}};
    }
    function field(owner,c){
      guard(owner);let config=validate(c),live=true,off;const api=o.physics.forOwner(owner),members=new Map();
      // Validate complete native query shapes before registering a field.
      for(const v of config.volumes)api.overlap(v.shape,v.position,{...config.filter,rotation:v.rotation});
      const record={owner,step};
      function destroy(){if(!live)return;live=false;fields.delete(record);members.clear();off?.();}
      function check(){guard(owner);if(!live)throw Error('Field destroyed');}
      function notify(name,e,dt){if(!e.destroyed&&config[name])config[name]({entity:e,deltaTime:dt,field:handle});}
      function step(dt){
        if(!live||!owner.record.active)return;const next=new Map();
        if(config.enabled!==false)for(const volume of config.volumes)for(const hit of api.overlap(volume.shape,volume.position,{...config.filter,rotation:volume.rotation}))if(!next.has(hit.entity.id)){
          let state;try{state=o.physics.getState(hit.entity);}catch{continue;}
          if(!['dynamic','character'].includes(state.kind)||config.filterEntity?.(hit.entity)===false)continue;
          next.set(hit.entity.id,{entity:hit.entity,volume});
        }
        for(const {entity:e,volume} of next.values()){
          notify(members.has(e.id)?'onStay':'onEnter',e,dt);if(!live||e.destroyed)continue;
          const state=o.physics.getState(e),vector=volume.vector||(typeof config.vector==='function'?config.vector(e,{deltaTime:dt,state}):config.vector);S.vec(vector);
          const mass=config.mode==='acceleration'?state.mass:1;
          api.applyForce(e,{x:vector.x*mass,y:vector.y*mass,z:vector.z*mass});
        }
        for(const [id,e]of members)if(!next.has(id))notify('onExit',e,dt);
        members.clear();for(const [id,{entity:e}]of next)if(!e.destroyed)members.set(id,e);
      }
      const handle=Object.freeze({get active(){return live;},setEnabled(value){check();if(typeof value!=='boolean')throw Error('Expected field enabled');config={...config,enabled:value};},update(patch){check();const next=validate({...config,...patch});for(const v of next.volumes)api.overlap(v.shape,v.position,{...next.filter,rotation:v.rotation});config=next;},getEntities(){check();return [...members.values()].filter(e=>!e.destroyed);},destroy});
      record.destroy=destroy;fields.add(record);off=owner.track(destroy);return handle;
    }
    return {forOwner(owner){guard(owner);return Object.freeze({create:c=>field(owner,c)});},step(dt){if(dead)return;for(const f of [...fields])try{f.step(dt);}catch(error){o.onError?.({file:f.owner.record.file,hook:'fields.step',error});f.destroy();}},stats:()=>({physicsFields:fields.size}),dispose(){if(dead)return;for(const f of [...fields])f.destroy();dead=true;}};
  }
  root.ArkGlideFields={create};
})(globalThis);
