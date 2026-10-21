import { useEditorStore, type AssetEntry } from "../store/useEditorStore";
import {getEditorScene} from '../engine/editor-scene';
import '../engine/ktx2-runtime.js';
const replacements = new Map<string, object>();
export async function importTextureAsset(asset: AssetEntry): Promise<string> {
  const documentId = useEditorStore.getState().documentId;
  const file = asset.fileHandle ? await asset.fileHandle.getFile() : asset.file;
  if (useEditorStore.getState().documentId !== documentId)
    throw new Error("项目已切换，请重新导入贴图");
  if (!file) throw new Error("无法读取贴图");
  return importTextureFile(file);
}
/** Decode before mutating the document; replacement retains the texture ID and all references. */
export async function importTextureFile(
  file: File,
  replaceId?: string,
): Promise<string> {
  const documentId = useEditorStore.getState().documentId;
  if (file.size <= 0 || file.size > 64 * 1024 * 1024)
    throw new Error("贴图大小需在 0～64 MiB 之间");
  const key = replaceId ? JSON.stringify([documentId, replaceId]) : null, token = {};
  if (key) replacements.set(key, token);
  try {
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
            : [0x86, 0x16, 0x87, 0x96, 0xf6, 0xd6, 0x96, 0x36].every((v, i) => b[i] === v)
              ? "application/x-babylon-env"
              : /^#\?(?:RADIANCE|RGBE)\r?\n/.test(new TextDecoder().decode(b.slice(0, 32)))
                ? "image/vnd.radiance" : (globalThis as any).ArkGlideKTX2.isKTX2(b)?'image/ktx2':null;
    if (!mime) throw new Error("请选择 PNG、JPEG、WebP、KTX2、.env 或 .hdr 贴图");
    if(mime==='image/ktx2'){
      let caps:Record<string,boolean>={};
      try{const c=getEditorScene().scene.getEngine().getCaps();caps=Object.fromEntries(['astc','bptc','s3tc','pvrtc','etc2','etc1'].map(k=>[k,!!(c as any)[k]]));}catch{/* Validation before viewport startup uses the RGBA fallback. */}
      await (globalThis as any).ArkGlideKTX2.validate(bytes,caps);
    } else
    if (mime === "application/x-babylon-env") {
      const end = b.indexOf(0, 8);
      if (end < 0) throw new Error("环境贴图头损坏");
      let header;
      try { header = JSON.parse(new TextDecoder().decode(b.slice(8, end))); }
      catch { throw new Error("环境贴图头损坏"); }
      if (!Number.isInteger(header.width) || header.width < 1 || header.width > 8192 || !header.specular?.mipmaps?.length)
        throw new Error("环境贴图缺少预过滤数据");
    } else if (mime === "image/vnd.radiance") {
      const header = new TextDecoder().decode(b.slice(0, 16384));
      const size = /-Y\s+(\d+)\s+\+X\s+(\d+)/.exec(header);
      if (!header.includes("FORMAT=32-bit_rle_rgbe") || !size || +size[1] < 1 || +size[2] < 1 || +size[1] > 8192 || +size[2] > 16384)
        throw new Error("不支持或损坏的 Radiance HDR 贴图");
    } else {
      const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
      bitmap.close();
    }
    const state = useEditorStore.getState();
    if (key && replacements.get(key) !== token)
      throw new Error("贴图替换已取消：已有更新的替换请求");
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
  } finally {
    if (key && replacements.get(key) === token) replacements.delete(key);
  }
}
