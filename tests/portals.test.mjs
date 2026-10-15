import test from "node:test";
import assert from "node:assert/strict";
import * as B from "@babylonjs/core";
import "../public/lib/jolt-physics.js";
import "../src/engine/spatial-runtime.js";
import "../src/engine/lifecycle-runtime.js";
import "../src/engine/physics-advanced.js";
import "../src/engine/physics-runtime.js";
import "../src/engine/camera-runtime.js";
import "../src/engine/portal-runtime.js";
import "../src/engine/interaction-runtime.js";
const J = await createArkGlideJolt();
const identity = { x: 0, y: 0, z: 0, w: 1 },
  vec = (x, y, z) => ({ x, y, z });

test('vertical rig headings retain transformed azimuth instead of snapping to world +Z', () => {
  const s = setup();
  try {
    const player = s.entity('vertical-view', vec(0, 0, 0), vec(1, 1, 1), null);
    const yaw = .8, rotation = B.Quaternion.RotationYawPitchRoll(yaw, Math.PI / 2, 0);
    const rig = s.c.createRig({ target: player, rotation });
    const direction = rig.direction(0, 1);
    near(direction.x, Math.sin(yaw)); near(direction.z, Math.cos(yaw)); near(direction.y, 0);
    assert.ok(Math.abs(Math.hypot(direction.x, direction.z) - 1) < 1e-6);
  } finally { s.done(); }
});

test('upright characters retain azimuth when a portal maps their facing exactly vertical', () => {
  const s = setup();
  try {
    const a = s.api.create({ id: 'entry' }), rotation = B.Quaternion.RotationYawPitchRoll(.8, Math.PI / 2, 0);
    const b = s.api.create({ id: 'exit', position: vec(10, 0, 0), rotation }); a.link(b);
    const player = s.entity('vertical-character', vec(0, 0, 1), vec(1, 1, 1), null);
    const ch = s.p.addCharacter(player, { radius: .2, height: .6, stepHeight: 0, maxSlope: 45, speed: 0, jumpSpeed: 0, movementMode: 'inertial', airAcceleration: 0 });
    s.api.watch(player); let crossed = false; s.api.onTraverse(() => { crossed = true; });
    ch.setVelocity(vec(0, 0, -10));
    for (let i = 0; i < 10 && !crossed; i++) s.portals.step(1 / 60);
    assert.equal(crossed, true);
    const q = s.p.getState(player).rotation, direction = ArkGlideSpatial.horizontalForward(B, new B.Quaternion(q.x, q.y, q.z, q.w));
    near(direction.x, -Math.sin(.8)); near(direction.z, -Math.cos(.8));
    const up = B.Vector3.TransformNormal(B.Axis.Y, B.Matrix.Compose(B.Vector3.One(), new B.Quaternion(q.x, q.y, q.z, q.w), B.Vector3.Zero()));
    near(up.y, 1);
  } finally { s.done(); }
});

test('portal warps map direct character input so the next control update cannot add stale carry', () => {
  const s = setup();
  try {
    const player = s.entity('direct-input', vec(0, 3, 0), vec(1, 1, 1), null);
    const ch = s.p.addCharacter(player, { radius: .2, height: 1, stepHeight: 0, maxSlope: 45, speed: 3, jumpSpeed: 4, movementMode: 'direct' });
    ch.move(vec(0, 0, 1)); s.physics.step(1 / 60);
    s.p.setState(player, { velocity: vec(3, 0, 0) });
    s.physics.warpFrame(player, B.Matrix.RotationY(Math.PI / 2));
    s.physics.step(1 / 60); ch.move(vec(1, 0, 0)); s.physics.step(1 / 60);
    near(ch.velocity.x, 3); near(ch.velocity.z, 0);
    ch.addImpulse(vec(2, 0, 0)); ch.clearInput(); s.physics.step(1 / 60);
    near(ch.velocity.x, 5);
  } finally { s.done(); }
});

