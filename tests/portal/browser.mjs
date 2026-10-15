import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { serveStatic } from "../../scripts/serve-static.mjs";
const root = new URL("../../", import.meta.url),
  fixture = new URL(".portal-browser-test/", root);
await fs.rm(fixture, { recursive: true, force: true });
execFileSync(process.execPath, ["scripts/create-portal-example.mjs"], {
  cwd: root,
});
execFileSync(process.execPath, ["scripts/sync-runtime.mjs"], { cwd: root });
execFileSync(
  process.execPath,
  [
    "scripts/export-static-game.mjs",
    "examples/portal-lab.arkglide",
    ".portal-browser-test",
  ],
  { cwd: root },
);
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
  await new Promise((r) => server.close(r));
});
test(
  "independent portal runtime: recursive render, pointer lock, mouse look, all views, launch, pause and clean restart",
  { timeout: 120000 },
  async () => {
    const page = await browser.newPage({
        viewport: { width: 1100, height: 760 },
      }),
      errors = [],
      logs = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") logs.push(m.text());
    });
    try {
      await page.goto(url);
      await page.locator("#start").click();
      await page.waitForFunction(
        () => document.body.dataset.state === "playing",
      );
      const frame = page
        .frames()
        .find((f) => f.url().includes("runtime.html?boot="));
      await frame.waitForFunction(
        () =>
          globalThis.portalDemo &&
          portalRuntime.stats().portalRenderedViews > 0,
      );
      assert.equal(await frame.evaluate(() => scriptErrors), 0);
      const before = await frame.evaluate(() => ({
        view: scene.activeCamera.getViewMatrix().asArray(),
        clip: scene.clipPlane,
        clip2: scene.clipPlane2,
        stats: portalRuntime.stats(),
      }));
      assert.ok(before.clip == null);
      assert.ok(before.clip2 == null);
      assert.ok(before.stats.portalViews >= 2);
      assert.ok(before.stats.portalRenderedViews <= 24);
      const canvas = frame.locator("#renderCanvas");
      await canvas.click({ position: { x: 550, y: 380 } });
      await frame.waitForFunction(
        () =>
          document.pointerLockElement ===
          document.getElementById("renderCanvas"),
      );
      const orientation = await frame.evaluate(
        () => portalDemo.rig.camera.getPose().rotation,
      );
      await page.mouse.move(620, 390, { steps: 4 });
      await page.waitForTimeout(300);
      // Headless CDP sends canceling recenter events under lock. A relative PointerEvent
      // verifies the input-to-rig path independently of that virtual mouse behavior.
      await frame.evaluate(() =>
        document
          .getElementById("renderCanvas")
          .dispatchEvent(
            new PointerEvent("pointermove", {
              movementX: 32,
              movementY: 0,
              bubbles: true,
            }),
          ),
      );
      await page.waitForTimeout(80);
      const changed = await frame.evaluate(
        () => portalDemo.rig.camera.getPose().rotation,
      );
      assert.notDeepEqual(changed, orientation);
      // Pause from the parent releases the lock and freezes simulation.
      await page.locator("#pause").evaluate((e) => e.click());
      await frame.waitForFunction(
        () => !running && document.pointerLockElement === null,
      );
      const timeBefore = await frame.evaluate(() => time.totalTime);
      await page.waitForTimeout(100);
      assert.equal(await frame.evaluate(() => time.totalTime), timeBefore);
      await page.locator("#pause").click();
      await frame.waitForFunction(() => running);
      await canvas.click({ position: { x: 300, y: 300 } });
      await page.keyboard.press("f");
      await frame.waitForFunction(() =>
        document
          .querySelector('[data-hud-id="mode"]')
          .textContent.includes("thirdPerson"),
      );
      await page.keyboard.press("f");
      await frame.waitForFunction(() =>
        document
          .querySelector('[data-hud-id="mode"]')
          .textContent.includes("observer"),
      );
      await page.keyboard.press("f");
      await frame.evaluate(() => {
        portalDemo.pair(true);
        portalDemo.physics.setState(portalDemo.player, {
          position: { x: 4, y: 10, z: 4 },
          velocity: { x: 0, y: 0, z: 0 },
        });
      });
      await frame.waitForFunction(() => portalDemo.traversals > 0, {
        timeout: 30000,
      });
      const launch = await frame.evaluate(() =>
        portalDemo.physics.getState(portalDemo.player),
      );
      assert.ok(launch.velocity.x < -5);
      assert.ok(launch.position.x < 12);
      await frame.evaluate(() =>
        portalDemo.portals.setQuality({ depth: 3, scale: 0.5, maxViews: 8 }),
      );
      await page.waitForTimeout(100);
      assert.ok(
        await frame.evaluate(
          () => portalRuntime.stats().portalRenderedViews <= 8,
        ),
      );
      assert.equal(await frame.evaluate(() => scriptErrors), 0);
      await page.locator("#stop").evaluate((e) => e.click());
      await page.waitForFunction(
        () => document.body.dataset.state === "stopped",
      );
      const cleaned = await page.evaluate(() => ArkGlidePlayer.stats);
      for (const key of [
        "portals",
        "portalSurfaces",
        "portalTravelers",
        "portalClones",
        "portalViews",
        "runtimeCameras",
        "cameraRigs",
        "physicsGrabs",
      ])
        assert.equal(cleaned[key], 0, key);
      for (let i = 0; i < 2; i++) {
        await page.locator("#start").click();
        await page.waitForFunction(
          () => document.body.dataset.state === "playing",
        );
        const f = page
          .frames()
          .find((f) => f.url().includes("runtime.html?boot="));
        await f.waitForFunction(() => globalThis.portalDemo);
        assert.equal(await f.evaluate(() => scriptErrors), 0);
        await page.locator("#stop").click();
        await page.waitForFunction(
          () => document.body.dataset.state === "stopped",
        );
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(logs, []);
    } finally {
      await page.close();
    }
  },
);

