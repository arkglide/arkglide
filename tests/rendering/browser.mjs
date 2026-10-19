import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { serveStatic } from "../../scripts/serve-static.mjs";
const root = new URL("../../", import.meta.url), fixture = new URL("work/rendering-static/", root);
await fs.rm(fixture, { recursive: true, force: true });
await fs.rm(new URL('work/rendering-static.zip', root), { force: true });
execFileSync(process.execPath, ["scripts/create-rendering-example.mjs"], { cwd: root });
execFileSync(process.execPath, ["scripts/export-static-game.mjs", "examples/rendering-lab.arkglide", "work/rendering-static"], { cwd: root });
const server = await serveStatic(fixture.pathname, 0);
let browser;
test.before(async () => {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, headless: true, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
});
test.after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });
test("exported lighting lab loads local resources, supports injected quality controls and releases rendering resources on stop", { timeout: 120000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } }), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.waitForSelector("iframe");
    const frame = page.frames().find(f => f.url().includes("/runtime.html"));
    await frame.waitForFunction(() => globalThis.running && globalThis.sceneAdapter?.rendering?.stats().renderDrawCalls > 0, { timeout: 90000 });
    const initial = await frame.evaluate(() => ({ ...sceneAdapter.rendering.stats(), ...portalRuntime.stats(), materials: sceneAdapter.materials.size, errors: scriptErrors, emit: sceneAdapter.materials.get("light").emissiveTexture?.gammaSpace, lightmap: sceneAdapter.materials.get("floor").lightmapTexture?.gammaSpace }));
    assert.equal(initial.renderQuality, "medium"); assert.equal(initial.environmentTextures, 1); assert.equal(initial.shadowLights, 1); assert.equal(initial.picturePipelines, 1);
    assert.equal(initial.emit, true); assert.equal(initial.lightmap, false); assert.equal(initial.errors, 0);
    await frame.locator("#renderCanvas").click(); await page.keyboard.press("1");
    await frame.waitForFunction(() => sceneAdapter.rendering.stats().renderQuality === "low");
    const low = await frame.evaluate(() => ({ ...sceneAdapter.rendering.stats(), ...portalRuntime.stats() }));
    assert.ok(low.portalRenderedPixels <= low.portalPixelBudget);
    await page.screenshot({ path: new URL("work/rendering-lab.png", root).pathname });
    await page.locator("iframe").evaluate(iframe => iframe.contentWindow.postMessage({ type: "stop", runId: globalThis.__arkglidePlayer?.getState?.().runId }, "*"));
    await frame.waitForFunction(() => !running && sceneAdapter.rendering.stats().environmentTextures === 0);
    const stopped = await frame.evaluate(() => sceneAdapter.rendering.stats());
    assert.equal(stopped.shadowLights, 0); assert.equal(stopped.picturePipelines, 0);
    assert.deepEqual(errors, []);
    await fs.writeFile(new URL("work/rendering-static-results.json", root), JSON.stringify({ initial, low, stopped }, null, 2));
  } finally { await page.close(); }
});
