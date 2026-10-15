// Parent-origin storage adapter shared by the editor and standalone host.
(function(root){
 'use strict';
 function create(options){
  const namespace=String(options.namespace||'');if(!namespace)throw Error('Storage requires a stable game/project namespace');
  const prefix='arkglide:game-state:'+encodeURIComponent(namespace)+':';let dead=false;
  const limits={...root.ArkGlideState.defaults,...options.limits};
  return {receive(message,reply){
   if(dead||message?.type!=='storage')return false;
   let value=null,error;
   try{
    if(!Number.isSafeInteger(message.requestId)||message.requestId<1||!['read','write','remove'].includes(message.op)||typeof message.key!=='string'||!message.key||message.key.length>256||/[\u0000-\u001f]/.test(message.key))throw Error('Invalid storage request');
    const storage=options.getStorage(),key=prefix+encodeURIComponent(message.key);
    if(message.op==='read'){const text=storage.getItem(key);if(text!==null){if(new TextEncoder().encode(text).length>limits.maxBytes)throw Error('Stored state exceeds byte budget');value=root.ArkGlideState.clone(JSON.parse(text),limits);}}
    if(message.op==='write')storage.setItem(key,JSON.stringify(root.ArkGlideState.clone(message.value,limits)));
    if(message.op==='remove')storage.removeItem(key);
   }catch(e){error=e.message||String(e);}
   reply({type:'storage-result',requestId:message.requestId,...(error?{error}:{value})});return true;
  },dispose(){dead=true;}};
 }
 root.ArkGlideStorageHost={create};
})(globalThis);
