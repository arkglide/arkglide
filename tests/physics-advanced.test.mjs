import test from "node:test";
import assert from "node:assert/strict";
import * as B from "@babylonjs/core";
import "../public/lib/jolt-physics.js";
import "../src/engine/physics-advanced.js";
import "../src/engine/physics-runtime.js";
import "../src/engine/lifecycle-runtime.js";
const J = await createArkGlideJolt();
function setup(config, onError) {
  const engine = new B.NullEngine(),
    scene = new B.Scene(engine),
    objects = new Map(),
    entities = new Map(),
    session = ArkGlideLifecycle.createSession();
  const physics = ArkGlidePhysics.createPhysics(J, B, {
    config,
    onError,
    getObject: (id) => objects.get(id),
    find: (id) => entities.get(id),
  });
  const owner = session.owner(null, "advanced-test");
  owner.attach({});
  session.startRecords([owner.record]);
  const api = physics.forOwner(owner);
  function entity(id, position = { x: 0, y: 0, z: 0 }) {
    const mesh = B.MeshBuilder.CreateBox(id, {}, scene);
    mesh.position.copyFromFloats(position.x, position.y, position.z);
    objects.set(id, mesh);
    const e = {
      id,
      name: id,
      get destroyed() {
        return mesh.isDisposed();
      },
    };
    entities.set(id, e);
    return e;
  }
  function body(id, pos, motion = "static", shape = "box", group) {
    const e = entity(id, pos);
    physics.add({
      id,
      name: id,
      physics: {
        motion,
        shape,
        group,
        size: { x: 1, y: 1, z: 1 },
        mass: 1,
        friction: 0.5,
        restitution: 0,
        sensor: false,
        lockRotation: true,
      },
    });
    return e;
  }
  return {
    physics,
    api,
    session,
    owner,
    body,
    entity,
    objects,
    entities,
    scene,
    done() {
      session.stop();
      physics.dispose();
      engine.dispose();
    },
  };
}
test("real Jolt ray, shape cast and overlap return live world-space hits and obey group filters", () => {
  const s = setup({
    groups: [
      { name: "Default", mask: 3 },
      { name: "Ignore", mask: 2 },
    ],
  });
  try {
    const a = s.body("cube", { x: 0, y: 0, z: 0 }),
      b = s.body("ignored", { x: 4, y: 0, z: 0 }, "static", "box", "Ignore");
    const hit = s.api.raycast({ x: 0, y: 3, z: 0 }, { x: 0, y: -5, z: 0 });
    assert.equal(hit.entity, a);
    assert.ok(Math.abs(hit.distance - 2.5) < 0.02);
    assert.ok(hit.normal.y > 0.9);
    assert.equal(
      s.api.raycast({ x: 4, y: 3, z: 0 }, { x: 0, y: -5, z: 0 }, { mask: 1 }),
      null,
    );
    assert.equal(
      s.api.overlap({ kind: "sphere", radius: 1 }, { x: 0, y: 0, z: 0 })[0]
        .entity,
      a,
    );
    assert.equal(
      s.api.shapeCast(
        { kind: "sphere", radius: 0.2 },
        { x: 0, y: 3, z: 0 },
        { x: 0, y: -5, z: 0 },
      ).entity,
      a,
    );
    s.physics.remove(a.id);
    s.entities.delete(a.id);
    assert.equal(
      s.api.raycast({ x: 0, y: 3, z: 0 }, { x: 0, y: -5, z: 0 }),
      null,
    );
  } finally {
    s.done();
  }
});
test("real Jolt model hull and static mesh shapes build, cache and release; dynamic mesh is rejected", () => {
  const s = setup();
  try {
    s.body("hull", { x: 0, y: 3, z: 0 }, "dynamic", "convex");
    s.body("mesh", { x: 0, y: 0, z: 0 }, "static", "mesh");
    for (let i = 0; i < 120; i++) s.physics.step(1 / 60);
    assert.ok(s.objects.get("hull").position.y < 2);
    assert.equal(s.physics.stats().physicsShapeCache, 2);
    assert.throws(
      () => s.body("bad", { x: 0, y: 0, z: 0 }, "dynamic", "mesh"),
      /静态/,
    );
    s.physics.dispose();
    assert.equal(s.physics.stats().physicsShapeCache, 0);
  } finally {
    s.done();
  }
});
test("model collision geometry accepts index counts within the documented limit",()=>{
 const s=setup();
 try {
  s.entity("large");const mesh=s.objects.get("large"),base=mesh.getIndices();
  mesh.setIndices(Uint32Array.from({length:180000},(_,i)=>base[i%base.length]));
  assert.doesNotThrow(()=>s.physics.add({id:"large",physics:{motion:"static",shape:"convex",mass:1,size:{x:1,y:1,z:1},friction:0.5,restitution:0,sensor:false,lockRotation:true}}));
  assert.equal(s.physics.stats().physicsBodies,1);
  assert.equal(s.api.raycast({x:0,y:3,z:0},{x:0,y:-5,z:0}).entity,s.entities.get("large"));
 } finally {s.done();}
});
test("native capsule controller walks, grounds, jumps and releases on owner disposal", () => {
  const s = setup();
  try {
    const floor = s.body("floor", { x: 0, y: -0.5, z: 0 });
    s.objects.get(floor.id).scaling.set(20, 1, 20);
    s.physics.remove(floor.id);
    s.physics.add({
      id: floor.id,
      name: "floor",
      physics: {
        motion: "static",
        shape: "box",
        size: { x: 1, y: 1, z: 1 },
        mass: 1,
        friction: 0.5,
        restitution: 0,
        sensor: false,
        lockRotation: true,
      },
    });
    const e = s.entity("player", { x: 0, y: 3, z: 0 });
    const controller = s.api.addCharacter(e, {
      radius: 0.3,
      height: 1.8,
      stepHeight: 0.3,
      maxSlope: 45,
      speed: 3,
      jumpSpeed: 5,
    });
    for (let i = 0; i < 180; i++) s.physics.step(1 / 60);
    assert.equal(controller.grounded, true);
    assert.equal(
      s.api.raycast({ x: 0, y: 4, z: 0 }, { x: 0, y: -5, z: 0 }).entity,
      e,
    );
    const y = s.objects.get(e.id).position.y;
    controller.move({ x: 1, y: 0, z: 0 });
    for (let i = 0; i < 60; i++) s.physics.step(1 / 60);
    assert.ok(s.objects.get(e.id).position.x > 0.9);
    controller.jump();
    s.physics.step(1 / 60);
    assert.ok(s.objects.get(e.id).position.y > y);
    s.physics.remove(e.id);
    assert.equal(s.physics.stats().physicsCharacters, 0);
  } finally {
    s.done();
  }
});
test("four native joint types attach to live bodies and are removed before endpoint destruction", () => {
  for (const kind of ["fixed", "hinge", "slider", "distance"]) {
    const s = setup();
    try {
      const a = s.body("a", { x: 0, y: 0, z: 0 }),
        b = s.body("b", { x: 0, y: 2, z: 0 }, "dynamic");
      if (kind === "hinge") {
        // One omitted angle uses the native hinge default, rather than 0..1.
        for (const bounds of [{ min: 2 }, { max: -0.1 }]) {
          const partial = s.api.createJoint(a, b, { kind, ...bounds });
          assert.equal(partial.active, true);
          partial.destroy();
        }
        assert.equal(s.physics.stats().physicsConstraints, 0);
      }
      const handle = s.api.createJoint(a, b, {
        kind,
        anchor: { x: 0, y: 1, z: 0 },
        min: 0,
        max: 2,
        ...(["hinge", "slider"].includes(kind)
          ? { motor: { velocity: 0.1, force: 10 } }
          : {}),
      });
      assert.equal(s.physics.stats().physicsConstraints, 1);
      for (let i = 0; i < 5; i++) s.physics.step(1 / 60);
      s.physics.remove(b.id);
      assert.equal(handle.active, false);
      assert.equal(s.physics.stats().physicsConstraints, 0);
    } finally {
      s.done();
    }
  }
});

