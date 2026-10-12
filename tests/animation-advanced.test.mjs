import test from "node:test";
import assert from "node:assert/strict";
import * as B from "@babylonjs/core";
import "../src/engine/lifecycle-runtime.js";
import "../src/engine/animation-advanced.js";
import "../src/engine/animation-runtime.js";
function setup() {
  const engine = new B.NullEngine(),
    scene = new B.Scene(engine),
    entities = new Map(),
    groups = new Map(),
    targets = new Map(),
    session = ArkGlideLifecycle.createSession(),
    errors = [],
    motions = [];
  function model(id, nodeName = "Bone") {
    const root = new B.TransformNode(id, scene),
      bone = new B.TransformNode(nodeName, scene);
    bone.parent = root;
    const entity = {
      id,
      name: id,
      get destroyed() {
        return root.isDisposed();
      },
    };
    entities.set(id, entity);
    targets.set(id, [bone]);
    groups.set(id, []);
    return { entity, root, bone };
  }
  function clip(id, name, from, to, property = "position") {
    const target = targets.get(id)[0],
      a = new B.Animation(
        name,
        property,
        60,
        property === "rotationQuaternion"
          ? B.Animation.ANIMATIONTYPE_QUATERNION
          : B.Animation.ANIMATIONTYPE_VECTOR3,
        B.Animation.ANIMATIONLOOPMODE_CYCLE,
      );
    a.setKeys([
      { frame: 0, value: from },
      { frame: 60, value: to },
    ]);
    const g = new B.AnimationGroup(name, scene);
    g.addTargetedAnimation(a, target);
    groups.get(id).push(g);
    return g;
  }
  const state = (name, clip, extra = {}) => ({
    name,
    clip,
    speed: 1,
    loop: true,
    events: [],
    ...extra,
  });
  const controller = {
    id: "locomotion",
    name: "Move",
    defaultState: "Idle",
    parameters: { speed: 0, jump: false, x: 0, y: 0 },
    states: [
      state("Idle", "Idle"),
      state("Move", "Move", { events: [{ time: 0.25, name: "step" }] }),
    ],
    transitions: [
      {
        from: "Idle",
        to: "Move",
        duration: 0.2,
        conditions: [{ parameter: "speed", op: ">", value: 0 }],
      },
    ],
  };
  const runtime = ArkGlideAnimation.createAnimation({
    BABYLON: B,
    controllers: { locomotion: controller },
    find: (id) => entities.get(id),
    getGroups: (id) => groups.get(id),
    getTargets: (id) => targets.get(id),
    onError: (e) => errors.push(e),
    applyRootMotion: (e, p, q, dt) => motions.push({ e, p, q, dt }),
  });
  function api() {
    const owner = session.owner(null, "animation-test");
    owner.attach({});
    session.startRecords([owner.record]);
    return { owner, api: runtime.forOwner(owner) };
  }
  return {
    engine,
    scene,
    model,
    clip,
    controller,
    runtime,
    api,
    errors,
    motions,
    done() {
      session.stop();
      runtime.dispose();
      engine.dispose();
    },
  };
}
test("state controllers isolate parameters, interpolate real imported channels and dispatch owned loop events", () => {
  const s = setup();
  try {
    const a = s.model("a"),
      b = s.model("b");
    for (const id of ["a", "b"]) {
      s.clip(id, "Idle", B.Vector3.Zero(), B.Vector3.Zero());
      s.clip(id, "Move", B.Vector3.Zero(), new B.Vector3(2, 0, 0));
    }
    const { owner, api } = s.api(),
      c = api.createController(a.entity, "locomotion"),
      d = api.createController(b.entity, "locomotion");
    let events = 0;
    api.onEvent(a.entity, (e) => {
      assert.equal(e.name, "step");
      events++;
    });
    c.setParameter("speed", 2);
    s.runtime.fixedUpdate(0.5);
    assert.equal(c.state, "Move");
    assert.equal(d.state, "Idle");
    assert.ok(Math.abs(a.bone.position.x - 1) < 1e-6);
    assert.equal(b.bone.position.x, 0);
    assert.equal(events, 1);
    s.runtime.fixedUpdate(1);
    assert.equal(events, 2);
    owner.abort();
    assert.equal(s.runtime.stats().animationControllers, 0);
    assert.equal(s.runtime.stats().animationEventSubscriptions, 0);
    assert.throws(() => c.setParameter("speed", 1), /销毁/);
  } finally {
    s.done();
  }
});
test("1D and 2D blend weights are continuous, normalized and recover exact sample points", () => {
  const w = ArkGlideAnimationTools.weights;
  const children = [
    { clip: "idle", threshold: 0, x: 0, y: 0 },
    { clip: "right", threshold: 1, x: 1, y: 0 },
    { clip: "up", threshold: 2, x: 0, y: 1 },
  ];
  assert.deepEqual(w({ kind: "1d", parameterX: "x", children }, { x: 0.5 }), [
    { clip: "idle", weight: 0.5 },
    { clip: "right", weight: 0.5 },
  ]);
  const blend = { kind: "2d", parameterX: "x", parameterY: "y", children };
  assert.deepEqual(w(blend, { x: 1, y: 0 }), [{ clip: "right", weight: 1 }]);
  for (const x of [0.1, 0.5, 1.1]) {
    const result = w(blend, { x, y: 0.3 });
    assert.ok(Math.abs(result.reduce((n, c) => n + c.weight, 0) - 1) < 1e-9);
    assert.ok(result.every((c) => c.weight >= 0));
  }
});
test("root motion unwraps looping translation, is extracted once at fixed time and leaves visual child stationary", () => {
  const s = setup();
  try {
    const a = s.model("a");
    s.clip("a", "Idle", B.Vector3.Zero(), new B.Vector3(2, 0, 0));
    s.clip("a", "Move", B.Vector3.Zero(), new B.Vector3(2, 0, 0));
    const { api } = s.api();
    api.createController(a.entity, "locomotion", {
      rootMotion: { target: "Bone", translation: true, rotation: false },
    });
    for (let i = 0; i < 90; i++) s.runtime.fixedUpdate(1 / 60);
    assert.ok(Math.abs(s.motions.reduce((n, m) => n + m.p.x, 0) - 3) < 1e-6);
    assert.equal(a.bone.position.x, 0);
    const count = s.motions.length;
    s.runtime.fixedUpdate(0);
    assert.equal(s.motions.length, count);
  } finally {
    s.done();
  }
});
test("explicit node/bone mapping transfers animation to differently named compatible hierarchy with pose and scale corrections", () => {
  const s = setup();
  try {
    const a = s.model("source", "SourceBone"),
      b = s.model("target", "TargetBone");
    s.clip("source", "Walk", new B.Vector3(1, 0, 0), new B.Vector3(3, 0, 0));
    const { api, owner } = s.api();
    assert.throws(
      () =>
        api.retarget(a.entity, b.entity, {
          mapping: { Missing: "TargetBone" },
          scale: 1,
        }),
      /映射/,
    );
    assert.deepEqual(
      api.retarget(a.entity, b.entity, {
        mapping: { SourceBone: "TargetBone" },
        scale: 2,
        sourcePose: {
          SourceBone: {
            position: { x: 1, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
          },
        },
        targetPose: {
          TargetBone: {
            position: { x: 5, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
          },
        },
      }),
      ["Walk"],
    );
    const g = s.scene.animationGroups.find(
      (g) => g.name === "Walk" && g.targetedAnimations[0].target === b.bone,
    );
    assert.equal(g.targetedAnimations[0].animation.evaluate(30).x, 7);
    assert.equal(s.runtime.stats().animationRetargetGroups, 1);
    owner.abort();
    assert.equal(s.runtime.stats().animationRetargetGroups, 0);
  } finally {
    s.done();
  }
});

test("controller transitions restore untouched channels to bind pose and cleanup returns every channel", () => {
  const s = setup();
  try {
    const a = s.model("a");
    s.clip("a", "Idle", new B.Vector3(0, 1, 0), new B.Vector3(0, 1, 0));
    s.clip("a", "Move", B.Vector3.One(), new B.Vector3(2, 2, 2), "scaling");
    const { owner, api } = s.api(),
      c = api.createController(a.entity, "locomotion");
    assert.equal(a.bone.position.y, 1);
    c.setState("Move", 0.2);
    s.runtime.fixedUpdate(0.1);
    assert.ok(Math.abs(a.bone.position.y - 0.5) < 1e-6);
    s.runtime.fixedUpdate(0.1);
    assert.equal(a.bone.position.y, 0);
    assert.ok(a.bone.scaling.x > 1);
    owner.abort();
    assert.equal(a.bone.scaling.x, 1);
  } finally {
    s.done();
  }
});
test("looped root quaternion motion remains continuous across multiple full cycles", () => {
  const s = setup();
  try {
    const a = s.model("a");
    for (const name of ["Idle", "Move"])
      s.clip(
        "a",
        name,
        B.Quaternion.Identity(),
        B.Quaternion.RotationAxis(B.Vector3.Up(), Math.PI / 2),
        "rotationQuaternion",
      );
    const { api } = s.api();
    api.createController(a.entity, "locomotion", {
      rootMotion: { target: "Bone", translation: false, rotation: true },
    });
    for (let i = 0; i < 150; i++) s.runtime.fixedUpdate(1 / 60);
    const actual = s.motions.reduce(
        (q, m) => q.multiply(m.q),
        B.Quaternion.Identity(),
      ),
      expected = B.Quaternion.RotationAxis(B.Vector3.Up(), Math.PI * 1.25);
    assert.ok(Math.abs(B.Quaternion.Dot(actual, expected)) > 0.9999);
  } finally {
    s.done();
  }
});
test("cross-frame event catch-up is bounded to 128 and skipped events are counted", () => {
  const s = setup();
  try {
    const a = s.model("a");
    for (const name of ["Idle", "Move"])
      s.clip("a", name, B.Vector3.Zero(), B.Vector3.Zero());
    const { api } = s.api(),
      c = api.createController(a.entity, "locomotion");
    let count = 0;
    api.onEvent(a.entity, () => count++);
    c.setState("Move");
    s.runtime.fixedUpdate(200);
    assert.equal(count, 128);
    assert.equal(s.runtime.stats().animationDroppedEvents, 72);
  } finally {
    s.done();
  }
});

test("rejected legacy animation playback preserves the active controller", () => {
  const s = setup();
  try {
    const { entity } = s.model("player");
    s.clip(entity.id, "Idle", B.Vector3.Zero(), B.Vector3.Zero());
    s.clip(entity.id, "Move", B.Vector3.Zero(), new B.Vector3(2, 0, 0));
    const { api } = s.api();
    const controller = api.createController(entity, "locomotion");
    assert.throws(() => api.play(entity, "missing"), /动画不存在/);
    assert.equal(controller.state, "Idle");
    assert.throws(() => api.play(entity, "Move", { speed: NaN }), /无效动画/);
    assert.equal(controller.state, "Idle");
    const stopped = s.api();
    stopped.owner.abort();
    assert.throws(() => stopped.api.stop(entity), /已销毁/);
    assert.equal(controller.state, "Idle");
    assert.throws(() => stopped.api.play(entity, "Move"), /已销毁/);
    assert.equal(controller.state, "Idle");
    const playback = api.play(entity, "Move");
    assert.throws(() => controller.state, /已销毁/);
    assert.equal(playback.playing, true);
    playback.stop();
    assert.equal(playback.playing, false);
  } finally {
    s.done();
  }
});

test("invalid replacement controllers preserve the previous controller and bind pose", () => {
  const s = setup();
  try {
    const { entity, bone } = s.model("player");
    s.clip(entity.id, "Idle", B.Vector3.Zero(), B.Vector3.Zero());
    s.clip(entity.id, "Move", B.Vector3.Zero(), new B.Vector3(2, 0, 0));
    const { api } = s.api();
    const previous = api.createController(entity, "locomotion");
    previous.setState("Move");
    s.runtime.fixedUpdate(0.25);
    assert.ok(Math.abs(bone.position.x - 0.5) < 1e-6);
    assert.throws(() => api.createController(entity, "locomotion", {
      rootMotion: { target: "missing", translation: true, rotation: false },
    }), /根运动节点不存在/);
    assert.equal(previous.state, "Move");
    assert.ok(Math.abs(bone.position.x - 0.5) < 1e-6);
    s.controller.states[1].clip = "missing";
    assert.throws(() => api.createController(entity, "locomotion"), /片段不存在/);
    assert.equal(previous.state, "Move");
    assert.ok(Math.abs(bone.position.x - 0.5) < 1e-6);
    s.controller.states[1].clip = "Move";
    const replacement = api.createController(entity, "locomotion");
    assert.throws(() => previous.state, /已销毁/);
    assert.equal(replacement.state, "Idle");
    s.runtime.fixedUpdate(0.1);
    assert.equal(bone.position.x, 0);
    api.stop(entity);
    assert.equal(bone.position.x, 0);
  } finally {
    s.done();
  }
});

test("destroying an obsolete controller handle leaves its replacement running", () => {
  const s = setup();
  try {
    const { entity } = s.model("player");
    s.clip(entity.id, "Idle", B.Vector3.Zero(), B.Vector3.Zero());
    s.clip(entity.id, "Move", B.Vector3.Zero(), new B.Vector3(2, 0, 0));
    const { api } = s.api();
    const old = api.createController(entity, "locomotion");
    const current = api.createController(entity, "locomotion");
    old.destroy();
    old.destroy();
    assert.equal(current.state, "Idle");
    current.setState("Move");
    s.runtime.fixedUpdate(0.25);
    assert.equal(current.state, "Move");
    current.destroy();
    assert.throws(() => current.state, /已销毁/);
    assert.doesNotThrow(() => current.destroy());
  } finally {
    s.done();
  }
});

test("animation event destruction stops frame writes, root motion and further event dispatch", () => {
  for (const rootMotion of [false, true]) {
    const s = setup();
    try {
      const { entity, bone } = s.model("player");
      s.clip(entity.id, "Idle", B.Vector3.Zero(), B.Vector3.Zero());
      s.clip(entity.id, "Move", B.Vector3.Zero(), new B.Vector3(2, 0, 0));
      s.controller.states[1].events.push({ time: 0.3, name: "later" });
      const { api } = s.api();
      const c = api.createController(entity, "locomotion", rootMotion ? {
        rootMotion: { target: "Bone", translation: true, rotation: false },
      } : {});
      const events = [];
      api.onEvent(entity, e => { events.push(e.name); c.destroy(); });
      c.setState("Move");
      s.runtime.fixedUpdate(0.5);
      assert.deepEqual(events, ["step"]);
      assert.equal(bone.position.x, 0);
      assert.equal(s.motions.length, 0);
    } finally {
      s.done();
    }
  }
});

test("controller replacement inside an event is not overwritten by the old frame", () => {
  const s = setup();
  try {
    const { entity, bone } = s.model("player");
    s.clip(entity.id, "Idle", B.Vector3.Zero(), B.Vector3.Zero());
    s.clip(entity.id, "Move", B.Vector3.Zero(), new B.Vector3(2, 0, 0));
    const { api } = s.api();
    const previous = api.createController(entity, "locomotion");
    let replacement;
    api.onEvent(entity, () => {
      replacement = api.createController(entity, "locomotion");
    });
    previous.setState("Move");
    s.runtime.fixedUpdate(0.5);
    assert.equal(replacement.state, "Idle");
    assert.equal(bone.position.x, 0);
    assert.throws(() => previous.state, /已销毁/);
  } finally {
    s.done();
  }
});

test("state changes inside animation events stop old-state events and pose writes", () => {
  const s = setup();
  try {
    const { entity, bone } = s.model("player");
    s.clip(entity.id, "Idle", B.Vector3.Zero(), B.Vector3.Zero());
    s.clip(entity.id, "Move", B.Vector3.Zero(), new B.Vector3(2, 0, 0));
    s.controller.states[1].events.push({ time: 0.3, name: "later" });
    const { api } = s.api();
    const c = api.createController(entity, "locomotion");
    const events = [];
    api.onEvent(entity, e => { events.push(e.name); c.setState("Idle"); });
    c.setState("Move");
    s.runtime.fixedUpdate(0.5);
    assert.deepEqual(events, ["step"]);
    assert.equal(c.state, "Idle");
    assert.equal(c.inspect().time, 0);
    assert.equal(bone.position.x, 0);
  } finally {
    s.done();
  }
});

test("event-triggered state restarts cancel old dispatch without breaking subsequent fixed updates", () => {
  const s = setup();
  try {
    const { entity, bone } = s.model("player");
    s.clip(entity.id, "Idle", B.Vector3.Zero(), B.Vector3.Zero());
    s.clip(entity.id, "Move", B.Vector3.Zero(), new B.Vector3(2, 0, 0));
    const { api } = s.api();
    const c = api.createController(entity, "locomotion");
    let first = 0, second = 0;
    const unsubscribe = api.onEvent(entity, () => { first++; c.setState("Move"); });
    api.onEvent(entity, () => second++);
    c.setState("Move");
    s.runtime.fixedUpdate(0.5);
    assert.equal(first, 1);
    assert.equal(second, 0);
    assert.equal(c.inspect().time, 0);
    unsubscribe();
    s.runtime.fixedUpdate(0.1);
    assert.ok(Math.abs(bone.position.x - 0.2) < 1e-6);
    s.runtime.fixedUpdate(0.2);
    assert.equal(second, 1);
  } finally {
    s.done();
  }
});

test("animation subscriptions canceled during dispatch do not receive the current event", () => {
  const s = setup();
  try {
    const { entity } = s.model("player");
    s.clip(entity.id, "Idle", B.Vector3.Zero(), B.Vector3.Zero());
    s.clip(entity.id, "Move", B.Vector3.Zero(), new B.Vector3(2, 0, 0));
    const { api } = s.api();
    const c = api.createController(entity, "locomotion");
    let cancel, called = 0;
    api.onEvent(entity, () => cancel());
    cancel = api.onEvent(entity, () => called++);
    c.setState("Move");
    s.runtime.fixedUpdate(0.5);
    assert.equal(called, 0);
    assert.equal(c.state, "Move");
  } finally {
    s.done();
  }
});

test("retarget owner cleanup only removes controllers that reference its generated clips", () => {
  for (const dependent of [false, true]) {
    const s = setup();
    try {
      const source = s.model("source", "SourceBone");
      const target = s.model("target", "TargetBone");
      s.clip("source", "Walk", B.Vector3.Zero(), new B.Vector3(3, 0, 0));
      s.clip("target", "Idle", B.Vector3.Zero(), B.Vector3.Zero());
      s.clip("target", "Move", B.Vector3.Zero(), new B.Vector3(2, 0, 0));
      const retarget = s.api();
      retarget.api.retarget(source.entity, target.entity, { mapping: { SourceBone: "TargetBone" }, scale: 1 });
      if (dependent) s.controller.states[1].clip = "Walk";
      const current = s.api().api.createController(target.entity, "locomotion");
      current.setState("Move");
      retarget.owner.abort();
      assert.equal(s.runtime.stats().animationRetargetGroups, 0);
      if (dependent) assert.throws(() => current.state, /已销毁/);
      else {
        assert.equal(current.state, "Move");
        s.runtime.fixedUpdate(0.25);
        assert.ok(Math.abs(target.bone.position.x - 0.5) < 1e-6);
      }
    } finally {
      s.done();
    }
  }
});

test("nested time-zero state events share the dispatch limit without overflowing the stack", () => {
  const s = setup();
  try {
    const { entity } = s.model("player");
    s.clip(entity.id, "Idle", B.Vector3.Zero(), B.Vector3.Zero());
    s.clip(entity.id, "Move", B.Vector3.Zero(), new B.Vector3(2, 0, 0));
    s.controller.states[0].events = [{ time: 0, name: "enter" }];
    const { api } = s.api();
    const c = api.createController(entity, "locomotion");
    let events = 0;
    api.onEvent(entity, () => { events++; c.setState("Idle"); });
    c.setState("Idle");
    assert.ok(events <= 128, `dispatched ${events}`);
    assert.equal(events, 128);
    assert.equal(s.errors.length, 0);
    assert.equal(c.state, "Idle");
    assert.ok(s.runtime.stats().animationDroppedEvents > 0);
  } finally {
    s.done();
  }
});
