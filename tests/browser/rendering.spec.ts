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

test("emissive textures bloom and grade once, including through a real portal view", async ({ page }) => {
  await page.goto("/runtime.html");
  await page.waitForFunction(() => !!(window as any).ArkGlideRendering);
  const result = await page.evaluate(async () => {
    const w = window as any, B = w.BABYLON;
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 128; document.body.append(canvas);
    const engine = new B.Engine(canvas, false, { preserveDrawingBuffer: true });
    const scene = new B.Scene(engine); scene.clearColor = new B.Color4(0, 0, 0, 1);
    const camera = new B.FreeCamera("view", new B.Vector3(0, 0, 5), scene); camera.setTarget(B.Vector3.Zero());
    const adapter = w.ArkGlideScene.createSceneAdapter(B, scene);
    const image = document.createElement("canvas"); image.width = image.height = 2;
    image.getContext("2d")!.fillStyle = "rgb(255,70,15)"; image.getContext("2d")!.fillRect(0, 0, 2, 2);
    const blob = await new Promise<Blob>(r => image.toBlob(b => r(b!))), bytes = await blob.arrayBuffer();
    const content: any = { textures: [{ id: "emit", mime: "image/png" }], materials: { mat: { id: "mat", name: "lamp", baseColor: "#000000", emissiveColor: "#FFFFFF", emissiveIntensity: 4, metallic: 0, roughness: 1, alpha: 1, doubleSided: false, uvScale: { u: 1, v: 1 } } } };
    const nodes = [{ id: "reference", name: "reference", type: "mesh", materialId: "mat", transform: { x: -2.5, y: 0, z: -2 } }, { id: "destination", name: "destination", type: "mesh", materialId: "mat", transform: { x: 10, y: 0, z: -2 } }];
    adapter.rendering.configure({ color: { toneMapping: "aces", exposure: 0.7 } });
    await adapter.sync(nodes, {}, content, { emit: bytes });
    const portals = w.ArkGlidePortals.create(B, { scene, physics: {}, getObject: () => null, find: () => null });
    const api = portals.forOwner({ record: { active: true }, track: () => () => {} });
    const a = api.create({ id: "a", shape: "rectangle", width: 2, height: 2, position: { x: 0, y: 0, z: 0 } });
    const b = api.create({ id: "b", shape: "rectangle", width: 2, height: 2, position: { x: 10, y: 0, z: 0 }, rotation: { x: 0, y: 1, z: 0, w: 0 } });
    a.link(b); api.setQuality({ depth: 1, samples: 1, maxViews: 2 });
    const draw = async () => {
      adapter.rendering.prepareFrame();
      await scene.whenReadyAsync();
      for (let i = 0; i < 8; i++) { portals.updateVisuals(); portals.render(); scene.render(); await new Promise(r => setTimeout(r, 20)); }
      return Array.from(await engine.readPixels(0, 0, 256, 128)) as number[];
    };
    const diff = (a: number[], b: number[]) => a.reduce((n, v, i) => n + (i % 4 === 3 ? 0 : Math.abs(v - b[i])), 0);
    try {
      const white = await draw();
      content.materials.mat.emissiveTextureId = "emit";
      await adapter.sync(nodes, {}, content, { emit: bytes });
      const orange = await draw();
      const projected = B.Vector3.Project(new B.Vector3(-2.5, 0, -2), B.Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(256, 128));
      const sample = (data: number[], x: number, y: number) => data.slice((Math.round(y) * 256 + Math.round(x)) * 4, (Math.round(y) * 256 + Math.round(x)) * 4 + 3);
      const direct = sample(orange, projected.x, 64), through = sample(orange, 128, 64);
      const targets = scene.textures.filter((t: any) => t.name.startsWith("__portal:target:"));
      const linearTargets = targets.every((t: any) => t.gammaSpace === false);
      adapter.rendering.configure({ color: { toneMapping: "aces", exposure: 0.7 }, bloom: { enabled: true, threshold: 0.1, weight: 0.6 } });
      const bloom = await draw();
      const bloomStats = adapter.rendering.stats(), bloomPasses = camera._postProcesses.filter(Boolean).map((p: any) => ({ name: p.name, ready: p.isReady() }));
      adapter.rendering.configure({ color: { toneMapping: "aces", exposure: 0.7, saturation: -100 } });
      const gray = await draw();
      const grayPixel = sample(gray, projected.x, 64);
      for (let i = 0; i < 3; i++) { adapter.rendering.configure({ bloom: { enabled: true } }); await draw(); adapter.rendering.configure(); await draw(); }
      const final = adapter.rendering.stats(), postCount = camera._postProcesses.filter(Boolean).length;
      return { emissiveDifference: diff(white, orange), bloomDifference: diff(orange, bloom), gradeDifference: diff(orange, gray), direct, through, grayPixel, linearTargets, emissiveGamma: adapter.materials.get("mat").emissiveTexture.gammaSpace, bloomStats, bloomPasses, final, postCount };
    } finally { portals.dispose(); adapter.dispose(); scene.dispose(); engine.dispose(); canvas.remove(); }
  });
  await test.info().attach("emissive-portal-pixels.json", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  expect(result.emissiveDifference).toBeGreaterThan(1000);
  expect(result.bloomDifference).toBeGreaterThan(1000);
  expect(result.gradeDifference).toBeGreaterThan(1000);
  expect(Math.max(...result.direct.map((n, i) => Math.abs(n - result.through[i])))).toBeLessThanOrEqual(3);
  expect(result.through[0]).toBeGreaterThan(50);
  expect(Math.max(...result.grayPixel) - Math.min(...result.grayPixel)).toBeLessThanOrEqual(3);
  expect(result.linearTargets).toBe(true);
  expect(result.emissiveGamma).toBe(true);
  expect(result.final.picturePipelines).toBe(0);
  expect(result.postCount).toBe(0);
});

test("baked lighting, AO and local reflection probes work through the shared scene adapter", async ({ page }) => {
  await page.goto("/runtime.html");
  await page.waitForFunction(() => !!(window as any).ArkGlideRendering);
  const result = await page.evaluate(async () => {
    const w = window as any, B = w.BABYLON;
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128; document.body.append(canvas);
    const engine = new B.Engine(canvas, false, { preserveDrawingBuffer: true });
    const scene = new B.Scene(engine);
    const camera = new B.FreeCamera("view", new B.Vector3(3, 4, -5), scene); camera.setTarget(new B.Vector3(0, 0.4, 0));
    scene.clearColor = new B.Color4(0, 0, 0, 1);
    const adapter = w.ArkGlideScene.createSceneAdapter(B, scene);
    const material = { id: "mat", name: "test", baseColor: "#999999", emissiveColor: "#000000", metallic: 0, roughness: 0.4, alpha: 1, doubleSided: false, uvScale: { u: 1, v: 1 } };
    const content: any = { textures: [], materials: { mat: material } }, buffers: any = {};
    const header = new TextEncoder().encode("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 4 +X 8\n");
    const hdr = new Uint8Array(header.length + 8 * 4 * 4); hdr.set(header);
    for (let i = header.length; i < hdr.length; i += 4) hdr.set([200, 70, 30, 129], i);
    content.textures.push({ id: "hdr", mime: "image/vnd.radiance" }); buffers.hdr = hdr.buffer;
    adapter.rendering.configure({ environment: { textureId: "hdr" } });
    const nodes = [
      { id: "ground", name: "ground", type: "mesh", primitive: "plane", materialId: "mat", scale: { x: 8, y: 1, z: 8 } },
      { id: "box", name: "box", type: "mesh", materialId: "mat", transform: { x: 0, y: 0.5, z: 0 } },
      { id: "light", name: "light", type: "light", lightType: "hemispheric", intensity: 1 },
    ];
    const draw = async () => {
      await scene.whenReadyAsync();
      for (let i = 0; i < 6; i++) { scene.render(); await new Promise(r => setTimeout(r, 20)); }
      return Array.from(await engine.readPixels(0, 0, 128, 128)) as number[];
    };
    const diff = (a: number[], b: number[]) => a.reduce((n, v, i) => n + (i % 4 === 3 ? 0 : Math.abs(v - b[i])), 0);
    const png = async (id: string, color: string) => {
      const c = document.createElement("canvas"); c.width = c.height = 2;
      const context = c.getContext("2d")!; context.fillStyle = color; context.fillRect(0, 0, 2, 2);
      const blob = await new Promise<Blob>(r => c.toBlob(b => r(b!)));
      buffers[id] = await blob.arrayBuffer(); content.textures.push({ id, mime: "image/png" });
    };
    try {
      await adapter.sync(nodes, {}, content, buffers);
      for (const id of ["ground", "box"]) {
        const mesh = adapter.nodes.get(id); mesh.setVerticesData(B.VertexBuffer.UV2Kind, mesh.getVerticesData(B.VertexBuffer.UVKind));
      }
      const plain = await draw();
      await png("baked", "rgb(180,80,30)");
      content.materials.mat = { ...material, lightmapTextureId: "baked", lightmapUV: 1, lightmapIntensity: 1.5 };
      await adapter.sync(nodes, {}, content, buffers);
      const baked = await draw();
      const bakedGamma = adapter.materials.get("mat").lightmapTexture.gammaSpace;
      const bakedUV = adapter.materials.get("mat").lightmapTexture.coordinatesIndex;
      await png("ao", "rgb(15,15,15)");
      content.materials.mat = { ...material, aoTextureId: "ao" };
      await adapter.sync(nodes, {}, content, buffers);
      const textureAO = await draw();
      content.materials.mat = { ...material };
      adapter.rendering.configure({ environment: { textureId: "hdr" }, ao: { enabled: true, radius: 2, strength: 2, samples: 16 } });
      await adapter.sync(nodes, {}, content, buffers);
      const ssao = await draw();
      const aoStats = adapter.rendering.stats();
      adapter.rendering.configure({ environment: { textureId: "hdr" } });
      await adapter.sync(nodes, {}, content, buffers); await draw();
      const env = await B.EnvironmentTextureTools.CreateEnvTextureAsync(scene.environmentTexture);
      content.textures.push({ id: "local", mime: "application/x-babylon-env" }); buffers.local = env;
      adapter.rendering.configure({ probes: [{ id: "room", name: "room", textureId: "local", position: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 4, z: 4 } }] });
      await adapter.sync(nodes, {}, content, buffers); await draw();
      const box = adapter.nodes.get("box"), base = adapter.materials.get("mat");
      const inside = box.material !== base && !!box.material.reflectionTexture.boundingBoxSize;
      box.position.x = 8; await draw();
      const outside = box.material === base;
      adapter.clear();
      return { bakedDifference: diff(plain, baked), textureAODifference: diff(plain, textureAO), ssaoDifference: diff(plain, ssao), bakedGamma, bakedUV, aoStats, inside, outside, cleared: adapter.rendering.stats() };
    } finally { adapter.dispose(); scene.dispose(); engine.dispose(); canvas.remove(); }
  });
  await test.info().attach("lighting-pixels.json", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  expect(result.bakedDifference).toBeGreaterThan(1000);
  expect(result.textureAODifference).toBeGreaterThan(1000);
  expect(result.ssaoDifference).toBeGreaterThan(100);
  expect(result.bakedGamma).toBe(false);
  expect(result.bakedUV).toBe(1);
  expect(result.aoStats.aoEnabled).toBe(true);
  expect(result.inside).toBe(true);
  expect(result.outside).toBe(true);
  expect(result.cleared.reflectionProbes).toBe(0);
});
