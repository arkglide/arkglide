import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/engine/prefab-runtime.js';

test('failed prefab model buffer copies release pending spawn bookkeeping',async()=>{
 const detached=new ArrayBuffer(4);structuredClone(detached,{transfer:[detached]});
 const node=id=>({id,name:id,type:'model',parentId:id==='root'?null:'root',transform:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}});
 const buffers={first:new ArrayBuffer(4),second:detached};
 const prefab={id:'template',rootId:'root',nodes:[node('root'),node('child')],modelKeys:{root:'first',child:'second'}};
 const library=ArkGlidePrefabs.createPrefabAPI({isRunning:()=>true,getContent:()=>({prefabs:{template:prefab}}),getGeneration:()=>1,getBuffers:()=>buffers,sceneAPI:{find:()=>null,destroy(){}},getAdapter(){assert.fail('failed bytes must not reach the scene');}});
 await assert.rejects(library.api.instantiate('template'),/detached|ArrayBuffer/i);
 assert.equal(library.pendingCount,0);assert.deepEqual(Object.keys(buffers),['first','second']);
});