test('traversal budgets are configurable and invalid step or ray inputs leave the world unchanged', () => {
  const s = setup();
  try {
    s.pair();
    const actor = s.entity('guard', vec(0, 0, 1), vec(.2, .2, .2), 'dynamic');
    s.api.watch(actor); const before = s.p.getState(actor);
    for (const duration of [0, -1, NaN, Infinity]) assert.throws(() => s.portals.step(duration));
    assert.deepEqual(s.p.getState(actor), before);
    assert.throws(() => s.api.setTraversalLimits({ maxSubSteps: 1.5 }));
    assert.throws(() => s.api.raycast(vec(0, 0, 3), vec(0, 0, -10), { maxHops: .5 }));
    assert.throws(() => s.api.raycast(vec(0, 0, 3), vec(1e308, 1e308, 1e308)));
    s.api.setTraversalLimits({ maxSubSteps: 512, maxStepTime: 1 / 480, maxTravelDistance: .05 });
    const copy = s.api.getTraversalLimits(); copy.maxSubSteps = 1;
    assert.equal(s.api.getTraversalLimits().maxSubSteps, 512);
    s.p.setVelocity(actor, vec(0, 0, -10)); s.portals.step(.2);
    assert.ok(s.p.getState(actor).position.x < 8);
  } finally { s.done(); }
});
function setup(gravity = vec(0, 0, 0)) {
  const engine = new B.NullEngine(),
    scene = new B.Scene(engine),
    objects = new Map(),
    entities = new Map(),
    session = ArkGlideLifecycle.createSession(),
    owner = session.owner(null, "test");
  owner.attach({});
  session.startRecords([owner.record]);
  const physics = ArkGlidePhysics.createPhysics(J, B, {
      getObject: (id) => objects.get(id),
      find: (id) => entities.get(id),
      gravity,
    }),
    p = physics.forOwner(owner);
  const cameras = ArkGlideCameras.create(B, {
      scene,
      getObject: (id) => objects.get(id),
      find: (id) => entities.get(id),
      fallback: () => null,
      physics: p,
    }),
    c = cameras.forOwner(owner);
  const portals = ArkGlidePortals.create(B, {
      scene,
      physics,
      cameras,
      getObject: (id) => objects.get(id),
      find: (id) => entities.get(id),
    }),
    api = portals.forOwner(owner);
  function entity(id, position, size = vec(1, 1, 1), motion = "static") {
    const mesh = B.MeshBuilder.CreateBox(id, {}, scene);
    mesh.position.copyFromFloats(position.x, position.y, position.z);
    mesh.scaling.copyFromFloats(size.x, size.y, size.z);
    const e = {
      id,
      name: id,
      get destroyed() {
        return mesh.isDisposed();
      },
      getWorldPosition() {
        const p = mesh.getAbsolutePosition();
        return vec(p.x, p.y, p.z);
      },
    };
    objects.set(id, mesh);
    entities.set(id, e);
    if (motion)
      p.add(e, {
        motion,
        shape: "box",
        size: vec(1, 1, 1),
        mass: 1,
        friction: 0,
        restitution: 0,
        sensor: false,
        lockRotation: false,
        linearDamping: 0,
        angularDamping: 0,
      });
    return e;
  }
  function pair(motionA = "static", motionB = "static") {
    const a = entity("wall-a", vec(0, 0, 0), vec(10, 10, 0.2), motionA),
      b = entity("wall-b", vec(8, 0, 0), vec(0.2, 10, 10), motionB);
    api.addSurface(a);
    api.addSurface(b);
    const pa = api.create({ id: "A" }),
      pb = api.create({ id: "B" });
    const ra = pa.place(vec(0, 0, 3), vec(0, 0, -6));
    assert.equal(ra.placed, true, ra.reason);
    const rb = pb.place(vec(6, 0, 0), vec(4, 0, 0));
    assert.equal(rb.placed, true, rb.reason);
    pa.link(pb);
    return [pa, pb, a, b];
  }
  return {
    engine,
    scene,
    owner,
    session,
    physics,
    p,
    cameras,
    c,
    portals,
    api,
    entity,
    pair,
    objects,
    entities,
    done() {
      session.stop();
      portals.dispose();
      cameras.dispose();
      physics.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}
function near(a, b, epsilon = 1e-3) {
  assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
}
test("a native box returns through the destination aperture without being stopped by its entrance ghost", () => {
  const s = setup();
  try {
    s.pair();
    const e = s.entity("roundtrip", vec(0, 0, 0.8), vec(0.7, 0.7, 0.7), "dynamic");
    s.api.watch(e);
    const events = [];
    s.api.onTraverse((event) => events.push(event.source.id));
    s.p.setVelocity(e, vec(0, 0, -4));
    for (let i = 0; i < 30; i++) s.portals.step(1 / 60);
    assert.deepEqual(events, ["A"]);
    s.p.setVelocity(e, vec(4, 0, 0));
    for (let i = 0; i < 30; i++) s.portals.step(1 / 60);
    assert.deepEqual(events, ["A", "B"]);
    assert.ok(s.p.getState(e).position.z > 0.6);
  } finally { s.done(); }
});

test("a rotated native box that fits the ellipse can traverse and return without an AABB corner false rejection", () => {
  const s = setup();
  try {
    s.pair();
    const e = s.entity("rotated-roundtrip", vec(0, -0.7, 0.8), vec(0.7, 0.7, 0.7), "dynamic");
    s.p.setState(e, { rotation: ArkGlideSpatial.plainQ(B.Quaternion.RotationAxis(B.Axis.Z, Math.PI / 4)), velocity: vec(0, 0, -4) });
    s.api.watch(e);
    const events = [];
    s.api.onTraverse((event) => events.push(event.source.id));
    for (let i = 0; i < 30; i++) s.portals.step(1 / 60);
    assert.deepEqual(events, ["A"], JSON.stringify(s.p.getState(e)));
    s.p.setVelocity(e, vec(4, 0, 0));
    for (let i = 0; i < 30; i++) s.portals.step(1 / 60);
    assert.deepEqual(events, ["A", "B"], JSON.stringify(s.p.getState(e)));
    assert.ok(s.p.getState(e).position.z > 0.6);
  } finally { s.done(); }
});

test("a grounded capsule that physically fits the low ellipse must traverse instead of walking out through the cut wall", () => {
  const s = setup(vec(0, -9.8, 0));
  try {
    s.entity("floor", vec(0, -0.15, 0), vec(12, 0.3, 8));
    const aWall = s.entity("a-wall", vec(0, 3, 2), vec(10, 6, 0.3));
    const bWall = s.entity("b-wall", vec(4, 3, 0), vec(0.3, 6, 8));
    s.api.addSurface(aWall); s.api.addSurface(bWall);
    const a = s.api.create({ width: 2.2, height: 3 });
    const b = s.api.create({ width: 2.2, height: 3 });
    assert.equal(a.place(vec(0, 1.6, 0), vec(0, 0, 4)).placed, true);
    assert.equal(b.place(vec(0, 1.6, 0), vec(6, 0, 0)).placed, true);
    a.link(b);
    const player = s.entity("ground-player", vec(0, 1, 0), vec(1, 1, 1), null);
    const ch = s.p.addCharacter(player, { radius: 0.3, height: 1.8,
      stepHeight: 0.3, maxSlope: 45, speed: 4, jumpSpeed: 5,
      movementMode: "inertial", groundAcceleration: 40, groundFriction: 8, airAcceleration: 6 });
    s.api.watch(player);
    const events = [];
    s.api.onTraverse((event) => events.push(event));
    for (let i = 0; i < 100 && !events.length; i++) {
      ch.move(vec(0, 0, 1)); s.portals.step(1 / 60);
    }
    const state = s.p.getState(player);
    assert.equal(events.length, 1, JSON.stringify(state));
    assert.ok(state.position.y > 0.8 && state.position.x < 3.85, JSON.stringify(state));
    // Leave the plane, then walk back from the other endpoint repeatedly under gravity.
    for (let trip = 0; trip < 6; trip++) {
      const atB = trip % 2 === 0;
      const away = atB ? vec(-1, 0, 0) : vec(0, 0, -1);
      const toward = atB ? vec(1, 0, 0) : vec(0, 0, 1);
      for (let i = 0; i < 25; i++) { ch.move(away); s.portals.step(1 / 60); }
      const expected = events.length + 1;
      for (let i = 0; i < 100 && events.length < expected; i++) {
        ch.move(toward); s.portals.step(1 / 60);
      }
      assert.equal(events.length, expected, JSON.stringify(s.p.getState(player)));
      assert.equal(events.at(-1).source.id, atB ? b.id : a.id);
      assert.ok(s.p.getState(player).position.y > 0.8);
    }
  } finally { s.done(); }
});

test("force-held native bodies can return through either endpoint with floor contacts and gravity", () => {
  const s = setup(vec(0, -9.8, 0));
  const interaction = ArkGlideInteraction.create(B, { physics: s.physics, portals: s.portals });
  try {
    s.pair();
    s.entity("floor", vec(3, -0.5, 0), vec(18, 0.2, 18));
    const e = s.entity("held-roundtrip", vec(0, 0, 1), vec(0.6, 0.6, 0.6), "dynamic");
    s.api.watch(e);
    const events = [];
    s.api.onTraverse((event) => events.push(event.source.id));
    const grab = interaction.forOwner(s.owner).grab(e, {
      position: vec(0, -0.1, -3), stiffness: 120, damping: 24,
      maxForce: 1000, maxDistance: 50,
    });
    for (let i = 0; i < 100 && events.length < 1; i++) { interaction.step(1 / 60); s.portals.step(1 / 60); }
    assert.deepEqual(events, ["A"]);
    for (let i = 0; i < 40; i++) { interaction.step(1 / 60); s.portals.step(1 / 60); }
    grab.setTarget(vec(9.5, -0.1, 0));
    for (let i = 0; i < 150 && events.length < 2; i++) { interaction.step(1 / 60); s.portals.step(1 / 60); }
    assert.deepEqual(events, ["A", "B"], JSON.stringify(s.p.getState(e)));
    assert.equal(grab.active, true);
  } finally { interaction.dispose(); s.done(); }
});

test("an exit-floor contact supports the traveler without canceling tangential portal movement", () => {
  const s = setup();
  try {
    s.pair();
    s.entity("floor-with-exit-edge", vec(1.925, -0.5, 0), vec(11.85, 0.2, 10));
    const e = s.entity("floor-traveler", vec(0, -0.2, 0.2), vec(0.4, 0.4, 0.4), "dynamic");
    s.api.watch(e);
    s.p.setVelocity(e, vec(0, -0.2, -4));
    s.portals.step(1 / 60);
    // The floor edge can legitimately deflect and rotate this body. It must
    // still advance, rather than being stopped along the unrelated gate normal.
    assert.ok(s.p.getState(e).velocity.z < -1, JSON.stringify(s.p.getState(e)));
    assert.ok(s.p.getState(e).position.z < 0.18);
    assert.ok(s.p.getState(e).position.y > -0.21);
  } finally { s.done(); }
});

test("rejected kinematic entries are solid and report their reason instead of leaking through an open wall", () => {
  const s = setup();
  try {
    s.pair();
    const e = s.entity("oversized-kinematic", vec(0, 0, 1), vec(3, 3, 3), "kinematic");
    s.api.watch(e);
    const reasons = [];
    s.api.onBlocked((event) => reasons.push(event.reason));
    s.objects.get(e.id).position.z = -1;
    s.portals.step(1 / 60);
    assert.deepEqual(reasons, ["traveler-does-not-fit"]);
    assert.ok(s.p.getState(e).position.z >= 1.6);
    assert.equal(s.portals.stats().portalTraversals, 0);
  } finally { s.done(); }
});

test("an incompatible upright exit and crossings shallower than the old epsilon are handled explicitly", () => {
  const s = setup();
  try {
    const a = s.api.create({ position: vec(0, 0, 0), width: 3, height: 3 });
    const b = s.api.create({ position: vec(8, 0, 0), width: 0.4, height: 0.4 });
    a.link(b);
    const e = s.entity("too-big-exit", vec(0, 0, 0.5), vec(0.7, 0.7, 0.7), "kinematic");
    s.api.watch(e);
    const reasons = [];
    s.api.onBlocked((event) => reasons.push(event.reason));
    s.objects.get(e.id).position.z = -0.5;
    s.portals.step(1 / 60);
    assert.deepEqual(reasons, ["exit-does-not-fit"]);
    assert.ok(s.p.getState(e).position.z >= 0.35);
    const small = s.entity("slow-traveler", vec(0, 0, 0.0001), vec(0.1, 0.1, 0.1), "kinematic");
    s.api.watch(small);
    s.objects.get(small.id).position.z = -0.0001;
    s.portals.step(1 / 60);
    assert.equal(s.portals.stats().portalTraversals, 1);
    assert.ok(s.p.getState(small).position.x > 7);
  } finally { s.done(); }
});
test("portal maps points, rotation and momentum round-trip across rotated frames", () => {
  const s = setup();
  try {
    const a = s.api.create({ position: vec(0, 0, 0) }),
      b = s.api.create({
        position: vec(9, 2, 1),
        rotation: ArkGlideSpatial.plainQ(
          B.Quaternion.RotationAxis(B.Axis.Y, Math.PI / 2),
        ),
      });
    a.link(b);
    const point = vec(1, 2, -3),
      v = vec(2, -4, -8),
      q = ArkGlideSpatial.plainQ(
        B.Quaternion.RotationYawPitchRoll(0.3, 0.2, 0.1),
      );
    const mapped = a.mapVector(v);
    near(Math.hypot(mapped.x, mapped.y, mapped.z), Math.hypot(v.x, v.y, v.z));
    const back = b.mapPoint(a.mapPoint(point));
    for (const k of ["x", "y", "z"]) near(back[k], point[k]);
    const rq = b.mapRotation(a.mapRotation(q));
    near(Math.abs(rq.x * q.x + rq.y * q.y + rq.z * q.z + rq.w * q.w), 1);
    a.unlink();
    assert.throws(() => a.mapVector(v), /linked/);
  } finally {
    s.done();
  }
});
test("linked ellipse cuts only its aperture, close restores real wall and invalid placement does not move it", () => {
  const s = setup();
  try {
    const [a, b, wall] = s.pair();
    assert.equal(s.p.raycast(vec(0, 0, 3), vec(0, 0, -6)), null);
    assert.equal(s.p.raycast(vec(3, 0, 3), vec(0, 0, -6)).entity, wall);
    assert.equal(s.p.raycast(vec(0.85, 1.25, 3), vec(0, 0, -6)).entity, wall);
    const before = a.getPose();
    assert.equal(
      a.place(vec(4.9, 0, 3), vec(0, 0, -6)).reason,
      "outside-surface",
    );
    assert.deepEqual(a.getPose(), before);
    b.setEnabled(false);
    assert.equal(s.p.raycast(vec(0, 0, 3), vec(0, 0, -6)).entity, wall);
    b.setEnabled(true);
    assert.equal(s.p.raycast(vec(0, 0, 3), vec(0, 0, -6)), null);
    a.destroy();
    assert.equal(s.p.raycast(vec(0, 0, 3), vec(0, 0, -6)).entity, wall);
  } finally {
    s.done();
  }
});
test("native dynamic traveler crosses rotated walls with momentum and angular velocity; reverse movement does not bounce", () => {
  const s = setup();
  try {
    const [a] = s.pair(),
      e = s.entity("body", vec(0, 0, 1), vec(0.4, 0.4, 0.4), "dynamic");
    s.api.watch(e);
    s.p.setState(e, {
      velocity: vec(0, 0, -12),
      angularVelocity: vec(0, 2, 0),
    });
    let count = 0;
    s.api.onTraverse(() => count++);
    for (let i = 0; i < 10; i++) s.portals.step(1 / 60);
    const state = s.p.getState(e);
    assert.equal(count, 1);
    assert.ok(state.position.x < 7);
    near(state.velocity.x, -12, 0.03);
    near(state.angularVelocity.y, 2, 0.03);
    for (let i = 0; i < 10; i++) s.portals.step(1 / 60);
    assert.equal(count, 1);
  } finally {
    s.done();
  }
});
test("native wall remains solid beyond aperture and oversized bodies cannot tunnel through edges", () => {
  const s = setup();
  try {
    s.pair();
    const e = s.entity("outside", vec(3, 0, 1), vec(0.4, 0.4, 0.4), "dynamic");
    s.api.watch(e);
    s.p.setState(e, { velocity: vec(0, 0, -12) });
    for (let i = 0; i < 15; i++) s.portals.step(1 / 60);
    assert.ok(s.p.getState(e).position.z > 0.15);
    const big = s.entity("big", vec(0, 0, 1), vec(3, 3, 3), "dynamic");
    s.api.watch(big);
    s.p.setState(big, { velocity: vec(0, 0, -4) });
    for (let i = 0; i < 15; i++) s.portals.step(1 / 60);
    assert.ok(s.p.getState(big).position.z > 0);
  } finally {
    s.done();
  }
});
test("cross-portal ray keeps total range and maps its path to a destination object", () => {
  const s = setup();
  try {
    s.pair();
    const target = s.entity("target", vec(6, 0, 0));
    const hit = s.api.raycast(vec(0, 0, 3), vec(0, 0, -12));
    assert.equal(hit.hit.entity, target);
    assert.deepEqual(hit.path, ["A"]);
    assert.equal(hit.segments.length, 2);
    near(hit.hit.distance, 4.3, 0.01);
    assert.equal(s.api.raycast(vec(0, 0, 3), vec(0, 0, -4)).hit, null);
    assert.equal(
      s.api.raycast(vec(0, 0, 3), vec(0, 0, -4), { maxHops: 0 }).truncated,
      true,
    );
  } finally {
    s.done();
  }
});
test("inertial characters retain horizontal launch speed, receive delta velocity impulses and remain compatible with cameras", () => {
  const s = setup();
  try {
    const e = s.entity("player", vec(0, 3, 0), vec(1, 1, 1), null),
      handle = s.p.addCharacter(e, {
        radius: 0.3,
        height: 1.8,
        stepHeight: 0.3,
        maxSlope: 45,
        speed: 3,
        jumpSpeed: 5,
        movementMode: "inertial",
        airAcceleration: 0,
      });
    handle.setVelocity(vec(10, 2, 0));
    for (let i = 0; i < 30; i++) s.physics.step(1 / 60);
    near(handle.velocity.x, 10);
    handle.addImpulse(vec(3, 0, 0));
    s.physics.step(1 / 60);
    near(handle.velocity.x, 13);
    const rig = s.c.createRig({ target: e });
    rig.look(200, 0);
    const d = rig.direction(0, 1);
    assert.ok(d.x > 0.1);
    assert.equal(rig.camera.ray(0.5, 0.5, 5).direction.z > 0, true);
    s.cameras.update();
    assert.ok(rig.camera.getPose().position.x > 4);
    rig.destroy();
    assert.equal(s.cameras.stats().runtimeCameras, 0);
  } finally {
    s.done();
  }
});
test("observer follows a separate viewpoint, third-person collision shortens its boom, invalid rigs release resources", () => {
  const s = setup();
  try {
    const player = s.entity("player", vec(0, 0, 0), vec(1, 1, 1), null),
      observer = s.entity("observer", vec(2, 4, -6), vec(1, 1, 1), null);
    const rig = s.c.createRig({
      mode: "observer",
      viewpoint: observer,
      target: player,
      offset: vec(0, 0, 0),
    });
    assert.deepEqual(rig.camera.getPose().position, vec(2, 4, -6));
    rig.destroy();
    s.entity("obstacle", vec(0, 1, -2), vec(3, 3, 0.2));
    const follow = s.c.createRig({
      mode: "thirdPerson",
      target: player,
      offset: vec(0, 0, -4),
    });
    assert.ok(follow.camera.getPose().position.z > -2);
    follow.destroy();
    assert.throws(() => s.c.createRig({ mode: "firstPerson" }), /target/);
    assert.equal(s.cameras.stats().runtimeCameras, 0);
  } finally {
    s.done();
  }
});

test("floor-to-wall character launch converts vertical momentum and camera orientation without horizontal loss", () => {
  const s = setup();
  try {
    const floor = s.entity("floor", vec(0, 0, 0), vec(8, 0.2, 8)),
      wall = s.entity("exit-wall", vec(10, 3, 0), vec(0.2, 8, 8));
    s.api.addSurface(floor);
    s.api.addSurface(wall);
    const a = s.api.create({ width: 2.2, height: 3 }),
      b = s.api.create({ width: 2.2, height: 3 });
    assert.equal(a.place(vec(0, 4, 0), vec(0, -8, 0)).placed, true);
    assert.equal(b.place(vec(6, 2, 0), vec(8, 0, 0)).placed, true);
    a.link(b);
    const player = s.entity("player", vec(0, 3, 0), vec(1, 1, 1), null),
      ch = s.p.addCharacter(player, {
        radius: 0.3,
        height: 1.8,
        stepHeight: 0.3,
        maxSlope: 45,
        speed: 3,
        jumpSpeed: 5,
        movementMode: "inertial",
        airAcceleration: 0,
      });
    s.api.watch(player);
    const rig = s.c.createRig({ target: player });
    ch.setVelocity(vec(0, -18, 0));
    let event;
    s.api.onTraverse((e) => (event = e));
    for (let i = 0; i < 15; i++) s.portals.step(1 / 60);
    assert.ok(event);
    near(
      Math.hypot(event.velocity.x, event.velocity.y, event.velocity.z),
      18,
      0.03,
    );
    assert.ok(ch.velocity.x < -17.9);
    assert.ok(s.p.getState(player).position.x < 9);
    s.cameras.update();
    const forward = rig.camera.ray(0.5, 0.5, 1).direction;
    assert.ok(Math.abs(forward.y) > 0.9);
    rig.destroy();
  } finally {
    s.done();
  }
});
test("exit collision applies before traveler center crosses", () => {
  const s = setup();
  try {
    s.pair();
    const obstacle = s.entity("blocker", vec(7.7, 0, 0), vec(0.3, 2, 2)),
      e = s.entity("traveler", vec(0, 0, 0.8), vec(0.4, 0.4, 0.4), "dynamic");
    s.api.watch(e);
    s.p.setState(e, { velocity: vec(0, 0, -4) });
    for (let i = 0; i < 30; i++) s.portals.step(1 / 60);
    const state = s.p.getState(e);
    assert.ok(
      state.position.x < 1 && state.position.z > 0.1,
      "center remains on source side",
    );
    assert.ok(state.velocity.z >= -0.1, "exit obstruction stops entry");
  } finally {
    s.done();
  }
});
test("partially crossing objects render clipped clones, closing evacuates the actor and owner disposal releases all resources", () => {
  const s = setup();
  try {
    const [a] = s.pair(),
      e = s.entity("traveler", vec(0, 0, 0.22), vec(0.4, 0.4, 0.4), "dynamic"),
      material = new B.StandardMaterial("original", s.scene);
    s.objects.get(e.id).material = material;
    s.api.watch(e);
    s.portals.updateVisuals();
    assert.equal(s.portals.stats().portalClones, 1);
    assert.notEqual(s.objects.get(e.id).material, material);
    a.setEnabled(false);
    s.portals.updateVisuals();
    assert.equal(s.portals.stats().portalClones, 0);
    assert.equal(s.objects.get(e.id).material, material);
    assert.ok(s.p.getState(e).position.z >= 0.3);
    s.session.stop();
    assert.equal(s.portals.stats().portals, 0);
    assert.equal(s.portals.stats().portalSurfaces, 0);
    assert.equal(s.portals.stats().portalTravelers, 0);
    assert.equal(s.scene.materials.includes(material), true);
  } finally {
    s.done();
  }
});
test("force grab obeys mass, custom force budget, collision, release and owner cleanup", () => {
  const s = setup();
  try {
    const system = ArkGlideInteraction.create(B, {
        physics: s.physics,
        portals: s.portals,
      }),
      e = s.entity("crate", vec(0, 0, 0), vec(1, 1, 1), "dynamic"),
      h = system
        .forOwner(s.owner)
        .grab(e, { position: vec(2, 0, 0), maxForce: 1, maxDistance: 5 });
    system.step(1);
    near(s.p.getState(e).velocity.x, 1);
    h.setTarget(vec(1, 0, 0));
    h.release();
    assert.equal(system.stats().physicsGrabs, 0);
    assert.throws(() => h.setTarget(vec(0, 0, 0)), /expired/);
    const next = system.forOwner(s.owner).grab(e);
    s.session.stop();
    assert.equal(next.active, false);
    system.dispose();
  } finally {
    s.done();
  }
});

test("partial exit contacts transfer linear momentum to another dynamic body", () => {
  const s = setup();
  try {
    s.pair();
    const target = s.entity(
        "receiver",
        vec(7.65, 0, 0),
        vec(0.3, 0.3, 0.3),
        "dynamic",
      ),
      e = s.entity("traveler", vec(0, 0, 0.7), vec(0.4, 0.4, 0.4), "dynamic");
    s.api.watch(e);
    s.p.setState(e, { velocity: vec(0, 0, -4) });
    for (let i = 0; i < 25; i++) s.portals.step(1 / 60);
    assert.ok(s.p.getState(target).velocity.x < -0.5);
    assert.ok(s.p.getState(target).position.x < 7.65);
  } finally {
    s.done();
  }
});
test("camera validation and expired portal handles cannot leak or mutate engine resources", () => {
  const s = setup();
  try {
    const e = s.entity("player", vec(0, 0, 0), vec(1, 1, 1), null);
    assert.throws(
      () => s.c.createRig({ target: e, offset: vec(NaN, 0, 0) }),
      /finite/,
    );
    assert.equal(s.cameras.stats().runtimeCameras, 0);
    const p = s.api.create();
    p.destroy();
    assert.throws(() => p.setEnabled(true), /destroyed/);
    assert.throws(() => p.getPose(), /destroyed/);
  } finally {
    s.done();
  }
});

test("holding through a portal applies force in the object current segment and updates after traversal", () => {
  const s = setup();
  try {
    s.pair();
    const e = s.entity("held", vec(0, 0, 1), vec(0.4, 0.4, 0.4), "dynamic"),
      system = ArkGlideInteraction.create(B, {
        physics: s.physics,
        portals: s.portals,
      }),
      h = system.forOwner(s.owner).grab(e, { maxDistance: 10 });
    h.setRay(vec(0, 0, 3), vec(0, 0, -6), 3.5);
    system.step(0.01);
    let state = s.p.getState(e);
    near(state.velocity.x, 0);
    assert.ok(state.velocity.z < 0, "pull toward source aperture");
    s.p.setState(e, { position: vec(7.6, 0, 0), velocity: vec(0, 0, 0) });
    // An external teleport did not emit onTraverse; explicitly select its frame.
    h.setRay(vec(0, 0, 3), vec(0, 0, -6), 3.5, { segment: 1 });
    system.step(0.01);
    state = s.p.getState(e);
    assert.ok(state.velocity.x < 0, "pull in destination coordinates");
    near(state.velocity.z, 0);
    assert.throws(
      () => h.setRay(vec(0, 0, 3), vec(0, 0, -6), 3.5, { segment: 99 }),
      /segment/,
    );
    h.release();
    system.dispose();
  } finally {
    s.done();
  }
});

test("generic point and angular impulses use native inertia and expose point velocity", () => {
  const s = setup();
  try {
    const e = s.entity("body", vec(0, 0, 0), vec(1, 1, 1), "dynamic");
    s.p.addImpulseAt(e, vec(1, 0, 0), vec(0, 1, 0));
    near(s.p.getVelocity(e).x, 1);
    assert.ok(s.p.getAngularVelocity(e).z < -1);
    assert.ok(s.p.getPointVelocity(e, vec(0, 1, 0)).x > 1);
    s.p.setAngularVelocity(e, vec(0, 0, 0));
    s.p.addAngularImpulse(e, vec(0, 1, 0));
    assert.ok(s.p.getAngularVelocity(e).y > 1);
  } finally {
    s.done();
  }
});
test("character mass config is native, invalid masses fail atomically and state copies cannot mutate pending motion", () => {
  const s = setup();
  try {
    const e = s.entity("player", vec(0, 3, 0), vec(1, 1, 1), null),
      config = {
        radius: 0.3,
        height: 1.8,
        stepHeight: 0.3,
        maxSlope: 45,
        speed: 3,
        jumpSpeed: 5,
        mass: 140,
      };
    assert.throws(() => s.p.addCharacter(e, { ...config, mass: 0 }), /mass/);
    assert.equal(s.physics.stats().physicsCharacters, 0);
    const ch = s.p.addCharacter(e, config);
    assert.equal(s.p.getState(e).mass, 140);
    ch.setVelocity(vec(5, 0, 0));
    const state = s.p.getState(e);
    state.velocity.x = NaN;
    s.physics.step(1 / 60);
    near(ch.velocity.x, 5);
  } finally {
    s.done();
  }
});

test("portal visual clones release their texture copies while retaining shared source textures", () => {
  const s = setup();
  try {
    const [a] = s.pair(),
      e = s.entity("textured", vec(0, 0, 0.22), vec(0.4, 0.4, 0.4), "dynamic"),
      material = new B.StandardMaterial("textured-source", s.scene),
      texture = B.RawTexture.CreateRGBTexture(
        new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]),
        2,
        2,
        s.scene,
      );
    material.diffuseTexture = texture;
    s.objects.get(e.id).material = material;
    s.api.watch(e);
    const before = s.scene.textures.length;
    s.portals.updateVisuals();
    assert.equal(s.portals.stats().portalClones, 1);
    a.setEnabled(false);
    s.portals.updateVisuals();
    assert.equal(s.scene.textures.length, before);
    assert.equal(material.diffuseTexture, texture);
    assert.ok(texture.getInternalTexture());
  } finally {
    s.done();
  }
});
test("registered surfaces reject movement explicitly and removed components release registrations", () => {
  const s = setup();
  try {
    const [a, b, wall] = s.pair();
    s.objects.get(wall.id).position.x += 1;
    assert.throws(() => s.portals.step(1 / 60), /surface moved/);
    s.objects.get(wall.id).position.x -= 1;
    const e = s.entity("watched", vec(0, 0, 1), vec(0.4, 0.4, 0.4), "dynamic");
    s.api.watch(e);
    s.p.remove(e);
    s.portals.step(1 / 60);
    assert.equal(s.portals.stats().portalTravelers, 0);
    s.p.remove(wall);
    s.portals.step(1 / 60);
    assert.equal(a.enabled, false);
    assert.equal(b.linked, false);
  } finally {
    s.done();
  }
});

