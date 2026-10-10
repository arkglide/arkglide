import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { useEditorStore } from "../store/useEditorStore";
import { normalizeProject } from "./projectValidation";
import { captureEditorProject } from "./projectRecovery";

export function createProjectArchive(): Uint8Array {
  const state = useEditorStore.getState(),
    data = normalizeProject(captureEditorProject(state)),
    files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  data.modelRefs = data.modelRefs.map((ref) => {
    const original = ref.fileName.split(/[\\/]/).pop() || "model.glb";
    let fileName = original,
      i = 1;
    while (used.has(fileName)) {
      const dot = original.lastIndexOf(".");
      fileName =
        dot > 0
          ? original.slice(0, dot) + "_" + i++ + original.slice(dot)
          : original + "_" + i++;
    }
    used.add(fileName);
    const buffer = state.modelBuffers.get(ref.assetId);
    if (buffer) files["assets/" + fileName] = new Uint8Array(buffer);
    return { ...ref, fileName };
  });
  for (const t of data.content?.textures || []) {
    const b = state.textureBuffers.get(t.id);
    if (b) files[texturePath(t.id)] = new Uint8Array(b);
  }
  files["project.json"] = strToU8(JSON.stringify(data, null, 2));
  return zipSync(files);
}
function texturePath(id: string) {
  return "textures/" + encodeURIComponent(id) + ".bin";
}
export function exportProject(): void {
  const blob = new Blob([new Uint8Array(createProjectArchive()).buffer], {
      type: "application/octet-stream",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download =
    (useEditorStore.getState().currentProjectName || "未命名项目") +
    ".arkglide";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function importProject(file: File): Promise<void> {
  const bytes = await file.arrayBuffer();
  let expanded = 0;
  const files = unzipSync(new Uint8Array(bytes), {
    filter(entry) {
      expanded += entry.originalSize;
      if (expanded > 512 * 1024 * 1024)
        throw new Error("项目解压大小超过 512 MiB");
      return true;
    },
  });
  if (!files["project.json"])
    throw new Error("无效的 .arkglide 文件：缺少 project.json");
  const project = normalizeProject(
      JSON.parse(strFromU8(files["project.json"])),
    ),
    buffers = new Map<string, ArrayBuffer>(),
    missing = new Set<string>(),
    textures = new Map<string, ArrayBuffer>();
  for (const ref of project.modelRefs) {
    const b = files["assets/" + ref.fileName];
    if (b) buffers.set(ref.assetId, b.slice().buffer);
    else missing.add(ref.assetId);
  }
  for (const t of project.content?.textures || []) {
    const b = files[texturePath(t.id)];
    if (b) {
      if (b.byteLength !== t.byteLength)
        throw new Error("贴图文件大小不一致: " + t.name);
      textures.set(t.id, b.slice().buffer);
    }
  }
  useEditorStore
    .getState()
    .replaceProject(
      { ...project, projectId: "", updatedAt: Date.now() },
      buffers,
      missing,
      true,
      undefined,
      textures,
    );
  useEditorStore.getState().addConsoleLog("log", "项目已导入: " + project.name);
}
