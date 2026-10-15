export function exportSettings(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Invalid build settings");
  const title = String(input.title || "ArkGlide Game").trim();
  if (!title || title.length > 120) throw Error("游戏标题应为 1～120 个字符");
  const fit = input.fit || "responsive";
  if (!["responsive", "contain"].includes(fit)) throw Error("无效运行尺寸模式");
  const width = input.width ?? 1280,
    height = input.height ?? 720;
  if (
    ![width, height].every((v) => Number.isInteger(v) && v >= 240 && v <= 7680)
  )
    throw Error("设计尺寸必须是 240～7680 的整数");
  const result = {
    title,
    fit,
    width,
    height,
    protectCode: input.protectCode ?? true,
    showLogs: input.showLogs ?? false,
    maxIndexChunks: input.maxIndexChunks ?? 16,
    nodesPerChunk: input.nodesPerChunk ?? 256,
    indexEntriesPerChunk: input.indexEntriesPerChunk ?? 128,
    batchNodes: input.batchNodes ?? 128,
    concurrency: input.concurrency ?? 4,
    maxChunkBytes: input.maxChunkBytes ?? 64 * 1024 * 1024,
    logLimit: input.logLimit ?? 200,
    loadTimeout: input.loadTimeout ?? 120000,
    preload: input.preload ?? [],
  };
  for (const key of ["protectCode", "showLogs"])
    if (typeof result[key] !== "boolean")
      throw Error("Invalid build option: " + key);
  for (const key of [
    "maxIndexChunks",
    "nodesPerChunk",
    "indexEntriesPerChunk",
    "batchNodes",
    "concurrency",
    "maxChunkBytes",
    "logLimit",
    "loadTimeout",
  ])
    if (!Number.isSafeInteger(result[key]) || result[key] < 1)
      throw Error("Invalid build budget: " + key);
  if (
    result.concurrency > 32 ||
    result.nodesPerChunk > 4096 ||
    result.indexEntriesPerChunk > 4096 ||
    result.maxChunkBytes > 512 * 1024 * 1024
  )
    throw Error("Build budget exceeded");
  if (
    !Array.isArray(result.preload) ||
    result.preload.some((k) => typeof k !== "string" || !k.includes(":"))
  )
    throw Error("Invalid preload resource keys");
  return result;
}