test("kinematic portal panels retain real holes, interpolate full-frame targets and restore the original collider", () => {
  const s = setup();
  try {
    const [a, , wall] = s.pair("kinematic");
    const traveler = s.entity("idle", vec(0, 3, 2), vec(0.2, 0.2, 0.2), "dynamic");
    s.api.watch(traveler);
    const bodies = s.physics.stats().physicsBodies;
    assert.equal(s.p.raycast(vec(0, 0, 3), vec(0, 0, -6)), null);
    assert.equal(s.p.raycast(vec(3, 0, 3), vec(0, 0, -6)).entity, wall);
    s.objects.get(wall.id).position.x = 3;
    s.portals.step(1 / 60);
    near(a.getPose().position.x, 3);
    near(s.p.getState(wall).velocity.x, 180, 0.05);
    assert.equal(s.p.raycast(vec(3, 0, 3), vec(0, 0, -6)), null);
    assert.equal(s.p.raycast(vec(0, 0, 3), vec(0, 0, -6)).entity, wall);
    a.unlink();
    assert.equal(s.p.raycast(vec(3, 0, 3), vec(0, 0, -6)).entity, wall);
    assert.equal(s.physics.stats().physicsBodies, bodies);
    s.portals.step(1 / 60);
    near(s.p.getState(wall).velocity.x, 0);
  } finally { s.done(); }
});

