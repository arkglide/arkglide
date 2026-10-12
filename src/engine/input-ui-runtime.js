(function (root) {
  "use strict";
  // Rich text is parsed into DOM nodes. Project text never becomes HTML.
  function richText(doc, el, text) {
    el.replaceChildren();
    const stack = [{ el, tag: "" }],
      tokens = String(text).split(/(\[\/?(?:b|i|color(?:=#[0-9a-f]{6})?)\])/gi);
    for (const token of tokens) {
      const open = /^\[(b|i|color=#[0-9a-f]{6})\]$/i.exec(token),
        close = /^\[\/(b|i|color)\]$/i.exec(token);
      if (open) {
        const tag = open[1].split("=")[0].toLowerCase(),
          node = doc.createElement(
            tag === "color" ? "span" : tag === "b" ? "strong" : "em",
          );
        if (tag === "color") node.style.color = open[1].split("=")[1];
        stack.at(-1).el.appendChild(node);
        stack.push({ el: node, tag });
      } else if (
        close &&
        stack.length > 1 &&
        stack.at(-1).tag === close[1].toLowerCase()
      )
        stack.pop();
      else if (token) stack.at(-1).el.appendChild(doc.createTextNode(token));
    }
  }
  function layoutStyle(d, parent) {
    const unit = d.unit === "px" ? "px" : "%",
      flow = parent && parent.layout && parent.layout !== "absolute";
    return {
      position: flow ? "relative" : "absolute",
      left: flow ? "" : (d.x ?? 5) + unit,
      top: flow ? "" : (d.y ?? 5) + unit,
      width: d.width === undefined ? "" : d.width + unit,
      height: d.height === undefined ? "" : d.height + unit,
      transform: flow
        ? ""
        : `translate(${-(d.anchorX || 0) * 100}%,${-(d.anchorY || 0) * 100}%)`,
      margin: (d.margin || 0) + "px",
      gap: (d.gap || 0) + "px",
      display:
        d.layout === "row" || d.layout === "column"
          ? "flex"
          : d.layout === "grid"
            ? "grid"
            : "block",
      flexDirection: d.layout === "column" ? "column" : "row",
      gridTemplateColumns: `repeat(${d.columns || 2},minmax(0,1fr))`,
      zIndex: String(d.zIndex || 0),
      fontSize: (d.fontSize || 20) + "px",
      color: d.color || "#FFFFFF",
      backgroundColor: d.background || "#222222",
      boxSizing: "border-box",
      pointerEvents:
        d.blockInput || ["button", "input", "joystick"].includes(d.kind)
          ? "auto"
          : "none",
      touchAction: "none",
      whiteSpace: "pre-wrap",
      flexShrink: "0",
    };
  }
  function createInputUI(options) {
    const win = options.window || window,
      doc = options.document || document,
      canvas = options.canvas,
      layer = options.layer,
      config = structuredClone(
        options.config || { actions: [], hud: [], captureInput: true },
      );
    const defaults = structuredClone(config.defaults || config.actions),
      keys = new Set(),
      codes = new Set(),
      virtual = new Map(),
      padValues = new Map(),
      pressed = new Set(),
      released = new Set(),
      actionPressed = new Set(),
      actionReleased = new Set(),
      elements = new Map(),
      releases = [],
      urls = new Set(),
      blockers = new Set();
    let active = true,
      simulation = true,
      disposed = false,
      mouseDown = false,
      mousePressed = false,
      mouseReleased = false,
      mx = 0,
      my = 0,
      dx = 0,
      dy = 0,
      focused = null,
      padButtons = new Set(),
      padList = [],
      binding = null;
    const upper = (k) => String(k || "").toUpperCase(),
      allow = () =>
        active &&
        simulation &&
        !blockers.size &&
        (doc.hasFocus?.() ?? true) &&
        doc.visibilityState !== "hidden";
    function action(name) {
      const a = config.actions.find((a) => a.name === name);
      if (!a) throw Error("输入动作不存在: " + name);
      return a;
    }
    function actionValue(name) {
      const a = action(name);
      if (!allow()) return 0;
      let pos = Number(a.positive.some((k) => codes.has(k))),
        neg = Number(a.negative.some((k) => codes.has(k)));
      for (const v of virtual.values())
        if (v.name === name) {
          pos = Math.max(pos, v.value);
          neg = Math.max(neg, -v.value);
        }
      for (const v of padValues.get(name) || []) {
        pos = Math.max(pos, v);
        neg = Math.max(neg, -v);
      }
      return Math.max(0, pos) - Math.max(0, neg);
    }
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
    function listen(target, name, fn, opts, list = releases) {
      target.addEventListener(name, fn, opts);
      list.push(() => target.removeEventListener(name, fn, opts));
    }
    function reset() {
      keys.clear();
      codes.clear();
      virtual.clear();
      padValues.clear();
      pressed.clear();
      released.clear();
      actionPressed.clear();
      actionReleased.clear();
      mouseDown = mousePressed = mouseReleased = false;
      dx = dy = 0;
      blockers.clear();
      for (const r of elements.values()) r.reset();
      if (focused) blockers.add(focused.def.id);
    }
    function report(error, owner, hook = "ui.event") {
      options.onError?.({
        file: owner?.record.file,
        entityId: owner?.record.entity?.id,
        hook,
        error,
      });
    }
    function conflicts(name, positive, negative, gamepad = []) {
      action(name);
      const found = [];
      for (const a of config.actions) {
        if (a.name === name) continue;
        for (const code of [...positive, ...negative])
          if ([...a.positive, ...a.negative].includes(code))
            found.push({ action: a.name, kind: "key", code });
        for (const b of gamepad)
          if (
            (a.gamepad || []).some(
              (v) =>
                v.kind === b.kind &&
                v.index === b.index &&
                v.direction === b.direction,
            )
          )
            found.push({ action: a.name, kind: b.kind, index: b.index });
      }
      return found;
    }
    function rebind(name, map, acceptConflicts = false) {
      const a = action(name),
        next = { ...a, ...structuredClone(map) };
      if (
        !["positive", "negative"].every(
          (k) =>
            Array.isArray(next[k]) &&
            next[k].length <= 64 &&
            next[k].every(
              (v) =>
                typeof v === "string" && /^[A-Za-z][A-Za-z0-9]{0,49}$/.test(v),
            ),
        )
      )
        throw Error("无效按键映射");
      if (next.positive.some((k) => next.negative.includes(k)))
        throw Error("同一动作的正反方向不能绑定同一键");
      if (
        !Array.isArray(next.gamepad || []) ||
        (next.gamepad || []).some(
          (b) =>
            !["axis", "button"].includes(b.kind) ||
            !Number.isInteger(b.index) ||
            b.index < 0 ||
            b.index > 63 ||
            ![1, -1].includes(b.direction) ||
            !Number.isFinite(b.deadzone) ||
            b.deadzone < 0 ||
            b.deadzone > 0.95,
        )
      )
        throw Error("无效手柄映射");
      const found = conflicts(name, next.positive, next.negative, next.gamepad);
      if (found.length && !acceptConflicts)
        return { applied: false, conflicts: found };
      reset();
      Object.assign(a, next);
      options.onBindingsChange?.(structuredClone(config.actions));
      return { applied: true, conflicts: found };
    }
    function enabled(r) {
      for (let i = 0; r && i < 256; i++, r = elements.get(r.def.parentId)) {
        if (r.def.disabled || r.def.visible === false) return false;
      }
      return true;
    }
    function clearTree(id) {
      const ids = new Set([id]);
      for (let i = 0; i < elements.size; i++)
        for (const r of elements.values())
          if (ids.has(r.def.parentId)) ids.add(r.def.id);
      for (const id of ids) elements.get(id)?.reset();
      if (focused && ids.has(focused.def.id)) {
        focused.el.blur?.();
        focused = null;
      }
    }
    function navigable() {
      return [...elements.values()]
        .filter(
          (r) =>
            enabled(r) &&
            (r.def.tabIndex ?? 0) >= 0 &&
            ["button", "input"].includes(r.def.kind),
        )
        .sort((a, b) => (a.def.tabIndex || 0) - (b.def.tabIndex || 0));
    }
    function navigate(direction) {
      const list = navigable();
      if (!list.length) return;
      let index = list.findIndex((r) => r === focused);
      index =
        index < 0
          ? (direction < 0 ? list.length - 1 : 0)
          : (index + direction + list.length) % list.length;
      list[index].el.focus?.();
      focused = list[index];
    }
    function menuKey(code, shiftKey = false) {
      if (["ArrowDown", "ArrowRight", "Tab"].includes(code)) {
        navigate(code === "Tab" && shiftKey ? -1 : 1);
        return true;
      }
      if (["ArrowUp", "ArrowLeft"].includes(code)) {
        navigate(-1);
        return true;
      }
      if (["Enter", "Space"].includes(code) && focused?.def.kind === "button") {
        focused.emit("click");
        return true;
      }
      return false;
    }
    const interactive = (e) =>
      e.target?.closest?.("input,textarea,select,[contenteditable=true]");
    listen(win, "keydown", (e) => {
      if (binding) {
        e.preventDefault();
        if (e.code === "Escape") {
          binding.finish(null);
          return;
        }
        binding.finish(e.code);
        return;
      }
      const menu = !!focused || !active || !simulation;
      if (menu && !interactive(e) && !e.repeat && menuKey(e.code, e.shiftKey)) {
        e.preventDefault();
        return;
      }
      if (!allow() || interactive(e)) return;
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
      if (!allow()) return;
      mouseDown = mousePressed = true;
      mx = e.clientX;
      my = e.clientY;
      try {
        canvas.setPointerCapture?.(e.pointerId);
      } catch {}
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
      if (!allow()) return;
      if (mouseDown) {
        dx += e.clientX - mx;
        dy += e.clientY - my;
      }
      mx = e.clientX;
      my = e.clientY;
    });
    listen(win, "blur", () => {
      if (focused) focused.el.style.outline = "";
      focused = null;
      reset();
      padButtons.clear();
      binding?.finish(null);
    });
    listen(win, "resize", reset);
    listen(win, "gamepaddisconnected", () => {
      reset();
      padButtons.clear();
    });
    listen(win, "gamepadconnected", () => {
      padButtons.clear();
    });
    listen(doc, "visibilitychange", () => {
      if (doc.visibilityState === "hidden") {
        reset();
        padButtons.clear();
        binding?.finish(null);
      }
    });
    function beginFrame() {
      if (disposed || doc.visibilityState === "hidden") {
        padList = [];
        return;
      }
      const pads = Array.from(
        (options.navigator || win.navigator)?.getGamepads?.() || [],
      ).filter((p) => p && p.connected !== false);
      padList = pads.map((p) => ({
        index: p.index,
        id: p.id,
        mapping: p.mapping,
      }));
      const nextButtons = new Set();
      for (const p of pads)
        for (let i = 0; i < p.buttons.length; i++)
          if (p.buttons[i]?.pressed || p.buttons[i]?.value > 0.5)
            nextButtons.add(p.index + ":" + i);
      if (
        (doc.hasFocus?.() ?? true) &&
        !binding &&
        (focused || !active || !simulation)
      ) {
        for (const key of nextButtons)
          if (!padButtons.has(key)) {
            const i = Number(key.split(":")[1]);
            if (i === 12 || i === 14) navigate(-1);
            if (i === 13 || i === 15) navigate(1);
            if (i === 0 && focused?.def.kind === "button")
              focused.emit("click");
          }
      }
      padButtons = nextButtons;
      mutate(() => {
        padValues.clear();
        if (!allow() || doc.visibilityState === "hidden") return;
        for (const a of config.actions) {
          const values = [];
          for (const p of pads)
            for (const b of a.gamepad || []) {
              const raw =
                b.kind === "axis"
                  ? p.axes[b.index] || 0
                  : (p.buttons[b.index]?.value ??
                    Number(!!p.buttons[b.index]?.pressed));
              if (!Number.isFinite(raw)) continue;
              const magnitude = Math.max(
                0,
                Math.min(1, (Math.abs(raw) - b.deadzone) / (1 - b.deadzone)),
              );
              values.push(
                b.kind === "axis"
                  ? Math.sign(raw) * magnitude * b.direction
                  : magnitude * b.direction,
              );
            }
          padValues.set(a.name, values);
        }
      });
    }
    const input = Object.freeze({
      isKeyDown: (k) => allow() && keys.has(upper(k)),
      wasKeyPressed: (k) => allow() && pressed.has(upper(k)),
      wasKeyReleased: (k) => released.has(upper(k)),
      getAxis: (a, b) =>
        allow() ? Number(keys.has(upper(b))) - Number(keys.has(upper(a))) : 0,
      getMousePosition: () => ({ x: mx, y: my }),
      getMouseDelta: () => ({ x: dx, y: dy }),
      isMouseDown: () => mouseDown,
      wasMousePressed: () => mousePressed,
      wasMouseReleased: () => mouseReleased,
      getAction: actionValue,
      isActionDown: (n) => !!actionValue(n),
      wasActionPressed: (n) => {
        action(n);
        return actionPressed.has(n);
      },
      wasActionReleased: (n) => {
        action(n);
        return actionReleased.has(n);
      },
      gamepads: () => structuredClone(padList),
      bindings: () => structuredClone(config.actions),
      rebind,
      resetBindings(name) {
        reset();
        for (const a of config.actions) {
          if (name && a.name !== name) continue;
          const d = defaults.find((v) => v.name === a.name);
          if (d) {
            a.positive = [...d.positive];
            a.negative = [...d.negative];
            a.gamepad = structuredClone(d.gamepad || []);
          }
        }
        options.onBindingsChange?.(structuredClone(config.actions));
      },
      captureBinding(name, direction = "positive") {
        action(name);
        if (!["positive", "negative"].includes(direction) || binding)
          throw Error("重绑捕获正在进行或方向无效");
        reset();
        return new Promise((resolve) => {
          binding = {
            finish(code) {
              binding = null;
              resolve(
                code
                  ? { code, ...rebind(name, { [direction]: [code] }) }
                  : { applied: false, cancelled: true },
              );
            },
          };
        });
      },
    });
    function create(def, owner, callback) {
      if (disposed || (owner && !owner.record.active))
        throw Error("HUD session stopped");
      if (
        !def ||
        typeof def.id !== "string" ||
        !def.id ||
        ["__proto__", "constructor", "prototype"].includes(def.id) ||
        elements.has(def.id) ||
        ![
          "text",
          "button",
          "container",
          "image",
          "richtext",
          "input",
          "joystick",
        ].includes(def.kind)
      )
        throw Error("HUD ID重复或配置无效");
      def = structuredClone({
        text: "",
        x: 5,
        y: 5,
        color: "#FFFFFF",
        background: "#222222",
        fontSize: 20,
        ...def,
      });
      const parent = def.parentId ? elements.get(def.parentId) : null;
      if (def.parentId && !parent) throw Error("HUD父节点不存在");
      if (
        ![def.x, def.y, def.fontSize].every(Number.isFinite) ||
        def.x < 0 ||
        def.y < 0 ||
        def.x > (def.unit === "px" ? 10000 : 100) ||
        def.y > (def.unit === "px" ? 10000 : 100) ||
        def.fontSize < 8 ||
        def.fontSize > 128 ||
        !/^#[0-9a-f]{6}$/i.test(def.color) ||
        !/^#[0-9a-f]{6}$/i.test(def.background)
      )
        throw Error("HUD位置/字号/颜色无效");
      if (def.action) action(def.action);
      if (def.kind === "joystick") {
        const j = def.joystick;
        if (
          !j ||
          !["fixed", "floating"].includes(j.mode) ||
          !Number.isFinite(j.radius) ||
          j.radius < 16 ||
          j.radius > 500 ||
          !Number.isFinite(j.deadzone) ||
          j.deadzone < 0 ||
          j.deadzone > 0.95
        )
          throw Error("摇杆配置无效");
        action(j.actionX);
        action(j.actionY);
      }
      const el = doc.createElement(
        def.kind === "button"
          ? "button"
          : def.kind === "image"
            ? "img"
            : def.kind === "input"
              ? "input"
              : "div",
      );
      el.dataset.hudId = def.id;
      el.style.cssText =
        "border:0;border-radius:8px;padding:8px 12px;font-family:system-ui,sans-serif;";
      Object.assign(el.style, layoutStyle(def, parent?.def));
      el.tabIndex =
        def.tabIndex ??
        (def.kind === "button" || def.kind === "input" ? 0 : -1);
      el.disabled = !!def.disabled || !active;
      el.hidden = def.visible === false;
      if (el.hidden) el.style.display = "none";
      function text(value) {
        def.text = String(value);
        if (def.kind === "input") el.value = def.text;
        else if (def.kind === "richtext") richText(doc, el, def.text);
        else if (
          def.kind !== "image" &&
          def.kind !== "joystick" &&
          def.kind !== "container"
        )
          el.textContent = def.text;
      }
      let url;
      if (def.kind === "image") {
        const asset = (options.textures || []).find(
            (t) => t.id === def.textureId,
          ),
          bytes = options.textureData?.[def.textureId];
        if (!asset || !bytes) throw Error("图片资源缺失");
        url = URL.createObjectURL(new Blob([bytes], { type: asset.mime }));
        urls.add(url);
        el.src = url;
        el.alt = def.text;
        el.onerror = () =>
          options.onError?.({
            hook: "ui.image",
            entityId: def.id,
            error: Error("图片资源无法解码: " + asset.name),
          });
        el.style.objectFit = "contain";
      } else text(def.text);
      const local = [],
        tokens = new Set(),
        listeners = new Set();
      let live = true,
        untrack,
        joystickPointer = null,
        origin = null,
        thumb,
        base;
      if (def.kind === "joystick") {
        el.style.backgroundColor = "transparent";
        el.style.padding = "0";
        base = doc.createElement("div");
        Object.assign(base.style, {
          position: "absolute",
          width: def.joystick.radius * 2 + "px",
          height: def.joystick.radius * 2 + "px",
          left: "50%",
          top: "50%",
          transform: "translate(-50%,-50%)",
          borderRadius: "50%",
          background: def.background,
          pointerEvents: "none",
          display: def.joystick.mode === "floating" ? "none" : "block",
        });
        thumb = doc.createElement("div");
        Object.assign(thumb.style, {
          position: "absolute",
          width: "40%",
          height: "40%",
          left: "50%",
          top: "50%",
          transform: "translate(-50%,-50%)",
          borderRadius: "50%",
          background: def.color,
          pointerEvents: "none",
        });
        base.appendChild(thumb);
        el.appendChild(base);
      }
      const r = {
        def,
        el,
        emit(type, value) {
          if (!live || !enabled(r)) return;
          for (const s of [...listeners])
            if (s.type === type && (!s.owner || s.owner.record.active)) {
              try {
                s.fn({ id: def.id, type, value: value ?? def.text });
              } catch (error) {
                report(error, s.owner);
              }
            }
        },
        reset() {
          for (const token of tokens) {
            virtual.delete(token);
            virtual.delete(token + ":x");
            virtual.delete(token + ":y");
          }
          tokens.clear();
          blockers.delete(def.id);
          joystickPointer = null;
          origin = null;
          if (thumb) {
            thumb.style.transform = "translate(-50%,-50%)";
            if (def.joystick.mode === "floating") base.style.display = "none";
          }
        },
      };
      function end(e) {
        const token = def.id + ":" + e.pointerId;
        if (!tokens.has(token)) return;
        mutate(() => {
          tokens.delete(token);
          virtual.delete(token);
          virtual.delete(token + ":x");
          virtual.delete(token + ":y");
          if (!tokens.size) blockers.delete(def.id);
        });
        if (joystickPointer === e.pointerId) {
          joystickPointer = null;
          origin = null;
          thumb.style.transform = "translate(-50%,-50%)";
          if (def.joystick.mode === "floating") base.style.display = "none";
        }
        r.emit("release");
      }
      function joystick(e) {
        const j = def.joystick;
        if (joystickPointer !== e.pointerId || !origin) return;
        let x = (e.clientX - origin.x) / j.radius,
          y = -(e.clientY - origin.y) / j.radius,
          len = Math.hypot(x, y);
        if (len > 1) {
          x /= len;
          y /= len;
        }
        const value = Math.max(
          0,
          (Math.min(1, len) - j.deadzone) / (1 - j.deadzone),
        );
        if (len > 0) {
          x = (x / Math.min(1, len)) * value;
          y = (y / Math.min(1, len)) * value;
        }
        const token = def.id + ":" + e.pointerId;
        mutate(() => {
          virtual.set(token + ":x", { name: j.actionX, value: x });
          virtual.set(token + ":y", { name: j.actionY, value: y });
        });
        thumb.style.transform = `translate(calc(-50% + ${x * j.radius}px),calc(-50% + ${-y * j.radius}px))`;
        r.emit("change", { x, y });
      }
      listen(
        el,
        "pointerdown",
        (e) => {
          if (!live || !enabled(r)) return;
          if (def.kind === "joystick" && (!allow() || joystickPointer !== null))
            return;
          if (
            def.blockInput ||
            ["button", "input", "joystick"].includes(def.kind)
          )
            e.stopPropagation();
          if (def.kind !== "input") e.preventDefault();
          try {
            el.setPointerCapture?.(e.pointerId);
          } catch {}
          const token = def.id + ":" + e.pointerId;
          tokens.add(token);
          if (def.kind !== "joystick" && def.blockInput)
            mutate(() => {
              blockers.add(def.id);
              codes.clear();
              keys.clear();
            });
          if (def.kind === "button" && def.action && allow())
            mutate(() =>
              virtual.set(token, {
                name: def.action,
                value: def.direction === -1 ? -1 : 1,
              }),
            );
          if (def.kind === "joystick") {
            joystickPointer = e.pointerId;
            const rect = el.getBoundingClientRect();
            origin =
              def.joystick.mode === "floating"
                ? { x: e.clientX, y: e.clientY }
                : {
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2,
                  };
            if (def.joystick.mode === "floating") {
              base.style.left = e.clientX - rect.left + "px";
              base.style.top = e.clientY - rect.top + "px";
              base.style.display = "block";
            }
            joystick(e);
          }
          r.emit("press");
        },
        undefined,
        local,
      );
      listen(
        el,
        "pointermove",
        (e) => {
          if (def.kind === "joystick") joystick(e);
        },
        undefined,
        local,
      );
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
        listen(el, type, end, undefined, local);
      for (const type of ["pointerup", "pointercancel"])
        listen(win, type, end, undefined, local);
      listen(
        el,
        "click",
        (e) => {
          e.stopPropagation();
          r.emit("click");
        },
        undefined,
        local,
      );
      listen(
        el,
        "focus",
        () => {
          focused = r;
          el.style.outline = "2px solid #90caf9";
          reset();
          blockers.add(def.id);
          r.emit("focus");
        },
        undefined,
        local,
      );
      listen(
        el,
        "blur",
        () => {
          el.style.outline = "";
          if (focused === r) focused = null;
          reset();
          r.emit("blur");
        },
        undefined,
        local,
      );
      listen(
        el,
        "input",
        () => {
          if (def.disabled) return;
          def.text = el.value;
          r.emit("change", el.value);
        },
        undefined,
        local,
      );
      function subscribe(type, fn, subscriberOwner) {
        if (
          !live ||
          (subscriberOwner && !subscriberOwner.record.active) ||
          !["click", "press", "release", "change", "focus", "blur"].includes(
            type,
          ) ||
          typeof fn !== "function"
        )
          throw Error("UI订阅无效");
        const subscription = { type, fn, owner: subscriberOwner, off: null };
        listeners.add(subscription);
        let stopTrack;
        const off = () => {
          listeners.delete(subscription);
          stopTrack?.();
        };
        subscription.off = off;
        if (subscriberOwner) stopTrack = subscriberOwner.track(off);
        return off;
      }
      if (callback) subscribe("click", callback, owner);
      const guard = () => {
        if (!live) throw Error("HUD destroyed");
      };
      r.handle = Object.freeze({
        id: def.id,
        get text() {
          return def.text;
        },
        setText(value) {
          guard();
          text(value);
        },
        setVisible(value) {
          guard();
          def.visible = !!value;
          el.hidden = !value;
          el.style.display = value
            ? layoutStyle(def, parent?.def).display
            : "none";
          if (!value) mutate(() => clearTree(def.id));
        },
        setDisabled(value) {
          guard();
          def.disabled = !!value;
          el.disabled = !!value || !active;
          if (value) mutate(() => clearTree(def.id));
        },
        focus() {
          guard();
          if (!enabled(r)) return;
          el.focus?.();
          focused = r;
        },
        on: (type, fn) => subscribe(type, fn, owner),
        destroy() {
          if (!live) return;
          for (const child of [...elements.values()])
            if (child.def.parentId === def.id) child.handle.destroy();
          live = false;
          for (const fn of local) fn();
          for (const s of [...listeners]) {
            s.off();
          }
          mutate(() => r.reset());
          elements.delete(def.id);
          if (focused === r) focused = null;
          el.onerror = null;
          if (url) {
            URL.revokeObjectURL(url);
            urls.delete(url);
          }
          el.remove();
          untrack?.();
        },
      });
      r.subscribe = subscribe;
      r.subscriptions = listeners;
      elements.set(def.id, r);
      (parent?.el || layer).appendChild(el);
      if (owner) untrack = owner.track(() => r.handle.destroy());
      return r.handle;
    }
    // Topological creation makes archive order independent of the UI hierarchy.
    const pending = [...(config.hud || [])];
    try {
      while (pending.length) {
        const i = pending.findIndex(
          (d) => !d.parentId || elements.has(d.parentId),
        );
        if (i < 0) throw Error("UI父节点缺失或循环");
        create(pending.splice(i, 1)[0]);
      }
    } catch (error) {
      for (const r of [...elements.values()]) r.handle.destroy();
      for (const release of releases) release();
      throw error;
    }
    return {
      input,
      inputForOwner(owner) {
        const copy = { ...input };
        for (const name of ["rebind", "resetBindings", "captureBinding"])
          copy[name] = (...args) => {
            if (!owner.record.active) throw Error("输入脚本已销毁");
            if (name === "captureBinding") {
              const result = input[name](...args),
                token = binding,
                untrack = owner.track(() => {
                  if (binding === token) token.finish(null);
                });
              return result.finally(untrack);
            }
            return input[name](...args);
          };
        return Object.freeze(copy);
      },
      beginFrame,
      forOwner: (owner) =>
        Object.freeze({
          get: (id) => {
            if (owner && !owner.record.active) throw Error("UI脚本已销毁");
            const r = elements.get(id);
            if (!r) return null;
            const h = {
              id: r.def.id,
              get text() {
                return r.def.text;
              },
              on: (type, fn) => r.subscribe(type, fn, owner),
            };
            for (const name of [
              "setText",
              "setVisible",
              "setDisabled",
              "focus",
              "destroy",
            ])
              h[name] = (...args) => {
                if (owner && !owner.record.active) throw Error("UI脚本已销毁");
                return r.handle[name](...args);
              };
            return Object.freeze(h);
          },
          create: (def) => create(def, owner),
          createText: (def) => create({ ...def, kind: "text" }, owner),
          createButton: (def, callback) =>
            create({ ...def, kind: "button" }, owner, callback),
        }),
      reset,
      setActive(v) {
        active = !!v;
        reset();
        for (const r of elements.values())
          if (r.def.kind === "button" || r.def.kind === "input")
            r.el.disabled = !active || !!r.def.disabled;
      },
      setSimulationActive(v) {
        if (simulation !== !!v) {
          simulation = !!v;
          reset();
        }
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
        inputHeld:
          codes.size +
          virtual.size +
          [...padValues.values()].reduce(
            (n, values) => n + values.filter((v) => v !== 0).length,
            0,
          ),
        uiSubscriptions: [...elements.values()].reduce(
          (n, r) => n + r.subscriptions.size,
          0,
        ),
        uiBlobURLs: urls.size,
        inputGamepads: padList.length,
        inputCaptures: binding ? 1 : 0,
      }),
      dispose() {
        if (disposed) return;
        for (const r of [...elements.values()]) r.handle.destroy();
        disposed = true;
        reset();
        binding?.finish(null);
        padList = [];
        for (const fn of releases) fn();
        layer.replaceChildren();
      },
    };
  }
  root.ArkGlideInputUI = { createInputUI, richText, layoutStyle };
})(globalThis);
