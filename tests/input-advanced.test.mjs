import test from "node:test";
import assert from "node:assert/strict";
import "../src/engine/input-ui-runtime.js";
import "../src/engine/lifecycle-runtime.js";
class Element {
  constructor(tag = "div") {
    this.tag = tag;
    this.listeners = new Map();
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.textContent = "";
  }
  addEventListener(n, f) {
    if (!this.listeners.has(n)) this.listeners.set(n, new Set());
    this.listeners.get(n).add(f);
  }
  removeEventListener(n, f) {
    this.listeners.get(n)?.delete(f);
  }
  emit(n, e = {}) {
    for (const f of [...(this.listeners.get(n) || [])])
      f({ target: this, preventDefault() {}, stopPropagation() {}, ...e });
  }
  appendChild(e) {
    e.parent = this;
    this.children.push(e);
  }
  replaceChildren() {
    this.children = [];
  }
  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter((e) => e !== this);
  }
  setPointerCapture() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 120, height: 120 };
  }
  focus() {
    this.emit("focus");
  }
  closest() {
    return this.tag === "input" ? this : null;
  }
}
function fixture(hud = []) {
  const window = new Element(),
    document = new Element(),
    canvas = new Element(),
    layer = new Element(),
    session = ArkGlideLifecycle.createSession(),
    owner = session.owner(null, "ui-test");
  document.createElement = (tag) => new Element(tag);
  document.createTextNode = (text) => ({ textContent: text });
  document.visibilityState = "visible";
  const pads = [];
  window.navigator = { getGamepads: () => pads };
  const actions = [
    {
      name: "moveX",
      positive: ["KeyD"],
      negative: ["KeyA"],
      gamepad: [{ kind: "axis", index: 0, direction: 1, deadzone: 0.2 }],
    },
    { name: "moveY", positive: ["KeyW"], negative: ["KeyS"] },
    {
      name: "jump",
      positive: ["Space"],
      negative: [],
      gamepad: [{ kind: "button", index: 0, direction: 1, deadzone: 0.1 }],
    },
  ];
  const ui = ArkGlideInputUI.createInputUI({
    window,
    document,
    canvas,
    layer,
    config: { actions, hud, captureInput: true },
  });
  return {
    window,
    document,
    canvas,
    layer,
    session,
    owner,
    ui,
    pads,
    done() {
      ui.dispose();
      session.stop();
    },
  };
}
const def = (id, kind = "button", extra = {}) => ({
  id,
  kind,
  text: id,
  x: 5,
  y: 5,
  fontSize: 20,
  color: "#FFFFFF",
  background: "#222222",
  ...extra,
});
test("gamepad deadzones, opposing keyboard input, disconnect and zero-time reset; remap conflicts and defaults", () => {
  const t = fixture();
  try {
    t.pads.push({
      index: 0,
      id: "stub hardware",
      connected: true,
      axes: [0.6],
      buttons: [{ value: 0, pressed: false }],
    });
    t.ui.beginFrame();
    assert.ok(Math.abs(t.ui.input.getAction("moveX") - 0.5) < 1e-9);
    t.window.emit("keydown", { key: "a", code: "KeyA" });
    assert.ok(Math.abs(t.ui.input.getAction("moveX") + 0.5) < 1e-9);
    t.ui.setSimulationActive(false);
    assert.equal(t.ui.input.getAction("moveX"), 0);
    t.ui.setSimulationActive(true);
    t.pads.length = 0;
    t.ui.beginFrame();
    assert.equal(t.ui.input.getAction("moveX"), 0);
    const result = t.ui.input.rebind("moveX", { positive: ["Space"] });
    assert.equal(result.applied, false);
    assert.equal(result.conflicts[0].action, "jump");
    assert.equal(
      t.ui.input.rebind("moveX", { positive: ["KeyL"] }).applied,
      true,
    );
    t.window.emit("keydown", { key: "l", code: "KeyL" });
    assert.equal(t.ui.input.getAction("moveX"), 1);
    t.ui.input.resetBindings("moveX");
    assert.deepEqual(t.ui.input.bindings()[0].positive, ["KeyD"]);
    t.window.emit("blur");
    assert.equal(t.ui.stats().inputHeld, 0);
  } finally {
    t.done();
  }
});
test("hierarchy, owner subscriptions, disabled release and paused keyboard/gamepad menu activation", () => {
  const t = fixture([
    def("child", "button", { parentId: "parent", action: "jump" }),
    def("parent", "container", { width: 80, height: 80 }),
    def("next", "button", { tabIndex: 1 }),
  ]);
  try {
    const api = t.ui.forOwner(t.owner),
      events = [];
    api.get("child").on("click", (e) => events.push(e.type));
    const child = t.layer.children[0].children[0];
    child.emit("pointerdown", { pointerId: 1 });
    assert.equal(t.ui.input.getAction("jump"), 1);
    api.get("child").setDisabled(true);
    assert.equal(t.ui.input.getAction("jump"), 0);
    api.get("child").setDisabled(false);
    t.ui.setActive(false);
    t.window.emit("keydown", { code: "Tab", key: "Tab" });
    t.window.emit("keydown", { code: "Enter", key: "Enter" });
    assert.deepEqual(events, ["click"]);
    t.pads.push({
      index: 0,
      id: "stub",
      axes: [],
      buttons: [{ value: 1, pressed: true }],
    });
    t.ui.beginFrame();
    assert.deepEqual(events, ["click", "click"]);
    t.ui.beginFrame();
    assert.equal(events.length, 2);
    assert.equal(t.ui.input.getAction("jump"), 0);
    t.owner.abort();
    assert.equal(t.ui.stats().uiSubscriptions, 0);
    assert.throws(() => api.get("parent"), /已销毁/);
    const fresh = t.ui.forOwner(t.session.owner(null, "fresh"));
    fresh.get("parent").destroy();
    assert.equal(fresh.get("child"), null);
  } finally {
    t.done();
  }
});
test("multi-touch joystick has radial deadzone and independent button ownership; cancellation and resize clear both axes", () => {
  const t = fixture([
    def("stick", "joystick", {
      joystick: {
        mode: "fixed",
        radius: 60,
        deadzone: 0.2,
        actionX: "moveX",
        actionY: "moveY",
      },
    }),
    def("jump", "button", { action: "jump" }),
  ]);
  try {
    const [stick, button] = t.layer.children;
    stick.emit("pointerdown", { pointerId: 1, clientX: 60, clientY: 60 });
    stick.emit("pointermove", { pointerId: 1, clientX: 90, clientY: 60 });
    assert.ok(Math.abs(t.ui.input.getAction("moveX") - 0.375) < 1e-9);
    button.emit("pointerdown", { pointerId: 2 });
    assert.equal(t.ui.input.getAction("jump"), 1);
    stick.emit("pointercancel", { pointerId: 1 });
    assert.equal(t.ui.input.getAction("moveX"), 0);
    assert.equal(t.ui.input.getAction("jump"), 1);
    t.window.emit("resize");
    assert.equal(t.ui.stats().inputHeld, 0);
    button.emit("pointerup", { pointerId: 2 });
    assert.equal(t.ui.input.getAction("jump"), 0);
  } finally {
    t.done();
  }
});
test("rich text only creates allowlisted DOM elements and preserves untrusted markup as text", () => {
  const t = fixture([
    def("rich", "richtext", {
      text: "[b]Safe[/b]<img src=x onerror=alert(1)>[color=#FF0000]Red[/color]",
    }),
  ]);
  try {
    const el = t.layer.children[0];
    assert.equal(el.children[0].tag, "strong");
    assert.equal(el.children[1].textContent, "<img src=x onerror=alert(1)>");
    assert.equal(el.children[2].tag, "span");
    assert.equal(el.children[2].style.color, "#FF0000");
  } finally {
    t.done();
  }
});
test("floating joystick follows the touch origin, hiding a parent releases descendants, owned rebind capture cancels", async () => {
  const t = fixture([
    def("panel", "container"),
    def("touch", "button", { parentId: "panel", action: "jump" }),
    def("float", "joystick", {
      joystick: {
        mode: "floating",
        radius: 60,
        deadzone: 0.1,
        actionX: "moveX",
        actionY: "moveY",
      },
    }),
  ]);
  try {
    const api = t.ui.forOwner(t.owner),
      [panel, stick] = t.layer.children;
    panel.children[0].emit("pointerdown", { pointerId: 2 });
    assert.equal(t.ui.input.getAction("jump"), 1);
    api.get("panel").setVisible(false);
    assert.equal(t.ui.input.getAction("jump"), 0);
    assert.equal(panel.style.display, "none");
    stick.emit("pointerdown", { pointerId: 1, clientX: 80, clientY: 30 });
    assert.equal(stick.children[0].style.left, "80px");
    assert.equal(stick.children[0].style.top, "30px");
    assert.equal(stick.children[0].style.display, "block");
    stick.emit("pointerup", { pointerId: 1 });
    assert.equal(stick.children[0].style.display, "none");
    const pending = t.ui.inputForOwner(t.owner).captureBinding("jump");
    assert.equal(t.ui.stats().inputCaptures, 1);
    t.owner.abort();
    assert.equal((await pending).cancelled, true);
    assert.equal(t.ui.stats().inputCaptures, 0);
  } finally {
    t.done();
  }
});