test("a moving entrance sweeps a stationary traveler and transfers frame-relative momentum", () => {
  const s = setup();
  try {
    const [a, , wall] = s.pair("kinematic");
    const e = s.entity("stationary", vec(0, 0, 0.3), vec(0.15, 0.15, 0.15), "dynamic");
    s.api.watch(e);
    const events = [];
    s.api.onTraverse((event) => events.push(event));
    s.objects.get(wall.id).position.z = 0.5;
    s.portals.step(1 / 60);
    assert.equal(events.length, 1);
    near(a.getPose().position.z, 0.6);
    near(s.p.getState(e).velocity.x, -30, 0.05);
    near(s.p.getState(e).velocity.z, 0, 0.05);
    assert.ok(s.p.getState(e).position.x < 7.9);
  } finally { s.done(); }
});

test("dynamic portal hosts preserve configured mass through convex cutting and move attached poses", () => {
  const s = setup();
  try {
    const [a, , wall] = s.pair("dynamic");
    s.p.addImpulse(wall, vec(1, 0, 0));
    near(s.p.getState(wall).velocity.x, 1);
    s.portals.step(0.1);
    near(a.getPose().position.x, 0.1, 0.01);
    a.unlink();
    s.p.setVelocity(wall, vec(0, 0, 0));
    s.p.addImpulse(wall, vec(1, 0, 0));
    near(s.p.getState(wall).velocity.x, 1);
    assert.throws(() => s.api.watch(wall), /surface/);
  } finally { s.done(); }
});

