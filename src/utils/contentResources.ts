import type { SceneNode } from "../store/useEditorStore";
import type { ProjectContent } from "../types/content";
export function collectModelRefs(
  nodes: SceneNode[],
  content?: ProjectContent,
): { assetId: string; fileName: string }[] {
  const refs = nodes
    .filter((n) => n.type === "model")
    .map((n) => ({ assetId: n.id, fileName: n.modelUrl || n.id + ".glb" }));
  for (const p of Object.values(content?.prefabs || {}))
    for (const n of p.nodes)
      if (n.type === "model")
        refs.push({
          assetId: p.modelKeys[n.id],
          fileName: n.modelUrl || n.id + ".glb",
        });
  return refs;
}
