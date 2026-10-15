import nodeTest from "node:test";
import factory from "../src/wasm/arkglide_math.js";
const nativeModule = await factory();
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import "../src/engine/lifecycle-runtime.js";
for (const backend of ["javascript", "cpp-wasm"]) {
  const test = (name, ...args) => nodeTest(backend + ": " + name, ...args);
  const create = (options) =>
    globalThis.ArkGlideLifecycle.createSession({
      ...options,
      ...(backend === "cpp-wasm" ? { nativeModule } : {}),
    });
  test("injected native timers reject non-function callbacks without allocating timers", () => {
    const session = create(),
      owner = session.owner({ id: "one" }, "timers.js");
    owner.attach({});
    for (const callback of [null, undefined, 42, "code"]) {
      assert.throws(() => owner.globals.setTimeout(callback, 10), TypeError);
      assert.throws(() => owner.globals.setInterval(callback, 10), TypeError);
    }
    assert.equal(session.stats().timers, 0);
    session.stop();
  });
  test("destroyed entities stop receiving events before the next cleanup tick", () => {
    const session = create(),
      entity = { id: "gone", destroyed: false },
      owner = session.owner(entity, "gone.js"),
      sender = session.owner({ id: "sender" }, "sender.js");
    let events = 0,
      destroyed = 0;
    owner.attach({
      onDestroy() {
        destroyed++;
      },
    });
    sender.attach({});
    owner.events.on("message", () => events++);
    session.start();
    entity.destroyed = true;
    sender.events.emit("message");
    assert.equal(events, 0);
    session.tick(0);
    assert.equal(destroyed, 1);
    session.stop();
    assert.equal(destroyed, 1);
  });
  test("invalid startup time scale preserves the existing simulation settings", () => {
    const session = create();
    session.start({ fixedTimeStep: 1 / 60, maxSubSteps: 8, timeScale: 2 });
    assert.throws(
      () =>
        session.start({ fixedTimeStep: 0.1, maxSubSteps: 1, timeScale: NaN }),
      RangeError,
    );
    assert.equal(session.time.fixedDeltaTime, 1 / 60);
    assert.equal(session.time.timeScale, 2);
    session.tick(0);
    session.tick(100);
    assert.equal(session.time.fixedFrameCount, 8);
    session.stop();
  });
  test("listener telemetry counts native event listeners rather than unrelated owned resources", () => {
    const session = create(),
      owner = session.owner({ id: "one" }, "resources.js"),
      target = new EventTarget();
    owner.attach({});
    session.start();
    const resource = owner.track(() => {});
    assert.equal(session.stats().listeners, 0);
    const listener = owner.events.listen(target, "ping", () => {});
    assert.equal(session.stats().listeners, 1);
    resource();
    assert.equal(session.stats().listeners, 1);
    listener();
    assert.equal(session.stats().listeners, 0);
    session.stop();
  });
  test("tick removes script records of entities destroyed outside the lifecycle API", () => {
    const session = create();
    session.start();
    let destroyed = 0;
    for (let i = 0; i < 20; i++) {
      const entity = { id: String(i), destroyed: false },
        owner = session.owner(entity, "dynamic.js");
      owner.attach({
        onDestroy() {
          destroyed++;
        },
      });
      session.startRecords([owner.record]);
      entity.destroyed = true;
      session.tick(i * 20);
      assert.equal(session.records.length, 0);
      assert.equal(session.stats().scripts, 0);
    }
    assert.equal(destroyed, 20);
    session.stop();
  });
  test("destroying owners do not receive events emitted by another owner during teardown", () => {
    const session = create(),
      a = session.owner({ id: "a" }, "a.js"),
      b = session.owner({ id: "b" }, "b.js");
    let events = 0;
    a.attach({
      onDestroy() {
        b.events.emit("cleanup");
      },
    });
    b.attach({});
    a.events.on("cleanup", () => events++);
    session.start();
    session.destroyEntity("a");
    assert.equal(events, 0);
    session.stop();
  });
  test("pause requested during startup remains effective until explicit resume", () => {
    const session = create(),
      owner = session.owner({ id: "one" }, "startup.js");
    let frames = 0;
    owner.attach({
      onStart() {
        session.pause();
      },
      onUpdate() {
        frames++;
      },
    });
    session.start();
    session.tick(0);
    session.tick(20);
    assert.equal(frames, 0);
    assert.equal(session.time.frameCount, 0);
    session.resume();
    session.tick(40);
    assert.equal(frames, 1);
    session.stop();
  });
  test("late owners after session stop remain inactive and retain no script records", () => {
    const session = create();
    session.start();
    session.stop();
    const owner = session.owner({ id: "late" }, "late.js");
    let calls = 0;
    owner.attach({
      onStart() {
        calls++;
      },
      onDestroy() {
        calls++;
      },
    });
    owner.timers.after(0, () => calls++);
    owner.events.on("late", () => calls++);
    session.startRecords([owner.record]);
    owner.events.emit("late");
    assert.equal(owner.record.active, false);
    assert.equal(session.records.length, 0);
    assert.equal(session.stats().scripts, 0);
    assert.equal(session.stats().timers, 0);
    assert.equal(calls, 0);
  });
  test("stopping inside a fixed hook prevents physics stepping and stopped sessions cannot resume", () => {
    let steps = 0;
    const session = create({ onFixedStep: () => steps++ }),
      owner = session.owner({ id: "one" }, "stop.js");
    owner.attach({
      onFixedUpdate() {
        session.stop();
      },
    });
    session.start();
    session.tick(0);
    session.tick(20);
    assert.equal(steps, 0);
    assert.equal(session.time.frameCount, 0);
    session.resume();
    session.tick(100);
    assert.equal(session.time.frameCount, 0);
  });
  test("pausing inside a timer defers remaining timers and frame hooks until resume", () => {
    const session = create(),
      owner = session.owner({ id: "one" }, "pause.js"),
      calls = [];
    owner.attach({
      onUpdate() {
        calls.push("frame");
      },
    });
    owner.timers.after(0.02, () => {
      calls.push("pause");
      session.pause();
    });
    owner.timers.after(0.02, () => calls.push("timer"));
    session.start();
    session.tick(0);
    calls.length = 0;
    session.tick(20);
    assert.deepEqual(calls, ["pause"]);
    session.resume();
    session.tick(30);
    assert.deepEqual(calls, ["pause", "timer", "frame"]);
    session.stop();
  });

  test("fixed-step results agree at 30, 60 and 120 FPS and run before frame hooks", () => {
    for (const fps of [30, 60, 120]) {
      const session = create(),
        order = [];
      let distance = 0;
      const owner = session.owner({ id: "player" }, "move.js");
      owner.attach({
        onFixedUpdate() {
          distance += 3 * session.time.fixedDeltaTime;
          order.push("fixed");
        },
        onUpdate() {
          order.push("frame");
        },
      });
      session.start();
      session.tick(0);
      for (let frame = 1; frame <= fps; frame++)
        session.tick((frame * 1000) / fps);
      assert.ok(Math.abs(distance - 3) < 1e-9);
      assert.equal(session.time.fixedFrameCount, 60);
      assert.equal(order.at(-1), "frame");
      session.stop();
    }
  });
  test("time scaling freezes timers; pause/resume and catch-up limits avoid a large jump", () => {
    const session = create(),
      owner = session.owner({ id: "one" }, "timer.js");
    let count = 0;
    owner.attach({});
    owner.timers.every(0.1, () => count++);
    session.start({ timeScale: 2, maxSubSteps: 2 });
    session.tick(0);
    session.tick(50);
    assert.equal(count, 1);
    assert.equal(session.time.totalTime, 0.1);
    session.time.timeScale = 0;
    session.tick(100);
    assert.equal(count, 1);
    session.pause();
    session.tick(50000);
    session.resume();
    session.tick(60000);
    assert.equal(session.time.deltaTime, 0);
    assert.equal(session.time.totalTime, 0.1);
    session.time.timeScale = 1;
    session.tick(61000);
    assert.equal(session.time.fixedFrameCount, 4);
    assert.ok(session.stats().droppedTime > 0.9);
    session.stop();
    assert.throws(() => {
      session.time.timeScale = NaN;
    }, RangeError);
  });
  test("timer/event ownership, native listener cleanup and repeated stop are deterministic", () => {
    const session = create(),
      a = session.owner({ id: "a" }, "a.js"),
      b = session.owner({ id: "b" }, "b.js"),
      target = new EventTarget();
    let fired = 0,
      event = 0,
      destroyed = 0,
      native = 0;
    a.attach({
      onDestroy() {
        destroyed++;
      },
    });
    b.attach({});
    a.timers.every(0.1, () => fired++);
    a.events.on("score", () => event++);
    a.events.listen(target, "ping", () => native++);
    const id = a.globals.setTimeout(() => fired++, 100);
    a.globals.clearTimeout(id);
    session.start();
    session.tick(0);
    session.tick(100);
    b.events.emit("score");
    target.dispatchEvent(new Event("ping"));
    assert.equal(fired, 1);
    assert.equal(event, 1);
    assert.equal(native, 1);
    session.destroyEntity("a");
    session.destroyEntity("a");
    b.events.emit("score");
    target.dispatchEvent(new Event("ping"));
    session.tick(200);
    assert.equal(fired, 1);
    assert.equal(event, 1);
    assert.equal(native, 1);
    assert.equal(destroyed, 1);
    session.stop();
    session.stop();
    const stats = session.stats();
    for (const key of ["scripts", "timers", "subscriptions", "listeners"])
      assert.equal(stats[key], 0, key);
  });
  test("all factories complete before startup; destroyed and aborted owners release resources", () => {
    const session = create(),
      order = [];
    const a = session.owner({ id: "a" }, "a.js"),
      b = session.owner({ id: "b" }, "b.js"),
      failed = session.owner({ id: "bad" }, "bad.js");
    a.attach({
      onStart() {
        order.push("a");
        b.events.emit("ready");
      },
      onDestroy() {
        order.push("destroy-a");
      },
    });
    b.attach({
      onStart() {
        order.push("b");
      },
      onDestroy() {
        order.push("destroy-b");
      },
    });
    b.events.on("ready", () => order.push("event"));
    failed.timers.after(0, () => assert.fail("aborted timer ran"));
    failed.events.on("ready", () => assert.fail("aborted event ran"));
    failed.abort();
    session.start();
    assert.deepEqual(order, ["a", "event", "b"]);
    session.stop();
    assert.deepEqual(order.slice(-2), ["destroy-b", "destroy-a"]);
    assert.equal(session.stats().timers, 0);
  });
  test("a throwing hook is disabled once while other scripts continue", () => {
    const errors = [],
      session = create({ onError: (e) => errors.push(e) }),
      a = session.owner({ id: "a" }, "broken.js"),
      b = session.owner({ id: "b" }, "good.js");
    let frames = 0;
    a.attach({
      onUpdate() {
        throw new Error("bad");
      },
    });
    b.attach({
      onUpdate() {
        frames++;
      },
    });
    session.start();
    for (let i = 0; i < 10; i++) session.tick(i * 20);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].file, "broken.js");
    assert.equal(errors[0].hook, "onUpdate");
    assert.equal(frames, 10);
    session.stop();
  });
  test("invalid fixed settings fail rather than looping and a timer cannot fire after cancel", () => {
    assert.throws(() => create().start({ fixedTimeStep: 0 }), RangeError);
    const session = create(),
      owner = session.owner({ id: "one" }, "one.js");
    let calls = 0;
    const cancel = owner.timers.after(0.1, () => calls++);
    cancel();
    cancel();
    session.start();
    session.tick(0);
    session.tick(100);
    assert.equal(calls, 0);
    session.stop();
  });

  test("one bad subscriber does not cancel other same-name subscriptions and once listeners are counted accurately", () => {
    const errors = [],
      session = create({ onError: (e) => errors.push(e) }),
      owner = session.owner({ id: "one" }, "one.js"),
      target = new EventTarget();
    let events = 0,
      native = 0;
    owner.attach({});
    owner.events.on("score", () => {
      throw new Error("bad listener");
    });
    owner.events.on("score", () => events++);
    owner.events.listen(target, "once", () => native++, { once: true });
    session.start();
    owner.events.emit("score");
    owner.events.emit("score");
    target.dispatchEvent(new Event("once"));
    target.dispatchEvent(new Event("once"));
    assert.equal(events, 2);
    assert.equal(errors.length, 1);
    assert.equal(native, 1);
    assert.equal(session.stats().listeners, 0);
    session.stop();
  });

  test("canceled event subscriptions do not fire later in the same dispatch or nested once dispatch", () => {
    const session = create(),
      owner = session.owner({ id: "one" }, "one.js");
    owner.attach({});
    session.start();
    let cancelLater,
      called = 0;
    owner.events.on("cancel", () => cancelLater());
    cancelLater = owner.events.on("cancel", () => called++);
    owner.events.emit("cancel");
    assert.equal(called, 0);
    let nested = false,
      once = 0;
    owner.events.on("nested", () => {
      if (!nested) {
        nested = true;
        owner.events.emit("nested");
      }
    });
    owner.events.once("nested", () => once++);
    owner.events.emit("nested");
    assert.equal(once, 1);
    session.stop();
  });

  test("listener cleanup uses the capture mode from registration", () => {
    const session = create(),
      owner = session.owner({ id: "one" }, "one.js"),
      target = new EventTarget(),
      options = { capture: false };
    let calls = 0;
    owner.attach({});
    owner.events.listen(target, "ping", () => calls++, options);
    session.start();
    options.capture = true;
    session.destroyEntity("one");
    session.resume();
    target.dispatchEvent(new Event("ping"));
    assert.equal(calls, 0);
    assert.equal(getEventListeners(target, "ping").length, 0);
    session.stop();
  });
  test("aborted native listeners release their owned cleanup records", () => {
    const session = create(),
      owner = session.owner({ id: "one" }, "one.js"),
      target = new EventTarget(),
      controller = new AbortController();
    owner.attach({});
    session.start();
    owner.events.listen(target, "ping", () => {}, {
      signal: controller.signal,
    });
    assert.equal(session.stats().listeners, 1);
    controller.abort();
    assert.equal(getEventListeners(target, "ping").length, 0);
    assert.equal(session.stats().listeners, 0);
    owner.events.listen(target, "ping", () => {}, {
      signal: controller.signal,
    });
    assert.equal(session.stats().listeners, 0);
    session.stop();
  });

  test("a throwing error reporter cannot interrupt script teardown or remaining owners", () => {
    const session = create({
        onError() {
          throw Error("reporter failed");
        },
      }),
      a = session.owner({ id: "a" }, "a.js"),
      b = session.owner({ id: "b" }, "b.js");
    let released = 0;
    a.attach({
      onDestroy() {
        released++;
      },
    });
    b.attach({
      onDestroy() {
        throw Error("script destroy failed");
      },
    });
    a.timers.after(1, () => {});
    b.timers.after(1, () => {});
    session.start();
    assert.doesNotThrow(() => session.stop());
    assert.equal(released, 1);
    assert.equal(session.records.length, 0);
    assert.equal(session.stats().timers, 0);
    assert.equal(session.stats().errors, 1);
  });
  test("configurable frame delta and timer snapshots preserve pause and zero-scale boundaries", () => {
    const session = create(),
      owner = session.owner({ id: "one" }, "snapshot.js"),
      calls = [];
    owner.attach({});
    owner.timers.after(0.1, () => {
      calls.push("first");
      session.time.timeScale = 0;
    });
    owner.timers.after(0.1, () => calls.push("second"));
    session.start({ maxFrameDelta: 0.1 });
    session.tick(0);
    session.tick(1000);
    assert.deepEqual(calls, ["first"]);
    assert.equal(session.time.totalTime, 0.1);
    session.time.timeScale = 1;
    session.tick(1010);
    assert.deepEqual(calls, ["first", "second"]);
    session.stop();
    assert.throws(() => create().start({ maxFrameDelta: 0 }), RangeError);
  });
}