for (const kind of ["fixed", "hinge", "slider", "distance"])
test(`whole-island portal traversal preserves native ${kind} joints and publishes coherent states`, () => {
  const s = setup();
  try {
    s.pair();
    const a = s.entity("head", vec(0, 0, 0.24), vec(0.16, 0.16, 0.16), "dynamic");
    const b = s.entity("tail", vec(0, 0, 0.84), vec(0.16, 0.16, 0.16), "dynamic");
    const config = { kind, axis: vec(0, 0, 1) };
    if (kind === "distance") Object.assign(config, { anchor: vec(0, 0, 0.24), anchor2: vec(0, 0, 0.84), min: 0.6, max: 0.6 });
    const joint = s.p.createJoint(a, b, config);
    const group = s.api.watchAssembly(a);
    assert.deepEqual(group.entities, [a, b]);
    assert.deepEqual(s.p.getConnectedBodies(b), [b, a]);
    const events = [];
    s.api.onTraverse((event) => {
      events.push(event);
      if (event.source.id === "A") {
        assert.ok(s.p.getState(a).position.x < 7.9);
        assert.ok(s.p.getState(b).position.x < 7.9);
      } else {
        assert.ok(s.p.getState(a).position.z > 0.1);
        assert.ok(s.p.getState(b).position.z > 0.1);
      }
      assert.equal(event.entities.length, 2);
    });
    s.p.setVelocity(a, vec(0, 0, -6)); s.p.setVelocity(b, vec(0, 0, -6));
    for (let i = 0; i < 10; i++) s.portals.step(1 / 60);
    assert.equal(events.length, 2);
    assert.equal(joint.active, true);
    assert.equal(s.physics.stats().physicsConstraints, 1);
    near(s.p.getState(a).velocity.x, -6, 0.05);
    const pa = s.p.getState(a).position, pb = s.p.getState(b).position;
    const delta = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
    near(delta, 0.6, 0.02);
    s.p.setVelocity(a, vec(6, 0, 0)); s.p.setVelocity(b, vec(6, 0, 0));
    for (let i = 0; i < 30 && events.length < 4; i++) s.portals.step(1 / 60);
    assert.equal(events.length, 4);
    assert.deepEqual(events.map((event) => event.source.id), ["A", "A", "B", "B"]);
    assert.equal(joint.active, true);
    const backA = s.p.getState(a).position, backB = s.p.getState(b).position;
    near(Math.hypot(backA.x - backB.x, backA.y - backB.y, backA.z - backB.z), 0.6, 0.02);
    group.destroy();
    assert.equal(s.portals.stats().portalTravelers, 0);
    assert.equal(s.physics.stats().physicsConstraints, 1);
    joint.destroy();
    assert.deepEqual(s.p.getConnectedBodies(a), [a]);
  } finally { s.done(); }
});

