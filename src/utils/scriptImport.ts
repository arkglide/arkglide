import { useEditorStore, type AssetEntry } from "../store/useEditorStore";

export async function importScriptAsset(asset: AssetEntry) {
  const initial = useEditorStore.getState();
  if (Object.hasOwn(initial.scripts, asset.name)) {
    initial.setActiveFile(asset.name);
    return;
  }
  const file = asset.fileHandle ? await asset.fileHandle.getFile() : asset.file;
  if (!file) throw new Error("无法读取脚本");
  const code = await file.text();
  const state = useEditorStore.getState();
  if (state.documentId !== initial.documentId)
    throw new Error("项目已切换，请重新导入脚本");
  if (!Object.hasOwn(state.scripts, asset.name)) {
    state.createScript(asset.name);
    state.updateScript(asset.name, code);
  }
  state.setActiveFile(asset.name);
}
