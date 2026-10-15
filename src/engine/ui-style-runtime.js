// Shared declarative HUD appearance: editor, project validation and game DOM.
(function (root) {
  "use strict";
  const states = ["hover", "focus", "pressed", "disabled"];
  const enums = {
    borderStyle: ["none", "solid", "dashed", "dotted", "double"],
    fontStyle: ["normal", "italic", "oblique"],
    textAlign: ["left", "center", "right", "start", "end", "justify"],
    alignItems: [
      "start",
      "end",
      "center",
      "stretch",
      "baseline",
      "flex-start",
      "flex-end",
    ],
    justifyContent: [
      "start",
      "end",
      "center",
      "space-between",
      "space-around",
      "space-evenly",
      "flex-start",
      "flex-end",
    ],
    whiteSpace: ["normal", "pre", "pre-wrap", "nowrap"],
    overflow: ["visible", "hidden", "clip", "auto"],
    textOverflow: ["clip", "ellipsis"],
    objectFit: ["contain", "cover", "fill", "none", "scale-down"],
    mixBlendMode: [
      "normal",
      "multiply",
      "screen",
      "overlay",
      "darken",
      "lighten",
      "difference",
      "exclusion",
    ],
    textTransform: ["none", "uppercase", "lowercase", "capitalize"],
  };
  const px = new Set([
    "borderWidth",
    "padding",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "fontSize",
    "letterSpacing",
    "outlineWidth",
    "outlineOffset",
  ]);
  const colors = new Set([
    "color",
    "backgroundColor",
    "borderColor",
    "outlineColor",
  ]);
  const safeName = (n) =>
    typeof n === "string" &&
    /^[a-zA-Z_][\w-]{0,99}$/.test(n) &&
    !["__proto__", "constructor", "prototype"].includes(n);
  const color = (v) =>
    typeof v === "string" &&
    (v === "transparent" ||
      v === "currentColor" ||
      /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(v) ||
      /^rgba?\([\d.,%\s+-]+\)$/.test(v));
  function validateStyle(style = {}) {
    if (!style || typeof style !== "object" || Array.isArray(style))
      throw Error("UI 样式必须为对象");
    for (const [k, v] of Object.entries(style)) {
      let valid = false;
      if (colors.has(k)) valid = color(v);
      else if (enums[k]) valid = enums[k].includes(v);
      else if (px.has(k))
        valid =
          Number.isFinite(v) &&
          v >= (["letterSpacing", "outlineOffset"].includes(k) ? -1024 : 0) &&
          v <= 10000;
      else if (k === "borderRadius")
        valid =
          (Number.isFinite(v) && v >= 0 && v <= 10000) ||
          (typeof v === "string" &&
            /^\d+(?:\.\d+)?%$/.test(v) &&
            parseFloat(v) <= 100);
      else if (k === "opacity") valid = Number.isFinite(v) && v >= 0 && v <= 1;
      else if (k === "rotation")
        valid = Number.isFinite(v) && Math.abs(v) <= 360000;
      else if (k === "scaleX" || k === "scaleY")
        valid = Number.isFinite(v) && Math.abs(v) <= 100;
      else if (k === "lineHeight")
        valid = Number.isFinite(v) && v > 0 && v <= 100;
      else if (k === "fontWeight")
        valid =
          ["normal", "bold", "lighter", "bolder"].includes(v) ||
          (Number.isInteger(v) && v >= 1 && v <= 1000);
      else if (k === "fontFamily")
        valid =
          typeof v === "string" &&
          v.length > 0 &&
          v.length <= 256 &&
          !/[;{}<>\\\x00-\x1f]/.test(v) &&
          !/(?:url|var|expression)\s*\(/i.test(v);
      else if (k === "boxShadow" || k === "textShadow")
        valid =
          typeof v === "string" &&
          v.length <= 256 &&
          /^(?:none|[\w\s#.,()%+\/-]+)$/.test(v) &&
          !/(?:url|var|expression)\s*\(/i.test(v);
      if (!valid) throw Error("无效 UI 样式属性: " + k);
    }
    return style;
  }
  function validateDefinition(def) {
    if (!def || typeof def !== "object" || Array.isArray(def))
      throw Error("无效 UI 样式定义");
    for (const [k, v] of Object.entries(def)) {
      if (k !== "base" && !states.includes(k))
        throw Error("无效 UI 样式状态: " + k);
      validateStyle(v);
    }
    return def;
  }
  function validateSheet(sheet = {}) {
    if (
      !sheet ||
      typeof sheet !== "object" ||
      Array.isArray(sheet) ||
      Object.keys(sheet).length > 256
    )
      throw Error("无效 UI 样式表");
    for (const [n, d] of Object.entries(sheet)) {
      if (!safeName(n)) throw Error("无效 UI 样式类名称: " + n);
      validateDefinition(d);
    }
    return sheet;
  }
  function validateItem(item, sheet = {}) {
    if (
      item.classes !== undefined &&
      (!Array.isArray(item.classes) ||
        item.classes.length > 32 ||
        item.classes.some((n) => !safeName(n) || !Object.hasOwn(sheet, n)))
    )
      throw Error("UI 样式类不存在");
    if (item.style !== undefined) validateStyle(item.style);
    if (item.stateStyles !== undefined) validateDefinition(item.stateStyles);
    for (const k of ["positionUnit", "sizeUnit"])
      if (item[k] !== undefined && !["px", "percent"].includes(item[k]))
        throw Error("无效 UI 坐标/尺寸单位");
    if (
      item.kind === "shape" &&
      !["rect", "ellipse"].includes(item.shape || "rect")
    )
      throw Error("无效 UI 图形");
  }
  function appearance(item, sheet = {}, state = {}) {
    let style = {};
    for (const name of item.classes || [])
      Object.assign(style, sheet[name]?.base);
    Object.assign(style, item.stateStyles?.base, item.style);
    for (const key of states)
      if (state[key]) {
        for (const name of item.classes || [])
          Object.assign(style, sheet[name]?.[key]);
        Object.assign(style, item.stateStyles?.[key]);
      }
    return style;
  }
  function layout(d, parent, sheet = {}, state = {}) {
    const unit = (d.positionUnit || d.unit) === "px" ? "px" : "%",
      size = (d.sizeUnit || d.unit) === "px" ? "px" : "%",
      flow = parent && parent.layout && parent.layout !== "absolute";
    const a = appearance(d, sheet, state),
      css = {
        position: flow ? "relative" : "absolute",
        left: flow ? "" : (d.x ?? 5) + unit,
        top: flow ? "" : (d.y ?? 5) + unit,
        width: d.width === undefined ? "" : d.width + size,
        height: d.height === undefined ? "" : d.height + size,
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
        border: "0",
        outline: state.focus ? "2px solid #90caf9" : "",
        borderStyle: "solid",
        borderRadius:
          d.kind === "shape" ? (d.shape === "ellipse" ? "50%" : "0") : "8px",
        padding: d.kind === "shape" ? "0" : "8px 12px",
        fontFamily: "system-ui,sans-serif",
        objectFit: "contain",
      };
    if (d.kind === "joystick") {
      css.backgroundColor = "transparent";
      css.padding = "0";
    }
    for (const [k, v] of Object.entries(a)) {
      if (["rotation", "scaleX", "scaleY"].includes(k)) continue;
      css[k] =
        px.has(k) || (k === "borderRadius" && typeof v === "number")
          ? v + "px"
          : String(v);
    }
    if (a.rotation !== undefined)
      css.transform += " rotate(" + a.rotation + "deg)";
    if (a.scaleX !== undefined || a.scaleY !== undefined)
      css.transform +=
        " scale(" + (a.scaleX ?? 1) + "," + (a.scaleY ?? 1) + ")";
    return css;
  }
  function crosshair(id = "reticle", options = {}) {
    const color = options.color || "#FFFFFF",
      size = options.size ?? 28,
      gap = options.gap ?? 6,
      thickness = options.thickness ?? 2,
      length = (size - gap) / 2;
    if (
      !Number.isFinite(size) ||
      size <= 0 ||
      !Number.isFinite(gap) ||
      gap < 0 ||
      gap >= size ||
      !Number.isFinite(thickness) ||
      thickness <= 0 ||
      thickness > size
    )
      throw Error("无效准心尺寸");
    const base = {
      text: "",
      color,
      background: color,
      fontSize: 20,
      visible: true,
      blockInput: false,
    };
    const root = {
      ...base,
      id,
      kind: "container",
      x: 50,
      y: 50,
      width: size,
      height: size,
      positionUnit: "percent",
      sizeUnit: "px",
      anchorX: 0.5,
      anchorY: 0.5,
      background: "transparent",
      style: { padding: 0, borderRadius: 0 },
    };
    const arm = (key, x, y, w, h) => ({
      ...base,
      id: id + "-" + key,
      kind: "shape",
      shape: "rect",
      parentId: id,
      unit: "px",
      x,
      y,
      width: w,
      height: h,
      style: { padding: 0, borderRadius: 0 },
    });
    return [
      root,
      arm("left", 0, (size - thickness) / 2, length, thickness),
      arm("right", (size + gap) / 2, (size - thickness) / 2, length, thickness),
      arm("top", (size - thickness) / 2, 0, thickness, length),
      arm(
        "bottom",
        (size - thickness) / 2,
        (size + gap) / 2,
        thickness,
        length,
      ),
    ];
  }
  root.ArkGlideUIStyles = {
    validateStyle,
    validateDefinition,
    validateSheet,
    validateItem,
    appearance,
    layout,
    crosshair,
  };
})(globalThis);
