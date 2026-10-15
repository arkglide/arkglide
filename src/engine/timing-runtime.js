// Frame pacing is independent of simulation time and the display refresh rate.
(function (root) {
  "use strict";
  function createFramePacer({ fps = 60, toleranceMs = 1 } = {}) {
    if (!Number.isFinite(toleranceMs) || toleranceMs < 0)
      throw new RangeError("Expected a nonnegative frame timing tolerance");
    let cap,
      deadline = null,
      previous = null;
    function reset() {
      deadline = previous = null;
    }
    function setCap(value) {
      if (!Number.isFinite(value) || value < 0)
        throw new RangeError("Expected a nonnegative FPS cap");
      if (cap !== value) {
        cap = value;
        reset();
      }
    }
    setCap(fps);
    return {
      reset,
      setCap,
      shouldRender(now) {
        if (!Number.isFinite(now)) return false;
        if (previous !== null && now < previous) reset();
        previous = now;
        if (!cap) return true;
        const interval = 1000 / cap,
          tolerance = Math.min(toleranceMs, interval / 4);
        if (deadline === null) {
          deadline = now + interval;
          return true;
        }
        if (now + tolerance < deadline) return false;
        // Advance from the planned time, not this jittered callback. A long
        // stall starts a new schedule rather than accumulating catch-up frames.
        deadline =
          now - deadline >= interval ? now + interval : deadline + interval;
        return true;
      },
    };
  }
  root.ArkGlideTiming = { createFramePacer };
})(globalThis);