test("unregistered joint peers block crossing safely instead of pulling a transported endpoint across rooms", () => {
  const s = setup();
  try {
    s.pair();
    const a = s.entity("head", vec(0, 0, 0.24), vec(0.16, 0.16, 0.16), "dynamic");
    const b = s.entity("tail", vec(0, 0, 0.84), vec(0.16, 0.16, 0.16), "dynamic");
    s.p.createJoint(a, b, { kind: "fixed" });
    s.api.watch(a);
    const blocked = [];
    s.api.onBlocked((event) => blocked.push(event));
    s.p.setVelocity(a, vec(0, 0, -6)); s.p.setVelocity(b, vec(0, 0, -6));
    for (let i = 0; i < 5; i++) s.portals.step(1 / 60);
    assert.equal(blocked[0].reason, "joint-policy");
    near(s.p.getState(a).position.x, 0);
    near(s.p.getState(b).position.x, 0);
    near(s.p.getState(a).velocity.z, 0, 0.05);
    near(s.p.getState(b).position.z - s.p.getState(a).position.z, 0.6, 0.02);
  } finally { s.done(); }
});

test("assembly traversal checks both aperture fit and the entire exit clearance path", () => {
  for (const reason of ["assembly-too-large", "assembly-exit-obstructed"]) {
    const s = setup();
    try {
      s.pair();
      const a = s.entity("head", vec(0, 0, 0.24), vec(0.16, 0.16, 0.16), "dynamic");
      const b = s.entity("tail", vec(reason === "assembly-too-large" ? 1.4 : 0, 0, 0.84), vec(0.16, 0.16, 0.16), "dynamic");
      s.p.createJoint(a, b, { kind: "fixed" });
      s.api.watchAssembly(a);
      if (reason === "assembly-exit-obstructed") s.entity("exit-blocker", vec(7.25, 0, 0), vec(0.15, 1, 1));
      const blocked = [];
      s.api.onBlocked((event) => blocked.push(event));
      s.p.setVelocity(a, vec(0, 0, -6)); s.p.setVelocity(b, vec(0, 0, -6));
      for (let i = 0; i < 5; i++) s.portals.step(1 / 60);
      assert.equal(blocked[0]?.reason, reason);
      near(s.p.getState(a).position.x, 0, 0.02);
      assert.equal(s.portals.stats().portalTraversals, 0);
    } finally { s.done(); }
  }
});

test("assembly registration validates atomically, observes topology changes and cleans up with its owner", () => {
  const s = setup();
  try {
    s.pair();
    const a = s.entity("head", vec(0, 0, 0.24), vec(0.16, 0.16, 0.16), "dynamic");
    const b = s.entity("tail", vec(0, 0, 0.84), vec(0.16, 0.16, 0.16), "dynamic");
    const anchor = s.entity("anchor", vec(0, 0, 3));
    const fixed = s.p.createJoint(a, anchor, { kind: "distance", min: 0, max: 4 });
    assert.throws(() => s.api.watchAssembly(a), /dynamic bodies/);
    assert.equal(s.portals.stats().portalTravelers, 0);
    fixed.destroy();
    s.p.createJoint(a, b, { kind: "fixed" });
    assert.throws(() => s.api.watchAssembly(a, { maxBodies: 1 }), /budget exceeded/);
    assert.equal(s.portals.stats().portalTravelers, 0);
    s.api.watchAssembly(a);
    const added = s.entity("added", vec(0, 0, 1.44), vec(0.16, 0.16, 0.16), "dynamic");
    s.p.createJoint(b, added, { kind: "fixed" });
    const blocked = [];
    s.api.onBlocked((event) => blocked.push(event));
    for (const e of [a, b, added]) s.p.setVelocity(e, vec(0, 0, -6));
    for (let i = 0; i < 5; i++) s.portals.step(1 / 60);
    assert.equal(blocked[0]?.reason, "joint-policy");
    s.session.stop();
    assert.equal(s.portals.stats().portalTravelers, 0);
    assert.equal(s.physics.stats().physicsConstraints, 0);
    assert.throws(() => s.p.getConnectedBodies(a), /销毁/);
  } finally { s.done(); }
});

