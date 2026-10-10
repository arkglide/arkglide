(function (root) {
  "use strict";
  function createInputUI(options) {
    const win = options.window || window,
      doc = options.document || document,
      canvas = options.canvas,
      layer = options.layer,
      config = options.config || { actions: [], hud: [], captureInput: true };
    const keys = new Set(),
      codes = new Set(),
      virtual = new Map(),
      pressed = new Set(),
      released = new Set(),
      actionPressed = new Set(),
      actionReleased = new Set(),
      elements = new Map(),
      releases = [];
    let active = true,
      mouseDown = false,
      mousePressed = false,
      mouseReleased = false,
      mx = 0,
      my = 0,
      dx = 0,
      dy = 0,
      disposed = false;
    const upper = (k) => String(k || "").toUpperCase();
    const actionValue = (name) => {
      const a = config.actions.find((a) => a.name === name);
      if (!a) throw new Error("输入动作不存在: " + name);
      const touch = [...virtual.values()].filter((v) => v.name === name);
      return (
        Number(
          a.positive.some((k) => codes.has(k)) || touch.some((v) => v.sign > 0),
        ) -
        Number(
          a.negative.some((k) => codes.has(k)) || touch.some((v) => v.sign < 0),
        )
      );
    };
    function mutate(fn) {
      const before = new Map(
        config.actions.map((a) => [a.name, actionValue(a.name)]),
      );
      fn();
      for (const a of config.actions) {
        const old = before.get(a.name),
          v = actionValue(a.name);
        if (!old && v) actionPressed.add(a.name);
        if (old && !v) actionReleased.add(a.name);
      }
    }
    function listen(target, name, fn, opts) {
      target.addEventListener(name, fn, opts);
      releases.push(() => target.removeEventListener(name, fn, opts));
    }
    const interactive = (e) =>
      e.target?.closest?.("input,textarea,select,[contenteditable=true]");
    listen(win, "keydown", (e) => {
      if (!active || interactive(e)) return;
      mutate(() => {
        const k = upper(e.key);
        if (!keys.has(k)) pressed.add(k);
        keys.add(k);
        codes.add(e.code);
      });
      if (
        config.captureInput &&
        config.actions.some((a) =>
          [...a.positive, ...a.negative].includes(e.code),
        )
      )
        e.preventDefault();
    });
    listen(win, "keyup", (e) => {
      mutate(() => {
        const k = upper(e.key);
        if (keys.has(k)) released.add(k);
        keys.delete(k);
        codes.delete(e.code);
      });
    });
    listen(canvas, "pointerdown", (e) => {
      if (!active) return;
      mouseDown = true;
      mousePressed = true;
      mx = e.clientX;
      my = e.clientY;
      canvas.setPointerCapture?.(e.pointerId);
    });
    listen(win, "pointerup", () => {
      if (mouseDown) mouseReleased = true;
      mouseDown = false;
    });
    listen(win, "pointercancel", () => {
      mouseDown = false;
      mouseReleased = true;
    });
    listen(canvas, "pointermove", (e) => {
      if (!active) return;
      if (mouseDown) {
        dx += e.clientX - mx;
        dy += e.clientY - my;
      }
      mx = e.clientX;
      my = e.clientY;
    });
    function reset() {
      keys.clear();
      codes.clear();
      virtual.clear();
      pressed.clear();
      released.clear();
      actionPressed.clear();
      actionReleased.clear();
      mouseDown = mousePressed = mouseReleased = false;
      dx = dy = 0;
    }
    listen(win, "blur", reset);
    listen(doc, "visibilitychange", () => {
      if (doc.visibilityState === "hidden") reset();
    });
    const input = Object.freeze({
      isKeyDown: (k) => keys.has(upper(k)),
      wasKeyPressed: (k) => pressed.has(upper(k)),
      wasKeyReleased: (k) => released.has(upper(k)),
      getAxis: (a, b) =>
        Number(keys.has(upper(b))) - Number(keys.has(upper(a))),
      getMousePosition: () => ({ x: mx, y: my }),
      getMouseDelta: () => ({ x: dx, y: dy }),
      isMouseDown: () => mouseDown,
      wasMousePressed: () => mousePressed,
      wasMouseReleased: () => mouseReleased,
      getAction: actionValue,
      isActionDown: (n) => !!actionValue(n),
      wasActionPressed: (n) => {
        actionValue(n);
        return actionPressed.has(n);
      },
      wasActionReleased: (n) => {
        actionValue(n);
        return actionReleased.has(n);
      },
    });
    function create(def, owner, callback) {
      if (disposed || (owner && !owner.record.active))
        throw new Error("HUD session stopped");
      if (
        !def ||
        typeof def.id !== "string" ||
        !def.id ||
        elements.has(def.id) ||
        !["text", "button"].includes(def.kind)
      )
        throw new Error("HUD ID重复或配置无效");
      const el = doc.createElement(def.kind === "button" ? "button" : "div");
      el.dataset.hudId = def.id;
      el.textContent = String(def.text || "");
      el.style.cssText =
        "position:absolute;white-space:pre-wrap;border:0;border-radius:8px;padding:8px 12px;max-width:90%;font-family:system-ui,sans-serif;";
      const x = def.x ?? 5,
        y = def.y ?? 5,
        size = def.fontSize ?? 20;
      if (
        ![x, y, size].every(Number.isFinite) ||
        x < 0 ||
        x > 100 ||
        y < 0 ||
        y > 100 ||
        size < 8 ||
        size > 128
      )
        throw new Error("HUD位置/字号无效");
      const color = def.color || "#FFFFFF",
        bg = def.background || "#222222";
      if (!/^#[0-9a-f]{6}$/i.test(color) || !/^#[0-9a-f]{6}$/i.test(bg))
        throw new Error("HUD颜色无效");
      if (def.action) actionValue(def.action);
      Object.assign(el.style, {
        left: x + "%",
        top: y + "%",
        fontSize: size + "px",
        color,
        backgroundColor: bg,
        pointerEvents: def.kind === "button" ? "auto" : "none",
        touchAction: "none",
      });
      const localReleases = [],
        tokens = new Set();
      let live = true,
        untrack;
      function on(name, fn) {
        el.addEventListener(name, fn);
        localReleases.push(() => el.removeEventListener(name, fn));
      }
      if (def.kind === "button") {
        on("pointerdown", (e) => {
          if (!active) return;
          e.stopPropagation();
          e.preventDefault();
          el.setPointerCapture?.(e.pointerId);
          const token = def.id + ":" + e.pointerId;
          tokens.add(token);
          if (def.action)
            mutate(() =>
              virtual.set(token, {
                name: def.action,
                sign: def.direction === -1 ? -1 : 1,
              }),
            );
        });
        const end = (e) => {
          const token = def.id + ":" + e.pointerId;
          tokens.delete(token);
          mutate(() => virtual.delete(token));
        };
        on("pointerup", end);
        on("pointercancel", end);
        on("lostpointercapture", end);
        if (callback)
          on("click", () => {
            if (!active || (owner && !owner.record.active)) return;
            try {
              callback();
            } catch (error) {
              options.onError?.({
                file: owner?.record.file,
                entityId: owner?.record.entity?.id,
                hook: "ui.click",
                error,
              });
            }
          });
      }
      const handle = Object.freeze({
        id: def.id,
        get text() {
          return el.textContent;
        },
        setText(value) {
          if (!live) throw new Error("HUD destroyed");
          el.textContent = String(value);
        },
        setVisible(value) {
          if (!live) throw new Error("HUD destroyed");
          el.hidden = !value;
        },
        destroy() {
          if (!live) return;
          live = false;
          for (const fn of localReleases) fn();
          for (const token of tokens) mutate(() => virtual.delete(token));
          tokens.clear();
          elements.delete(def.id);
          el.remove();
          untrack?.();
        },
      });
      elements.set(def.id, handle);
      layer.appendChild(el);
      if (owner) untrack = owner.track(() => handle.destroy());
      return handle;
    }
    for (const d of config.hud || []) create(d);
    return {
      input,
      forOwner: (owner) =>
        Object.freeze({
          get: (id) => elements.get(id) || null,
          createText: (def) => create({ ...def, kind: "text" }, owner),
          createButton: (def, callback) =>
            create({ ...def, kind: "button" }, owner, callback),
        }),
      reset,
      setActive(v) {
        active = v;
        reset();
        for (const el of layer.querySelectorAll("button")) el.disabled = !v;
      },
      endFrame() {
        pressed.clear();
        released.clear();
        actionPressed.clear();
        actionReleased.clear();
        mousePressed = mouseReleased = false;
        dx = dy = 0;
      },
      stats: () => ({
        hudElements: elements.size,
        inputHeld: codes.size + virtual.size,
      }),
      dispose() {
        if (disposed) return;
        for (const h of [...elements.values()]) h.destroy();
        disposed = true;
        reset();
        for (const fn of releases) fn();
        layer.replaceChildren();
      },
    };
  }
  root.ArkGlideInputUI = { createInputUI };
})(globalThis);
