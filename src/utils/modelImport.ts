import { useEditorStore, type AssetEntry } from "../store/useEditorStore";
import { readModelAsset } from "../engine/modelImport";
import { assertModelPath } from "./projectValidation";

const replacements = new Map<string, object>();

function currentDocument(documentId: string) {
  const state = useEditorStore.getState();
  if (state.documentId !== documentId)
    throw new Error("项目已切换，请重新导入模型");
  if (state.playState !== "stopped") throw new Error("请先停止运行");
  return state;
}

export async function importModelAsset(asset: AssetEntry, assets: AssetEntry[]) {
  assertModelPath(asset.name);
  const documentId = useEditorStore.getState().documentId;
  const buffer = await readModelAsset(asset, assets);
  const state = currentDocument(documentId);
  const id = state.addNode("model", asset.name.replace(/\.(glb|gltf)$/i, ""));
  state.updateTransform(id, { modelUrl: asset.name }, false);
  state.setModelBuffer(id, buffer);
  return id;
}

export async function relinkModelFile(nodeId: string, file: File) {
  assertModelPath(file.name);
  const documentId = useEditorStore.getState().documentId;
  const asset: AssetEntry = { id: file.name, name: file.name, path: file.name, type: "model", size: file.size, file };
  const key = JSON.stringify([documentId, nodeId]), token = {};
  replacements.set(key, token);
  try {
    const buffer = await readModelAsset(asset, [asset]);
    const state = currentDocument(documentId);
    if (replacements.get(key) !== token)
      throw new Error("模型替换已取消：已有更新的替换请求");
    if (!state.nodes.some((n) => n.id === nodeId && n.type === "model"))
      throw new Error("要重新链接的模型已删除");
    state.relinkModel(nodeId, buffer, file.name);
  } finally {
    if (replacements.get(key) === token) replacements.delete(key);
  }
}
