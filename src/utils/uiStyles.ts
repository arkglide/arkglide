import "../engine/ui-style-runtime.js";
import type { CSSProperties } from "react";
import type {
  HUDItem,
  GameplayConfig,
  UIState,
  UIStyle,
} from "../types/gameplay";
const runtime = (globalThis as any).ArkGlideUIStyles;
export const hudLayout = (
  item: HUDItem,
  parent?: HUDItem,
  styles?: GameplayConfig["styles"],
  state?: Partial<Record<UIState, boolean>>,
): CSSProperties => runtime.layout(item, parent, styles, state);
export function validateHUDStyles(gameplay: GameplayConfig) {
  runtime.validateSheet(gameplay.styles);
  for (const item of gameplay.hud) runtime.validateItem(item, gameplay.styles);
}
export const crosshairPreset = (
  id: string,
  options?: { size?: number; gap?: number; thickness?: number; color?: string },
): HUDItem[] => runtime.crosshair(id, options);
export const validateUIStyle = (value: unknown) => runtime.validateStyle(value);
export const validateUIStyleSheet = (value: unknown) =>
  runtime.validateSheet(value);

export const hudAppearance = (
  item: HUDItem,
  styles?: GameplayConfig["styles"],
): UIStyle => runtime.appearance(item, styles);
