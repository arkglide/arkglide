import { validateHUDStyles } from "./uiStyles";
import {
  validateAdvancedComponents,
  validateAdvancedContent,
} from "./advancedGameplayValidation";
import type { SceneNode } from "../store/useEditorStore";
import type { ProjectContent } from "../types/content";
import { defaultGameplay } from "../types/gameplay";
const finite = (v: any, min: number, max = 1e6) =>
  Number.isFinite(v) && v >= min && v <= max;
const key = (s: any) =>
  typeof s === "string" &&
  s.length > 0 &&
  s.length <= 100 &&
  !["__proto__", "constructor", "prototype"].includes(s);
export function validateComponents(n: SceneNode) {
  validateAdvancedComponents(n);
  const p = n.physics;
  if (
    p &&
    (!["mesh", "model", "empty"].includes(n.type) ||
      !["static", "dynamic", "kinematic"].includes(p.motion) ||
      !["box", "sphere", "capsule", "convex", "mesh"].includes(p.shape) ||
      !p.size ||
      ![p.size.x, p.size.y, p.size.z].every((v) => finite(v, 0.001, 10000)) ||
      !finite(p.mass, 0.001) ||
      !finite(p.friction, 0, 1) ||
      !finite(p.restitution, 0, 1) ||
      typeof p.sensor !== "boolean" ||
      typeof p.lockRotation !== "boolean")
  )
    throw new Error("无效刚体/碰撞体配置");
  const a = n.animation;
  if (
    a &&
    (n.type !== "model" ||
      typeof a.clip !== "string" ||
      a.clip.length > 500 ||
      typeof a.autoplay !== "boolean" ||
      typeof a.loop !== "boolean" ||
      !finite(a.speed, 0, 100))
  )
    throw new Error("无效动画配置");
  const s = n.audioSource;
  if (
    s &&
    (!key(s.assetId) ||
      typeof s.autoplay !== "boolean" ||
      typeof s.loop !== "boolean" ||
      typeof s.spatial !== "boolean" ||
      !finite(s.volume, 0, 1) ||
      !finite(s.refDistance, 0.01, 10000))
  )
    throw new Error("无效音源配置");
}
export function validateGameplayContent(content: ProjectContent) {
  content.audio ??= [];
  content.gameplay ??= defaultGameplay();
  if (!Array.isArray(content.audio) || content.audio.length > 256)
    throw new Error("无效音频列表");
  const ids = new Set<string>();
  for (const a of content.audio) {
    if (
      !a ||
      !key(a.id) ||
      ids.has(a.id) ||
      typeof a.name !== "string" ||
      ![
        "audio/wav",
        "audio/mpeg",
        "audio/ogg",
        "audio/mp4",
        "audio/webm",
      ].includes(a.mime) ||
      !Number.isInteger(a.byteLength) ||
      !finite(a.byteLength, 1, 32 * 1024 * 1024)
    )
      throw new Error("无效音频资源");
    ids.add(a.id);
  }
  const g = content.gameplay;
  if (
    !g ||
    typeof g.captureInput !== "boolean" ||
    !Array.isArray(g.actions) ||
    g.actions.length > 128 ||
    !Array.isArray(g.hud) ||
    g.hud.length > 256
  )
    throw new Error("无效游戏输入/HUD配置");
  const names = new Set<string>();
  for (const a of g.actions) {
    if (
      !a ||
      !key(a.name) ||
      names.has(a.name) ||
      ![a.positive, a.negative].every(
        (v) => Array.isArray(v) && v.length <= 32 && v.every(key),
      )
    )
      throw new Error("无效动作映射");
    names.add(a.name);
  }
  const hud = new Set<string>();
  for (const h of g.hud) {
    if (
      !h ||
      !key(h.id) ||
      hud.has(h.id) ||
      ![
        "text",
        "button",
        "container",
        "image",
        "richtext",
        "input",
        "joystick",
        "shape",
      ].includes(h.kind) ||
      typeof h.text !== "string" ||
      h.text.length > 10000 ||
      ![h.x, h.y].every((v) =>
        finite(v, 0, (h.positionUnit || h.unit) === "px" ? 10000 : 100),
      ) ||
      !finite(h.fontSize, 8, 128) ||
      (!/^#[0-9a-f]{6}$/i.test(h.color) && h.color !== "transparent") ||
      (!/^#[0-9a-f]{6}$/i.test(h.background) &&
        h.background !== "transparent") ||
      (h.action !== undefined && !names.has(h.action)) ||
      (h.direction !== undefined && ![1, -1].includes(h.direction))
    )
      throw new Error("无效HUD元素");
    hud.add(h.id);
  }
  validateHUDStyles(g);
  validateAdvancedContent(content);
}
