import type { AssetEntry } from '../store/useEditorStore';

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (part === '..') {
      if (!parts.length) throw new Error('glTF 关联资源路径不能越过资源根目录: ' + path);
      parts.pop();
    }
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}
export async function readModelAsset(asset: AssetEntry, assets: AssetEntry[]): Promise<ArrayBuffer> {
  const read = async (entry: AssetEntry) => {
    const file = entry.fileHandle ? await entry.fileHandle.getFile() : entry.file;
    if (!file) throw new Error('无法读取资源: ' + entry.path);
    return file.arrayBuffer();
  };
  const buffer = await read(asset);
  if (!/\.gltf$/i.test(asset.name)) return buffer;
  // Inline local glTF sidecars, so the stored/exported document is self-contained.
  const gltf = JSON.parse(new TextDecoder().decode(buffer));
  const base = asset.path.slice(0, asset.path.lastIndexOf('/') + 1);
  const entries = [...(gltf.buffers || []), ...(gltf.images || [])];
  const buffers = new Set(gltf.buffers || []);
  for (const entry of entries) {
    if (!entry.uri || /^data:/i.test(entry.uri)) continue;
    const path = normalizePath(base + decodeURIComponent(entry.uri.split(/[?#]/, 1)[0]));
    const sidecar = assets.find(a => normalizePath(a.path) === path);
    if (!sidecar) throw new Error('glTF 缺少关联资源: ' + path + '，请选择包含资源的文件夹');
    const bytes = new Uint8Array(await read(sidecar));
    if (buffers.has(entry)) {
      if (!Number.isInteger(entry.byteLength) || entry.byteLength <= 0)
        throw new Error('glTF 缓冲区声明大小无效: ' + path);
      if (bytes.byteLength < entry.byteLength)
        throw new Error('glTF 缓冲区数据不足: ' + path);
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    entry.uri = 'data:application/octet-stream;base64,' + btoa(binary);
  }
  return new TextEncoder().encode(JSON.stringify(gltf)).buffer;
}
