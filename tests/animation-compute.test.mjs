import test from "node:test";
import assert from "node:assert/strict";
import * as B from "@babylonjs/core";
import factory from "../src/wasm/arkglide_math.js";
import "../src/engine/animation-compute.js";
const module = await factory();
const near = (actual, expected, message = "") => {
  const a = typeof actual === "number" ? [actual] : actual.asArray(),
    b = typeof expected === "number" ? [expected] : expected.asArray();
  for (let i = 0; i < a.length; i++)
    assert.ok(Math.abs(a[i] - b[i]) < 1e-9, `${message}: ${a} != ${b}`);
};
function fixture(options = { minTracks: 0 }) {
  const compute = ArkGlideAnimationCompute.create(B, module, options),
    target = {
      position: new B.Vector3(3, 2, 1),
      rotationQuaternion: B.Quaternion.Identity(),
      weight: 0.3,
      uv: new B.Vector2(1, 2),
      color: new B.Color3(0.2, 0.4, 0.6),
      tint: new B.Color4(1, 0, 0, 1),
    },
    c = { bindPose: new Map([[target, new Map()]]), groups: [] };
  function track(path, type, keys, group = { targetedAnimations: [] }) {
    const animation = new B.Animation(path, path, 60, type);
    animation.setKeys(keys);
    group.targetedAnimations.push({ animation, target });
    if (!c.groups.includes(group)) c.groups.push(group);
    c.bindPose.get(target).set(path, target[path]?.clone?.() ?? target[path]);
    return { animation, group };
  }
  return { c, target, track, compute };
}

test("native sampling matches Babylon for linear, STEP and cubic scalar/vector/color/quaternion keys, bounds and duplicate frames", () => {
  const s = fixture();
  try {
    const definitions = [
      ["weight", B.Animation.ANIMATIONTYPE_FLOAT, 0.1, 0.9, 0.02],
      [
        "position",
        B.Animation.ANIMATIONTYPE_VECTOR3,
        new B.Vector3(1, 2, 3),
        new B.Vector3(7, -4, 8),
        new B.Vector3(0.1, -0.1, 0.2),
      ],
      [
        "uv",
        B.Animation.ANIMATIONTYPE_VECTOR2,
        new B.Vector2(1, 3),
        new B.Vector2(4, -2),
        new B.Vector2(0.1, 0.2),
      ],
      [
        "color",
        B.Animation.ANIMATIONTYPE_COLOR3,
        new B.Color3(0.1, 0.3, 0.2),
        new B.Color3(0.9, 0.5, 0.4),
        new B.Color3(0.01, 0.02, 0.03),
      ],
      [
        "tint",
        B.Animation.ANIMATIONTYPE_COLOR4,
        new B.Color4(0.1, 0.2, 0.3, 0.4),
        new B.Color4(0.9, 0.8, 0.7, 0.6),
        new B.Color4(0.01, 0, 0, 0.02),
      ],
      [
        "rotationQuaternion",
        B.Animation.ANIMATIONTYPE_QUATERNION,
        B.Quaternion.Identity(),
        B.Quaternion.RotationYawPitchRoll(2, -0.2, 0.4),
        new B.Quaternion(0, 0.01, 0, 0),
      ],
    ];
    for (const mode of ["linear", "step", "cubic", "duplicates"]) {
      s.c.groups = [];
      s.c.bindPose.get(s.target).clear();
      const entries = definitions.map(([path, type, from, to, tangent]) =>
        s.track(path, type, [
          {
            frame: 10,
            value: from,
            ...(mode === "step" ? { interpolation: 1 } : {}),
            ...(mode === "cubic" ? { outTangent: tangent } : {}),
          },
          ...(mode === "duplicates" ? [{ frame: 10, value: to }] : []),
          {
            frame: 70,
            value: to,
            ...(mode === "cubic" ? { inTangent: tangent } : {}),
          },
        ]),
      );
      const plan = s.compute.prepare(s.c);
      assert.ok(plan, mode);
      for (const frame of [-5, 10, 10.001, 21.7, 40, 69.999, 70, 200]) {
        assert.equal(
          plan.evaluate(entries.map((e) => ({ g: e.group, frame, weight: 1 }))),
          true,
        );
        entries.forEach((e) =>
          near(
            s.target[e.animation.targetProperty],
            e.animation.evaluate(frame),
            `${mode} ${frame}`,
          ),
        );
      }
      plan.dispose();
    }
  } finally {
    s.compute.dispose();
  }
});

