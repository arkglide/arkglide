import { useEditorStore, type AssetEntry } from "../store/useEditorStore";
import { readModelAsset } from "../engine/modelImport";

function currentDocument(documentId: string) {
  const state = useEditorStore.getState();
  if (state.documentId !== documentId)
    throw new Error("项目已切换，请重新导入模型");
  if (state.playState !== "stopped") throw new Error("请先停止运行");
  return state;
}

export async function importModelAsset(asset: AssetEntry, assets: AssetEntry[]) {
  const documentId = useEditorStore.getState().documentId;
  const buffer = await readModelAsset(asset, assets);
  const state = currentDocument(documentId);
  const id = state.addNode("model", asset.name.replace(/\.(glb|gltf)$/i, ""));
  state.updateTransform(id, { modelUrl: asset.name }, false);
  state.setModelBuffer(id, buffer);
  return id;
}

export async function relinkModelFile(nodeId: string, file: File) {
  const documentId = useEditorStore.getState().documentId;
  const buffer = await file.arrayBuffer();
  const state = currentDocument(documentId);
  if (!state.nodes.some((n) => n.id === nodeId && n.type === "model"))
    throw new Error("要重新链接的模型已删除");
  state.relinkModel(nodeId, buffer);
  state.updateTransform(nodeId, { modelUrl: file.name });
}
