import type { SceneNode } from "../store/useEditorStore";
import type { ProjectContent } from "../types/content";
import { defaultPhysicsConfig, defaultMixer } from "../types/advancedGameplay";
const num = (v: unknown, min: number, max = 1e6) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const key = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= 500 &&
  !["__proto__", "prototype", "constructor"].includes(v);
const vec = (v: any) => v && ["x", "y", "z"].every((k) => num(v[k], -1e6));
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}
function acyclic(
  items: { id: string; parentId?: string | null }[],
  label: string,
) {
  const ids = new Map(items.map((n) => [n.id, n]));
  for (const n of items) {
    const seen = new Set([n.id]);
    let id = n.parentId;
    while (id) {
      check(ids.has(id) && !seen.has(id), label + "存在缺失父级或循环");
      seen.add(id);
      id = ids.get(id)!.parentId;
    }
  }
}
export function validateAdvancedComponents(n: SceneNode) {
  const p = n.physics;
  if (p) {
    check(p.group === undefined || key(p.group), "无效碰撞分组");
    check(
      p.parts === undefined ||
        (Array.isArray(p.parts) && p.parts.length <= 256 && p.parts.every(key)),
      "无效模型碰撞部件",
    );
    check(
      p.shape !== "mesh" || p.motion === "static",
      "三角网格仅支持静态刚体",
    );
  }
  if (p)
    check(
      ["linearDamping", "angularDamping"].every(
        (k) =>
          p[k as keyof typeof p] === undefined ||
          num(p[k as keyof typeof p], 0, 100),
      ),
      "无效刚体阻尼",
    );
  const c = n.character;
  if (c) {
    check(
      !p && ["mesh", "model", "empty"].includes(n.type),
      "角色与刚体不能同时控制实体",
    );
    check(
      num(c.radius, 0.01, 100) &&
        num(c.height, 2 * c.radius, 200) &&
        num(c.stepHeight, 0, c.height) &&
        num(c.maxSlope, 0, 89) &&
        num(c.speed, 0, 1000) &&
        num(c.jumpSpeed, 0, 1000) &&
        (c.mass === undefined || num(c.mass, 0.001, 10000)) &&
        (c.movementMode === undefined ||
          ["direct", "inertial"].includes(c.movementMode)) &&
        ["groundAcceleration", "airAcceleration", "groundFriction"].every(
          (k) =>
            c[k as keyof typeof c] === undefined ||
            num(c[k as keyof typeof c], 0, 10000),
        ) &&
        (c.group === undefined || key(c.group)),
      "无效角色控制器参数",
    );
  }
  if (n.joints) {
    check(
      Array.isArray(n.joints) && n.joints.length <= 64 && !!p,
      "关节需要刚体且最多 64 个",
    );
    const ids = new Set();
    for (const j of n.joints) {
      check(
        j &&
          key(j.id) &&
          !ids.has(j.id) &&
          key(j.targetId) &&
          j.targetId !== n.id &&
          ["fixed", "hinge", "slider", "distance"].includes(j.kind) &&
          vec(j.anchor) &&
          vec(j.anchor2) &&
          vec(j.axis) &&
          Math.hypot(j.axis.x, j.axis.y, j.axis.z) > 1e-6 &&
          num(j.min, j.kind === "distance" ? 0 : -1e6) &&
          num(j.max, j.min),
        "无效关节配置",
      );
      check(
        j.kind !== "hinge" || (j.min >= -Math.PI && j.max <= Math.PI),
        "铰链角度限制必须在 -π..π",
      );
      check(
        !j.motor ||
          (["hinge", "slider"].includes(j.kind) &&
            num(j.motor.velocity, -1000, 1000) &&
            num(j.motor.force, 0)),
        "无效关节电机",
      );
      ids.add(j.id);
    }
  }
  const a = n.animation;
  if (a) {
    check(
      a.controllerId === undefined || key(a.controllerId),
      "无效动画控制器引用",
    );
    check(
      !a.rootMotion ||
        (!!a.controllerId &&
          key(a.rootMotion.target) &&
          typeof a.rootMotion.translation === "boolean" &&
          typeof a.rootMotion.rotation === "boolean"),
      "无效根运动配置",
    );
    check(
      !a.retarget || (key(a.retarget.sourceId) && key(a.retarget.profileId)),
      "无效重定向引用",
    );
  }
  const s = n.audioSource;
  if (s) {
    check(s.rate === undefined || num(s.rate, 0.001, 16), "无效音源倍率");
    check(s.bus === undefined || key(s.bus), "无效音频总线引用");
    for (const k of ["stream", "preservePitch"] as const)
      check(
        s[k] === undefined || typeof s[k] === "boolean",
        "无效音源播放模式",
      );
    check(
      s.priority === undefined || num(s.priority, -1000, 1000),
      "无效音源优先级",
    );
  }
}
export function validateAdvancedContent(content: ProjectContent) {
  content.physics ??= defaultPhysicsConfig();
  content.mixer ??= defaultMixer();
  content.animationControllers ??= {};
  content.retargetProfiles ??= {};
  const p = content.physics;
  check(
    Array.isArray(p.groups) &&
      p.groups.length > 0 &&
      p.groups.length <= 16 &&
      typeof p.debug === "boolean",
    "无效物理分组配置",
  );
  const names = new Set();
  for (const g of p.groups) {
    check(
      g &&
        key(g.name) &&
        !names.has(g.name) &&
        Number.isInteger(g.mask) &&
        num(g.mask, 0, (1 << p.groups.length) - 1),
      "无效碰撞掩码/名称",
    );
    names.add(g.name);
  }
  check(names.has("Default"), "必须保留 Default 碰撞组");
  const m = content.mixer;
  check(
    Array.isArray(m.buses) &&
      m.buses.length > 0 &&
      m.buses.length <= 32 &&
      Array.isArray(m.snapshots) &&
      m.snapshots.length <= 64 &&
      Array.isArray(m.ducking) &&
      m.ducking.length <= 64 &&
      Number.isInteger(m.maxVoices) &&
      num(m.maxVoices, 1, 256),
    "无效混音器",
  );
  const buses = new Set<string>();
  for (const b of m.buses) {
    check(
      b &&
        key(b.id) &&
        !buses.has(b.id) &&
        key(b.name) &&
        num(b.volume, 0, 1) &&
        typeof b.mute === "boolean" &&
        (b.id === "Master" ? b.parentId === null : key(b.parentId)),
      "无效音频总线",
    );
    buses.add(b.id);
  }
  check(buses.has("Master"), "缺少 Master 总线");
  acyclic(m.buses, "音频路由");
  const snapshots = new Set();
  for (const s of m.snapshots) {
    check(
      s &&
        key(s.id) &&
        !snapshots.has(s.id) &&
        key(s.name) &&
        s.buses &&
        typeof s.buses === "object" &&
        !Array.isArray(s.buses),
      "无效混音快照",
    );
    snapshots.add(s.id);
    for (const [id, b] of Object.entries(s.buses))
      check(
        buses.has(id) &&
          b &&
          num(b.volume, 0, 1) &&
          typeof b.mute === "boolean",
        "混音快照包含无效总线",
      );
  }
  for (const d of m.ducking)
    check(
      d &&
        buses.has(d.sourceBus) &&
        buses.has(d.targetBus) &&
        d.sourceBus !== d.targetBus &&
        num(d.amount, 0, 1) &&
        num(d.attack, 0.001, 60) &&
        num(d.release, 0.001, 60),
      "无效自动压低规则",
    );
  const controllers = content.animationControllers;
  check(
    controllers &&
      typeof controllers === "object" &&
      !Array.isArray(controllers) &&
      Object.keys(controllers).length <= 128,
    "无效控制器资源",
  );
  for (const [id, c] of Object.entries(controllers)) {
    check(
      c &&
        key(id) &&
        c.id === id &&
        key(c.name) &&
        key(c.defaultState) &&
        c.parameters &&
        typeof c.parameters === "object" &&
        !Array.isArray(c.parameters) &&
        Object.keys(c.parameters).length <= 64 &&
        Array.isArray(c.states) &&
        c.states.length > 0 &&
        c.states.length <= 64 &&
        Array.isArray(c.transitions) &&
        c.transitions.length <= 256,
      "无效动画控制器",
    );
    for (const [name, v] of Object.entries(c.parameters))
      check(
        key(name) && (typeof v === "boolean" || num(v, -1e6)),
        "无效动画参数",
      );
    const states = new Set();
    for (const s of c.states) {
      check(
        s &&
          key(s.name) &&
          !states.has(s.name) &&
          typeof s.clip === "string" &&
          num(s.speed, 0, 100) &&
          typeof s.loop === "boolean" &&
          Array.isArray(s.events) &&
          s.events.length <= 128,
        "无效动画状态",
      );
      states.add(s.name);
      for (const e of s.events)
        check(
          e &&
            num(e.time, 0, 3600) &&
            key(e.name) &&
            (e.data === undefined ||
              e.data === null ||
              ["string", "number", "boolean"].includes(typeof e.data)),
          "无效动画事件",
        );
      if (s.blend) {
        const b = s.blend;
        check(
          ["1d", "2d"].includes(b.kind) &&
            typeof c.parameters[b.parameterX] === "number" &&
            (b.kind === "1d" ||
              typeof c.parameters[b.parameterY || ""] === "number") &&
            Array.isArray(b.children) &&
            b.children.length > 0 &&
            b.children.length <= 32,
          "无效混合树",
        );
        const samples = new Set();
        for (const child of b.children) {
          const sample =
            b.kind === "1d" ? String(child.threshold) : `${child.x},${child.y}`;
          check(
            child &&
              key(child.clip) &&
              num(child.threshold, -1e6) &&
              num(child.x, -1e6) &&
              num(child.y, -1e6) &&
              !samples.has(sample),
            "混合树采样点无效或重复",
          );
          samples.add(sample);
        }
      }
    }
    check(states.has(c.defaultState), "默认动画状态不存在");
    for (const t of c.transitions) {
      check(
        t &&
          (t.from === "*" || states.has(t.from)) &&
          states.has(t.to) &&
          num(t.duration, 0, 60) &&
          (t.exitTime === undefined || num(t.exitTime, 0, 100)) &&
          Array.isArray(t.conditions) &&
          t.conditions.length <= 64,
        "无效动画过渡",
      );
      for (const d of t.conditions)
        check(
          d &&
            Object.hasOwn(c.parameters, d.parameter) &&
            [">", "<", "==", "!="].includes(d.op) &&
            typeof d.value === typeof c.parameters[d.parameter],
          "无效动画条件",
        );
    }
  }
  const profiles = content.retargetProfiles;
  check(
    profiles &&
      typeof profiles === "object" &&
      !Array.isArray(profiles) &&
      Object.keys(profiles).length <= 128,
    "无效重定向资源",
  );
  for (const [id, p] of Object.entries(profiles)) {
    check(
      p &&
        key(id) &&
        p.id === id &&
        key(p.name) &&
        num(p.scale, 0.001, 1000) &&
        p.mapping &&
        typeof p.mapping === "object" &&
        !Array.isArray(p.mapping) &&
        Object.keys(p.mapping).length > 0 &&
        Object.keys(p.mapping).length <= 512,
      "无效骨骼映射",
    );
    const targets = new Set();
    for (const [src, dst] of Object.entries(p.mapping)) {
      check(
        key(src) && key(dst) && !targets.has(dst),
        "骨骼映射目标重复或无效",
      );
      targets.add(dst);
    }
    for (const pose of [p.sourcePose, p.targetPose]) {
      check(
        pose && typeof pose === "object" && !Array.isArray(pose),
        "参考姿势缺失",
      );
      for (const [name, t] of Object.entries(pose))
        check(
          key(name) &&
            t &&
            vec(t.position) &&
            t.rotation &&
            ["x", "y", "z", "w"].every((k) =>
              num((t.rotation as any)[k], -1, 1),
            ) &&
            Math.abs(
              Math.hypot(
                t.rotation.x,
                t.rotation.y,
                t.rotation.z,
                t.rotation.w,
              ) - 1,
            ) < 0.01,
          "无效参考姿势",
        );
    }
    for (const [src, dst] of Object.entries(p.mapping))
      check(
        !!p.sourcePose[src] === !!p.targetPose[dst],
        "参考姿势必须成对提供",
      );
    for (const src of Object.keys(p.sourcePose))
      check(Object.hasOwn(p.mapping, src), "源参考姿势没有骨骼映射");
    for (const dst of Object.keys(p.targetPose))
      check(targets.has(dst), "目标参考姿势没有骨骼映射");
  }
  const g = content.gameplay!;
  g.defaults ??= structuredClone(g.actions);
  check(Array.isArray(g.defaults) && g.defaults.length <= 128, "无效默认映射");
  const defaultNames = new Set();
  for (const a of g.defaults) {
    check(
      a &&
        key(a.name) &&
        !defaultNames.has(a.name) &&
        [a.positive, a.negative].every(
          (v) => Array.isArray(v) && v.length <= 32 && v.every(key),
        ),
      "无效默认映射",
    );
    defaultNames.add(a.name);
  }
  for (const a of [...g.actions, ...g.defaults])
    if (a.gamepad) {
      check(Array.isArray(a.gamepad) && a.gamepad.length <= 32, "无效手柄映射");
      for (const b of a.gamepad)
        check(
          b &&
            ["button", "axis"].includes(b.kind) &&
            Number.isInteger(b.index) &&
            num(b.index, 0, 63) &&
            [1, -1].includes(b.direction) &&
            num(b.deadzone, 0, 0.95),
          "无效手柄按钮/轴",
        );
    }
  acyclic(g.hud, "UI 节点树");
  const textures = new Set(content.textures.map((t) => t.id)),
    actions = new Set(g.actions.map((a) => a.name));
  for (const h of g.hud) {
    for (const k of ["width", "height", "margin", "gap"] as const)
      check(h[k] === undefined || num(h[k], 0, 10000), "无效 UI 尺寸/间距");
    for (const k of ["anchorX", "anchorY"] as const)
      check(h[k] === undefined || num(h[k], 0, 1), "无效 UI 锚点");
    check(
      h.unit === undefined || ["percent", "px"].includes(h.unit),
      "无效 UI 单位",
    );
    check(
      h.layout === undefined ||
        ["absolute", "row", "column", "grid"].includes(h.layout),
      "无效布局容器",
    );
    check(
      h.columns === undefined ||
        (Number.isInteger(h.columns) && num(h.columns, 1, 64)),
      "无效网格列数",
    );
    for (const k of ["disabled", "visible", "blockInput"] as const)
      check(h[k] === undefined || typeof h[k] === "boolean", "无效 UI 状态");
    check(h.zIndex === undefined || Number.isInteger(h.zIndex), "无效 UI 层级");
    check(
      h.tabIndex === undefined ||
        (Number.isInteger(h.tabIndex) && num(h.tabIndex, -1, 10000)),
      "无效 UI 导航顺序",
    );
    check(
      h.kind !== "image" || (!!h.textureId && textures.has(h.textureId)),
      "图片 UI 资源不存在",
    );
    if (h.joystick)
      check(
        h.kind === "joystick" &&
          ["fixed", "floating"].includes(h.joystick.mode) &&
          num(h.joystick.radius, 16, 500) &&
          num(h.joystick.deadzone, 0, 0.95) &&
          actions.has(h.joystick.actionX) &&
          actions.has(h.joystick.actionY),
        "无效触摸摇杆",
      );
    check(h.kind !== "joystick" || !!h.joystick, "摇杆配置缺失");
  }
  for (const a of content.audio || [])
    check(
      a.stream === undefined || typeof a.stream === "boolean",
      "无效音频资源模式",
    );
}
export function validateAdvancedReferences(
  content: ProjectContent,
  nodes: SceneNode[],
) {
  const groups = new Set(content.physics!.groups.map((g) => g.name)),
    buses = new Set(content.mixer!.buses.map((b) => b.id));
  function subtree(list: SceneNode[]) {
    const ids = new Map(list.map((n) => [n.id, n]));
    for (const n of list) {
      if (n.physics)
        check(
          groups.has(n.physics.group || "Default"),
          "刚体引用了不存在的碰撞组",
        );
      if (n.character)
        check(
          groups.has(n.character.group || "Default"),
          "角色引用了不存在的碰撞组",
        );
      for (const j of n.joints || [])
        check(
          ids.has(j.targetId) && ids.get(j.targetId)?.physics,
          "关节目标刚体缺失",
        );
      if (n.audioSource)
        check(buses.has(n.audioSource.bus || "SFX"), "音源总线不存在");
      if (n.animation?.controllerId)
        check(
          content.animationControllers?.[n.animation.controllerId],
          "动画控制器不存在",
        );
      if (n.animation?.retarget)
        check(
          ids.get(n.animation.retarget.sourceId)?.type === "model" &&
            n.animation.retarget.sourceId !== n.id &&
            content.retargetProfiles?.[n.animation.retarget.profileId],
          "重定向来源或映射缺失",
        );
    }
  }
  subtree(nodes);
  for (const p of Object.values(content.prefabs)) {
    subtree(p.nodes);
    for (const i of Object.values(p.nestedInstances || {})) subtree(i.baseline);
  }
  for (const i of Object.values(content.prefabInstances)) subtree(i.baseline);
}
