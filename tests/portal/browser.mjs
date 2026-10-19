import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { serveStatic } from "../../scripts/serve-static.mjs";
import {tmpdir} from "node:os";
import path from "node:path";
import {unzipSync,zipSync,strFromU8,strToU8} from "fflate";
const root = new URL("../../", import.meta.url),
  fixture = new URL(".portal-browser-test/", root);
await fs.rm(fixture, { recursive: true, force: true });
await fs.rm(new URL('.portal-browser-test.zip', root), { force: true });
execFileSync(process.execPath, ["scripts/create-portal-example.mjs"], {
  cwd: root,
});
execFileSync(process.execPath, ["scripts/sync-runtime.mjs"], { cwd: root });
// Exercise native batches even in this small regression scene, without changing
// the shipped demo's project settings or the engine's general-purpose defaults.
const temporary = await fs.mkdtemp(path.join(tmpdir(),"arkglide-render-portal-"));
try {
  const archive=unzipSync(new Uint8Array(await fs.readFile(new URL("examples/portal-lab.arkglide",root)))), project=JSON.parse(strFromU8(archive["project.json"]));
  project.settings.renderCompute={normalsMinVertices:0,cullMinMeshes:0,boundsMinChangedFraction:0};
  archive["project.json"]=strToU8(JSON.stringify(project));
  const source=path.join(temporary,"native-render.arkglide");
  await fs.writeFile(source,zipSync(archive));
  execFileSync(process.execPath,["scripts/export-static-game.mjs",source,".portal-browser-test"],{cwd:root});
} finally {await fs.rm(temporary,{recursive:true,force:true});}
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
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
    try {
      await page.goto(url);
      await page.evaluate(() => ArkGlidePlayer.start());
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
      assert.equal(await frame.evaluate(() => renderCompute.stats().renderComputeBackend),"cpp-wasm");
      assert.ok(await frame.evaluate(() => renderCompute.stats().renderCullBatches)>0);
      assert.ok(await frame.evaluate(() => renderCompute.stats().renderNativeBounds)>0);
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
      await page.evaluate(() => ArkGlidePlayer.pause());
      await frame.waitForFunction(
        () => !running && document.pointerLockElement === null,
      );
      const timeBefore = await frame.evaluate(() => time.totalTime);
      await page.waitForTimeout(100);
      assert.equal(await frame.evaluate(() => time.totalTime), timeBefore);
      await page.evaluate(() => ArkGlidePlayer.pause());
      await frame.waitForFunction(() => running);
      // Chromium can expose pointerLockElement before dispatching the change event.
      // Wait for that event, whose input handler clears held keys, before sending F.
      await frame.evaluate(() => {
        globalThis.__resumedLockReady = false;
        document.addEventListener('pointerlockchange', function locked() {
          if (document.pointerLockElement !== document.getElementById('renderCanvas')) return;
          globalThis.__resumedLockReady = true;
          document.removeEventListener('pointerlockchange', locked);
        });
      });
      await canvas.click({ position: { x: 300, y: 300 } });
      await frame.waitForFunction(() => __resumedLockReady && document.pointerLockElement === document.getElementById('renderCanvas'));
      await frame.waitForFunction(() => document.hasFocus());
      await frame.evaluate(() => { globalThis.__modeKeys = []; window.addEventListener('keydown', e => __modeKeys.push([e.code, e.target.tagName])); });
      async function switchMode(mode) {
        await frame.waitForFunction(() => document.hasFocus() && document.pointerLockElement === document.getElementById('renderCanvas'));
        await page.keyboard.down('f');
        try {
          await frame.waitForFunction(mode => document.querySelector('[data-hud-id="mode"]').textContent.includes(mode), mode, { timeout: 5000 });
        } catch (error) {
          throw Error(mode + ': ' + JSON.stringify(await frame.evaluate(() => ({ keys: __modeKeys, active: document.activeElement.tagName, focus:document.hasFocus(), visibility:document.visibilityState, pointerLocked:!!document.pointerLockElement, timeScale:time.timeScale, stats:inputRuntime.stats(), running, errors: scriptErrors, mode: document.querySelector('[data-hud-id="mode"]').textContent, key: inputRuntime.input.isKeyDown('f') }))), { cause: error });
        } finally { await page.keyboard.up('f'); }
        const rendered = await frame.evaluate(() => time.unscaledTotalTime);
        await frame.waitForFunction(before => time.unscaledTotalTime > before, rendered);
      }
      await switchMode('thirdPerson');
      await switchMode('observer');
      await switchMode('firstPerson');
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
      await page.evaluate(() => ArkGlidePlayer.stop());
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
        await page.evaluate(() => ArkGlidePlayer.start());
        await page.waitForFunction(
          () => document.body.dataset.state === "playing",
        );
        const f = page
          .frames()
          .find((f) => f.url().includes("runtime.html?boot="));
        await f.waitForFunction(() => globalThis.portalDemo);
        assert.equal(await f.evaluate(() => scriptErrors), 0);
        await page.evaluate(() => ArkGlidePlayer.stop());
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
      await page.evaluate(() => ArkGlidePlayer.start());
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

test('portal stays rendered inside the camera near plane and uses native resolution with configurable MSAA', { timeout: 90000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  try {
    await page.goto(url); await page.evaluate(() => ArkGlidePlayer.start());
    await page.waitForFunction(() => document.body.dataset.state === 'playing');
    const frame = page.frames().find(f => f.url().includes('runtime.html?boot='));
    await frame.waitForFunction(() => globalThis.portalDemo && portalRuntime.stats().portalRenderedViews > 0);
    const result = await frame.evaluate(async () => {
      engine.stopRenderLoop();
      const B = BABYLON, a = portalDemo.blue, b = portalDemo.orange;
      portalDemo.portals.setQuality({ depth: 1, scale: 1, samples: 4 });
      const pa = a.getPose(), pb = b.getPose();
      const matrix = pose => B.Matrix.Compose(B.Vector3.One(), new B.Quaternion(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w), new B.Vector3(pose.position.x, pose.position.y, pose.position.z));
      const na = B.Vector3.TransformNormal(B.Axis.Z, matrix(pa)), nb = B.Vector3.TransformNormal(B.Axis.Z, matrix(pb));
      const marker = B.MeshBuilder.CreatePlane('near-plane-marker', { size: 30, sideOrientation: B.Mesh.DOUBLESIDE }, scene);
      marker.position.copyFrom(new B.Vector3(pb.position.x, pb.position.y, pb.position.z).add(nb.scale(3)));
      marker.rotationQuaternion = new B.Quaternion(pb.rotation.x, pb.rotation.y, pb.rotation.z, pb.rotation.w);
      const material = new B.StandardMaterial('near-plane-red', scene);
      material.disableLighting = true; material.emissiveColor = new B.Color3(1, 0, 0); marker.material = material;
      for (const mesh of scene.meshes) if (mesh !== marker && !mesh.name.includes(':view') && !mesh.name.includes(':rim')) mesh.setEnabled(false);
      const camera = scene.activeCamera, rotation = ArkGlideSpatial.look(B, na.negate(), Math.abs(na.y) > .9 ? B.Axis.Z : B.Axis.Y);
      camera.minZ = .1;
      const measurements = [];
      for (const distance of [.3, .08, .01, .002, .0002]) {
        ArkGlideSpatial.write(B, camera, new B.Vector3(pa.position.x, pa.position.y, pa.position.z).add(na.scale(distance)), rotation);
        for (let i = 0; i < 5; i++) { portalRuntime.render(); scene.render(); await new Promise(r => setTimeout(r, 16)); }
        const pixels = await engine.readPixels(Math.floor(engine.getRenderWidth() / 2) - 4, Math.floor(engine.getRenderHeight() / 2) - 4, 8, 8);
        let red = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 180 && pixels[i + 1] < 50 && pixels[i + 2] < 50) red++;
        measurements.push({ distance, red });
      }
      const target = scene.getMeshByName('blue:view').material.getActiveTextures()[0];
      const native = { size: target.getSize(), samples: target.samples, width: engine.getRenderWidth(true), height: engine.getRenderHeight(true), maxSamples: engine.getCaps().maxMSAASamples };
      portalDemo.portals.setQuality({ scale: .5, samples: 1 }); portalRuntime.render(); scene.render();
      const lower = scene.getMeshByName('blue:view').material.getActiveTextures()[0];
      return { measurements, native, lower: { size: lower.getSize(), samples: lower.samples }, errors: scriptErrors };
    });
    for (const sample of result.measurements) assert.equal(sample.red, 64, `exit remains visible at eye distance ${sample.distance}`);
    assert.equal(result.native.size.width, result.native.width); assert.equal(result.native.size.height, result.native.height);
    assert.equal(result.native.samples, Math.min(4, result.native.maxSamples));
    assert.equal(result.lower.size.width, Math.round(result.native.width * .5));
    assert.equal(result.lower.samples, 1); assert.equal(result.errors, 0);
  } finally { await page.close(); }
});