test("weighted poses preserve track order, shortest quaternion arcs, missing channels and bind-pose fill", () => {
  const s = fixture();
  try {
    const rotation = s.track("rotationQuaternion", 2, [
        { frame: 0, value: B.Quaternion.Identity() },
        { frame: 60, value: B.Quaternion.RotationAxis(B.Axis.Y, 1.3) },
      ]),
      opposite = s.track("rotationQuaternion", 2, [
        { frame: 0, value: B.Quaternion.RotationAxis(B.Axis.X, 0.9).scale(-1) },
        {
          frame: 60,
          value: B.Quaternion.RotationAxis(B.Axis.X, 0.9).scale(-1),
        },
      ]),
      position = s.track(
        "position",
        1,
        [{ frame: 0, value: new B.Vector3(20, 0, 0) }],
        rotation.group,
      ),
      base = s.c.bindPose.get(s.target),
      plan = s.compute.prepare(s.c);
    assert.ok(plan);
    for (const [a, b] of [
      [0.1, 0.3],
      [0.3, 0.7],
      [1, 1],
      [0, 0],
    ]) {
      plan.evaluate([
        { g: rotation.group, frame: 30, weight: a },
        { g: opposite.group, frame: 30, weight: b },
      ]);
      let q = a
        ? rotation.animation.evaluate(30)
        : base.get("rotationQuaternion");
      if (b)
        q = a
          ? B.Quaternion.Slerp(
              q,
              opposite.animation.evaluate(30),
              b / (a + b),
            ).normalize()
          : opposite.animation.evaluate(30);
      if (a + b < 1)
        q = B.Quaternion.Slerp(
          base.get("rotationQuaternion"),
          q,
          a + b,
        ).normalize();
      near(s.target.rotationQuaternion, q);
      near(
        s.target.position,
        a < 1
          ? B.Vector3.Lerp(
              base.get("position"),
              position.animation.evaluate(30),
              a,
            )
          : position.animation.evaluate(30),
      );
    }
    plan.evaluate([]);
    for (const [path, value] of base) near(s.target[path], value);
  } finally {
    s.compute.dispose();
    assert.equal(s.compute.stats().animationNativeControllers, 0);
  }
});

test("custom easing, function values and custom evaluators use JS; replaced keys and target entries invalidate native plans", () => {
  const s = fixture();
  try {
    const e = s.track("weight", 0, [
      { frame: 0, value: 0 },
      { frame: 10, value: 1 },
    ]);
    const p = s.compute.prepare(s.c);
    assert.ok(p.valid());
    e.animation.setKeys([
      { frame: 0, value: 5 },
      { frame: 10, value: 6 },
    ]);
    assert.equal(p.valid(), false);
    p.dispose();
    const newer = s.compute.prepare(s.c);
    newer.evaluate([{ g: e.group, frame: 5, weight: 1 }]);
    near(s.target.weight, 5.5);
    e.group.targetedAnimations[0] = { ...e.group.targetedAnimations[0] };
    assert.equal(newer.valid(), false);
    newer.dispose();
    const easing = new B.SineEase();
    e.animation.setEasingFunction(easing);
    assert.equal(s.compute.prepare(s.c), null);
    e.animation.setEasingFunction(null);
    e.animation.getKeys()[0].easingFunction = easing;
    assert.equal(s.compute.prepare(s.c), null);
    e.animation.setKeys([{ frame: 0, value: () => 5 }]);
    assert.equal(s.compute.prepare(s.c), null);
    e.animation.setKeys([{ frame: 0, value: 5 }]);
    e.animation.evaluate = () => 10;
    assert.equal(s.compute.prepare(s.c), null);
  } finally {
    s.compute.dispose();
  }
});

