import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { createServer } from "vite";
import { chromium } from "playwright";
import {
  createStaticGame,
  RUNTIME_FILES,
} from "../../src/export/static-game.mjs";
import { serveStatic } from "../../scripts/serve-static.mjs";
const root = new URL("../../", import.meta.url),
  fixture = new URL("../../.package-browser-test/", import.meta.url),
  B = globalThis.ArkGlideBinary;
const compiler = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
let project;
const archive = unzipSync(
  new Uint8Array(
    await fs.readFile(new URL("examples/fourth-static.arkglide", root)),
  ),
);
try {
  const { normalizeProject } = await compiler.ssrLoadModule(
    "/src/utils/projectValidation.ts",
  );
  project = normalizeProject(JSON.parse(strFromU8(archive["project.json"])));
} finally {
  await compiler.close();
}
const maps = {
  models: new Map(
    project.modelRefs.map((r) => [
      r.assetId,
      archive["assets/" + r.fileName].slice().buffer,
    ]),
  ),
  textures: new Map(
    project.content.textures.map((r) => [
      r.id,
      archive["textures/" + encodeURIComponent(r.id) + ".bin"].slice().buffer,
    ]),
  ),
  audio: new Map(
    project.content.audio.map((r) => [
      r.id,
      archive["audio/" + encodeURIComponent(r.id) + ".bin"].slice().buffer,
    ]),
  ),
};
const runtime = Object.fromEntries(
  await Promise.all(
    RUNTIME_FILES.map(async (path) => [
      path,
      new Uint8Array(await fs.readFile(new URL("public/" + path, root))),
    ]),
  ),
);
// A silent bootstrap makes lazy-load assertions independent of demo timers.
project.scripts = {
  "entry.js":
    "export default function({levels,assets}){globalThis.packageProbe={levels,assets};return {onStart(){console.log('package-ready');}};}",
};
for (const n of project.scene.nodes) n.scripts = [];
project.scene.nodes[0].scripts = ["entry.js"];
for (const p of Object.values(project.content.prefabs))
  for (const n of p.nodes) n.scripts = [];
// Give a prefab-only GLB unique content so demand loading is measurable even
// though the example otherwise shares the same model bytes with the entry scene.
const lazyKey = Object.values(
  Object.values(project.content.prefabs).find(
    (p) => Object.values(p.modelKeys).length,
  ).modelKeys,
)[0];
const original = new Uint8Array(maps.models.get(lazyKey)),
  view = new DataView(original.buffer),
  jsonSize = view.getUint32(12, true);
const gltf = JSON.parse(
  new TextDecoder().decode(original.subarray(20, 20 + jsonSize)),
);
gltf.extras = { lazyPackageFixture: true };
const json = new TextEncoder().encode(JSON.stringify(gltf)),
  padded = Math.ceil(json.length / 4) * 4,
  unique = new Uint8Array(original.length - jsonSize + padded);
unique.set(original.subarray(0, 20));
unique.fill(32, 20, 20 + padded);
unique.set(json, 20);
unique.set(original.subarray(20 + jsonSize), 20 + padded);
new DataView(unique.buffer).setUint32(8, unique.length, true);
new DataView(unique.buffer).setUint32(12, padded, true);
maps.models.set(lazyKey, unique.buffer);
const game = createStaticGame(project, maps, runtime, {
  nodesPerChunk: 3,
  batchNodes: 2,
  logLimit: 5,
});
const boot = B.decode(game.files[game.manifest.boot.path]),
  catalog = Object.assign(
    {},
    ...boot.indexes.map((d) => B.decode(game.files[d.path])),
  );
await fs.rm(fixture, { recursive: true, force: true });
await fs.mkdir(fixture, { recursive: true });
for (const folder of ["", "deep/demo/"])
  for (const [path, raw] of Object.entries(game.files)) {
    const file = new URL(folder + path, fixture);
    await fs.mkdir(new URL("./", file), { recursive: true });
    await fs.writeFile(file, raw);
  }
const server = await serveStatic(fixture.pathname, 0),
  url = "http://127.0.0.1:" + server.address().port;
