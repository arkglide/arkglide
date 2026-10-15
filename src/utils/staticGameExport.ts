import { useEditorStore } from "../store/useEditorStore";
import { captureEditorProject } from "./projectRecovery";
import { normalizeProject } from "./projectValidation";
import { RUNTIME_FILES } from "../export/runtime-files.mjs";
import type { StaticExportSettings } from "../export/static-game.mjs";
export async function createEditorStaticGame(
  settings: StaticExportSettings,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number, stage?: string) => void,
  includeFiles = false,
) {
  const state = useEditorStore.getState();
  if (state.playState !== "stopped")
    throw Error("请先停止运行，再导出独立游戏");
  // Capture every mutable project value before asynchronous I/O.
  const project = normalizeProject(
    structuredClone(captureEditorProject(state)),
  );
  const maps = {
    models: new Map(state.modelBuffers),
    textures: new Map(state.textureBuffers),
    audio: new Map(state.audioBuffers),
  };
  const runtime: Record<string, Uint8Array> = {};
  let done = 0;
  for (const path of RUNTIME_FILES) {
    signal?.throwIfAborted();
    const response = await fetch(import.meta.env.BASE_URL + path, { signal });
    if (!response.ok)
      throw Error("运行时文件加载失败: " + path + " HTTP " + response.status);
    runtime[path] = new Uint8Array(await response.arrayBuffer());
    onProgress?.(++done, RUNTIME_FILES.length);
  }
  signal?.throwIfAborted();
  return new Promise<{
    files?: Record<string, Uint8Array>;
    manifest: any;
    zip: () => Uint8Array;
  }>((resolve, reject) => {
    const worker = new Worker(
      new URL("../export/game-build.worker.ts", import.meta.url),
      { type: "module" },
    );
    const abort = () => {
      worker.terminate();
      reject(new DOMException("导出已取消", "AbortError"));
    };
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      worker.terminate();
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    worker.onmessage = (event) => {
      const result = event.data;
      if (result.stage) {
        onProgress?.(done, RUNTIME_FILES.length, result.stage);
        return;
      }
      finish();
      if (result.error) reject(Error(result.error));
      else
        resolve({
          files: result.files,
          manifest: result.manifest,
          zip: () => result.zip,
        });
    };
    worker.onerror = (event) => {
      finish();
      reject(Error(event.message));
    };
    // Clone editor buffers; transferring them would detach the live project.
    worker.postMessage({ project, maps, runtime, settings, includeFiles });
  });
}
export function downloadStaticGame(game: {
  manifest: any;
  zip: () => Uint8Array;
}) {
  const zip = game.zip(),
    url = URL.createObjectURL(
      new Blob([zip.buffer as ArrayBuffer], { type: "application/zip" }),
    );
  const a = document.createElement("a");
  a.href = url;
  a.download =
    (game.manifest.settings.title.replace(/[\\/:*?"<>|]/g, "_") || "ArkGlide") +
    "-static.zip";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportStaticGame(
  settings: StaticExportSettings,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number, stage?: string) => void,
) {
  const game = await createEditorStaticGame(settings, signal, onProgress);
  signal?.throwIfAborted();
  downloadStaticGame(game);
  return game.manifest;
}