test("native collider wireframes follow rotated parent world transforms and disabling disposes every mesh", () => {
  const s = setup({ groups: [{ name: "Default", mask: 1 }], debug: true });
  try {
    const e = s.body("debug", { x: 1, y: 2, z: 3 }, "dynamic");
    s.objects.get(e.id).rotation.z = 0.5;
    s.physics.step(1 / 60);
    assert.equal(s.physics.stats().physicsDebugMeshes, 2);
    const wire = s.scene.meshes.find((m) => m.name === "__physics_debug_debug");
    assert.ok(wire && wire.getTotalVertices() > 12);
    assert.ok(Math.abs(wire.position.x - 1) < 0.001);
    s.api.setDebug(false);
    assert.equal(s.physics.stats().physicsDebugMeshes, 0);
    assert.equal(
      s.scene.meshes.filter((m) => m.metadata?.arkglidePhysicsDebug).length,
      0,
    );
  } finally {
    s.done();
  }
});

function solid(s, id, pos, size, rotation = 0, motion = "static") {
  const e = s.entity(id, pos),
    m = s.objects.get(id);
  m.rotation.z = rotation;
  s.physics.add({
    id,
    name: id,
    physics: {
      motion,
      shape: "box",
      size,
      mass: 1,
      friction: 0.5,
      restitution: 0,
      sensor: false,
      lockRotation: true,
    },
  });
  return e;
}
function player(s, pos) {
  const e = s.entity("player", pos);
  return {
    e,
    c: s.api.addCharacter(e, {
      radius: 0.3,
      height: 1.8,
      stepHeight: 0.3,
      maxSlope: 45,
      speed: 2,
      jumpSpeed: 5,
    }),
  };
}
function steps(s, n = 90) {
  for (let i = 0; i < n; i++) s.physics.step(1 / 60);
}
test("native character crosses a low step, follows a walkable ramp and slides along a wall", () => {
  for (const scenario of ["step", "ramp", "wall"]) {
    const s = setup();
    try {
      solid(s, "floor", { x: 0, y: -0.5, z: 0 }, { x: 20, y: 1, z: 20 });
      if (scenario === "step")
        solid(s, "step", { x: 1.2, y: 0.1, z: 0 }, { x: 1, y: 0.2, z: 4 });
      if (scenario === "ramp")
        solid(s, "ramp", { x: 0, y: 0.05, z: 0 }, { x: 4, y: 0.2, z: 4 }, 0.3);
      if (scenario === "wall")
        solid(s, "wall", { x: 1.2, y: 1, z: 0 }, { x: 0.2, y: 3, z: 8 });
      const { e, c } = player(s, {
        x: scenario === "ramp" ? -1.3 : 0,
        y: 3,
        z: 0,
      });
      steps(s, 120);
      c.move({ x: 1, y: 0, z: scenario === "wall" ? 1 : 0 });
      let peak = 0;
      for (let i = 0; i < (scenario === "wall" ? 90 : 75); i++) {
        s.physics.step(1 / 60);
        peak = Math.max(peak, s.objects.get(e.id).position.y);
      }
      const p = s.objects.get(e.id).position;
      if (scenario === "step") {
        assert.ok(p.x > 1.6, `step x ${p.x}`);
        assert.ok(peak > 1.05, `step peak ${peak}`);
      }
      if (scenario === "ramp") {
        assert.ok(p.x > 0.7, `ramp x ${p.x}`);
        assert.ok(p.y > 1.2, `ramp height ${p.y}`);
      }
      if (scenario === "wall") {
        assert.ok(p.x < 0.85, `wall x ${p.x}`);
        assert.ok(p.z > 1, `wall slide z ${p.z}`);
      }
    } finally {
      s.done();
    }
  }
});
test("native character inherits kinematic platform velocity and platform stops without residual drift", () => {
  const s = setup();
  try {
    const platform = solid(
        s,
        "platform",
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0.5, z: 5 },
        0,
        "kinematic",
      ),
      { e, c } = player(s, { x: 0, y: 3, z: 0 });
    steps(s, 120);
    assert.equal(c.grounded, true);
    for (let i = 0; i < 60; i++) {
      s.objects.get(platform.id).position.x += 1 / 60;
      s.physics.step(1 / 60);
    }
    const x = s.objects.get(e.id).position.x;
    assert.ok(x > 0.8 && x < 1.2, `carried ${x}`);
    const px = s.objects.get(platform.id).position.x;
    steps(s, 60);
    assert.ok(Math.abs(s.objects.get(platform.id).position.x - px) < 1e-4);
    assert.ok(Math.abs(s.objects.get(e.id).position.x - x) < 0.05);
  } finally {
    s.done();
  }
});
test("mutual collision masks control native sensor contacts, and invalid limits/filters reject before native allocation", () => {
  for (const enabled of [false, true]) {
    const s = setup({
      groups: [
        { name: "Default", mask: enabled ? 3 : 1 },
        { name: "Trigger", mask: enabled ? 3 : 2 },
      ],
    });
    try {
      const a = s.body("dynamic", { x: 0, y: 0, z: 0 }, "dynamic"),
        b = s.entity("sensor", { x: 0, y: 0, z: 0 });
      s.physics.add({
        id: b.id,
        name: b.id,
        physics: {
          motion: "static",
          shape: "box",
          group: "Trigger",
          size: { x: 3, y: 3, z: 3 },
          mass: 1,
          friction: 0.5,
          restitution: 0,
          sensor: true,
          lockRotation: true,
        },
      });
      let enters = 0;
      s.api.onContact(a, (e) => {
        if (e.phase === "enter") enters++;
      });
      s.physics.step(1 / 60);
      assert.equal(enters, enabled ? 1 : 0);
      assert.equal(
        s.api.raycast(
          { x: 0, y: 3, z: 0 },
          { x: 0, y: -5, z: 0 },
          { group: "Default", mask: 2 },
        ) !== null,
        enabled,
      );
      assert.throws(
        () =>
          s.api.raycast(
            { x: 0, y: 3, z: 0 },
            { x: 0, y: -5, z: 0 },
            { mask: -1 },
          ),
        /掩码/,
      );
      assert.throws(
        () => s.api.createJoint(a, b, { kind: "hinge", min: -99, max: 99 }),
        /铰链/,
      );
      assert.equal(s.physics.stats().physicsQueriesActive, 0);
    } finally {
      s.done();
    }
  }
});
test("virtual character peer collisions obey the same mutual group masks as native bodies", () => {
  for (const collide of [false, true]) {
    const s = setup({
      groups: [
        { name: "Default", mask: collide ? 7 : 5 },
        { name: "Ghost", mask: collide ? 7 : 6 },
        { name: "Floor", mask: 7 },
      ],
    });
    try {
      const floor = s.entity("floor", { x: 0, y: -0.5, z: 0 });
      s.physics.add({
        id: floor.id,
        name: floor.id,
        physics: {
          motion: "static",
          shape: "box",
          group: "Floor",
          size: { x: 20, y: 1, z: 20 },
          mass: 1,
          friction: 0.5,
          restitution: 0,
          sensor: false,
          lockRotation: true,
        },
      });
      const a = s.entity("a", { x: 0, y: 3, z: 0 }),
        b = s.entity("b", { x: 1.5, y: 3, z: 0 }),
        config = {
          radius: 0.3,
          height: 1.8,
          stepHeight: 0.3,
          maxSlope: 45,
          speed: 2,
          jumpSpeed: 5,
        },
        c = s.api.addCharacter(a, config);
      s.api.addCharacter(b, { ...config, group: "Ghost" });
      steps(s, 120);
      c.move({ x: 1, y: 0, z: 0 });
      steps(s, 60);
      const x = s.objects.get(a.id).position.x;
      const bx = s.objects.get(b.id).position.x;
      assert.ok(
        collide
          ? Math.abs(bx - x) > 0.58
          : x > 1.8 && Math.abs(bx - 1.5) < 0.01,
        `peer collide=${collide} a=${x} b=${bx}`,
      );
    } finally {
      s.done();
    }
  }
});

