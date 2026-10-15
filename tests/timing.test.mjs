import test from "node:test";
import assert from "node:assert/strict";
import "../src/engine/timing-runtime.js";
const { createFramePacer } = ArkGlideTiming;

for (const hz of [60, 120, 144]) {
  for (const fps of [5, 24, 30, 60, 90, 144, 0]) {
    test(`${fps} FPS cap preserves rate on a jittered ${hz} Hz display`, () => {
      const pacer = createFramePacer({ fps });
      let rendered = 0;
      const duration = 10000;
      for (let frame = 0; frame < (hz * duration) / 1000; frame++) {
        // Alternating short/long callbacks used to halve the capped rate.
        const jitter = [0.3, -0.3, 0.1, -0.1][frame % 4];
        if (pacer.shouldRender(1000 + (frame * 1000) / hz + jitter)) rendered++;
      }
      const expected = (Math.min(fps || hz, hz) * duration) / 1000;
      assert.ok(
        Math.abs(rendered - expected) <= 2,
        `${rendered} vs ${expected}`,
      );
    });
  }
}
test("stalls, clock rewind, reset and changing caps never create a catch-up burst", () => {
  const p = createFramePacer({ fps: 30 });
  assert.equal(p.shouldRender(0), true);
  assert.equal(p.shouldRender(16.6), false);
  assert.equal(p.shouldRender(10000), true);
  assert.equal(p.shouldRender(10001), false);
  assert.equal(p.shouldRender(10016.6), false);
  assert.equal(p.shouldRender(10033.3), true);
  assert.equal(p.shouldRender(2), true);
  p.setCap(60);
  assert.equal(p.shouldRender(3), true);
  assert.equal(p.shouldRender(19.6), true);
  p.reset();
  assert.equal(p.shouldRender(20), true);
  p.setCap(0);
  assert.equal(p.shouldRender(20.1), true);
  assert.equal(p.shouldRender(20.2), true);
  for (const n of [NaN, Infinity, -1]) assert.throws(() => p.setCap(n));
  assert.equal(p.shouldRender(NaN), false);
});
