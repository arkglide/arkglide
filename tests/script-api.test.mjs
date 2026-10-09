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
