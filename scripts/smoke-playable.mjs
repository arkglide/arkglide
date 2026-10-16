import { preview } from "vite";
import { chromium } from "@playwright/test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
const source = fileURLToPath(new URL("../", import.meta.url));
const output = new URL(
  "../test-results/production-smoke.json",
  import.meta.url,
);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const exampleFile =
  process.env.ARKGLIDE_SMOKE_EXAMPLE || "collect-gems.arkglide";
const server = await preview({
  root: source,
  preview: { host: "127.0.0.1", port: 5198, strictPort: true },
});
const browser = await chromium.launch({
  executablePath,
  args: executablePath
    ? [
        "--no-sandbox",
        "--no-zygote",
        "--single-process",
        "--in-process-gpu",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ]
    : [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  const C = window.AudioContext;
  if (!C) return;
  const original = C.prototype.createBufferSource;
  C.prototype.createBufferSource = function () {
    const b = original.call(this),
      start = b.start;
    b.start = function (...args) {
      window.__played = (window.__played || 0) + 1;
      window.__duration = b.buffer?.duration;
      return start.apply(b, args);
    };
    return b;
  };
});
const check = (value, message) => {
  if (!value) throw new Error(message);
};
try {
  await page.goto("http://127.0.0.1:5198");
  await page.waitForSelector("#viewport");
  await page
    .locator('input[accept=".arkglide"]')
    .setInputFiles(
      fileURLToPath(new URL("../examples/" + exampleFile, import.meta.url)),
    );
  const runtime = page.frames().find((f) => f.url().endsWith("/runtime.html"));
  await runtime.waitForFunction(
    () => window.joltModule && window.math?.backend === "wasm",
    undefined,
    { polling: 50 },
  );
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await runtime.waitForFunction(
    () =>
      window.running &&
      Math.abs(window.sceneAPI.find("Player").position.y - 0.5) < 0.05,
    undefined,
    { polling: 50 },
  );
  await runtime.getByRole("button", { name: "启用音频", exact: true }).click();
  await runtime.waitForFunction(
    () => window.audioRuntime.stats().audioState === "running",
    undefined,
    { polling: 50 },
  );
  await runtime
    .locator("#renderCanvas")
    .click({ position: { x: 150, y: 100 } });
  await page.keyboard.down("d");
  await runtime.waitForFunction(
    () =>
      document.querySelector('[data-hud-id="score"]').textContent === "分数：1",
    undefined,
    { polling: 50 },
  );
  await runtime.waitForFunction(
    () => window.sceneAPI.find("Player").position.x > 2.9,
    undefined,
    { polling: 50 },
  );
  await page.keyboard.up("d");
  const played = await runtime.evaluate(() => ({
    backend: physicsRuntime.stats().physicsBackend,
    x: sceneAPI.find("Player").position.x,
    score: document.querySelector('[data-hud-id="score"]').textContent,
    audioStarts: window.__played,
    duration: window.__duration,
    errors: scriptErrors,
  }));
  check(
    played.backend === "jolt-wasm" &&
      played.x < 3.1 &&
      played.score === "分数：1" &&
      played.audioStarts >= 1 &&
      played.duration > 0 &&
      played.errors === 0,
    "production gameplay mismatch " + JSON.stringify(played),
  );
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await runtime.waitForFunction(
    () => window.desiredState === "paused",
    undefined,
    { polling: 50 },
  );
  const clock = await runtime.evaluate(() => time.totalTime);
  await page.waitForTimeout(150);
  check(
    (await runtime.evaluate(() => time.totalTime)) === clock,
    "pause advances game",
  );
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await runtime.waitForFunction(() => entityMap.size === 0, undefined, {
    polling: 50,
  });
  const stopped = await runtime.evaluate(() =>
    Object.assign(
      { entities: entityMap.size, pending: prefabLibrary.pendingCount },
      session.stats(),
      physicsRuntime.stats(),
      audioRuntime.stats(),
      animationRuntime.stats(),
      inputRuntime.stats(),
    ),
  );
  for (const key of [
    "entities",
    "pending",
    "scripts",
    "timers",
    "subscriptions",
    "listeners",
    "physicsBodies",
    "physicsSubscriptions",
    "audioVoices",
    "audioBuffers",
    "animationPlayers",
    "hudElements",
    "inputHeld",
  ])
    check(stopped[key] === 0, key + " leaked");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出为 .arkglide 文件", exact: true })
    .click();
  const download = await downloadPromise;
  const archivePath = new URL(
    "../test-results/production-project.arkglide",
    import.meta.url,
  );
  await download.saveAs(fileURLToPath(archivePath));
  const files = unzipSync(fs.readFileSync(archivePath)),
    project = JSON.parse(strFromU8(files["project.json"]));
  check(
    project.version === "0.5" &&
      project.content.gameplay.hud.length === 7 &&
      files["audio/coin.bin"].length === 8864,
    "export loses gameplay",
  );
  if (exampleFile === "collect-gems-modules.arkglide") {
    check(
      project.scripts["main.js"].includes("import { movement }") &&
        project.scripts["movement.js"].includes("export const speed"),
      "export loses JavaScript modules",
    );
  }
  check(
    project.scene.nodes.find((n) => n.id === "Player").transform.y === 2,
    "play dirtied source scene",
  );
  await page
    .getByRole("button", { name: "恢复记录（恢复副本已保存）", exact: true })
    .waitFor();
  await page.reload();
  await page.waitForSelector("#viewport");
  const dialog = page.getByRole("dialog", { name: "项目恢复" });
  await dialog.waitFor();
  await dialog
    .getByText(project.name, { exact: true })
    .first()
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "恢复", exact: true })
    .click();
  await page.getByRole("tab", { name: "材质与预制体", exact: true }).click();
  await page.getByRole("tab", { name: "音频 (1)", exact: true }).click();
  await page
    .getByTestId("audio-panel")
    .getByText(/收集音效.wav/)
    .first()
    .waitFor();
  check(errors.length === 0, "page errors " + JSON.stringify(errors));
  const report = {
    passed: true,
    exampleFile,
    played,
    stopped,
    archive: { version: project.version, audioBytes: 8864, hud: 7, sourceY: 2 },
    recovery: true,
    pageErrors: errors,
  };
  fs.mkdirSync(new URL("../test-results/", import.meta.url), {
    recursive: true,
  });
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
