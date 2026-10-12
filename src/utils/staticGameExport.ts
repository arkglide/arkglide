import { useEditorStore } from '../store/useEditorStore';
import { captureEditorProject } from './projectRecovery';
import { normalizeProject } from './projectValidation';
import { RUNTIME_FILES, createStaticGame, type StaticExportSettings } from '../export/static-game.mjs';
export async function createEditorStaticGame(settings: StaticExportSettings, signal?: AbortSignal, onProgress?: (done: number, total: number) => void) {
  const state = useEditorStore.getState();
  if (state.playState !== 'stopped') throw Error('请先停止运行，再导出独立游戏');
  // Capture every mutable project value before asynchronous I/O.
  const project = normalizeProject(structuredClone(captureEditorProject(state)));
  const maps = { models: new Map(state.modelBuffers), textures: new Map(state.textureBuffers), audio: new Map(state.audioBuffers) };
  const runtime: Record<string, Uint8Array> = {};
  let done = 0;
  for (const path of RUNTIME_FILES) {
    signal?.throwIfAborted();
    const response = await fetch(import.meta.env.BASE_URL + path, {signal});
    if (!response.ok) throw Error('运行时文件加载失败: ' + path + ' HTTP ' + response.status);
    runtime[path] = new Uint8Array(await response.arrayBuffer());
    onProgress?.(++done, RUNTIME_FILES.length);
  }
  signal?.throwIfAborted();
  return createStaticGame(project, maps, runtime, settings);
}
export async function exportStaticGame(settings: StaticExportSettings, signal?: AbortSignal, onProgress?: (done:number,total:number) => void) {
  const game = await createEditorStaticGame(settings, signal, onProgress);
  signal?.throwIfAborted();
  const zip = game.zip();
  signal?.throwIfAborted();
  const url = URL.createObjectURL(new Blob([zip.slice().buffer], {type:'application/zip'}));
  const a = document.createElement('a'); a.href = url;
  a.download = (game.manifest.settings.title.replace(/[\\/:*?"<>|]/g, '_') || 'ArkGlide') + '-static.zip'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return game.manifest;
}
