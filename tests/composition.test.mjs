import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers/foundations.mjs';
const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const identity = { x: 0, y: 0, z: 0, w: 1 };

test('signal gates settle as a graph before notification and coalesce changes without glitches', () => {
  const s = setup();
  try {
    const a = s.sig.create(), b = s.sig.create(), gate = s.sig.gate('and', [a, b]), inverse = s.sig.gate('not', [gate]), events = [];
    s.sig.onChange(gate, e => events.push([e.previous, e.value, inverse.value]));
    a.set(true); b.set(true); b.set(false); b.set(true);
    assert.equal(gate.value, false);
    s.signals.flush();
    assert.deepEqual(events, [[false, true, false]]);
    assert.equal(s.sig.gate('xor', [a, b]).value, false);
    assert.equal(s.sig.gate('or', [a, b]).value, true);
    b.set(false); b.set(true); s.signals.flush(); assert.equal(events.length, 1);
    assert.throws(() => a.set(1));
    const other = ArkGlideSignals.create(), foreign = other.forOwner(s.owner).create();
    assert.throws(() => s.sig.gate('not', [foreign]), /another session/); other.dispose();
    assert.throws(() => s.sig.gate('and', []));
  } finally { s.done(); }
});

test('signal feedback is bounded, exceptions are isolated, and consumer subscriptions have their own owner', async () => {
  const s = setup();
  try {
    s.sig.setLimits({ maxPasses: 4 });
    const a = s.sig.create(), b = s.sig.create(); let healthy = 0;
    s.sig.onChange(a, e => a.set(!e.value));
    s.sig.onChange(b, () => { throw Error('bad listener'); });
    s.sig.onChange(b, () => healthy++);
    a.set(true); b.set(true); s.signals.flush();
    assert.equal(healthy, 1);
    assert.ok(s.errors.some(e => /budget exceeded/.test(e.error.message)));
    assert.ok(s.errors.some(e => /bad listener/.test(e.error.message)));
    const consumer = s.session.owner(null, 'consumer'); consumer.attach({}); s.session.startRecords([consumer.record]);
    const c = s.signals.forOwner(consumer), derived = c.gate('not', [a]);
    c.onChange(a, () => healthy++);
    const listeners = s.signals.stats().signalListeners;
    consumer.abort();
    assert.equal(derived.active, false);
    assert.equal(s.signals.stats().signalListeners, listeners - 1);
    const late = s.sig.create(); s.sig.onChange(late, async () => { throw Error('async listener'); });
    late.set(true); s.signals.flush(); await new Promise(resolve => setImmediate(resolve));
    assert.ok(s.errors.some(e => /async listener/.test(e.error.message)));
    a.destroy(); assert.throws(() => a.set(true));
  } finally { s.done(); }
});

test('signal budgets and source destruction prevent orphan derived nodes and listeners', () => {
  const s = setup();
  try {
    s.sig.setLimits({ maxNodes: 2, maxListeners: 1 });
    const source = s.sig.create(), gate = s.sig.gate('not', [source]);
    s.sig.onChange(gate, () => {});
    assert.throws(() => s.sig.create(), /budget/);
    assert.throws(() => s.sig.onChange(source, () => {}), /budget/);
    assert.throws(() => s.sig.setLimits({ maxNodes: 1 }), /usage/);
    source.destroy();
    assert.equal(gate.active, false);
    assert.deepEqual(s.signals.stats(), { signalNodes: 0, signalListeners: 0 });
  } finally { s.done(); }
});

test('kinematic actuators reverse, pause, restore and retain native velocity across portal substeps', () => {
  const s = setup();
  try {
    s.pair(); const traveler = s.body('traveler', v(0, 0, 2)); s.a.watch(traveler);
    const door = s.body('door', v(20), undefined, 'kinematic');
    const config = { to: { position: v(24), rotation: identity }, duration: 1, target: 1 };
    const actuator = s.m.create(door, config); config.duration = 0;
    s.motion.step(.25); s.portals.step(.25);
    assert.ok(Math.abs(s.p.getState(door).position.x - 21) < .001);
    assert.ok(Math.abs(s.p.getVelocity(door).x - 4) < .001);
    actuator.setTarget(0); s.motion.step(.125); s.portals.step(.125);
    assert.ok(Math.abs(s.p.getState(door).position.x - 20.5) < .001);
    actuator.setPaused(true); s.motion.step(.1); s.portals.step(.1);
    assert.ok(Math.abs(s.p.getVelocity(door).x) < .001);
    const before = actuator.getState();
    assert.throws(() => actuator.restore({ progress: NaN, target: 1, paused: false }));
    assert.deepEqual(actuator.getState(), before);
    actuator.restore({ progress: .75, target: 1, paused: false });
    assert.ok(Math.abs(s.p.getState(door).position.x - 23) < .001);
    assert.throws(() => s.m.create(door, config), /already controlled/);
    assert.throws(() => s.m.create(traveler, config), /kinematic/);
    actuator.destroy(); assert.equal(s.motion.stats().motionControllers, 0);
  } finally { s.done(); }
});

