import { test, expect } from "./fixtures";
import fs from "node:fs/promises";

test("panel help supports hover and keyboard; native offscreen culling preserves pixels while reducing draw calls", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForSelector("#viewport");
  await page.getByRole("tab", { name: "材质与预制体", exact: true }).click();
  await page.getByRole("tab", { name: "UI 画布", exact: true }).click();
  const layoutHelp = page.getByRole("button", {
    name: "布局帮助",
    exact: true,
  });
  await layoutHelp.hover();
  await expect(page.getByRole("tooltip")).toContainText("拖动元素调整位置");
  await page.keyboard.press("Escape");
  await page.mouse.move(5, 5);
  await layoutHelp.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("tooltip")).toContainText("一次拖动记录一次撤销");
  await page.keyboard.press("Escape");
  expect(await page.getByTestId("ui-editor-panel").innerText()).not.toContain(
    "拖动布局",
  );
  await page.getByRole("tab", { name: "音频混音", exact: true }).click();
  const busHelp = page.getByRole("button", { name: "总线帮助", exact: true });
  await busHelp.hover();
  await expect(page.getByRole("tooltip")).toContainText("UI 总线继续播放");
  await page.screenshot({
    path: info.outputPath("panel-help.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const { useEditorStore: store } =
      await import("/src/store/useEditorStore.ts");
    (window as any).renderStore = store;
    store.getState().play();
  });
  const runtime = page.frames().find((f) => f.url().includes("/runtime.html"))!;
  await runtime.waitForFunction(
    () => (window as any).running && !!(window as any).renderCompute,
  );
  // Reading help remains available while the surrounding form is read-only.
  await busHelp.focus();
  await expect(busHelp).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("tooltip")).toContainText("UI 总线继续播放");
  await page.keyboard.press("Escape");
  const result = await runtime.evaluate(async () => {
    const w = window as any,
      B = w.BABYLON,
      scene = w.scene,
      engine = w.engine;
    const camera = new B.FreeCamera(
      "batch-view",
      new B.Vector3(0, 0, -6),
      scene,
    );
    camera.setTarget(B.Vector3.Zero());
    const material = new B.StandardMaterial("batch-material", scene);
    material.disableLighting = true;
    material.emissiveColor = new B.Color3(1, 0.25, 0);
    material.backFaceCulling = false;
    const visible = B.MeshBuilder.CreateBox(
      "visible-batch-box",
      { size: 2 },
      scene,
    );
    visible.material = material;
    const meshes = [visible];
    for (let i = 0; i < 40; i++) {
      const m = B.MeshBuilder.CreateBox("outside-" + i, {}, scene);
      m.position.set(100 + i * 3, 0, 0);
      m.material = material;
      meshes.push(m);
    }
    const target = new B.RenderTargetTexture(
      "generic-offscreen-batch",
      128,
      scene,
      false,
      true,
    );
    target.activeCamera = camera;
    target.renderList = meshes;
    target.renderParticles = false;
    const draw = () => {
      const before = engine._drawCalls.current;
      target.render(false, false);
      return engine._drawCalls.current - before;
    };
    try {
      draw();
      draw();
      const fullDraws = draw(),
        full = await target.readPixels();
      let selectedCount = 0;
      target.getCustomRenderList = (
        _pass: any,
        list: any[],
        length: number,
      ) => {
        if (scene.activeCamera !== camera) return null;
        const selected = w.renderCompute.select(
          list,
          scene.frustumPlanes,
          length,
        );
        selectedCount = selected?.length ?? length;
        return selected;
      };
      const nativeDraws = draw(),
        selected = await target.readPixels();
      let difference = 0,
        colored = 0;
      for (let i = 0; i < full.length; i++)
        difference = Math.max(difference, Math.abs(full[i] - selected[i]));
      for (let i = 0; i < selected.length; i += 4)
        if (selected[i] > 150 && selected[i + 1] > 10) colored++;
      return {
        fullDraws,
        nativeDraws,
        selectedCount,
        difference,
        colored,
        stats: w.renderCompute.stats(),
      };
    } finally {
      target.dispose();
      for (const mesh of meshes) mesh.dispose();
      material.dispose();
      camera.dispose();
    }
  });
  expect(result.selectedCount).toBe(1);
  expect(result.difference).toBeLessThanOrEqual(1);
  expect(result.colored).toBeGreaterThan(100);
  expect(result.nativeDraws).toBeLessThan(result.fullDraws);
  expect(result.stats.renderCulledMeshes).toBeGreaterThanOrEqual(40);
  const report = info.outputPath("native-offscreen-render.json");
  await fs.writeFile(report, JSON.stringify(result, null, 2));
  await info.attach("native-offscreen-render.json", {
    path: report,
    contentType: "application/json",
  });
  await page.evaluate(() => (window as any).renderStore.getState().stop());
  await runtime.waitForFunction(() => (window as any).renderCompute === null);
  expect(errors).toEqual([]);
});
