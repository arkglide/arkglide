import { test, expect } from "./fixtures";
import fs from "node:fs/promises";
import { unzipSync } from "fflate";
import { serveStatic } from "../../scripts/serve-static.mjs";

test("C++ logical runtime and styled HUD work in the editor and an independently exported game", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForSelector("#viewport");
  await page.waitForFunction(() =>
    performance
      .getEntriesByType("resource")
      .some((r) => r.name.includes("/@babylonjs_core.js?")),
  );
  await page.evaluate(async () => {
    (window as any).coreStore = (
      await import("/src/store/useEditorStore.ts")
    ).useEditorStore;
    const coreUrl = performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .find((url) => url.includes("/@babylonjs_core.js?"))!;
    const B = await import(coreUrl);
    (window as any).coreEditorFrames = 0;
    B.EngineStore.LastCreatedScene.onAfterRenderObservable.add(
      () => (window as any).coreEditorFrames++,
    );
  });
  await page.getByRole("tab", { name: "材质与预制体", exact: true }).click();
  await page.getByRole("tab", { name: "UI 画布", exact: true }).click();
  await page.getByRole("button", { name: "大画布编辑", exact: true }).click();
  const designer = page.getByRole("dialog", { name: "UI 设计器", exact: true }),
    panel = designer.getByTestId("ui-editor-panel");
  await panel
    .getByRole("button", { name: "添加十字准心", exact: true })
    .click();
  await panel.getByRole("button", { name: "添加圆环", exact: true }).click();
  const sheet = {
    reticleSkin: {
      base: {
        backgroundColor: "transparent",
        borderWidth: 2,
        borderColor: "#20FF90",
        opacity: 0.8,
      },
    },
    control: {
      base: { padding: 0, borderWidth: 2, borderColor: "#FFFFFF" },
      hover: { opacity: 0.7 },
      pressed: { opacity: 0.4 },
      disabled: { opacity: 0.2 },
    },
  };
  await panel
    .getByLabel("共享样式定义（JSON）", { exact: true })
    .fill(JSON.stringify(sheet));
  await panel.getByRole("button", { name: "应用样式表", exact: true }).click();
  await panel.getByLabel("样式类", { exact: true }).click();
  await page.getByRole("option", { name: "reticleSkin", exact: true }).click();
  await page.keyboard.press("Escape");
  await panel
    .getByRole("button", { name: "清除元素覆盖", exact: true })
    .click();
  await expect(panel.getByLabel("透明度", { exact: true })).toHaveValue("0.8");
  const ids = await page.evaluate(() => {
    const g = (window as any).coreStore.getState().content.gameplay;
    return {
      root: g.hud.find(
        (h: any) => h.id.startsWith("reticle_") && h.kind === "container",
      ).id,
      ring: g.hud.find((h: any) => h.id.startsWith("ring_")).id,
    };
  });
  await expect(panel.locator(`[data-ui-node="${ids.ring}"]`)).toHaveCSS(
    "border-color",
    "rgb(32, 255, 144)",
  );
  await expect(panel.locator(`[data-ui-node="${ids.root}"]`)).toHaveCSS(
    "width",
    "28px",
  );
  const authored = await page.evaluate(() => {
    const g = (window as any).coreStore.getState().content.gameplay;
    return structuredClone(g);
  });
  expect(authored.hud).toHaveLength(6);
  expect(authored.styles).toEqual(sheet);
  await page.screenshot({ path: info.outputPath("styled-ui-editor.png") });
  await designer
    .getByRole("button", { name: "返回编辑器", exact: true })
    .click();
  await page.evaluate(() => {
    const s = (window as any).coreStore,
      state = s.getState(),
      nodes = state.nodes.map((n: any, i: number) => ({
        ...n,
        scripts: i === 0 ? ["probe.js"] : [],
      }));
    s.getState().updateGameplay({
      ...state.content.gameplay,
      hud: [
        ...state.content.gameplay.hud,
        {
          id: "control",
          kind: "button",
          text: "Test",
          x: 5,
          y: 5,
          width: 120,
          height: 40,
          positionUnit: "percent",
          sizeUnit: "px",
          fontSize: 20,
          color: "#FFFFFF",
          background: "#222222",
          classes: ["control"],
        },
      ],
    });
    s.setState({
      nodes,
      settings: {
        ...state.settings,
        renderCompute: { normalsMinVertices: 0, cullMinMeshes: 0 },
      },
      scripts: {
        "probe.js":
          "export default function({entity,ui,timers,visuals}){globalThis.coreUIProbe={entity,ui,ticks:0};return{onStart(){visuals.createMesh({positions:[0,0,100,1,0,100,0,1,100],indices:[0,1,2]});timers.every(.02,()=>coreUIProbe.ticks++);}};}",
      },
      activeFileId: "probe.js",
    });
    s.getState().play();
  });
  let runtime = page.frames().find((f) => f.url().includes("/runtime.html"))!;
  await runtime.waitForFunction(() => (window as any).coreUIProbe?.ticks > 2);
  const editorFramesDuringPlay = await page.evaluate(
    () => (window as any).coreEditorFrames,
  );
  await runtime.waitForFunction(() => (window as any).coreUIProbe?.ticks > 8);
  expect(
    await page.evaluate(() => (window as any).coreEditorFrames),
    "hidden authoring scene must stop rendering during play",
  ).toBe(editorFramesDuringPlay);
  expect(
    await runtime.evaluate(() => ({
      scene: (window as any).entityAPI.stats().sceneBackend,
      lifecycle: (window as any).session.stats().lifecycleBackend,
    })),
  ).toEqual({ scene: "cpp-wasm", lifecycle: "cpp-wasm" });
  expect(
    await runtime.evaluate(
      () => (window as any).renderCompute.stats().renderNormalBatches,
    ),
  ).toBeGreaterThan(0);
  const control = runtime.locator('[data-hud-id="control"]');
  await control.hover();
  await expect(control).toHaveCSS("opacity", "0.7");
  await page.mouse.down();
  await expect(control).toHaveCSS("opacity", "0.4");
  await page.mouse.up();
  await runtime.evaluate(() =>
    (window as any).coreUIProbe.ui.get("control").setDisabled(true),
  );
  await expect(control).toHaveCSS("opacity", "0.2");
  await page.evaluate(() => (window as any).coreStore.getState().stop());
  await page.waitForFunction(
    (before) => (window as any).coreEditorFrames > before,
    editorFramesDuringPlay,
  );
  await runtime.waitForFunction(
    () =>
      (window as any).session.stats().nativeOwners === 0 &&
      (window as any).entityAPI.stats().nativeEntities === 0,
  );
  await page.getByRole("button", { name: "菜单", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "导出独立游戏…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "导出独立游戏",
    exact: true,
  });
  const navigations: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  const documentId = await page.evaluate(() => performance.timeOrigin);
  await dialog.getByRole("button", { name: "开始打包", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("打包完成", {
    timeout: 30000,
  });
  expect(navigations, "export must preserve the editor document").toEqual([]);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentId);
  const pending = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "下载游戏 ZIP", exact: true })
    .click();
  const download = await pending,
    file = info.outputPath("styled-game.zip");
  await download.saveAs(file);
  const files = unzipSync(new Uint8Array(await fs.readFile(file))),
    folder = new URL("../../.core-ui-browser-test/", import.meta.url);
  await fs.rm(folder, { recursive: true, force: true });
  await fs.mkdir(folder, { recursive: true });
  for (const [path, raw] of Object.entries(files)) {
    const target = new URL(path, folder);
    await fs.mkdir(new URL("./", target), { recursive: true });
    await fs.writeFile(target, raw);
  }
  const server = await serveStatic(folder.pathname, 0),
    url = "http://127.0.0.1:" + (server.address() as any).port;
  const gamePage = await page.context().newPage();
  gamePage.on("pageerror", (e) => errors.push(e.message));
  try {
    await gamePage.goto(url);
    await gamePage.waitForFunction(() =>
      ["playing", "error"].includes((window as any).ArkGlidePlayer.state),
    );
    expect(
      await gamePage.evaluate(() => (window as any).ArkGlidePlayer.state),
      (await gamePage.locator("#loadingLog").textContent()) || "",
    ).toBe("playing");
    runtime = gamePage
      .frames()
      .find((f) => f.url().includes("runtime.html?boot="))!;
    await runtime.waitForFunction(() => (window as any).coreUIProbe?.ticks > 2);
    expect(
      await runtime.evaluate(
        () => (window as any).session.stats().lifecycleBackend,
      ),
    ).toBe("cpp-wasm");
    expect(
      await runtime.evaluate(
        () => (window as any).renderCompute.stats().renderNormalBatches,
      ),
    ).toBeGreaterThan(0);
    const crosshair = runtime.locator(`[data-hud-id="${ids.root}"]`),
      ring = runtime.locator(`[data-hud-id="${ids.ring}"]`);
    await expect(crosshair).toHaveCSS("pointer-events", "none");
    await expect(ring).toHaveCSS("border-color", "rgb(32, 255, 144)");
    await expect(ring).toHaveCSS("border-radius", "50%");
    for (const width of [1440, 720]) {
      await gamePage.setViewportSize({ width, height: 800 });
      await expect
        .poll(async () => {
          const box = await crosshair.boundingBox();
          return Math.abs(box!.x + box!.width / 2 - width / 2);
        })
        .toBeLessThan(1);
      await expect(crosshair).toHaveCSS("width", "28px");
    }
    await gamePage.screenshot({ path: info.outputPath("styled-ui-game.png") });
    await gamePage.evaluate(() => (window as any).ArkGlidePlayer.stop());
    const stats = await gamePage.evaluate(
      () => (window as any).ArkGlidePlayer.stats,
    );
    expect(stats.nativeEntities).toBe(0);
    expect(stats.nativeOwners).toBe(0);
    expect(stats.nativeTimers).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await gamePage.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
