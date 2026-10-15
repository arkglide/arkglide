import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, MeshBuilder, Quaternion, Vector3 } from '@babylonjs/core';
import '../public/arkglide-api.js';

function setup() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const adapter = globalThis.ArkGlideRuntime.createEntityAPI({ MeshBuilder }, () => scene);
  return { ...adapter, engine, scene };
}

test('entity handles support live vectors, snapshots, aliases and relative movement', () => {
  const { sceneAPI, engine, scene } = setup();
  try {
    const entity = sceneAPI.create('box', 'player');
    const mesh = scene.getMeshByName('player');
    assert.equal(entity._mesh, undefined);
    entity.setPosition({ x: 1, y: 2, z: 3 });
    const snapshot = entity.getPosition();
    snapshot.x = 99;
    assert.equal(entity.position.x, 1);
    assert.equal(entity.transform, entity.position);
    entity.transform.z += 2;
    entity.position = { x: 4, y: 5, z: 6 };
    entity.translate(1, -1, 2);
    assert.deepEqual(entity.getPosition(), { x: 5, y: 4, z: 8 });
    assert.deepEqual(mesh.position.asArray(), [5, 4, 8]);
    entity.setRotation(0, 0.5, 0);
    entity.rotate({ x: 0, y: 0.5, z: 0 });
    assert.equal(entity.rotation.y, 1);
    entity.setScale({ x: 2, y: 3, z: 4 });
    assert.equal(mesh.scaling.y, 3);
    assert.throws(() => entity.translate(NaN, 0, 0), /finite/);
    assert.throws(() => { entity.position.x = Infinity; }, /finite/);
  } finally { engine.dispose(); }
});

test('name lookup uses display names while IDs remain stable; duplicate IDs cannot leak meshes', () => {
  const { sceneAPI, engine, scene } = setup();
  try {
    const first = sceneAPI.create('box', 'a');
    const second = sceneAPI.create('sphere', 'b');
    first.name = 'Player'; second.setName('Player');
    assert.equal(first.id, 'a');
    assert.equal(sceneAPI.find('a'), first);
    assert.equal(sceneAPI.find('Player'), null);
    assert.equal(sceneAPI.findByName('Player'), first);
    assert.deepEqual(sceneAPI.findAllByName('Player'), [first, second]);
    assert.equal(sceneAPI.findByName('absent'), null);
    const count = scene.meshes.length;
    assert.throws(() => sceneAPI.create('box', 'a'), /Duplicate/);
    assert.throws(() => sceneAPI.create('typo'), /Unknown/);
    assert.equal(scene.meshes.length, count);
  } finally { engine.dispose(); }
});

test('hidden objects can be shown again; destruction is idempotent and old live views fail clearly', () => {
  const { sceneAPI, engine } = setup();
  try {
    const entity = sceneAPI.create('box');
    const view = entity.position;
    entity.visible = false;
    assert.equal(entity.isVisible(), false);
    entity.setVisible(true);
    assert.equal(entity.visible, true);
    entity.destroy(); entity.destroy();
    assert.equal(entity.destroyed, true);
    assert.equal(sceneAPI.getEntityCount(), 0);
    assert.throws(() => view.x, /destroyed/);
    assert.throws(() => entity.getName(), /destroyed/);
    sceneAPI.create('sphere'); sceneAPI.create('box');
    sceneAPI.destroyAll();
    assert.equal(sceneAPI.getEntityCount(), 0);
  } finally { engine.dispose(); }
});

test('imported quaternion roots respond to the Euler rotation API', () => {
  const { register, engine, scene } = setup();
  try {
    const mesh = MeshBuilder.CreateBox('root', {}, scene);
    mesh.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), 0.5);
    const entity = register(mesh, 'model', 'Imported Model');
    assert.equal(mesh.rotationQuaternion, null);
    assert.ok(Math.abs(entity.rotation.y - 0.5) < 1e-6);
    entity.rotation.y = 1;
    assert.equal(mesh.rotation.y, 1);
  } finally { engine.dispose(); }
});

test('Euler rotation views read and edit quaternion-backed entities without losing other axes',()=>{
 const {sceneAPI,scene,engine}=setup();
 try {
  const entity=sceneAPI.create('box','quaternion-model'),mesh=scene.getMeshByName('quaternion-model');
  mesh.rotationQuaternion=Quaternion.FromEulerAngles(0.2,0.4,0.1);
  assert.ok(Math.abs(entity.getRotation().y-0.4)<1e-6);
  assert.ok(Math.abs(entity.rotation.x-0.2)<1e-6);
  entity.rotation.y=0.7;
  assert.equal(mesh.rotationQuaternion,null);
  assert.ok(Math.abs(mesh.rotation.x-0.2)<1e-6);assert.ok(Math.abs(mesh.rotation.z-0.1)<1e-6);
  assert.equal(mesh.rotation.y,0.7);
 } finally {engine.dispose();}
});

