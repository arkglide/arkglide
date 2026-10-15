import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { compositionProject } from '../../scripts/composition-project.mjs';
import { RUNTIME_FILES, createStaticGame } from '../../src/export/static-game.mjs';
import { serveStatic } from '../../scripts/serve-static.mjs';

const fixture = new URL('../../.composition-browser-test/', import.meta.url);
const compiler = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
let project;
try {
  const { normalizeProject } = await compiler.ssrLoadModule('/src/utils/projectValidation.ts');
  project = normalizeProject(await compositionProject());
} finally { await compiler.close(); }
const runtime = Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async path => [path,
  new Uint8Array(await fs.readFile(new URL('../../public/' + path, import.meta.url)))])));
const game = createStaticGame(project, { models: new Map(), textures: new Map(), audio: new Map() }, runtime);
await fs.rm(fixture, { recursive: true, force: true }); await fs.mkdir(fixture, { recursive: true });
for (const [name, raw] of Object.entries(game.files)) {
  const path = new URL(name, fixture); await fs.mkdir(new URL('./', path), { recursive: true }); await fs.writeFile(path, raw);
}
const server = await serveStatic(fixture.pathname, 0);
let browser;
test.before(async () => { browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); });
test.after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });

test('composition lab connects real grab, plate, reflection, motion, projected bridge/field, saves, death retry and cleanup', { timeout: 90000 }, async () => {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let frame;
  try {
    await page.goto('http://127.0.0.1:' + server.address().port); await page.locator('#start').click();
    await page.waitForFunction(() => document.body.dataset.state === 'playing');
    frame = page.frames().find(f => f.url().includes('runtime.html?boot='));
    await frame.waitForFunction(() => globalThis.compositionLab?.status().ready || globalThis.compositionLab?.status().error);
    assert.equal((await frame.evaluate(() => compositionLab.status())).error, '');
    await frame.waitForFunction(() => compositionLab.status().receiver);
    assert.equal(await frame.evaluate(() => compositionLab.status().plate), false);
    assert.equal(await frame.evaluate(() => compositionLab.status().laserReflections), 1);

    await frame.evaluate(() => physicsRuntime.setState(sceneAPI.find('Player'), {
      position: { x: 3, y: 1.5, z: 3 }, velocity: { x: 0, y: 0, z: -8 },
    }));
    await frame.waitForFunction(() => compositionLab.status().crossings > 0);
    assert.ok(await frame.evaluate(() => physicsRuntime.getState(sceneAPI.find('Player')).position.x > 5));

    // Use the actual input-bound game interaction, then release before the plate test.
    await frame.evaluate(() => {
      physicsRuntime.setState(sceneAPI.find('Player'), { position: { x: -6, y: 1.1, z: 0 }, velocity: { x: 0, y: 0, z: 0 } });
      compositionLab.rig.update();
      const pos = compositionLab.rig.camera.getPose().position, target = sceneAPI.find('Crate').getWorldPosition();
      const direction = new BABYLON.Vector3(target.x - pos.x, target.y - pos.y, target.z - pos.z);
      compositionLab.rig.setRotation(ArkGlideSpatial.plainQ(ArkGlideSpatial.look(BABYLON, direction, BABYLON.Axis.Y)));
    });
    await frame.locator('#renderCanvas').press('e');
    await frame.waitForFunction(() => interactionRuntime.stats().physicsGrabs === 1);
    await frame.locator('#renderCanvas').press('e');
    await frame.waitForFunction(() => interactionRuntime.stats().physicsGrabs === 0);

    await frame.evaluate(() => physicsRuntime.setState(sceneAPI.find('Crate'), { position: { x: -2, y: .55, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }));
    await frame.waitForFunction(() => { const s = compositionLab.status(); return s.plate && s.unlocked && s.door.progress > .99 && s.bridgeSegments >= 2 && s.fieldSegments >= 2; });
    assert.ok(await frame.evaluate(() => physicsRuntime.getState(sceneAPI.find('Door')).position.y > 4.9));
    // A native ray must hit one of the generated convex bridge colliders.
    assert.equal(await frame.evaluate(() => {
      const hit = physicsRuntime.forOwner({ record: { active: true } }).raycast({ x: 6, y: 2, z: 6 }, { x: 0, y: -4, z: 0 });
      return !!hit && hit.entity.id.startsWith('visual:');
    }), true);

    // Keep the plate occupied with the player while testing real field acceleration on the crate.
    await frame.evaluate(() => physicsRuntime.setState(sceneAPI.find('Player'), { position: { x: -2, y: 1.1, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }));
    await frame.waitForFunction(() => triggersRuntime.stats().triggerMembers >= 2);
    await frame.evaluate(() => physicsRuntime.setState(sceneAPI.find('Crate'), { position: { x: 8, y: 1.7, z: 6 }, velocity: { x: 0, y: 0, z: 0 } }));
    await frame.waitForFunction(() => physicsRuntime.getState(sceneAPI.find('Crate')).velocity.x < -.05);
    await frame.evaluate(() => physicsRuntime.setState(sceneAPI.find('Crate'), { position: { x: 6, y: 1.1, z: 6 }, velocity: { x: 0, y: 0, z: 0 } }));
    await frame.waitForFunction(() => {
      const state = physicsRuntime.getState(sceneAPI.find('Crate'));
      return state.position.y > .85 && state.position.y < 1 && Math.abs(state.velocity.y) < .05;
    });
    await frame.evaluate(() => {
      physicsRuntime.setState(sceneAPI.find('Crate'), { position: { x: -2, y: .55, z: 0 }, velocity: { x: 0, y: 0, z: 0 } });
      physicsRuntime.setState(sceneAPI.find('Player'), { position: { x: -6, y: 1.1, z: -2 }, velocity: { x: 0, y: 0, z: 0 } });
    });
    await frame.waitForFunction(() => compositionLab.status().plate && compositionLab.status().door.progress > .99);
    assert.equal(await frame.evaluate(() => compositionLab.save()), true);
    await frame.evaluate(() => compositionLab.turnMirror());
    await frame.waitForFunction(() => !compositionLab.status().receiver && compositionLab.status().door.progress < .01);
    assert.equal(await frame.evaluate(() => compositionLab.retry()), true);
    await frame.waitForFunction(() => compositionLab.status().receiver && compositionLab.status().door.progress > .99);
    assert.equal(await frame.evaluate(() => compositionLab.status().mirrorTurned), false);

    await frame.evaluate(() => physicsRuntime.setState(sceneAPI.find('Player'), { position: { x: -6, y: -20, z: -2 }, velocity: { x: 0, y: 0, z: 0 } }));
    await frame.waitForFunction(() => !compositionLab.status().busy && sceneAPI.find('Player').getWorldPosition().y > 0);
    await frame.evaluate(() => physicsRuntime.setState(sceneAPI.find('Player'), { position: { x: 11, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }));
    await frame.waitForFunction(() => compositionLab.status().completed);
    assert.equal(await frame.evaluate(() => scriptErrors), 0);
    assert.deepEqual(errors, []);

    await page.locator('#stop').click(); await page.waitForFunction(() => document.body.dataset.state === 'stopped');
    const stats = await page.evaluate(() => ArkGlidePlayer.stats);
    for (const key of ['scripts', 'physicsBodies', 'physicsFields', 'physicsTriggers', 'signalNodes', 'signalListeners', 'motionControllers', 'opticalReflectors', 'visualResources']) assert.equal(stats[key], 0, key);
    await page.locator('#start').click(); await page.waitForFunction(() => document.body.dataset.state === 'playing');
    frame = page.frames().find(f => f.url().includes('runtime.html?boot='));
    await frame.waitForFunction(() => globalThis.compositionLab?.status().ready);
    assert.equal(await frame.evaluate(() => compositionLab.status().plate), false);
    assert.equal(await frame.evaluate(() => scriptErrors), 0);
    await page.locator('#stop').click(); await page.waitForFunction(() => document.body.dataset.state === 'stopped');
  } catch (error) {
    console.error('Composition diagnostics:', errors, await frame?.evaluate(() => ({ errors: globalThis.scriptErrors, state: globalThis.compositionLab?.status() })).catch(() => null));
    throw error;
  } finally { await page.close(); }
});
