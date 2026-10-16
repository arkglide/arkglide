import { test, expect } from "./fixtures";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { serveStatic } from "../../scripts/serve-static.mjs";
import type { Frame } from "@playwright/test";

async function verifyPose(runtime: Frame) {
  return runtime.evaluate(async () => {
    const w = window as any,
      B = w.BABYLON;
    w.running = false;
    w.session.pause();
    const api = w.animationRuntime.forOwner(),
      player = w.sceneAPI.find("Player");
    api.controller(player).setState("Probe");
    w.animationRuntime.fixedUpdate(0.371);
    const group = w.sceneAdapter.resources
      .get("Player")
      .animationGroups.find((g: any) => g.name === "Forward");
    let difference = 0;
    const expected = group.targetedAnimations.map((entry: any) => {
      const value = entry.animation.evaluate(
          group.from +
            0.371 * group.targetedAnimations[0].animation.framePerSecond,
        ),
        actual = entry.target[entry.animation.targetProperty];
      const a = value.asArray(),
        b = actual.asArray();
      for (let i = 0; i < a.length; i++)
        difference = Math.max(difference, Math.abs(a[i] - b[i]));
      return { entry, value };
    });
    const camera = new B.FreeCamera(
      "animation-proof-camera",
      new B.Vector3(2, 3, -8),
      w.scene,
    );
    camera.setTarget(new B.Vector3(0, 2, -2));
    const target = new B.RenderTargetTexture(
      "animation-proof",
      128,
      w.scene,
      false,
      true,
    );
    target.activeCamera = camera;
    target.renderList = w.sceneAdapter.nodes
      .get("Player")
      .getChildMeshes(false);
    target.renderParticles = false;
    try {
      target.render(false, false);
      target.render(false, false);
      const nativePixels = await target.readPixels();
      for (const { entry, value } of expected)
        entry.target[entry.animation.targetProperty].copyFrom(value);
      target.render(false, false);
      const jsPixels = await target.readPixels();
      let pixelDifference = 0,
        colored = 0;
      for (let i = 0; i < nativePixels.length; i++)
        pixelDifference = Math.max(
          pixelDifference,
          Math.abs(nativePixels[i] - jsPixels[i]),
        );
      for (let i = 0; i < nativePixels.length; i += 4)
        if (nativePixels[i + 2] > nativePixels[i] + 20) colored++;
      return {
        difference,
        pixelDifference,
        colored,
        stats: w.animationRuntime.stats(),
        skeletons: w.scene.skeletons.length,
      };
    } finally {
      target.dispose();
      camera.dispose();
    }
  });
}

test("WASM poses drive a real skinned model and retargeted rig in the editor and an independent export", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForSelector("#viewport");
  await page
    .locator('input[accept=".arkglide"]')
    .setInputFiles(
      fileURLToPath(
        new URL("../../examples/third-full.arkglide", import.meta.url),
      ),
    );
  await page.waitForFunction(async () => {
    const store = (await import("/src/store/useEditorStore.ts")).useEditorStore;
    return !!store.getState().modelAnimations.Player?.length;
  });
  await page.evaluate(async () => {
    const store = (await import("/src/store/useEditorStore.ts")).useEditorStore;
    (window as any).animationStore = store;
    const state = store.getState(),
      controller = state.content.animationControllers.locomotion;
    store.setState({
      nodes: state.nodes.map((node: any) => ({
        ...node,
        scripts: [],
        animation: node.animation
          ? { ...node.animation, rootMotion: undefined }
          : undefined,
      })),
      settings: { ...state.settings, animationCompute: { minTracks: 0 } },
      content: {
        ...state.content,
        animationControllers: {
          locomotion: {
            ...controller,
            defaultState: "Probe",
            states: [
              {
                name: "Probe",
                clip: "Forward",
                loop: true,
                speed: 1,
                events: [],
              },
            ],
            transitions: [],
          },
        },
      },
    });
    store.getState().play();
  });
  let runtime = page.frames().find((f) => f.url().includes("/runtime.html"))!;
  await runtime.waitForFunction(
    () =>
      (window as any).animationRuntime?.stats().animationNativeControllers ===
      2,
  );
  const editor = await verifyPose(runtime);
  expect(editor.difference).toBeLessThan(1e-9);
  expect(editor.pixelDifference).toBe(0);
  expect(editor.colored).toBeGreaterThan(20);
  expect(editor.skeletons).toBeGreaterThan(0);
  expect(editor.stats.animationNativeBatches).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).animationStore.getState().stop());
  await runtime.waitForFunction(
    () =>
      (window as any).animationRuntime.stats().animationNativeControllers === 0,
  );
  await page.getByRole("button", { name: "菜单", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "导出独立游戏…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "导出独立游戏",
    exact: true,
  });
  await dialog.getByRole("button", { name: "开始打包", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("打包完成", {
    timeout: 30000,
  });
  const pending = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "下载游戏 ZIP", exact: true })
    .click();
  const download = await pending,
    archive = info.outputPath("animated-game.zip");
  await download.saveAs(archive);
  const files = unzipSync(new Uint8Array(await fs.readFile(archive))),
    folder = info.outputPath("game");
  for (const [name, bytes] of Object.entries(files)) {
    const path = folder + "/" + name;
    await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await fs.writeFile(path, bytes);
  }
  const server = await serveStatic(folder, 0),
    game = await page.context().newPage();
  game.on("pageerror", (e) => errors.push(e.message));
  try {
    await game.goto("http://127.0.0.1:" + (server.address() as any).port);
    await game.waitForFunction(
      () => (window as any).ArkGlidePlayer.state === "playing",
    );
    runtime = game
      .frames()
      .find((f) => f.url().includes("runtime.html?boot="))!;
    await runtime.waitForFunction(
      () =>
        (window as any).animationRuntime?.stats().animationNativeControllers ===
        2,
    );
    const exported = await verifyPose(runtime);
    expect(exported.difference).toBeLessThan(1e-9);
    expect(exported.pixelDifference).toBe(0);
    expect(exported.colored).toBeGreaterThan(20);
    await game.evaluate(() => (window as any).ArkGlidePlayer.stop());
    expect(
      await game.evaluate(
        () => (window as any).ArkGlidePlayer.stats.animationNativeControllers,
      ),
    ).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await game.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
