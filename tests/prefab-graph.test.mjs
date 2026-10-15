import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';

test('prefab depth limits are independent of template insertion order',async()=>{
 const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
 try {
  const {assertPrefabGraph}=await server.ssrLoadModule('/src/engine/prefabs.ts');
  const graph=(length,reverse)=>{
   const entries=Array.from({length},(_,i)=>['p'+i,{nestedInstances:i+1<length?{child:{prefabId:'p'+(i+1)}}:{}}]);
   return Object.fromEntries(reverse?entries.reverse():entries);
  };
  for(const reverse of [false,true]){
   assert.doesNotThrow(()=>assertPrefabGraph(graph(65,reverse)));
   assert.throws(()=>assertPrefabGraph(graph(66,reverse)),/超过 64 层/);
  }
 } finally {await server.close();}
});