test("removed character handles cannot control a replacement on the same entity", () => {
  const s = setup();
  try {
    const { e, c: old } = player(s, { x: 0, y: 3, z: 0 });
    s.api.removeCharacter(e);
    const replacement = s.api.addCharacter(e, {
      radius: 0.3, height: 1.8, stepHeight: 0.3,
      maxSlope: 45, speed: 2, jumpSpeed: 5,
    });
    assert.throws(() => old.move({ x: 1, y: 0, z: 0 }), /角色不存在/);
    assert.throws(() => old.jump(), /角色不存在/);
    assert.throws(() => old.teleport({ x: 9, y: 3, z: 0 }), /角色不存在/);
    for (const key of ["grounded", "velocity", "groundNormal"])
      assert.throws(() => old[key], /角色不存在/);
    replacement.move({ x: 1, y: 0, z: 0 });
    s.physics.step(1 / 60);
    assert.ok(Number.isFinite(replacement.velocity.x));
    assert.ok(s.objects.get(e.id).position.x < 1);
  } finally {
    s.done();
  }
});

test("aborting an old character owner leaves another owner's replacement alive", () => {
  const s = setup();
  try {
    const { e } = player(s, { x: 0, y: 3, z: 0 });
    s.api.removeCharacter(e);
    const owner = s.session.owner(null, "replacement");
    owner.attach({});
    s.session.startRecords([owner.record]);
    const replacement = s.physics.forOwner(owner).addCharacter(e, {
      radius: 0.3, height: 1.8, stepHeight: 0.3,
      maxSlope: 45, speed: 2, jumpSpeed: 5,
    });
    s.owner.abort();
    assert.doesNotThrow(() => replacement.move({ x: 1, y: 0, z: 0 }));
    assert.doesNotThrow(() => replacement.teleport({ x: 2, y: 3, z: 0 }));
    assert.equal(s.objects.get(e.id).position.x, 2);
    owner.abort();
    assert.throws(() => replacement.teleport({ x: 0, y: 0, z: 0 }), /已销毁|角色不存在/);
  } finally {
    s.done();
  }
});