test('a rendered body stays visible on every sampled frame as its source and ghost swap sides', { timeout: 90000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  try {
    await page.goto(url); await page.evaluate(() => ArkGlidePlayer.start());
    await page.waitForFunction(() => document.body.dataset.state === 'playing');
    const frame = page.frames().find(f => f.url().includes('runtime.html?boot='));
    await frame.waitForFunction(() => globalThis.portalDemo && portalRuntime.stats().portalRenderedViews > 0);
    const result = await frame.evaluate(async () => {
      engine.stopRenderLoop();
      const B = BABYLON, a = portalDemo.blue, b = portalDemo.orange, api = portalDemo.physics;
      portalDemo.portals.setQuality({ depth: 1, samples: 1 }); a.unlink();
      a.setPose({ position: { x: 0, y: 20, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });
      b.setPose({ position: { x: 8, y: 20, z: 0 }, rotation: B.Quaternion.RotationAxis(B.Axis.Y, -Math.PI / 2) }); a.link(b);
      const e = sceneAPI.find('Crate1'), mesh = entityAPI.getObject(e.id);
      for (const other of scene.meshes) if (other !== mesh && !other.name.includes(':view') && !other.name.includes(':rim')) other.setEnabled(false);
      const material = new B.StandardMaterial('crossing-red', scene);
      material.disableLighting = true; material.emissiveColor = new B.Color3(1, 0, 0); mesh.material = material;
      ArkGlideSpatial.write(B, scene.activeCamera, { x: 0, y: 20, z: 3 }, B.Quaternion.RotationAxis(B.Axis.Y, Math.PI));
      api.setState(e, { position: { x: 0, y: 20, z: .8 }, velocity: { x: 0, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });
      for (let i = 0; i < 6; i++) { portalRuntime.updateVisuals(); portalRuntime.render(); scene.render(); await new Promise(r => setTimeout(r, 16)); }
      api.setState(e, { position: { x: 0, y: 20, z: .3 }, velocity: { x: 0, y: 0, z: -2 } });
      const samples = [], before = portalRuntime.stats().portalTraversals;
      for (let i = 0; i < 16; i++) {
        const velocity = api.getState(e).velocity;
        api.setState(e, { velocity: { ...velocity, y: 0 } });
        portalRuntime.step(1 / 60); portalRuntime.updateVisuals(); portalRuntime.render(); scene.render();
        const pixels = await engine.readPixels(Math.floor(engine.getRenderWidth() / 2) - 4, Math.floor(engine.getRenderHeight() / 2) - 4, 8, 8);
        let red = 0; for (let j = 0; j < pixels.length; j += 4) if (pixels[j] > 180 && pixels[j + 1] < 50 && pixels[j + 2] < 50) red++;
        samples.push(red); await new Promise(r => setTimeout(r, 16));
      }
      return { samples, crossed: portalRuntime.stats().portalTraversals - before, errors: scriptErrors };
    });
    assert.equal(result.crossed, 1); assert.equal(result.errors, 0);
    result.samples.forEach((red, i) => assert.equal(red, 64, `body remains visible on frame ${i}`));
  } finally { await page.close(); }
});