test("window blur clears menu blockers and unfocused gamepad polling cannot activate menus", () => {
  const t = fixture([def("menu")]);
  try {
    let hasFocus = true;
    t.document.hasFocus = () => hasFocus;
    let clicks = 0;
    t.ui.forOwner(t.owner).get("menu").on("click", () => clicks++);
    t.layer.children[0].focus();
    hasFocus = false;
    t.window.emit("blur");
    t.ui.setActive(false);
    t.pads.push({ index: 0, id: "stub", axes: [], buttons: [
      { value: 1, pressed: true },
      ...Array.from({ length: 11 }, () => ({ value: 0, pressed: false })),
      { value: 1, pressed: true },
    ] });
    t.ui.beginFrame();
    t.pads[0].buttons[0] = { value: 0, pressed: false };
    t.ui.beginFrame();
    t.pads[0].buttons[0] = { value: 1, pressed: true };
    t.ui.beginFrame();
    assert.equal(clicks, 0);
    t.pads.length = 0;
    hasFocus = true;
    t.ui.setActive(true);
    t.window.emit("keydown", { key: "d", code: "KeyD" });
    assert.equal(t.ui.input.getAction("moveX"), 1);
    assert.equal(t.layer.children[0].style.outline, "");
  } finally {
    t.done();
  }
});