test("native views refresh after another batch grows WASM memory; invalid jobs never apply partial target poses", () => {
  const s = fixture();
  try {
    const e = s.track("weight", 0, [
        { frame: 0, value: 1 },
        { frame: 10, value: 9 },
      ]),
      plan = s.compute.prepare(s.c);
    plan.evaluate([{ g: e.group, frame: 5, weight: 1 }]);
    near(s.target.weight, 5);
    const large = new module.AnimationBatch();
    try {
      assert.equal(large.reserve(1, 1, 1, 800000), true);
    } finally {
      large.delete();
    }
    plan.evaluate([{ g: e.group, frame: 7.5, weight: 1 }]);
    near(s.target.weight, 7);
    assert.equal(
      plan.evaluate([
        { g: e.group, frame: 0, weight: 1 },
        { g: e.group, frame: NaN, weight: 1 },
      ]),
      false,
    );
    near(s.target.weight, 7);
    plan.dispose();
    plan.dispose();
    assert.equal(plan.evaluate([]), false);
    assert.equal(s.compute.stats().animationNativeControllers, 0);
  } finally {
    s.compute.dispose();
  }
});

test("animation budgets are validated and small or oversized controllers retain JS", () => {
  for (const invalid of [
    { enabled: 1 },
    { unknown: 0 },
    { minTracks: -1 },
    { maxTracks: 65537 },
    { maxKeys: 0 },
    { maxKeys: Infinity },
  ])
    assert.throws(
      () => ArkGlideAnimationCompute.settings(invalid),
      /Invalid animation/,
    );
  for (const options of [
    { enabled: false },
    { minTracks: 2 },
    { maxKeys: 1, minTracks: 0 },
  ]) {
    const s = fixture(options);
    try {
      s.track("weight", 0, [
        { frame: 0, value: 0 },
        { frame: 10, value: 1 },
      ]);
      assert.equal(s.compute.prepare(s.c), null);
    } finally {
      s.compute.dispose();
    }
  }
  const native = new module.AnimationBatch();
  try {
    assert.equal(native.reserve(0xffffffff, 0, 0, 0), false);
    assert.equal(native.reserveJobs(0xffffffff), false);
    assert.equal(native.evaluate(1), false);
    native.reserve(1, 1, 1, 1);
    native.kindView()[0] = 1;
    native.trackView().set([0, 0, 1, 0xffffffff, 3]);
    assert.equal(native.seal(), false);
  } finally {
    native.delete();
  }
});

test("native pose writes preserve custom target copy hooks installed after compilation", () => {
  const s = fixture();
  try {
    const e = s.track("position", B.Animation.ANIMATIONTYPE_VECTOR3, [
        { frame: 0, value: new B.Vector3(2, 4, 6) },
        { frame: 10, value: new B.Vector3(4, 8, 12) },
      ]),
      plan = s.compute.prepare(s.c);
    let calls = 0;
    const retained = [];
    s.target.position.copyFrom = function (value) {
      calls++;
      retained.push(value);
      return B.Vector3.prototype.copyFrom.call(this, value);
    };
    assert.equal(plan.evaluate([{ g: e.group, frame: 0, weight: 1 }]), true);
    assert.equal(calls, 1);
    near(s.target.position, new B.Vector3(2, 4, 6));
    plan.evaluate([{ g: e.group, frame: 10, weight: 1 }]);
    near(s.target.position, new B.Vector3(4, 8, 12));
    near(retained[0], new B.Vector3(2, 4, 6));
    assert.equal(s.compute.stats().animationNativeControllers, 1);
  } finally {
    s.compute.dispose();
  }
});