test("invalid joint anchors are rejected before allocating native settings or vectors", () => {
  const s = setup();
  const original = J.FixedConstraintSettings;
  let allocations = 0;
  const allocated = [];
  try {
    const a = s.body("a", { x: 0, y: 0, z: 0 });
    const b = s.body("b", { x: 0, y: 2, z: 0 }, "dynamic");
    J.FixedConstraintSettings = function (...args) {
      allocations++;
      const settings = new original(...args);
      allocated.push(settings);
      return settings;
    };
    assert.throws(() => s.api.createJoint(a, b, {
      kind: "fixed", anchor: { x: NaN, y: 0, z: 0 },
    }), /Vec3/);
    assert.equal(allocations, 0);
    assert.throws(() => s.api.createJoint(a, b, {
      kind: "fixed", anchor2: { x: 0, y: Infinity, z: 0 },
    }), /Vec3/);
    assert.equal(allocations, 0);
    assert.equal(s.physics.stats().physicsConstraints, 0);
  } finally {
    J.FixedConstraintSettings = original;
    for (const settings of allocated) J.destroy(settings);
    s.done();
  }
});

test("unknown collision groups fail before allocating native body shapes", () => {
  const s = setup();
  const Original = J.BoxShape;
  const allocated = [];
  try {
    const e = s.entity("invalid");
    J.BoxShape = function (...args) {
      const shape = new Original(...args);
      allocated.push(shape);
      return shape;
    };
    assert.throws(() => s.api.add(e, {
      motion: "dynamic", shape: "box", group: "missing",
      size: { x: 1, y: 1, z: 1 }, mass: 1,
      friction: 0.5, restitution: 0, sensor: false, lockRotation: true,
    }), /分组/);
    assert.equal(allocated.length, 0);
    assert.equal(s.api.has(e), false);
  } finally {
    J.BoxShape = Original;
    for (const shape of allocated) shape.Release();
    s.done();
  }
});