test("reverse menu navigation starts at the last item and Shift+Tab moves backwards", () => {
  const t = fixture([
    def("first", "button", { tabIndex: 0 }),
    def("hidden", "button", { tabIndex: 1, visible: false }),
    def("disabled", "button", { tabIndex: 2, disabled: true }),
    def("middle", "button", { tabIndex: 3 }),
    def("last", "button", { tabIndex: 4 }),
  ]);
  try {
    const clicks = [];
    const api = t.ui.forOwner(t.owner);
    for (const id of ["first", "middle", "last"])
      api.get(id).on("click", () => clicks.push(id));
    t.ui.setActive(false);
    t.window.emit("keydown", { code: "ArrowUp", key: "ArrowUp" });
    t.window.emit("keydown", { code: "Enter", key: "Enter" });
    assert.deepEqual(clicks, ["last"]);
    t.window.emit("keydown", { code: "Tab", key: "Tab", shiftKey: true });
    t.window.emit("keydown", { code: "Enter", key: "Enter" });
    assert.deepEqual(clicks, ["last", "middle"]);
    t.window.emit("keydown", { code: "Tab", key: "Tab", shiftKey: true });
    t.window.emit("keydown", { code: "Enter", key: "Enter" });
    assert.deepEqual(clicks, ["last", "middle", "first"]);
    t.window.emit("keydown", { code: "Tab", key: "Tab", shiftKey: true });
    t.window.emit("keydown", { code: "Enter", key: "Enter" });
    assert.deepEqual(clicks, ["last", "middle", "first", "last"]);
  } finally {
    t.done();
  }
});

test("invalid captured bindings reject promptly without escaping the keyboard handler", async () => {
  const t = fixture();
  try {
    const capture = t.ui.inputForOwner(t.owner).captureBinding("moveX");
    const rejected = assert.rejects(capture, /正反方向/);
    assert.doesNotThrow(() =>
      t.window.emit("keydown", { code: "KeyA", key: "a" }),
    );
    await rejected;
    assert.equal(t.ui.stats().inputCaptures, 0);
    assert.deepEqual(t.ui.input.bindings()[0].positive, ["KeyD"]);
    const next = t.ui.input.captureBinding("moveX");
    t.window.emit("keydown", { code: "KeyL", key: "l" });
    assert.equal((await next).applied, true);
  } finally {
    t.done();
  }
});

test("UI subscriptions canceled inside a callback do not fire in the same dispatch", () => {
  const t = fixture([def("button")]);
  try {
    const handle = t.ui.forOwner(t.owner).get("button");
    let cancel, called = 0;
    handle.on("click", () => cancel());
    cancel = handle.on("click", () => called++);
    t.layer.children[0].emit("click");
    assert.equal(called, 0);
    t.layer.children[0].emit("click");
    assert.equal(called, 0);
  } finally {
    t.done();
  }
});

