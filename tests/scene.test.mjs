import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '@babylonjs/core';
import '../public/arkglide-scene.js';
import '../public/arkglide-api.js';
const node=(id,type='mesh',extra={})=>({id,name:'Cube',type,transform:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},visible:true,...extra});
function setup(options={}){
 const engine=new B.NullEngine(),scene=new B.Scene(engine);
 const adapter=globalThis.ArkGlideScene.createSceneAdapter(B,scene,options);
 return {engine,scene,adapter,dispose(){adapter.dispose();engine.dispose();}};
}
test('scene construction preserves primitive shape, unordered hierarchy and zero light intensity',async()=>{
 const t=setup();try{
 await t.adapter.sync([node('child','mesh',{primitive:'box',parentId:'group',transform:{x:2,y:0,z:0}}),node('group','empty',{transform:{x:10,y:0,z:0}}),node('sun','light',{intensity:0,lightType:'point'}),node('view','camera',{fov:90,activeCamera:true})]);
 const child=t.adapter.nodes.get('child');child.computeWorldMatrix(true);
 assert.equal(child.getTotalVertices(),24);assert.equal(child.getAbsolutePosition().x,12);
 assert.equal(t.adapter.resources.get('sun').intensity,0);
 assert.ok(Math.abs(t.adapter.activeCamera().fov-Math.PI/2)<1e-8);
 await t.adapter.sync([node('child','mesh',{primitive:'box',name:'Sphere renamed'})]);
 assert.equal(t.adapter.nodes.get('child').getTotalVertices(),24);assert.equal(t.scene.lights.length,0);assert.equal(t.scene.cameras.length,0);
 }finally{t.dispose();}
});
test('all node types can have entity handles and parent destruction removes descendant handles',async()=>{
 const engine=new B.NullEngine(),scene=new B.Scene(engine),api=globalThis.ArkGlideRuntime.createEntityAPI(B,()=>scene);
 const adapter=globalThis.ArkGlideScene.createSceneAdapter(B,scene,{onCreate:(object,n)=>api.register(object,n.id,n.name),onRemove:id=>api.sceneAPI.destroy(id)});
 try{
 await adapter.sync([node('group','empty'),node('child','light',{parentId:'group'}),node('camera','camera')]);
 assert.equal(api.entities.size,3);assert.equal(api.sceneAPI.find('group').visible,true);
 api.sceneAPI.find('group').destroy();assert.equal(api.entities.size,1);
 assert.equal(api.sceneAPI.find('child'),null);
 }finally{adapter.dispose();engine.dispose();}
});
test('late model containers are disposed after stop or replacement and URLs are revoked',async()=>{
 const engine=new B.NullEngine(),scene=new B.Scene(engine),resolvers=[];
 const fake={...B,SceneLoader:{LoadAssetContainerAsync:()=>new Promise(resolve=>resolvers.push(resolve))}};
 const adapter=globalThis.ArkGlideScene.createSceneAdapter(fake,scene);
 let disposed=0,added=0;
 const container=()=>({meshes:[],transformNodes:[],addAllToScene(){added++;},dispose(){disposed++;}});
 try{
 const first=adapter.sync([node('model','model')],new Map([['model',new ArrayBuffer(4)]]));
 adapter.clear();resolvers.shift()(container());await first;
 assert.equal(added,0);assert.equal(disposed,1);assert.equal(adapter.nodes.size,0);
 const old=adapter.sync([node('model','model')],new Map([['model',new ArrayBuffer(4)]]));
 const newer=adapter.sync([node('model','model')],new Map([['model',new ArrayBuffer(8)]]));
 resolvers.shift()(container());await old;assert.equal(added,0);
 resolvers.shift()(container());await newer;assert.equal(added,1);assert.equal(disposed,2);
 }finally{adapter.dispose();engine.dispose();}
});
