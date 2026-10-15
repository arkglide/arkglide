import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
const awaitSource = (name) =>
  readFileSync(new URL("../public/" + name, import.meta.url), "utf8");
import vm from "node:vm";

const source = await fs.readFile(
  new URL("../public/standalone-player.js", import.meta.url),
  "utf8",
);
function player(options = {}) {
  const events = new Map(),
    documentEvents = new Map(),
    elements = new Map(),
    frames = [],
    messages = [];
  const element = () => ({
    style: {},
    addEventListener() {},
    getBoundingClientRect() {
      return { width: 1280, height: 720 };
    },
  });
  const document = {
    currentScript: { src: "http://localhost/game/standalone-player.js" },
    body: { dataset: {} },
    hidden: false,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    addEventListener(type, callback) {
      documentEvents.set(type, callback);
    },
    createElement() {
      const frame = {
        ...element(),
        setAttribute() {},
        focus() {},
        remove() {
          frame.removed = true;
        },
        contentWindow: {
          postMessage(msg) {
            messages.push(msg);
          },
        },
      };
      frames.push(frame);
      return frame;
    },
  };
  document.getElementById("stage").append = () => {};
  const project = new TextEncoder().encode("{}");
  const manifest = {
    format: "arkglide-static-2",
    settings: {
      title: "Game",
      fit: "responsive",
      loadTimeout: 120000,
      concurrency: 4,
      logLimit: 200,
    },
    boot: {
      path: "boot/" + "a".repeat(64) + ".agb",
      byteLength: 8,
      hash: "a".repeat(64),
    },
    runtime: [],
  };
  const context = vm.createContext({
    document,
    URL,
    AbortController,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    Map,
    Set,
    Promise,
    crypto: { randomUUID: () => "test-token" },
    location: { protocol: "http:" },
    setTimeout,
    clearTimeout,
    ResizeObserver: class {
      observe() {}
    },
    fetch: async (url) => {
      await options.beforeRead?.(url);
      return {
        ok: true,
        arrayBuffer: async () =>
          url.pathname.endsWith("game-manifest.json")
            ? new TextEncoder().encode(JSON.stringify(manifest)).buffer
            : project.buffer,
      };
    },
    addEventListener(type, callback) {
      events.set(type, callback);
    },
  });
  context.window = context;
  vm.runInContext(awaitSource("arkglide-state.js"), context);
  vm.runInContext(awaitSource("arkglide-storage-host.js"), context);
  vm.runInContext(source, context);
  const send = (msg) =>
    events.get("message")({
      source: frames.at(-1).contentWindow,
      data: { bootToken: "test-token", ...msg },
    });
  return {
    api: context.ArkGlidePlayer,
    document,
    frames,
    messages,
    send,
    visibility() {
      documentEvents.get("visibilitychange")();
    },
  };
}
test("concurrent stop callers wait for runtime cleanup", async () => {
  const p = player();
  await p.api.start();
  p.send({ type: "ready" });
  p.send({ type: "started" });
  const first = p.api.stop(),
    second = p.api.stop();
  let resolved = false;
  second.then(() => {
    resolved = true;
  });
  await Promise.resolve();
  assert.equal(resolved, false);
  p.send({ type: "telemetry", stats: { state: "stopped" } });
  await Promise.all([first, second]);
  assert.equal(p.api.state, "stopped");
  assert.equal(p.frames[0].removed, true);
});
test("hiding the page while resume is pending pauses after the runtime acknowledges", async () => {
  const p = player();
  await p.api.start();
  p.send({ type: "ready" });
  p.send({ type: "started" });
  p.api.pause();
  p.send({ type: "telemetry", stats: { state: "paused" } });
  p.api.pause();
  assert.equal(p.api.state, "resuming");
  p.document.hidden = true;
  p.visibility();
  p.send({ type: "telemetry", stats: { state: "playing" } });
  assert.equal(p.api.state, "pausing");
  assert.equal(p.messages.at(-1).type, "pause");
  p.send({ type: "telemetry", stats: { state: "paused" } });
  assert.equal(p.api.hiddenPause, true);
  const stopped = p.api.stop();
  p.send({ type: "telemetry", stats: { state: "stopped" } });
  await stopped;
});

test("stopping a pending manifest read rejects a late bootstrap without creating an iframe", async () => {
  let release, reached;
  const gate = new Promise((r) => (release = r)),
    requested = new Promise((r) => (reached = r));
  const p = player({
    beforeRead: async () => {
      reached();
      await gate;
    },
  });
  await requested;
  const start = p.api.start();
  await p.api.stop();
  assert.equal(p.api.state, "stopped");
  release();
  await start;
  assert.equal(p.frames.length, 0);
  assert.equal(p.api.state, "stopped");
  await p.api.start();
  assert.equal(p.api.state, "initializing");
  const stopped = p.api.stop();
  p.send({ type: "telemetry", stats: { state: "stopped" } });
  await stopped;
});
