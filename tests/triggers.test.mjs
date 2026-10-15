import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers/foundations.mjs';

const origin = { x: 0, y: 0, z: 0 };
const volume = () => ({ shape: { kind: 'sphere', radius: 2 }, position: { ...origin } });
function sample(s, dt = 1 / 60) { s.physics.step(dt); s.triggers.step(dt); }

test('native trigger overlaps deduplicate volumes, deliver ordered transitions and never apply force', () => {
  const s = setup();
  try {
    const actor = s.body('actor'), events = [];
    let predicateCalls = 0;
    const config = { volumes: [volume(), volume()], filterEntity: entity => {
      predicateCalls++; return entity === actor;
    }, onEnter: event => events.push(event), onStay: event => events.push(event), onExit: event => events.push(event) };
    const trigger = s.t.create(config);
    config.volumes[0].position.x = 100;
    sample(s); sample(s);
    assert.deepEqual(events.map(event => event.phase), ['enter', 'stay']);
    assert.equal(predicateCalls, 2);
    assert.equal(events[0].trigger, trigger);
    assert.equal(trigger.contains(actor), true);
    assert.deepEqual(trigger.getEntities(), [actor]);
    const copy = trigger.getEntities(); copy.length = 0;
    assert.deepEqual(trigger.getEntities(), [actor]);
    assert.deepEqual(s.p.getVelocity(actor), origin);
    s.p.teleport(actor, { x: 10, y: 0, z: 0 }); sample(s);
    assert.equal(events.at(-1).reason, 'left');
    assert.deepEqual(trigger.getEntities(), []);
    s.p.teleport(actor, origin); sample(s);
    assert.equal(events.at(-1).phase, 'enter');
    assert.equal(s.errors.length, 0);
  } finally { s.done(); }
});

test('trigger samples actual rotated shapes and can include static, sensor and character bodies', () => {
  const s = setup();
  try {
    const target = s.body('static', { x: 3, y: 0, z: 0 }, undefined, 'static');
    const sensor = s.body('sensor'); s.p.remove(sensor);
    s.p.add(sensor, { motion: 'static', shape: 'sphere', size: { x: 1, y: 1, z: 1 }, mass: 1,
      friction: 0, restitution: 0, sensor: true, lockRotation: false });
    const player = s.entities.sceneAPI.create('box', 'player');
    s.p.addCharacter(player, { radius: .2, height: 1, stepHeight: 0, maxSlope: 45, speed: 0, jumpSpeed: 0 });
    const trigger = s.t.create({ volumes: [{ shape: { kind: 'box', size: { x: 1, y: 3, z: 8 } }, position: origin }], motions: ['static', 'character'] });
    sample(s);
    assert.deepEqual(trigger.getEntities(), [player]);
    trigger.update({ volumes: [{ shape: { kind: 'box', size: { x: 1, y: 3, z: 8 } }, position: origin,
      rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 } }], filter: { sensors: true } });
    sample(s);
    assert.deepEqual(trigger.getEntities().map(entity => entity.id), ['player', 'sensor', 'static']);
    assert.equal(trigger.contains(target), true);
    trigger.update({ filter: { sensors: true, ignore: [player, target.id] } }); sample(s);
    assert.deepEqual(trigger.getEntities(), [sensor]);
  } finally { s.done(); }
});

test('sampling intervals use simulation time; disabling bypasses the wait and emits one exit', () => {
  const s = setup();
  try {
    const actor = s.body('actor'), events = [];
    const trigger = s.t.create({ volumes: [volume()], interval: .25,
      onEnter: event => events.push(event), onStay: event => events.push(event), onExit: event => events.push(event) });
    s.triggers.step(.1); s.triggers.step(.1);
    assert.equal(events.length, 1);
    s.triggers.step(.15);
    assert.equal(events.length, 2);
    assert.equal(events[1].deltaTime, .25);
    trigger.setEnabled(false); s.triggers.step(.01);
    assert.equal(events.at(-1).reason, 'disabled');
    s.triggers.step(.3); assert.equal(events.length, 3);
    trigger.setEnabled(true); s.triggers.step(.01);
    assert.equal(events.at(-1).phase, 'enter');
    s.p.teleport(actor, { x: 20, y: 0, z: 0 });
    assert.deepEqual(trigger.query(), []);
    assert.equal(trigger.contains(actor), true, 'query does not replace sampled membership');
    s.triggers.step(.25); assert.equal(trigger.contains(actor), false);
  } finally { s.done(); }
});