test('native character rides a moving kinematic platform without a scripted teleport', () => {
  const s = setup(v(0, -9.8));
  try {
    const platform = s.body('platform', v(0, -.25), v(8, .5, 8), 'kinematic');
    const player = s.entities.sceneAPI.create('box', 'rider'); player.position = v(0, 1);
    const ch = s.p.addCharacter(player, { radius: .3, height: 1.8, stepHeight: .2, maxSlope: 45, speed: 0, jumpSpeed: 0 });
    for (let i = 0; i < 90; i++) s.physics.step(1 / 60);
    assert.equal(ch.getGround().entity, platform);
    s.m.create(platform, { to: { position: v(3, -.25), rotation: identity }, duration: 1, target: 1 });
    for (let i = 0; i < 60; i++) { s.motion.step(1 / 60); s.portals.step(1 / 60); }
    assert.ok(Math.abs(player.getWorldPosition().x - 3) < .15, JSON.stringify(player.getWorldPosition()));
    assert.equal(ch.getGround().entity, platform);
    assert.equal(s.errors.length, 0);
  } finally { s.done(); }
});

function reflectedScene(s) {
  const mirror = s.body('mirror', v(0, 0, 4), v(4, 4, .2), 'static');
  const rotation = s.B.Quaternion.RotationYawPitchRoll(-Math.PI / 4, 0, 0);
  s.p.setState(mirror, { rotation });
  const target = s.body('receiver', v(4, 0, 3.86), v(1, 1, 1), 'static');
  const reflector = s.opt.addReflector(mirror, { reflectivity: .5 });
  return { mirror, target, reflector };
}
test('optical traces use real mirror normals, conserve path range and stop on receiver collisions', () => {
  const s = setup();
  try {
    const { mirror, target, reflector } = reflectedScene(s);
    const trace = s.opt.trace({ origin: v(), direction: v(0, 0, 12) });
    assert.equal(trace.hit?.entity, target);
    assert.equal(trace.reflections.length, 1); assert.equal(trace.reflections[0].entity, mirror);
    assert.equal(trace.energy, .5); assert.equal(trace.reason, 'hit');
    assert.ok(trace.distance < 12 && trace.distance > 6);
    assert.ok(trace.reflections[0].direction.x > .99);
    const limited = s.opt.trace({ origin: v(), direction: v(0, 0, 5) });
    assert.equal(limited.hit, null); assert.ok(Math.abs(limited.distance - 5) < 1e-6);
    const energy = s.opt.trace({ origin: v(), direction: v(0, 0, 12), minEnergy: .6 });
    assert.equal(energy.reason, 'energy'); assert.equal(energy.truncated, false);
    const budget = s.opt.trace({ origin: v(), direction: v(0, 0, 12), maxBounces: 0 });
    assert.equal(budget.reason, 'budget'); assert.equal(budget.hit.entity, mirror);
    assert.throws(() => reflector.update({ reflectivity: 2 }));
    assert.equal(s.opt.trace({ origin: v(), direction: v(0, 0, 12) }).energy, .5);
    reflector.destroy();
    assert.equal(s.opt.trace({ origin: v(), direction: v(0, 0, 12) }).hit.entity, mirror);
  } finally { s.done(); }
});

test('reflection after a real portal preserves the mapped direction and shares a total portal budget', () => {
  const s = setup();
  try {
    s.pair();
    const mirror = s.body('exit-mirror', v(6), v(2, 2, .2), 'static');
    s.p.setState(mirror, { rotation: s.B.Quaternion.RotationYawPitchRoll(Math.PI / 4, 0, 0) });
    s.opt.addReflector(mirror);
    const receiver = s.body('receiver', v(6.14, 0, 3), v(1, 1, 1), 'static');
    const config = { origin: v(0, 0, 3), direction: v(0, 0, -12) };
    const trace = s.opt.trace(config);
    assert.deepEqual(trace.path, ['A']); assert.equal(trace.reflections.length, 1);
    assert.equal(trace.hit?.entity, receiver);
    const truncated = s.opt.trace({ ...config, maxPortalHops: 0 });
    assert.equal(truncated.truncated, true); assert.equal(truncated.reflections.length, 0);
    s.opt.setLimits({ maxSegments: 1 }); assert.equal(s.opt.trace(config).reason, 'budget');
    assert.throws(() => s.opt.trace({ ...config, maxBounces: -1 }));
    receiver.destroy(); mirror.destroy(); s.optics.prune();
    assert.equal(s.optics.stats().opticalReflectors, 0);
  } finally { s.done(); }
});