test("closing a portal evacuates a partial native joint island by one shared translation", () => {
  const s = setup();
  try {
    const [a] = s.pair();
    const head = s.entity("head", vec(0, 0, 0.13), vec(0.2, 0.2, 0.2), "dynamic");
    const tail = s.entity("tail", vec(0, 0, 0.73), vec(0.2, 0.2, 0.2), "dynamic");
    s.p.createJoint(head, tail, { kind: "fixed" });
    s.api.watchAssembly(head);
    a.unlink();
    near(s.p.getState(tail).position.z - s.p.getState(head).position.z, 0.6);
    assert.ok(s.p.getState(head).position.z > 0.2);
    s.portals.step(1 / 60);
    near(s.p.getState(tail).position.z - s.p.getState(head).position.z, 0.6, 0.005);
  } finally { s.done(); }
});

test("rotating entrances and moving exits convert point and angular velocities in both host frames", () => {
  const s = setup();
  try {
    const [a, b, source, destination] = s.pair("kinematic", "kinematic");
    const e = s.entity("traveler", vec(0, 0, 0.23), vec(0.1, 0.1, 0.1), "dynamic");
    s.api.watch(e);
    s.p.setVelocity(e, vec(0, 0, -10));
    s.objects.get(source.id).position.x = 0.02;
    s.objects.get(source.id).rotationQuaternion = B.Quaternion.RotationAxis(B.Axis.Y, 0.03);
    s.objects.get(destination.id).position.y = 0.05;
    let crossings = 0;
    s.api.onTraverse((event) => {
      crossings++;
      const before = b.mapPoint(event.position);
      const av = s.p.getPointVelocity(source, before), bv = s.p.getPointVelocity(destination, event.position);
      const expected = a.mapVector(vec(-av.x, -av.y, -10 - av.z));
      for (const key of ["x", "y", "z"]) near(event.velocity[key], expected[key] + bv[key], 0.02);
      const aw = s.p.getState(source).angularVelocity, bw = s.p.getState(destination).angularVelocity;
      const mapped = a.mapVector(vec(-aw.x, -aw.y, -aw.z));
      const actual = s.p.getState(e).angularVelocity;
      for (const key of ["x", "y", "z"]) near(actual[key], mapped[key] + bw[key], 0.02);
    });
    s.portals.step(1 / 60);
    assert.equal(crossings, 1);
    assert.throws(() => { s.objects.get(source.id).scaling.x *= 2; s.portals.step(1 / 60); }, /scale changed/);
  } finally { s.done(); }
});

test("kinematic traveler retains the mapped remainder of its whole-frame target after crossing", () => {
  const s = setup();
  try {
    const a = s.api.create({ position: vec(0, 0, 0) });
    const b = s.api.create({ position: vec(8, 0, 0), rotation: ArkGlideSpatial.plainQ(B.Quaternion.RotationAxis(B.Axis.Y, -Math.PI / 2)) });
    a.link(b);
    const e = s.entity("kinematic-traveler", vec(0, 0, 0.5), vec(0.1, 0.1, 0.1), "kinematic");
    s.api.watch(e);
    s.objects.get(e.id).position.z = -0.5;
    s.portals.step(0.1);
    near(s.p.getState(e).position.x, 7.5, 0.002);
    near(s.p.getState(e).velocity.x, -10, 0.05);
    assert.equal(s.portals.stats().portalTraversals, 1);
  } finally { s.done(); }
});

test("asymmetric holes on a dynamic host preserve its native constraint anchor frame through restoration", () => {
  const s = setup();
  try {
    const [a, , wall] = s.pair("dynamic");
    const anchor = s.entity("fixed-anchor", vec(0, 0, -3), vec(0.2, 0.2, 0.2));
    const joint = s.p.createJoint(wall, anchor, { kind: "fixed" });
    assert.equal(a.place(vec(2, 0, 3), vec(0, 0, -6)).placed, true);
    for (let i = 0; i < 15; i++) s.portals.step(1 / 60);
    near(s.p.getState(wall).position.x, 0, 0.002);
    near(s.p.getState(wall).position.z, 0, 0.002);
    a.unlink();
    for (let i = 0; i < 15; i++) s.portals.step(1 / 60);
    near(s.p.getState(wall).position.x, 0, 0.002);
    near(s.p.getState(wall).position.z, 0, 0.002);
    assert.equal(joint.active, true);
  } finally { s.done(); }
});

test("subdivided kinematic targets preserve parented world poses even when child bodies were added first", () => {
  const s = setup();
  try {
    s.pair();
    const traveler = s.entity("idle", vec(0, 3, 2), vec(0.1, 0.1, 0.1), "dynamic");
    s.api.watch(traveler);
    const child = s.entity("child", vec(20, 0, 1), vec(1, 1, 1), "kinematic");
    const parent = s.entity("parent", vec(20, 0, 0), vec(1, 1, 1), "kinematic");
    s.objects.get(child.id).setParent(s.objects.get(parent.id));
    s.objects.get(parent.id).position.x = 21;
    s.objects.get(child.id).position.z = 2;
    s.portals.step(1 / 60);
    near(s.p.getState(parent).position.x, 21);
    near(s.p.getState(child).position.x, 21);
    near(s.p.getState(child).position.z, 2);
    const position = s.objects.get(child.id).getAbsolutePosition();
    near(position.x, 21); near(position.z, 2);
  } finally { s.done(); }
});

test("observer movement directions follow its actual viewpoint rather than a previous first-person heading", () => {
  const s = setup();
  try {
    const player = s.entity("player", vec(0, 0, 0), vec(1, 1, 1), null),
      observer = s.entity("observer", vec(2, 4, -6), vec(1, 1, 1), null),
      rig = s.c.createRig({
        mode: "observer",
        target: player,
        viewpoint: observer,
      });
    const d = rig.direction(0, 1);
    near(d.x, -2 / Math.sqrt(40));
    near(d.z, 6 / Math.sqrt(40));
    rig.destroy();
  } finally {
    s.done();
  }
});

