import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
test("third batch playable project: real WASM collision, animation, sound, HUD/input, persistence and cleanup", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("PAGEERROR", e.message);
  });
  await page.goto("/");
  await page.waitForSelector("#viewport");
  console.log("STAGE loaded");
  await page.evaluate(async () => {
    (window as any).s = (
      await import("/src/store/useEditorStore.ts")
    ).useEditorStore;
  });
  const runtime = page.frames().find((f) => f.url().endsWith("/runtime.html"))!;
  await runtime.waitForFunction(
    () =>
      (window as any).joltModule && (window as any).math?.backend === "wasm",
    undefined,
    { polling: 50 },
  );
  await page
    .locator('input[accept=".arkglide"]')
    .setInputFiles(
      fileURLToPath(
        new URL("../../examples/collect-gems.arkglide", import.meta.url),
      ),
    );
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).s.getState().modelAnimations.Gem || [],
      ),
    )
    .toEqual(["Idle", "Move"]);
  await page.evaluate(() => (window as any).s.getState().selectNode("Player"));
  await expect(
    page.getByTestId("gameplay-inspector").getByLabel("质量 kg"),
  ).toHaveValue("1");
  await page.getByTestId("gameplay-inspector").getByLabel("质量 kg").fill("2");
  await page.evaluate(() => (window as any).s.getState().undo());
  await page.getByRole("tab", { name: "材质与预制体", exact: true }).click();
  await page.getByRole("tab", { name: /音频 \(/ }).click();
  await expect(page.getByTestId("audio-panel")).toContainText("收集音效.wav");
  await page.getByRole("tab", { name: "输入与 HUD" }).click();
  await expect(page.getByTestId("input-hud-panel")).toContainText("score");
  console.log("STAGE play");
  await page.evaluate(() => (window as any).s.getState().play());
  await runtime.waitForFunction(
    () =>
      (window as any).running &&
      (window as any).physicsRuntime?.stats().physicsBodies === 4,
    undefined,
    { polling: 50 },
  );
  console.log("STAGE running");
  await runtime.getByRole("button", { name: "启用音频" }).click();
  await expect
    .poll(() =>
      runtime.evaluate(() => (window as any).audioRuntime.stats().audioState),
    )
    .toBe("running");
  await runtime.waitForFunction(
    () =>
      Math.abs((window as any).sceneAPI.find("Player").position.y - 0.5) < 0.05,
    undefined,
    { polling: 50 },
  );
  const clips = await runtime.evaluate(() =>
    (window as any).sceneAdapter.resources
      .get("Gem")
      .animationGroups.map((g: any) => g.name),
  );
  expect(clips).toEqual(["Idle", "Move"]);
  await runtime
    .locator("#renderCanvas")
    .click({ position: { x: 150, y: 100 } });
  console.log("STAGE move");
  await page.keyboard.down("d");
  await runtime.waitForFunction(
    () => (window as any).input.getAction("moveX") === 1,
    undefined,
    { polling: 50 },
  );
  await expect
    .poll(() =>
      runtime.evaluate(
        () =>
          (window as any).sceneAdapter.resources
            .get("Gem")
            ?.animationGroups.find((g: any) => g.name === "Move")?.isStarted ||
          !(window as any).sceneAPI.find("Gem"),
      ),
    )
    .toBe(true);
  await runtime.waitForFunction(
    () =>
      document.querySelector('[data-hud-id="score"]')?.textContent ===
      "分数：1",
    undefined,
    { polling: 50 },
  );
  await runtime.waitForFunction(
    () => (window as any).sceneAPI.find("Player").position.x > 2.9,
    undefined,
    { polling: 50 },
  );
  await page.keyboard.up("d");
  const x = await runtime.evaluate(
    () => (window as any).sceneAPI.find("Player").position.x,
  );
  expect(x).toBeLessThan(3.1);
  await page.evaluate(() => (window as any).s.getState().pause());
  const frozen = await runtime.evaluate(() => ({
    p: (window as any).sceneAPI.find("Player").getPosition(),
    t: (window as any).time.totalTime,
  }));
  await page.waitForTimeout(250);
  expect(
    await runtime.evaluate(() => ({
      p: (window as any).sceneAPI.find("Player").getPosition(),
      t: (window as any).time.totalTime,
    })),
  ).toEqual(frozen);
  expect(
    await runtime.evaluate(
      () => (window as any).audioRuntime.stats().audioState,
    ),
  ).toBe("suspended");
  await runtime.evaluate(() => {
    (window as any).pausedButton = (window as any).inputRuntime
      .forOwner()
      .createButton({ id: "paused-regression", text: "Paused" });
  });
  await expect(runtime.locator('[data-hud-id="paused-regression"]')).toBeDisabled();
  await page.evaluate(() => (window as any).s.getState().play());
  await expect(runtime.locator('[data-hud-id="paused-regression"]')).toBeEnabled();
  await runtime.evaluate(() => (window as any).pausedButton.destroy());
  await expect
    .poll(() =>
      runtime.evaluate(() => (window as any).audioRuntime.stats().audioState),
    )
    .toBe("running");
  const touch = await runtime.locator('[data-hud-id="left"]').boundingBox();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: touch!.x + 10, y: touch!.y + 10, id: 1 }],
  });
  expect(
    await runtime.evaluate(() => (window as any).input.getAction("moveX")),
  ).toBe(-1);
  await runtime.evaluate(() =>
    (window as any).inputRuntime.forOwner().get("left").setVisible(false),
  );
  expect(
    await runtime.evaluate(() => (window as any).input.getAction("moveX")),
  ).toBe(0);
  await runtime.evaluate(() =>
    (window as any).inputRuntime.forOwner().get("left").setVisible(true),
  );
  expect(
    await runtime.evaluate(() => (window as any).input.getAction("moveX")),
  ).toBe(0);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  expect(
    await runtime.evaluate(() => (window as any).input.getAction("moveX")),
  ).toBe(0);
  await page.evaluate(() => (window as any).s.getState().stop());
  expect(
    await runtime.evaluate(() =>
      Object.assign(
        (window as any).physicsRuntime.stats(),
        (window as any).audioRuntime.stats(),
        (window as any).animationRuntime.stats(),
        (window as any).inputRuntime.stats(),
      ),
    ),
  ).toMatchObject({
    physicsBodies: 0,
    physicsSubscriptions: 0,
    audioVoices: 0,
    audioBuffers: 0,
    animationPlayers: 0,
    hudElements: 0,
    inputHeld: 0,
  });
  expect(
    await page.evaluate(
      () =>
        (window as any).s.getState().nodes.find((n: any) => n.id === "Player")
          .transform,
    ),
  ).toEqual({ x: 0, y: 2, z: 0 });
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => (window as any).s.getState().play());
    await runtime.waitForFunction(() => (window as any).running, undefined, {
      polling: 50,
    });
    await page.evaluate(() => (window as any).s.getState().stop());
    await runtime.waitForFunction(
      () => (window as any).physicsRuntime.stats().physicsBodies === 0,
      undefined,
      { polling: 50 },
    );
  }
  await page.evaluate(async () => {
    await (window as any).s.getState().saveCurrentProject("Third batch saved");
    const id = (window as any).s.getState().currentProjectId;
    (window as any).s.getState().newProject();
    await (window as any).s.getState().loadProjectById(id);
  });
  expect(
    await page.evaluate(
      () => (window as any).s.getState().audioBuffers.get("coin").byteLength,
    ),
  ).toBe(8864);
  expect(
    await page.evaluate(
      () => (window as any).s.getState().content.gameplay.hud.length,
    ),
  ).toBe(7);
  const template = await page.evaluate(() => {
    const s = (window as any).s;
    s.getState().updateTransform("Gem", {
      audioSource: {
        assetId: "coin",
        autoplay: true,
        loop: true,
        volume: 0.2,
        spatial: true,
        refDistance: 1,
      },
    });
    return s.getState().createPrefab("Gem", "Animated Pickup");
  });
  await page.evaluate(() => (window as any).s.getState().play());
  await runtime.waitForFunction(() => (window as any).running, undefined, {
    polling: 50,
  });
  const result = await runtime.evaluate(async (id) => {
    const w = window as any;
    const before = {
      ...w.physicsRuntime.stats(),
      ...w.audioRuntime.stats(),
      ...w.animationRuntime.stats(),
    };
    for (let i = 0; i < 5; i++) {
      const p = await w.prefabs.instantiate(id, {
        position: { x: -2, y: 0.5, z: -2 },
      });
      if (w.physicsRuntime.stats().physicsBodies !== before.physicsBodies + 1)
        throw new Error("Spawned prefab has no body");
      p.destroy();
    }
    const after = {
      ...w.physicsRuntime.stats(),
      ...w.audioRuntime.stats(),
      ...w.animationRuntime.stats(),
    };
    return { before, after, pending: w.prefabLibrary.pendingCount };
  }, template);
  expect(result.after.physicsBodies).toBe(result.before.physicsBodies);
  expect(result.after.audioVoices).toBe(result.before.audioVoices);
  expect(result.after.animationPlayers).toBe(result.before.animationPlayers);
  expect(result.pending).toBe(0);
  await page.evaluate(() => (window as any).s.getState().stop());
  await runtime.waitForFunction(
    () => (window as any).physicsRuntime.stats().physicsBodies === 0,
    undefined,
    { polling: 50 },
  );
  expect(
    await runtime.evaluate(
      () => (window as any).audioRuntime.stats().audioVoices,
    ),
  ).toBe(0);
  expect(errors).toEqual([]);
});
