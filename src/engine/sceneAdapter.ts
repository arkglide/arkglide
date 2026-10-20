import type { Scene, TransformNode } from "@babylonjs/core";
import type * as Babylon from "@babylonjs/core";
import type { ProjectContent } from "../types/content";
import type { SceneNode } from "../store/useEditorStore";
import "./scene-runtime.js";
import "./lighting-uv.js";
import "./baked-lighting.js";
import "./geometry-cluster.js";
import "./scene-optimization.js";
import "./static-instances.js";
import {loadMathModule} from './wasm/math-loader';
import "./rendering-config.js";
import "./atmosphere-runtime.js";
import "./volumetric-runtime.js";
import "./render-view-budget.js";
import "./reflection-runtime.js";
import "./rendering-runtime.js";

export interface SceneAdapter {
  instanceStats(): {instancingSupported?: boolean;instanceBatches?: number;instancedMeshes?: number;instanceSkippedMeshes?: number};
  rendering: any;
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
    onAnimations?: (id: string, names: string[]) => void;
    onParts?: (id: string, parts: { key: string; name: string }[]) => void;
    onError?: (node: SceneNode, error: unknown) => void;
  },
): SceneAdapter {
  return (globalThis as any).ArkGlideScene.createSceneAdapter(
    B,
    scene,
    {...options,loadModule:loadMathModule},
  );
}
