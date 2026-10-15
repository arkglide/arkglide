// An empty independently exported game isolates scheduling from scene/GPU load.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createStaticGame, RUNTIME_FILES } from "../src/export/static-game.mjs";
import { serveStatic } from "./serve-static.mjs";

const frameCount = Number(process.env.BENCH_RAF_FRAMES || 180);
if (!Number.isSafeInteger(frameCount) || frameCount < 30)
  throw Error("BENCH_RAF_FRAMES must be an integer >= 30");
const folder = await fs.mkdtemp(
  path.join(os.tmpdir(), "arkglide-frame-bench-"),
);
let server, browser;
try {
  const runtime = Object.fromEntries(
    await Promise.all(
      RUNTIME_FILES.map(async (name) => [
        name,
        new Uint8Array(
          await fs.readFile(new URL("../public/" + name, import.meta.url)),
        ),
      ]),
    ),
  );
  const project = {
    version: "1",
    name: "Frame pacing benchmark",
    projectId: "frame-benchmark",
    scene: { nodes: [] },
    scripts: {},
    assets: [],
    modelRefs: [],
    content: { prefabs: {} },
    settings: { fpsCap: 60 },
  };
  const game = createStaticGame(
    project,
    { models: new Map(), textures: new Map(), audio: new Map() },
    runtime,
    { protectCode: false },
  );
  for (const [name, bytes] of Object.entries(game.files)) {
    const target = path.join(folder, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  }
  server = await serveStatic(folder, 0);
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.waitForFunction(() =>
    ["playing", "error"].includes(ArkGlidePlayer.state),
  );
  if ((await page.evaluate(() => ArkGlidePlayer.state)) !== "playing")
    throw Error(await page.locator("#loadingLog").textContent());
  const frame = page
    .frames()
    .find((f) => f.url().includes("runtime.html?boot="));
  const cases = [];
  for (const cap of [30, 60, 0]) {
    cases.push(
      await frame.evaluate(
        async ({ cap, frameCount }) => {
          applySettings({ fpsCap: cap });
          // Allow warmup, shader compilation and the changed cap to settle.
          for (let i = 0; i < 30; i++) await new Promise(requestAnimationFrame);
          let rendered = 0,
            callbacks = 0,
            first;
          const observer = scene.onAfterRenderObservable.add(() => rendered++);
          return new Promise((resolve) => {
            function sample(now) {
              if (first === undefined) {
                first = now;
                rendered = 0;
              } else callbacks++;
              if (callbacks < frameCount) {
                requestAnimationFrame(sample);
                return;
              }
              scene.onAfterRenderObservable.remove(observer);
              const seconds = (now - first) / 1000;
              resolve({
                cap,
                callbacks,
                rendered,
                rafFps: callbacks / seconds,
                renderedFps: rendered / seconds,
                renderedPerCallback: rendered / callbacks,
              });
            }
            requestAnimationFrame(sample);
          });
        },
        { cap, frameCount },
      ),
    );
  }
  console.log(
    JSON.stringify(
      {
        browser: await browser.version(),
        viewport: "320x240",
        scene: "empty",
        renderer: "SwiftShader",
        cases,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await fs.rm(folder, { recursive: true, force: true });
}
