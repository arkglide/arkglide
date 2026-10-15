import { createStaticGame } from "./static-game.mjs";
self.onmessage = (event: MessageEvent) => {
  try {
    const { project, maps, runtime, settings } = event.data;
    self.postMessage({ stage: "编译脚本、分块场景并校验资源" });
    const game = createStaticGame(project, maps, runtime, settings);
    self.postMessage({ stage: "压缩运行包" });
    const zip = game.zip(),
      buffers = new Set<ArrayBuffer>();
    if (event.data.includeFiles)
      for (const value of Object.values(game.files))
        buffers.add(value.buffer as ArrayBuffer);
    buffers.add(zip.buffer as ArrayBuffer);
    self.postMessage(
      {
        files: event.data.includeFiles ? game.files : undefined,
        manifest: game.manifest,
        zip,
      },
      { transfer: [...buffers] },
    );
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