test('configuration and native shape validation are atomic and limits reject invalid or excessive usage', () => {
  const s = setup();
  try {
    const actor = s.body('actor');
    s.t.setLimits({ maxTriggers: 1, maxVolumesPerTrigger: 2, maxMembersPerTrigger: 1 });
    const trigger = s.t.create({ volumes: [volume(), volume()] }); sample(s);
    assert.throws(() => s.t.create({ volumes: [volume()] }), /budget/);
    assert.throws(() => s.t.setLimits({ maxVolumesPerTrigger: 1 }), /usage/);
    assert.throws(() => s.t.setLimits({ maxTriggers: 0 }));
    assert.throws(() => s.t.setLimits({ toString: 1 }));
    assert.throws(() => trigger.update({ volumes: [{ ...volume(), shape: { kind: 'sphere', radius: -1 } }] }));
    assert.throws(() => trigger.update({ volumes: [] }));
    assert.throws(() => trigger.update({ volumes: [volume(), volume(), volume()] }));
    assert.throws(() => trigger.update({ interval: Infinity }));
    assert.throws(() => trigger.update({ filter: { mask: 32 } }));
    assert.throws(() => trigger.update({ motions: [] }));
    assert.throws(() => trigger.update({ enabled: 1 }));
    assert.deepEqual(trigger.query(), [actor]);
    const limits = s.t.getLimits(); limits.maxTriggers = 999;
    assert.equal(s.t.getLimits().maxTriggers, 1);
    assert.equal(s.errors.length, 0);
    trigger.destroy(); trigger.destroy();
    assert.equal(s.triggers.stats().physicsTriggers, 0);
  } finally { s.done(); }
});

test('membership overflow reports an error and never emits a partially collected region', () => {
  const s = setup();
  try {
    s.body('a', { x: -1, y: 0, z: 0 }); s.body('b', { x: 1, y: 0, z: 0 });
    s.t.setLimits({ maxMembersPerTrigger: 1 });
    const events = [], trigger = s.t.create({ volumes: [volume()], onEnter: event => events.push(event) });
    s.triggers.step(.1);
    assert.equal(trigger.active, false);
    assert.equal(events.length, 0);
    assert.match(s.errors[0].error.message, /membership budget/);
    assert.equal(s.errors[0].hook, 'triggers.step');
    assert.deepEqual(s.triggers.stats(), { physicsTriggers: 0, triggerMembers: 0 });
  } finally { s.done(); }
});

test('callback mutation applies on the next sample, destruction stops dispatch, and failing regions are isolated', () => {
  const s = setup();
  try {
    s.body('a', { x: -1, y: 0, z: 0 }); s.body('b', { x: 1, y: 0, z: 0 });
    const events = [];
    const trigger = s.t.create({ volumes: [volume()], interval: 100,
      onEnter: event => { events.push(event.phase + ':' + event.entity.id); event.trigger.setEnabled(false); },
      onExit: event => events.push(event.reason + ':' + event.entity.id) });
    s.triggers.step(.1); assert.deepEqual(events, ['enter:a', 'enter:b']);
    s.triggers.step(.1); assert.deepEqual(events.slice(2), ['disabled:a', 'disabled:b']);
    trigger.destroy();
    const destroyed = s.t.create({ volumes: [volume()], onEnter: event => { events.push('destroy'); event.trigger.destroy(); } });
    const failed = s.t.create({ volumes: [volume()], onEnter: () => { throw Error('game callback'); } });
    let healthy = 0;
    s.t.create({ volumes: [volume()], onEnter: () => healthy++ });
    s.triggers.step(.1);
    assert.equal(destroyed.active, false); assert.equal(failed.active, false);
    assert.equal(events.filter(event => event === 'destroy').length, 1);
    assert.equal(healthy, 2); assert.equal(s.errors.length, 1);
    assert.match(s.errors[0].error.message, /game callback/);
  } finally { s.done(); }
});

