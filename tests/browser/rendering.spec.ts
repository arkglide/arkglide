import { test, expect } from "./fixtures";

test("soft shadows, environment IBL and exposure change actual WebGL pixels", async ({ page }) => {
  await page.goto("/runtime.html");
  await page.waitForFunction(() => !!(window as any).ArkGlideRendering);
  const result = await page.evaluate(async () => {
    const w = window as any, B = w.BABYLON;
    const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 128; document.body.append(canvas);
    const engine = new B.Engine(canvas, false, { preserveDrawingBuffer: true });
    const scene = new B.Scene(engine);
    scene.clearColor = new B.Color4(0, 0, 0, 1);
    const camera = new B.FreeCamera("test", new B.Vector3(4, 5, -6), scene); camera.setTarget(new B.Vector3(0, 0.5, 0));
    const light = new B.DirectionalLight("sun", new B.Vector3(-1, -2, 1), scene); light.position.set(3, 6, -3);
    light.metadata = { arkglideRendering: { castShadows: true } };
    const ground = B.MeshBuilder.CreateGround("floor", { width: 10, height: 10 }, scene);
    const box = B.MeshBuilder.CreateBox("box", { size: 1.5 }, scene); box.position.y = 0.75;
    for (const mesh of [ground, box]) {
      mesh.metadata = { arkglideRendering: {} };
      const mat = new B.PBRMaterial(mesh.name, scene); mat.albedoColor.set(0.6, 0.6, 0.6); mat.metallic = 0; mat.roughness = 0.5; mesh.material = mat;
    }
    const manager = w.ArkGlideRendering.create(B, scene);
    const draw = async () => {
      await scene.whenReadyAsync();
      for (let i = 0; i < 5; i++) { scene.render(); await new Promise(r => setTimeout(r, 20)); }
      return Array.from(await engine.readPixels(0, 0, 128, 128)) as number[];
    };
    const diff = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + (i % 4 === 3 ? 0 : Math.abs(v - b[i])), 0);
    try {
      await manager.sync();
      const plain = await draw();
      manager.configure({ shadows: { enabled: true, mapSize: 512 } });
      const shadow = await draw();
      manager.configure({ color: { exposure: 0.35, toneMapping: "aces" } });
      const exposure = await draw();
      light.intensity = 0;
      const dark = await draw();
      const header = new TextEncoder().encode("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 4 +X 8\n");
      const hdr = new Uint8Array(header.length + 8 * 4 * 4); hdr.set(header);
      for (let i = header.length; i < hdr.length; i += 4) hdr.set([180, 120, 80, 129], i);
      manager.configure({ environment: { textureId: "hdr" }, color: { toneMapping: "aces" } });
      await manager.sync({ textures: [{ id: "hdr", mime: "image/vnd.radiance" }] }, { hdr: hdr.buffer });
      const ibl = await draw();
      const stats = manager.stats(); manager.clear();
      return { shadowDifference: diff(plain, shadow), exposureDifference: diff(shadow, exposure), iblDifference: diff(dark, ibl), stats, cleared: manager.stats() };
    } finally { manager.dispose(); scene.dispose(); engine.dispose(); canvas.remove(); }
  });
  expect(result.shadowDifference).toBeGreaterThan(1000);
  expect(result.exposureDifference).toBeGreaterThan(1000);
  expect(result.iblDifference).toBeGreaterThan(1000);
  expect(result.stats.environmentTextures).toBe(1);
  expect(result.cleared.environmentTextures).toBe(0);
});