let browser;
test.before(async () => {
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
});
test.after(async () => {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
});
async function playing(page) {
  await page.waitForFunction(
    () => ["playing", "error"].includes(ArkGlidePlayer.state),
    null,
    { timeout: 45000 },
  );
  assert.equal(
    await page.evaluate(() => ArkGlidePlayer.state),
    "playing",
    await page.locator("#loadingLog").textContent(),
  );
  return page.frames().find((f) => f.url().includes("runtime.html?boot="));
}
for (const subpath of ["", "/deep/demo"])
  test(
    "automatic binary boot, terminal cleanup, lazy prefab resource leases and restart at " +
      (subpath || "/"),
    { timeout: 90000 },
    async () => {
      const page = await browser.newPage(),
        errors = [],
        requested = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => requested.push(new URL(r.url()).pathname));
      let release;
      const gate = new Promise((r) => (release = r));
      await page.route("**/" + game.manifest.boot.path, async (route) => {
        await gate;
        try {
          await route.continue();
        } catch {}
      });
      try {
        await page.goto(url + subpath + "/");
        await page.waitForFunction(() =>
          document.getElementById("loadingLog").textContent.includes("boot/"),
        );
        assert.equal(
          await page.locator("#start,#stop,#pause,progress,header").count(),
          0,
        );
        assert.ok(
          (await page.locator("#loadingLog").textContent()).startsWith("> "),
        );
        release();
        const frame = await playing(page);
        assert.equal(await page.locator("#loadingLog").textContent(), "");
        assert.equal(await page.locator("#boot").isVisible(), false);
        assert.equal(await page.locator("#gameLog").isVisible(), false);
        const template = Object.values(project.content.prefabs).find(
            (p) => Object.values(p.modelKeys).length,
          ),
          key = Object.values(template.modelKeys)[0],
          prefabPath = catalog["prefab:" + template.id].path,
          modelPath = catalog["model:" + key].path;
        assert.equal(
          requested.some((p) => p.endsWith("/" + prefabPath)),
          false,
        );
        assert.equal(
          requested.some((p) => p.endsWith("/" + modelPath)),
          false,
        );
        const initial = await frame.evaluate(() => packageRuntime.stats());
        for (let i = 0; i < 2; i++) {
          await frame.evaluate(async (id) => {
            globalThis.spawned = await prefabLibrary.api.instantiate(id);
          }, template.id);
          assert.ok(requested.some((p) => p.endsWith("/" + prefabPath)));
          assert.ok(requested.some((p) => p.endsWith("/" + modelPath)));
          assert.equal(
            await frame.evaluate((key) => !!runtimeModelData[key], key),
            true,
          );
          await frame.evaluate(() => spawned.destroy());
          await frame.waitForFunction(
            (expected) => packageRuntime.stats().packageResources === expected,
            initial.packageResources,
          );
          assert.equal(
            await frame.evaluate((key) => !!runtimeModelData[key], key),
            false,
          );
          assert.equal(
            await frame.evaluate(
              (id) => runtimeContent.prefabs[id].nodes.length,
              template.id,
            ),
            0,
          );
        }
        assert.equal(await frame.evaluate(() => scriptErrors), 0);
        await page.evaluate(() => ArkGlidePlayer.stop());
        assert.equal(
          await page.evaluate(() => ArkGlidePlayer.state),
          "stopped",
        );
        const stats = await page.evaluate(() => ArkGlidePlayer.stats);
        for (const key of [
          "packageResources",
          "packageGroups",
          "packageIndexes",
          "packageModules",
          "entities",
          "physicsBodies",
          "audioBuffers",
        ])
          assert.equal(stats[key], 0, key);
        await page.evaluate(() => ArkGlidePlayer.start());
        await playing(page);
        assert.deepEqual(errors, []);
      } finally {
        release();
        await page.close();
      }
    },
  );
test(
  "game log visibility is explicit and bounded; same-size binary corruption fails with retry UI",
  { timeout: 90000 },
  async () => {
    const page = await browser.newPage();
    try {
      await page.route("**/game-manifest.json", async (route) => {
        const response = await route.fetch(),
          manifest = await response.json();
        manifest.settings.showLogs = true;
        manifest.settings.logLimit = 5;
        await route.fulfill({ json: manifest });
      });
      await page.goto(url);
      const frame = await playing(page);
      assert.equal(await page.locator("#gameLog").isVisible(), true);
      await frame.evaluate(() => {
        for (let i = 0; i < 12; i++) console.log("line-" + i);
      });
      await page.waitForFunction(() =>
        document.getElementById("logs").textContent.includes("line-11"),
      );
      const logs = await page.locator("#logs").textContent();
      assert.equal(logs.split("\n").length, 5);
      assert.ok(!logs.includes("line-0\n"));
      await page.evaluate(() => ArkGlidePlayer.stop());
      await page.route("**/" + boot.scene[0].path, async (route) => {
        const response = await route.fetch(),
          raw = new Uint8Array(await response.body());
        raw[raw.length - 1] ^= 1;
        await route.fulfill({ body: Buffer.from(raw) });
      });
      await page.evaluate(() => ArkGlidePlayer.start());
      await page.waitForFunction(() => ArkGlidePlayer.state === "error");
      assert.match(await page.locator("#loadingLog").textContent(), /校验失败/);
      assert.equal(await page.locator("#retry").isVisible(), true);
      await page.unroute("**/" + boot.scene[0].path);
      await page.locator("#retry").click();
      await playing(page);
    } finally {
      await page.close();
    }
  },
);
test(
  "stopping during a delayed chunk read cannot resurrect the runtime",
  { timeout: 90000 },
  async () => {
    const page = await browser.newPage();
    let release,
      requested = false;
    const gate = new Promise((r) => (release = r));
    try {
      await page.route("**/" + boot.scene[0].path, async (route) => {
        requested = true;
        await gate;
        try {
          await route.continue();
        } catch {}
      });
      await page.goto(url);
      await page.waitForFunction(
        () => globalThis.ArkGlidePlayer?.state === "initializing",
      );
      for (let i = 0; i < 200 && !requested; i++) await page.waitForTimeout(20);
      assert.equal(requested, true);
      await page.evaluate(() => ArkGlidePlayer.stop());
      release();
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => ArkGlidePlayer.state), "stopped");
      assert.equal(page.frames().length, 1);
      await page.unroute("**/" + boot.scene[0].path);
      await page.evaluate(() => ArkGlidePlayer.start());
      await playing(page);
    } finally {
      release();
      await page.close();
    }
  },
);