test('contact subscriptions created through another owner during shutdown are released',()=>{
 const s=setup();
 try {
  const later=s.session.owner({id:'later'},'later.js');
  later.attach({onDestroy(){s.api.onContact(null,()=>{});}});
  s.session.startRecords([later.record]);s.session.stop();
  assert.equal(s.physics.stats().physicsSubscriptions,0);
 } finally {s.done();}
});

test('contact callbacks skip owners whose entity was destroyed before cleanup',()=>{
 const s=setup();
 try {
  s.body('floor',{x:0,y:0,z:0});const ball=s.body('ball',{x:0,y:0.5,z:0},'dynamic');
  const ownerEntity={id:'script-owner',destroyed:false};s.owner.record.entity=ownerEntity;
  let events=0;s.api.onContact(ball,()=>events++);ownerEntity.destroyed=true;
  s.physics.step(1/60);assert.equal(events,0);
 } finally {s.done();}
});

test('a failed contact callback is unsubscribed before diagnostic reporting',()=>{
 const s=setup(undefined,()=>{throw Error('reporter failed');});
 try {
  s.body('floor',{x:0,y:0,z:0});const ball=s.body('ball',{x:0,y:0.5,z:0},'dynamic');
  s.api.onContact(ball,()=>{throw Error('contact failed');});
  assert.throws(()=>s.physics.step(1/60),/reporter failed/);
  assert.equal(s.physics.stats().physicsSubscriptions,0);
 } finally {s.done();}
});

