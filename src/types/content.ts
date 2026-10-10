import type { SceneNode } from "../store/useEditorStore";
export interface MaterialAsset {
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
  uvScale: { u: number; v: number };
}
export interface TextureAsset {
  id: string;
  name: string;
  mime: string;
  byteLength: number;
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
  materials: Record<string, MaterialAsset>;
  textures: TextureAsset[];
  prefabs: Record<string, PrefabAsset>;
  prefabInstances: Record<string, PrefabInstance>;
}
export const emptyContent = (): ProjectContent => ({
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
