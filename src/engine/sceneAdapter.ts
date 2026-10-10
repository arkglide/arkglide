import type { Scene, TransformNode } from "@babylonjs/core";
import type * as Babylon from "@babylonjs/core";
import type { ProjectContent } from "../types/content";
import type { SceneNode } from "../store/useEditorStore";
import "./scene-runtime.js";

export interface SceneAdapter {
  nodes: Map<string, TransformNode>;
  sync(
    nodes: SceneNode[],
    buffers: Map<string, ArrayBuffer>,
    content?: ProjectContent,
    textureBuffers?: Map<string, ArrayBuffer>,
  ): Promise<unknown>;
  dispose(): void;
}
export function createSceneAdapter(
  B: typeof Babylon,
  scene: Scene,
  options: {
    editor: boolean;
    onLoading?: (delta: number) => void;
    onLoaded?: (id: string) => void;
    onError?: (node: SceneNode, error: unknown) => void;
  },
): SceneAdapter {
  return (globalThis as any).ArkGlideScene.createSceneAdapter(
    B,
    scene,
    options,
  );
}