test(
  "portal textures contain rendered geometry, clip the exit backside and restore the main camera",
  { timeout: 60000 },
  async () => {
    const page = await browser.newPage({
      viewport: { width: 1100, height: 760 },
    });
    try {
      await page.goto(url);
      await page.locator("#start").click();
      await page.waitForFunction(
        () => document.body.dataset.state === "playing",
      );
      const frame = page
        .frames()
        .find((f) => f.url().includes("runtime.html?boot="));
      await frame.waitForFunction(
        () => portalRuntime?.stats().portalRenderedViews > 0,
      );
      await page.waitForTimeout(300);
      const sample = () =>
        frame.evaluate(async () => {
          const target = scene
              .getMeshByName("blue:view")
              .material.getActiveTextures()[0],
            pixels = await target.readPixels();
          let red = 0,
            magenta = 0;
          const colors = new Set();
          for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i],
              g = pixels[i + 1],
              b = pixels[i + 2];
            colors.add(r + "," + g + "," + b);
            if (r > 80 && g < r * 0.7 && b < r * 0.9) red++;
            if (r > 200 && g < 30 && b > 200) magenta++;
          }
          return { colors: colors.size, red, magenta };
        });
      const initial = await sample();
      assert.ok(initial.colors > 20, "RT has actual geometry");
      assert.ok(
        initial.red > 10,
        "destination marker is visible in the rendered portal",
      );
      await frame.evaluate(() => {
        const mesh = BABYLON.MeshBuilder.CreateBox(
          "backside-occluder",
          { width: 0.5, height: 20, depth: 20 },
          scene,
        );
        mesh.position.set(13.5, 1.6, 4);
        const material = new BABYLON.StandardMaterial(
          "backside-magenta",
          scene,
        );
        material.disableLighting = true;
        material.emissiveColor = new BABYLON.Color3(1, 0, 1);
        mesh.material = material;
      });
      await page.waitForTimeout(100);
      const clipped = await sample();
      assert.equal(
        clipped.magenta,
        0,
        "geometry behind the exit plane is discarded",
      );
      assert.ok(clipped.red > 10);
      const restored = await frame.evaluate(() => {
        const camera = scene.activeCamera,
          before = Array.from(camera.getViewMatrix(true).m),
          clip = scene.clipPlane2;
        portalRuntime.render();
        return {
          sameCamera: scene.activeCamera === camera,
          sameView: before.every(
            (v, i) => v === camera.getViewMatrix(true).m[i],
          ),
          sameClip: scene.clipPlane2 === clip,
          errors: scriptErrors,
        };
      });
      assert.deepEqual(restored, {
        sameCamera: true,
        sameView: true,
        sameClip: true,
        errors: 0,
      });
    } finally {
      await page.close();
    }
  },
);