test('entity destruction notifies lifecycle cleanup once for explicit and native disposal',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),calls=[];
 const api=ArkGlideRuntime.createEntityAPI({MeshBuilder},()=>scene,()=>null,{onBeforeDestroy:id=>calls.push(id)});
 try {
  const first=api.sceneAPI.create('box','first');first.destroy();first.destroy();
  assert.deepEqual(calls,['first']);
  api.sceneAPI.create('box','native');scene.getMeshByName('native').dispose();
  assert.deepEqual(calls,['first','native']);
 } finally {engine.dispose();}
});

test('entity disposal completes when lifecycle notification throws',()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 const api=ArkGlideRuntime.createEntityAPI({MeshBuilder},()=>scene,()=>null,{onBeforeDestroy(){throw Error('cleanup failed');}});
 try {
  const entity=api.sceneAPI.create('box','failed-cleanup');
  assert.throws(()=>entity.destroy(),/cleanup failed/);
  assert.equal(entity.destroyed,true);assert.equal(api.sceneAPI.find('failed-cleanup'),null);
  assert.equal(scene.getMeshByName('failed-cleanup'),null);assert.doesNotThrow(()=>entity.destroy());
 } finally {engine.dispose();}
});

test('native disposal unregisters the entity even when lifecycle reporting fails',()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 const api=ArkGlideRuntime.createEntityAPI({MeshBuilder},()=>scene,()=>null,{onBeforeDestroy(){throw Error('native cleanup failed');}});
 const entity=api.sceneAPI.create('box','native-failure'),mesh=scene.getMeshByName('native-failure');
 try {
  assert.throws(()=>mesh.dispose(),/native cleanup failed/);
  assert.equal(entity.destroyed,true);assert.equal(api.sceneAPI.find('native-failure'),null);
 } finally {mesh.onDisposeObservable.clear();mesh.dispose();engine.dispose();}
});

test('descendant cleanup failures do not prevent the rest of an entity subtree from disposing',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),calls=[];
 const api=ArkGlideRuntime.createEntityAPI({MeshBuilder},()=>scene,()=>null,{onBeforeDestroy(id){calls.push(id);if(id==='child')throw Error('child cleanup failed');}});
 try {
  const parent=api.sceneAPI.create('box','parent');
  for(const id of ['child','sibling']){api.sceneAPI.create('box',id);const mesh=scene.getMeshByName(id);mesh.metadata={arkglideId:id};mesh.parent=scene.getMeshByName('parent');}
  assert.throws(()=>parent.destroy(),/child cleanup failed/);
  assert.equal(api.entities.size,0);assert.equal(scene.meshes.length,0);
  assert.deepEqual([...calls].sort(),['child','parent','sibling']);
 } finally {engine.dispose();}
});

test('entity teardown preserves falsy thrown values while completing cleanup',()=>{
 for(const thrown of [null,undefined,false,0,'']){
  const engine=new NullEngine(),scene=new Scene(engine);
  const api=ArkGlideRuntime.createEntityAPI({MeshBuilder},()=>scene,()=>null,{onBeforeDestroy(){throw thrown;}});
  try {
   const entity=api.sceneAPI.create('box','falsy');let caught=false;
   try {entity.destroy();}catch(error){caught=true;assert.equal(error,thrown);}
   assert.equal(caught,true);assert.equal(entity.destroyed,true);assert.equal(api.entities.size,0);
  } finally {engine.dispose();}
 }
});

test('destroyAll completes unrelated entity cleanup before rethrowing the first failure',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),calls=[];
 const api=ArkGlideRuntime.createEntityAPI({MeshBuilder},()=>scene,()=>null,{onBeforeDestroy(id){calls.push(id);if(id==='first')throw Error('first failed');}});
 try {
  api.sceneAPI.create('box','first');api.sceneAPI.create('box','second');
  assert.throws(()=>api.sceneAPI.destroyAll(),/first failed/);
  assert.equal(api.entities.size,0);assert.equal(scene.meshes.length,0);assert.deepEqual(calls,['first','second']);
 } finally {engine.dispose();}
});
