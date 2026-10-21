import {
  defaultPhysicsConfig,
  defaultMixer,
  type PhysicsConfig,
  type AudioMixerConfig,
  type AnimationControllerAsset,
  type RetargetProfile,
} from "./advancedGameplay";
import {
  defaultGameplay,
  type AudioAsset,
  type GameplayConfig,
} from "./gameplay";
import type { SceneNode } from "../store/useEditorStore";
export interface MaterialAsset {
  bakedDirectLighting?: boolean;
  id: string;
  name: string;
  baseColor: string;
  emissiveColor: string;
  metallic: number;
  roughness: number;
  alpha: number;
  doubleSided: boolean;
  albedoTextureId?: string;
  normalTextureId?: string;
  metallicRoughnessTextureId?: string;
  aoTextureId?: string;
  aoStrength?: number;
  lightmapTextureId?: string;
  lightmapIntensity?: number;
  lightmapUV?: 0 | 1;
  emissiveTextureId?: string;
  emissiveIntensity?: number;
  normalScale?: number;
  alphaMode?: "auto" | "opaque" | "mask" | "blend";
  alphaCutoff?: number;
  uvOffset?: { u: number; v: number };
  uvRotation?: number;
  clearCoat?: { enabled?: boolean; intensity?: number; roughness?: number; normalScale?: number };
  clearCoatTextureId?: string;
  clearCoatNormalTextureId?: string;
  sheen?: { enabled?: boolean; color?: string; intensity?: number; roughness?: number };
  sheenTextureId?: string;
  anisotropy?: { enabled?: boolean; intensity?: number; rotation?: number };
  anisotropyTextureId?: string;
  transmission?: { enabled?: boolean; intensity?: number; ior?: number; thickness?: number; tintColor?: string; tintDistance?: number };
  thicknessTextureId?: string;
  transmissionTextureId?: string;
  detail?: { enabled?: boolean; scale?: number; diffuse?: number; normal?: number; roughness?: number };
  detailTextureId?: string;
  uvScale: { u: number; v: number };
}
export interface TextureAsset {
  id: string;
  name: string;
  mime: string;
  byteLength: number;
  ktx2?: {width:number;height:number;mipLevels:number;colorSpace:'linear'|'srgb';encoding:'rgba8'|'etc1s'|'uastc';supercompression:'none'|'basisLZ'|'zstd';orientation:'rd'|'ru'|'ld'|'lu';estimatedRgbaBytes:number};
}
export interface PrefabAsset {
  id: string;
  name: string;
  revision: number;
  rootId: string;
  nodes: SceneNode[];
  modelKeys: Record<string, string>;
  /** Nested instance maps use this template’s local node IDs. */
  nestedInstances?: Record<string, PrefabInstance>;
}
export interface PrefabInstance {
  parentInstanceId?: string;
  unpackedMounts?: string[];
  /** Stable mount identity in the parent template. */
  mountId?: string;
  id: string;
  prefabId: string;
  rootId: string;
  nodeMap: Record<string, string>;
  baseline: SceneNode[];
  revision: number;
}
export interface ProjectContent {
  physics?: PhysicsConfig;
  mixer?: AudioMixerConfig;
  animationControllers?: Record<string, AnimationControllerAsset>;
  retargetProfiles?: Record<string, RetargetProfile>;
  audio?: AudioAsset[];
  gameplay?: GameplayConfig;
  materials: Record<string, MaterialAsset>;
  textures: TextureAsset[];
  prefabs: Record<string, PrefabAsset>;
  prefabInstances: Record<string, PrefabInstance>;
}
export const emptyContent = (): ProjectContent => ({
  physics: defaultPhysicsConfig(),
  mixer: defaultMixer(),
  animationControllers: {},
  retargetProfiles: {},
  audio: [],
  gameplay: defaultGameplay(),
  materials: {},
  textures: [],
  prefabs: {},
  prefabInstances: {},
});
export const defaultMaterial = (id: string, name: string): MaterialAsset => ({
  id,
  name,
  baseColor: "#FFFFFF",
  emissiveColor: "#000000",
  metallic: 0,
  roughness: 0.7,
  alpha: 1,
  doubleSided: false,
  uvScale: { u: 1, v: 1 },
});