test('destroyed occupants report exits, while owner cleanup never invokes gameplay callbacks', () => {
  const s = setup();
  try {
    const actor = s.body('actor'), events = [];
    const trigger = s.t.create({ volumes: [volume()], onExit: event => events.push(event) });
    sample(s); actor.destroy(); s.triggers.step(.1);
    assert.equal(events.length, 1); assert.equal(events[0].entity, actor);
    assert.equal(events[0].reason, 'destroyed');
    s.body('second'); s.triggers.step(.1); s.owner.abort();
    assert.equal(events.length, 1);
    assert.equal(trigger.active, false);
    assert.deepEqual(s.triggers.stats(), { physicsTriggers: 0, triggerMembers: 0 });
    assert.throws(() => trigger.getEntities(), /owner expired/i);
    assert.throws(() => s.t.create({ volumes: [volume()] }), /owner expired/i);
  } finally { s.done(); }
});

test('trigger predicates reject asynchronous results and new regions wait until the next fixed step', () => {
  const s = setup();
  try {
    s.body('actor');
    const invalid = s.t.create({ volumes: [volume()], filterEntity: async () => true });
    const events = [];
    s.t.create({ volumes: [volume()], onEnter: () => {
      events.push('parent');
      s.t.create({ volumes: [volume()], onEnter: () => events.push('child') });
    } });
    s.triggers.step(.1);
    assert.equal(invalid.active, false);
    assert.match(s.errors[0].error.message, /synchronous boolean/);
    assert.deepEqual(events, ['parent']);
    s.triggers.step(.1); assert.deepEqual(events, ['parent', 'child']);
  } finally { s.done(); }
});

test('async event rejections are reported without stopping other regions or leaking after owner cleanup', async () => {
  const s = setup();
  try {
    s.body('actor');
    const failed = s.t.create({ volumes: [volume()], onEnter: async () => { throw Error('async effect'); } });
    let healthy = 0;
    s.t.create({ volumes: [volume()], onEnter: () => healthy++ });
    s.triggers.step(.1);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(failed.active, false); assert.equal(healthy, 1);
    assert.match(s.errors[0].error.message, /async effect/);
    let reject;
    s.t.create({ volumes: [volume()], onEnter: () => new Promise((_, fail) => { reject = fail; }) });
    s.triggers.step(.1); s.owner.abort(); reject(Error('late effect'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(s.errors.length, 1);
  } finally { s.done(); }
});

test('filter mutation keeps the next-step refresh even when the sampling interval is long', () => {
  const s = setup();
  try {
    s.body('actor');
    let trigger, entered = 0, exited = 0;
    trigger = s.t.create({ volumes: [volume()], interval: 100,
      filterEntity: () => { trigger.setEnabled(false); return true; },
      onEnter: () => entered++, onExit: event => { assert.equal(event.reason, 'disabled'); exited++; } });
    s.triggers.step(.1); s.triggers.step(.1);
    assert.equal(entered, 1); assert.equal(exited, 1);
  } finally { s.done(); }
});

test('convex volumes keep their authored origins and candidate filters exclude unrelated motion types', () => {
  const s = setup();
  try {
    const actor = s.body('actor', { x: 20, y: 0, z: 0 }, undefined, 'kinematic');
    const points = [];
    for (const x of [19, 21]) for (const y of [-1, 1]) for (const z of [-1, 1]) points.push({ x, y, z });
    const trigger = s.t.create({ volumes: [{ shape: { kind: 'convex', points }, position: origin }], motions: ['kinematic'] });
    s.triggers.step(.1); assert.deepEqual(trigger.getEntities(), [actor]);
    trigger.update({ motions: ['dynamic'] }); s.triggers.step(.1);
    assert.deepEqual(trigger.getEntities(), []);
  } finally { s.done(); }
});
