import { useEditorStore } from "../store/useEditorStore";
/** Decode before mutating the document; replacement retains the texture ID and all references. */
export async function importTextureFile(
  file: File,
  replaceId?: string,
): Promise<string> {
  const documentId = useEditorStore.getState().documentId;
  if (file.size <= 0 || file.size > 64 * 1024 * 1024)
    throw new Error("贴图大小需在 0～64 MiB 之间");
  const bytes = await file.arrayBuffer(),
    b = new Uint8Array(bytes);
  const mime =
    b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71
      ? "image/png"
      : b[0] === 255 && b[1] === 216
        ? "image/jpeg"
        : new TextDecoder().decode(b.slice(0, 4)) === "RIFF" &&
            new TextDecoder().decode(b.slice(8, 12)) === "WEBP"
          ? "image/webp"
          : null;
  if (!mime) throw new Error("请选择 PNG、JPEG 或 WebP 贴图");
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
  bitmap.close();
  const state = useEditorStore.getState();
  if (state.documentId !== documentId)
    throw new Error("项目已切换，请重新导入贴图");
  if (replaceId && !state.content.textures.some((t) => t.id === replaceId))
    throw new Error("要替换的贴图已删除");
  const id = replaceId || crypto.randomUUID();
  state.importTexture(
    { id, name: file.name, mime, byteLength: bytes.byteLength },
    bytes,
  );
  return id;
}
