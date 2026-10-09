import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {indexedDB} from 'fake-indexeddb';
let server,store,storage,archive,validate,selection,readModelAsset;
function request(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
before(async()=>{
 globalThis.indexedDB=indexedDB;
 // Reproduce and migrate the old database containing only the projects store.
 const old=indexedDB.open('arkglide-db',1);old.onupgradeneeded=()=>old.result.createObjectStore('projects');(await request(old)).close();
 server=await createServer({server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
 ({useEditorStore:store}=await server.ssrLoadModule('/src/store/useEditorStore.ts'));
 storage=await server.ssrLoadModule('/src/utils/projectStorage.ts');
 archive=await server.ssrLoadModule('/src/utils/projectExport.ts');
 ({validateProject:validate}=await server.ssrLoadModule('/src/utils/projectValidation.ts'));
 selection=await server.ssrLoadModule('/src/engine/selectionTransform.ts');
 ({readModelAsset}=await server.ssrLoadModule('/src/engine/modelImport.ts'));
});
after(async()=>{await server?.close();});
test('IndexedDB migrates old schema and isolates models shared by node ID across projects',async()=>{
 const data=id=>({projectId:id,name:id,version:'0.1',updatedAt:1,scene:{nodes:[]},scripts:{'main.js':''},activeFileId:'main.js',modelRefs:[{assetId:'same',fileName:'test.glb'}]});
 await storage.saveProjectSnapshot(data('one'),new Map([['same',new Uint8Array([1]).buffer]]));
 await storage.saveProjectSnapshot(data('two'),new Map([['same',new Uint8Array([2]).buffer]]));
 assert.deepEqual([...new Uint8Array(await storage.loadModelBlob('same','one'))],[1]);
 assert.deepEqual([...new Uint8Array(await storage.loadModelBlob('same','two'))],[2]);
 await storage.deleteProject('one');assert.equal(await storage.loadProject('one'),undefined);
 assert.deepEqual([...new Uint8Array(await storage.loadModelBlob('same','two'))],[2]);
});
test('model copy/paste, duplicate, deletion and undo preserve binary assets and descendants',()=>{
 store.getState().newProject();const s=store.getState();const group=s.addNode('empty','group'),model=s.addNode('model','model');
 store.getState().setParent(model,group);store.getState().setModelBuffer(model,new Uint8Array([1,2,3]).buffer);
 store.getState().selectNode(group);store.getState().copyToClipboard();store.getState().pasteFromClipboard();
 const copied=store.getState().nodes.filter(n=>n.name==='model_copy')[0];
 assert.deepEqual([...new Uint8Array(store.getState().modelBuffers.get(copied.id))],[1,2,3]);
 assert.notEqual(copied.parentId,group);
 store.getState().duplicateNode(model);const clone=store.getState().selectedNodeId;
 assert.ok(store.getState().modelBuffers.has(clone));store.getState().removeNode(clone);assert.ok(!store.getState().modelBuffers.has(clone));
 store.getState().undo();assert.ok(store.getState().modelBuffers.has(clone));
});
test('ZIP roundtrip is atomic, preserves binaries/settings and clears project history',async()=>{
 store.getState().updateSettings({backgroundColor:'#123456'});
 const bytes=archive.createProjectArchive();const models=store.getState().nodes.filter(n=>n.type==='model').length;
 store.getState().newProject();store.getState().undo();assert.equal(store.getState().nodes.length,4);
 await archive.importProject(new File([bytes],'test.arkglide'));
 assert.equal(store.getState().nodes.filter(n=>n.type==='model').length,models);
 assert.equal(store.getState().settings.backgroundColor,'#123456');assert.equal(store.getState().past.length,0);
 const before=store.getState().nodes;
 await assert.rejects(archive.importProject(new File([new Uint8Array([1,2])],'broken.arkglide')));
 assert.equal(store.getState().nodes,before);
});
test('script renames/deletes update bindings and undo restores file identity and settings',()=>{
 store.getState().newProject();store.getState().createScript('player.js');store.getState().attachScript('cube','player.js');
 store.getState().renameScript('player.js','hero.js');assert.ok(store.getState().nodes.find(n=>n.id==='cube').scripts.includes('hero.js'));
 store.getState().deleteScript('hero.js');assert.ok(!store.getState().nodes.find(n=>n.id==='cube').scripts.includes('hero.js'));
 store.getState().undo();assert.equal(store.getState().activeFileId,'hero.js');assert.ok(Object.hasOwn(store.getState().scripts,'hero.js'));
 store.getState().updateSettings({ambientIntensity:0});store.getState().undo();assert.equal(store.getState().settings.ambientIntensity,0.5);
});
test('invalid hierarchy is rejected before project replacement; new node IDs never collide',()=>{
 store.getState().newProject();const a=store.getState().addNode('empty'),b=store.getState().addNode('empty');assert.notEqual(a,b);
 store.getState().setParent(a,b);store.getState().setParent(b,a);assert.equal(store.getState().nodes.find(n=>n.id===b).parentId,null);
 const nodes=store.getState().nodes.map(n=>({...n,parentId:n.id}));
 assert.throws(()=>validate({scene:{nodes},scripts:{'main.js':''}}),/循环/);
});
test('multi-selection applies rotation/scale around pivot and skips selected descendants',async()=>{
 const B=await import('@babylonjs/core');const engine=new B.NullEngine(),scene=new B.Scene(engine);
 try{
 const a=new B.TransformNode('a',scene),b=new B.TransformNode('b',scene),child=new B.TransformNode('child',scene);a.position.x=-1;b.position.x=1;child.parent=a;
 assert.deepEqual(selection.selectionRoots([a,b,child]),[a,b]);
 const initial=new Map([a,b].map(n=>[n,n.computeWorldMatrix(true).clone()]));
 const pivot=B.Matrix.Compose(new B.Vector3(2,2,2),B.Quaternion.RotationAxis(B.Vector3.Up(),Math.PI/2),B.Vector3.Zero());
 selection.applySelectionDelta(initial,B.Matrix.Identity(),pivot);
 assert.ok(Math.abs(a.position.z-2)<1e-5);assert.ok(Math.abs(b.position.z+2)<1e-5);assert.equal(a.scaling.x,2);
 }finally{engine.dispose();}
});

test('pause before play is ignored and resume preserves the original play snapshot',()=>{
 store.getState().newProject();store.getState().pause();assert.equal(store.getState().playState,'stopped');
 store.getState().play();const snapshot=store.getState().prePlaySnapshot,project=store.getState().project;
 store.getState().pause();store.getState().play();
 assert.equal(store.getState().playState,'playing');assert.equal(store.getState().prePlaySnapshot,snapshot);assert.equal(store.getState().project,project);
 store.getState().stop();assert.equal(store.getState().project,null);
});

test('glTF sidecars are embedded before storing and missing resources fail explicitly',async()=>{
 const json={asset:{version:'2.0'},buffers:[{uri:'mesh.bin',byteLength:3}],images:[{uri:'../textures/test.png'}]};
 const model={name:'scene.gltf',path:'models/scene.gltf',file:new File([JSON.stringify(json)],'scene.gltf')};
 const bin={path:'models/mesh.bin',file:new File([new Uint8Array([1,2,3])],'mesh.bin')};
 const image={path:'textures/test.png',file:new File([new Uint8Array([4,5,6])],'test.png')};
 const packed=JSON.parse(new TextDecoder().decode(await readModelAsset(model,[model,bin,image])));
 assert.match(packed.buffers[0].uri,/^data:/);assert.match(packed.images[0].uri,/^data:/);
 await assert.rejects(readModelAsset(model,[model]),/缺少关联资源/);
});

test('ZIP keeps a missing model missing when another model has the same filename',async()=>{
 store.getState().newProject();const missing=store.getState().addNode('model','missing'),valid=store.getState().addNode('model','valid');
 store.getState().updateTransform(missing,{modelUrl:'same.glb'});store.getState().updateTransform(valid,{modelUrl:'same.glb'});
 store.getState().setModelBuffer(valid,new Uint8Array([7,8,9]).buffer);
 const zip=archive.createProjectArchive();await archive.importProject(new File([zip],'test.arkglide'));
 assert.ok(store.getState().missingModelIds.has(missing));assert.ok(!store.getState().modelBuffers.has(missing));
 assert.deepEqual([...new Uint8Array(store.getState().modelBuffers.get(valid))],[7,8,9]);
});
