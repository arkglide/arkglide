import { useEditorStore, type AssetEntry } from "../store/useEditorStore";
import { assertScriptPath } from "./projectValidation";

export async function importScriptAsset(asset: AssetEntry) {
  const fileName = asset.path;
  assertScriptPath(fileName);
  const initial = useEditorStore.getState();
  if (Object.hasOwn(initial.scripts, fileName)) {
    initial.setActiveFile(fileName);
    return;
  }
  const file = asset.fileHandle ? await asset.fileHandle.getFile() : asset.file;
  if (!file) throw new Error("无法读取脚本");
  const code = await file.text();
  const state = useEditorStore.getState();
  if (state.documentId !== initial.documentId)
    throw new Error("项目已切换，请重新导入脚本");
  if (state.playState !== "stopped") throw new Error("请先停止运行，再导入脚本");
  if (!Object.hasOwn(state.scripts, fileName)) {
    state.createScript(fileName, code);
  }
  state.setActiveFile(fileName);
}
