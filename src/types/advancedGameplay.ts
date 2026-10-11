import type { Transform } from "../store/useEditorStore";
export interface CollisionGroup {
  name: string;
  mask: number;
}
export interface PhysicsConfig {
  groups: CollisionGroup[];
  debug: boolean;
}
export interface CharacterComponent {
  radius: number;
  height: number;
  stepHeight: number;
  maxSlope: number;
  speed: number;
  jumpSpeed: number;
  group?: string;
}
export interface JointComponent {
  id: string;
  kind: "fixed" | "hinge" | "slider" | "distance";
  targetId: string;
  anchor: Transform;
  anchor2: Transform;
  axis: Transform;
  min: number;
  max: number;
  motor?: { velocity: number; force: number };
}
export interface AnimationEvent {
  time: number;
  name: string;
  data?: string | number | boolean | null;
}
export interface BlendChild {
  clip: string;
  threshold: number;
  x: number;
  y: number;
}
export interface AnimationState {
  name: string;
  clip: string;
  speed: number;
  loop: boolean;
  blend?: {
    kind: "1d" | "2d";
    parameterX: string;
    parameterY?: string;
    children: BlendChild[];
  };
  events: AnimationEvent[];
}
export interface AnimationCondition {
  parameter: string;
  op: ">" | "<" | "==" | "!=";
  value: number | boolean;
}
export interface AnimationTransition {
  from: string;
  to: string;
  duration: number;
  exitTime?: number;
  conditions: AnimationCondition[];
}
export interface AnimationControllerAsset {
  id: string;
  name: string;
  defaultState: string;
  parameters: Record<string, number | boolean>;
  states: AnimationState[];
  transitions: AnimationTransition[];
}
export interface RetargetProfile {
  id: string;
  name: string;
  mapping: Record<string, string>;
  scale: number;
  sourcePose: Record<
    string,
    {
      position: Transform;
      rotation: { x: number; y: number; z: number; w: number };
    }
  >;
  targetPose: RetargetProfile["sourcePose"];
}
export interface AudioBus {
  id: string;
  name: string;
  parentId: string | null;
  volume: number;
  mute: boolean;
}
export interface MixerSnapshot {
  id: string;
  name: string;
  buses: Record<string, { volume: number; mute: boolean }>;
}
export interface DuckingRule {
  sourceBus: string;
  targetBus: string;
  amount: number;
  attack: number;
  release: number;
}
export interface AudioMixerConfig {
  buses: AudioBus[];
  snapshots: MixerSnapshot[];
  ducking: DuckingRule[];
  maxVoices: number;
}
export const defaultPhysicsConfig = (): PhysicsConfig => ({
  groups: [{ name: "Default", mask: 1 }],
  debug: false,
});
export const defaultCharacter = (): CharacterComponent => ({
  radius: 0.3,
  height: 1.8,
  stepHeight: 0.3,
  maxSlope: 45,
  speed: 3,
  jumpSpeed: 5,
});
export const defaultMixer = (): AudioMixerConfig => ({
  buses: [
    { id: "Master", name: "Master", parentId: null, volume: 1, mute: false },
    ...["Music", "SFX", "UI"].map((id) => ({
      id,
      name: id,
      parentId: "Master",
      volume: 1,
      mute: false,
    })),
  ],
  snapshots: [],
  ducking: [],
  maxVoices: 32,
});

/** Remap entity references together with scene/prefab node IDs. */
export function remapGameplayReferences<
  T extends {
    joints?: JointComponent[];
    animation?: { retarget?: { sourceId: string; profileId: string } };
  },
>(node: T, map: Map<string, string> | Record<string, string>): T {
  const id = (value: string) =>
    map instanceof Map ? map.get(value) || value : map[value] || value;
  const copy = structuredClone(node);
  if (copy.joints)
    copy.joints = copy.joints.map((j) => ({ ...j, targetId: id(j.targetId) }));
  if (copy.animation?.retarget)
    copy.animation.retarget = {
      ...copy.animation.retarget,
      sourceId: id(copy.animation.retarget.sourceId),
    };
  return copy;
}