test('straddling source and ghost keep different clip planes across the transport frame', () => {
  const s = setup();
  try {
    const [a, b] = s.pair(), e = s.entity('clip-body', vec(0, 0, .22), vec(.4, .4, .4), 'dynamic');
    const mesh = s.objects.get(e.id), original = new B.StandardMaterial('clip-original', s.scene);
    mesh.material = original; s.api.watch(e); s.portals.updateVisuals();
    const source = mesh.material, ghost = s.scene.getMeshByName('__portal:clone:' + e.id);
    assert.ok(source.clipPlane.signedDistanceTo(new B.Vector3(0, 0, .3)) < 0, 'source front survives');
    assert.ok(source.clipPlane.signedDistanceTo(new B.Vector3(0, 0, -.1)) > 0, 'source back is clipped');
    assert.ok(ghost.material.clipPlane.signedDistanceTo(new B.Vector3(7.6, 0, 0)) < 0, 'exit front survives');
    assert.ok(ghost.material.clipPlane.signedDistanceTo(new B.Vector3(8.1, 0, 0)) > 0, 'exit back is clipped');
    s.p.setVelocity(e, vec(0, 0, -2));
    for (let i = 0; i < 10 && !s.portals.stats().portalTraversals; i++) s.portals.step(1 / 60);
    assert.equal(s.portals.stats().portalTraversals, 1);
    s.portals.updateVisuals();
    assert.equal(mesh.material, source, 'reuse ready materials during crossing');
    assert.ok(source.clipPlane.signedDistanceTo(new B.Vector3(7.6, 0, 0)) < 0);
    assert.ok(ghost.material.clipPlane.signedDistanceTo(new B.Vector3(0, 0, .3)) < 0);
    b.setEnabled(false); s.portals.updateVisuals();
    assert.equal(mesh.material, original);
  } finally { s.done(); }
});

test('remote grab before the entrance pulls through the selected doorway and ignores a wall on the unrelated straight path', () => {
  for (const explicit of [false, true]) {
    const s = setup(), system = ArkGlideInteraction.create(B, { physics: s.physics, portals: s.portals });
    try {
      const [a] = s.pair(), e = s.entity('remote-held', vec(6.8, 0, 0), vec(.3, .3, .3), 'dynamic');
      s.entity('unrelated-wall', vec(4, 0, 0), vec(.2, 6, 6));
      s.api.watch(e); const events = []; s.api.onTraverse(event => events.push(event));
      const pick = s.api.raycast(vec(0, 0, 5), vec(0, 0, -10));
      assert.equal(pick.hit.entity, e); assert.deepEqual(pick.path, ['A']);
      const h = system.forOwner(s.owner).grab(e, { maxDistance: 15, ...(explicit ? { path: pick.path } : {}) });
      h.setRay(vec(0, 0, 5), vec(0, 0, -1), 2.5); system.step(1 / 60);
      assert.ok(s.p.getState(e).velocity.x > 0, 'pull towards B to emerge from A');
      near(s.p.getState(e).velocity.z, 0);
      for (let i = 0; i < 240; i++) {
        h.setRay(vec(0, 0, 5), vec(0, 0, -1), 2.5); system.step(1 / 120); s.portals.step(1 / 120);
      }
      assert.equal(h.active, true); assert.equal(events.length, 1);
      assert.equal(events[0].source.id, 'B'); assert.equal(events[0].destination.id, 'A');
      const state = s.p.getState(e); near(state.position.x, 0, .01); near(state.position.z, 2.5, .02);
      // A closed route must release before applying another force.
      h.release(); s.p.setState(e, { position: vec(6.8, 0, 0), velocity: vec(0, 0, 0) });
      const next = system.forOwner(s.owner).grab(e, { path: ['A'], maxDistance: 15 });
      next.setRay(vec(0, 0, 5), vec(0, 0, -1), 2.5); a.setEnabled(false); system.step(1 / 60);
      assert.equal(next.active, false); near(s.p.getState(e).velocity.x, 0);
    } finally { system.dispose(); s.done(); }
  }
});

test('first-person eye resolves either side of a floor portal independently and stays continuous when the body center warps', () => {
  const s = setup();
  try {
    const a = s.api.create({ id: 'floor-view', rotation: B.Quaternion.RotationAxis(B.Axis.X, -Math.PI / 2) });
    const b = s.api.create({ id: 'wall-view', position: vec(10, 0, 0), rotation: B.Quaternion.RotationAxis(B.Axis.Y, -Math.PI / 2) }); a.link(b);
    const player = s.entity('eye-body', vec(0, .05, 0), vec(.3, .3, .3), 'dynamic'); s.api.watch(player);
    const rig = s.c.createRig({ target: player, eyeOffset: vec(0, .7, 0), uprightSpeed: 0 });
    const before = rig.camera.getPose();
    s.p.setVelocity(player, vec(0, -1, 0)); s.portals.step(.1); s.cameras.update();
    const after = rig.camera.getPose();
    near(after.position.x, before.position.x); near(after.position.y, before.position.y - .1); near(after.position.z, before.position.z);
    for (const k of ['x', 'y', 'z', 'w']) near(after.rotation[k], before.rotation[k]);
    for (let i = 0; i < 48; i++) s.portals.step(1 / 60);
    s.cameras.update();
    assert.ok(rig.camera.getPose().position.x < 10, 'eye now emerged at the wall exit');
    // An offset looking down crosses before the physical body, too.
    const eye = s.c.createRig({ target: player, eyeOffset: vec(1, 0, 0), uprightSpeed: 0 });
    s.p.setState(player, { position: vec(9.8, 0, 0), velocity: vec(0, 0, 0) }); s.cameras.update();
    assert.ok(eye.camera.getPose().position.y > 0, 'early eye is on floor side');
  } finally { s.done(); }
});

test('held target remains in the correct frame while the body has crossed but the first-person eye has not', () => {
  const s = setup(), system = ArkGlideInteraction.create(B, { physics: s.physics, portals: s.portals });
  try {
    const a = s.api.create({ id: 'floor-hold', rotation: B.Quaternion.RotationAxis(B.Axis.X, -Math.PI / 2) });
    const b = s.api.create({ id: 'wall-hold', position: vec(10, 0, 0), rotation: B.Quaternion.RotationAxis(B.Axis.Y, -Math.PI / 2) }); a.link(b);
    const holder = s.entity('holder', vec(0, .05, 0), vec(.3, .3, .3), 'dynamic');
    const e = s.entity('hold-eye-crate', vec(0, 1.2, 0), vec(.2, .2, .2), 'dynamic');
    s.api.watch(holder); s.api.watch(e);
    const rig = s.c.createRig({ target: holder, eyeOffset: vec(0, .7, 0), uprightSpeed: 0 });
    const h = system.forOwner(s.owner).grab(e, { path: [], holder, maxDistance: 15 });
    h.setRay(rig.camera.ray().origin, vec(0, 1, 0), 2.5);
    s.p.setVelocity(holder, vec(0, -1, 0)); s.portals.step(.1); s.cameras.update();
    assert.ok(rig.camera.getPose().position.y > .6, 'eye is still above the floor entry');
    const origin = rig.camera.ray().origin;
    h.setRay(origin, vec(0, 1, 0), 2.5); system.step(.01);
    const velocity = s.p.getState(e).velocity;
    near(velocity.x, 0); near(velocity.z, origin.z); near(velocity.y, origin.y + 2.5 - 1.2, .01);
    assert.equal(h.active, true);
  } finally { system.dispose(); s.done(); }
});

test('perspective picking rays start at the eye so a portal inside the near plane is still traced', () => {
  const s = setup();
  try {
    s.pair(); const e = s.entity('near-ray-target', vec(6.8, 0, 0), vec(.3, .3, .3), 'dynamic');
    const camera = s.c.create({ position: vec(0, 0, .12), rotation: B.Quaternion.RotationAxis(B.Axis.Y, Math.PI), near: .5 });
    const ray = camera.ray(.5, .5, 10), trace = s.api.raycast(ray.origin, ray.direction);
    near(ray.origin.z, .12); assert.deepEqual(trace.path, ['A']); assert.equal(trace.hit.entity, e);
  } finally { s.done(); }
});