test('contact registration after physics disposal rejects without retaining a subscription',()=>{
 const s=setup();
 try {
  s.physics.dispose();
  assert.throws(()=>s.api.onContact(null,()=>{}),/stopped|停止/);
  assert.equal(s.physics.stats().physicsSubscriptions,0);
 } finally {s.done();}
});

test('contact dispatch skips remaining subscribers after a contact entity is disposed',()=>{
 const s=setup();
 try {
  s.body('floor',{x:0,y:0,z:0});const ball=s.body('ball',{x:0,y:0.5,z:0},'dynamic');
  let later=0;
  s.api.onContact(ball,()=>s.objects.get(ball.id).dispose());
  s.api.onContact(ball,()=>later++);
  s.physics.step(1/60);assert.equal(later,0);
 } finally {s.done();}
});

test('queries ignore disposed entities before the next physics cleanup step',()=>{
 const s=setup();
 try {
  const entity=s.body('disposed',{x:0,y:0,z:0});s.objects.get(entity.id).dispose();
  assert.equal(s.api.raycast({x:0,y:3,z:0},{x:0,y:-5,z:0}),null);
  assert.equal(s.api.shapeCast({kind:'sphere',radius:0.2},{x:0,y:3,z:0},{x:0,y:-5,z:0}),null);
  assert.deepEqual(s.api.overlap({kind:'sphere',radius:2},{x:0,y:0,z:0}),[]);
 } finally {s.done();}
});