test("hiding a UI element inside an event prevents subsequent callbacks until shown", () => {
  const t = fixture([def("button")]);
  try {
    const handle = t.ui.forOwner(t.owner).get("button");
    let called = 0;
    const cancelHide = handle.on("click", () => handle.setVisible(false));
    handle.on("click", () => called++);
    t.layer.children[0].emit("click");
    assert.equal(called, 0);
    cancelHide();
    handle.setVisible(true);
    t.layer.children[0].emit("click");
    assert.equal(called, 1);
  } finally {
    t.done();
  }
});

test("invalid button callbacks fail without leaving window listeners or HUD elements", () => {
  const t = fixture();
  try {
    const count = () => [...t.window.listeners.values()].reduce((n, list) => n + list.size, 0);
    const before = count();
    assert.throws(() => t.ui.forOwner(t.owner).createButton(def("invalid"), 42), /回调|订阅无效/);
    assert.equal(count(), before);
    assert.equal(t.layer.children.length, 0);
    const button = t.ui.forOwner(t.owner).createButton(def("valid"), () => {});
    assert.equal(t.layer.children.length, 1);
    button.destroy();
    assert.equal(count(), before);
  } finally {
    t.done();
  }
});

test("key release follows the original physical key when modifiers change its character", () => {
  const t = fixture();
  try {
    t.window.emit("keydown", { key: "!", code: "Digit1" });
    assert.equal(t.ui.input.isKeyDown("!"), true);
    t.window.emit("keyup", { key: "1", code: "Digit1" });
    assert.equal(t.ui.input.isKeyDown("!"), false);
    assert.equal(t.ui.input.wasKeyReleased("!"), true);
    t.ui.endFrame();
    t.window.emit("keydown", { key: "1", code: "Digit1" });
    t.window.emit("keydown", { key: "!", code: "Digit1", repeat: true });
    t.window.emit("keyup", { key: "!", code: "Digit1" });
    assert.equal(t.ui.input.isKeyDown("1"), false);
    assert.equal(t.ui.input.isKeyDown("!"), false);
  } finally {
    t.done();
  }
});

test("releasing one of two physical modifier keys leaves the other held", () => {
  const t = fixture();
  try {
    t.window.emit("keydown", { key: "Shift", code: "ShiftLeft" });
    t.window.emit("keydown", { key: "Shift", code: "ShiftRight" });
    t.ui.endFrame();
    t.window.emit("keyup", { key: "Shift", code: "ShiftLeft" });
    assert.equal(t.ui.input.isKeyDown("Shift"), true);
    assert.equal(t.ui.input.wasKeyReleased("Shift"), false);
    t.window.emit("keyup", { key: "Shift", code: "ShiftRight" });
    assert.equal(t.ui.input.isKeyDown("Shift"), false);
    assert.equal(t.ui.input.wasKeyReleased("Shift"), true);
  } finally {
    t.done();
  }
});

test("keyboard reset clears physical-key associations while action mappings retain their edges", () => {
  const t = fixture();
  try {
    t.window.emit("keydown", { key: "d", code: "KeyD" });
    assert.equal(t.ui.input.getAction("moveX"), 1);
    assert.equal(t.ui.input.wasActionPressed("moveX"), true);
    t.ui.endFrame();
    t.window.emit("keyup", { key: "D", code: "KeyD" });
    assert.equal(t.ui.input.getAction("moveX"), 0);
    assert.equal(t.ui.input.wasActionReleased("moveX"), true);
    t.window.emit("keydown", { key: "!", code: "Digit1" });
    t.ui.reset();
    t.window.emit("keydown", { key: "1", code: "Digit1" });
    assert.equal(t.ui.input.isKeyDown("1"), true);
    assert.equal(t.ui.input.isKeyDown("!"), false);
    t.window.emit("keyup", { key: "1", code: "Digit1" });
    assert.equal(t.ui.input.isKeyDown("1"), false);
  } finally {
    t.done();
  }
});

test("blocking HUD interaction releases mouse state and pending mouse movement", () => {
  const t = fixture([def("menu", "button", { blockInput: true })]);
  try {
    t.canvas.emit("pointerdown", { pointerId: 1, clientX: 0, clientY: 0 });
    t.canvas.emit("pointermove", { pointerId: 1, clientX: 10, clientY: 5 });
    assert.equal(t.ui.input.isMouseDown(), true);
    t.layer.children[0].emit("pointerdown", { pointerId: 2 });
    assert.equal(t.ui.input.isMouseDown(), false);
    assert.equal(t.ui.input.wasMousePressed(), false);
    assert.deepEqual(t.ui.input.getMouseDelta(), { x: 0, y: 0 });
    t.layer.children[0].emit("pointerup", { pointerId: 2 });
    assert.equal(t.ui.input.isMouseDown(), false);
  } finally {
    t.done();
  }
});
