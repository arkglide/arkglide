import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
test("full third batch: real skinned assets, root-motion character, mixer/worklet, UI editing, nested spawning and 20-session memory regression", async ({
  page,
}, info) => {
  test.setTimeout(300000);
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForSelector("#viewport");
  await page.evaluate(async () => {
    (window as any).s = (
      await import("/src/store/useEditorStore.ts")
    ).useEditorStore;
  });
  const runtime = page
    .frames()
    .find((f) => f.url().split("?")[0].endsWith("/runtime.html"))!;
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
        new URL("../../examples/third-full.arkglide", import.meta.url),
      ),
    );
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).s.getState().modelAnimations.Player || [],
      ),
    )
    .toEqual(["Idle", "Forward", "Back", "Left", "Right", "Jump"]);
  await page.getByRole("tab", { name: "材质与预制体", exact: true }).click();
  await page.getByRole("tab", { name: "UI 画布", exact: true }).click();
  const item = page.locator('[data-ui-node="status"]');
  await expect(item).toBeVisible();
  const box = (await item.boundingBox())!;
  await page.mouse.move(box.x + 15, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + 45, box.y + 25, { steps: 4 });
  await page.mouse.up();
  expect(
    await page.evaluate(
      () =>
        (window as any).s
          .getState()
          .content.gameplay.hud.find((h: any) => h.id === "status").x,
    ),
  ).toBeGreaterThan(3);
  await page
    .getByTestId("ui-editor-panel")
    .getByRole("button", { name: "撤销", exact: true })
    .click();
  expect(
    await page.evaluate(
      () =>
        (window as any).s
          .getState()
          .content.gameplay.hud.find((h: any) => h.id === "status").x,
    ),
  ).toBe(3);
  const play = async () => {
    await page.evaluate(() => (window as any).s.getState().play());
    await runtime.waitForFunction(
      () =>
        (window as any).running &&
        (window as any).animationRuntime?.stats().animationControllers === 2,
      undefined,
      { polling: 50 },
    );
  };
  const stop = async () => {
    await page.evaluate(() => (window as any).s.getState().stop());
    await runtime.waitForFunction(
      () =>
        !(window as any).running &&
        (window as any).desiredState === "stopped" &&
        (window as any).sceneAPI.getEntityCount() === 0,
      undefined,
      { polling: 50 },
    );
  };
  console.log("FULL loaded and UI undo verified");
  await play();
  console.log("FULL playing");
  expect(
    await runtime.evaluate(
      () => (window as any).animationRuntime.stats().animationRetargetGroups,
    ),
  ).toBe(6);
  expect(
    await runtime.evaluate(
      () => (window as any).physicsRuntime.stats().physicsCharacters,
    ),
  ).toBe(2);
  expect(
    await runtime.evaluate(
      () => (window as any).physicsRuntime.stats().physicsConstraints,
    ),
  ).toBe(1);
  await runtime.getByRole("button", { name: "启用音频", exact: true }).click();
  await expect
    .poll(() =>
      runtime.evaluate(() => (window as any).audioRuntime.stats().audioState),
    )
    .toBe("running");
  await runtime.waitForFunction(
    () =>
      (window as any).physicsRuntime
        .forOwner((window as any).session.owner(null, "probe"))
        .character((window as any).sceneAPI.find("Player")).grounded,
    undefined,
    { polling: 50 },
  );
  await runtime
    .locator("#renderCanvas")
    .click({ position: { x: 200, y: 160 } });
  await page.keyboard.down("d");
  await runtime.waitForFunction(
    () => (window as any).sceneAPI.find("Player").position.x > 0.4,
    undefined,
    { polling: 50 },
  );
  await page.keyboard.up("d");
  await runtime.getByRole("button", { name: "暂停菜单", exact: true }).click();
  await runtime.waitForFunction(
    () => (window as any).time.timeScale === 0,
    undefined,
    { polling: 50 },
  );
  await expect
    .poll(() =>
      runtime
        .locator("[data-hud-id=icon]")
        .evaluate((e: HTMLImageElement) => e.naturalWidth),
    )
    .toBe(64);
  const frozen = await runtime.evaluate(() => ({
    p: (window as any).sceneAPI.find("Player").getPosition(),
    t: (window as any).time.totalTime,
  }));
  await page.waitForTimeout(200);
  expect(
    await runtime.evaluate(() => ({
      p: (window as any).sceneAPI.find("Player").getPosition(),
      t: (window as any).time.totalTime,
    })),
  ).toEqual(frozen);
  await runtime
    .getByRole("button", { name: "音乐倍率：1", exact: true })
    .click();
  await expect(
    runtime.getByRole("button", { name: "音乐倍率：2", exact: true }),
  ).toBeVisible();
  await runtime.getByRole("button", { name: "继续", exact: true }).click();
  await runtime.waitForFunction(
    () => (window as any).time.timeScale === 1,
    undefined,
    { polling: 50 },
  );
  console.log("FULL movement and pause menu verified");
  await test.step("actual browser AudioWorklet retains a 440 Hz pitch at 0.5/1/2x", async () => {
    const measurements = await runtime.evaluate(async () => {
      const w = window as any,
        sr = 44100,
        n = sr * 2,
        raw = new ArrayBuffer(44 + n * 2),
        v = new DataView(raw);
      const text = (o: number, s: string) => {
        for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
      };
      text(0, "RIFF");
      v.setUint32(4, raw.byteLength - 8, true);
      text(8, "WAVEfmt ");
      v.setUint32(16, 16, true);
      v.setUint16(20, 1, true);
      v.setUint16(22, 1, true);
      v.setUint32(24, sr, true);
      v.setUint32(28, sr * 2, true);
      v.setUint16(32, 2, true);
      v.setUint16(34, 16, true);
      text(36, "data");
      v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++)
        v.setInt16(
          44 + i * 2,
          Math.round(12000 * Math.sin((i * 2 * Math.PI * 440) / sr)),
          true,
        );
      await w.audioRuntime.load(
        [
          {
            id: "pitch",
            name: "pitch",
            mime: "audio/wav",
            byteLength: raw.byteLength,
          },
        ],
        { pitch: raw },
      );
      const Original = w.AudioWorkletNode;
      let node: any;
      w.AudioWorkletNode = class extends Original {
        constructor(...args: any[]) {
          super(...args);
          node = this;
        }
      };
      const owner = w.session.owner(null, "worklet-measure"),
        api = w.audioRuntime.forOwner(owner),
        out = [];
      try {
        for (const rate of [0.5, 1, 2]) {
          const voice = api.play("pitch", {
              rate,
              preservePitch: true,
              loop: true,
              bus: "SFX",
            }),
            analyser = node.context.createAnalyser(),
            mute = node.context.createGain();
          analyser.fftSize = 4096;
          mute.gain.value = 0;
          node.connect(analyser);
          analyser.connect(mute);
          mute.connect(node.context.destination);
          await new Promise((r) => setTimeout(r, 350));
          const pcm = new Float32Array(4096);
          analyser.getFloatTimeDomainData(pcm);
          const crossings: number[] = [];
          for (let i = 1; i < pcm.length; i++)
            if (pcm[i - 1] <= 0 && pcm[i] > 0)
              crossings.push(i - 1 - pcm[i - 1] / (pcm[i] - pcm[i - 1]));
          out.push({
            rate,
            hz:
              crossings.length > 1
                ? ((crossings.length - 1) * node.context.sampleRate) /
                  (crossings.at(-1)! - crossings[0])
                : 0,
            peak: Math.max(...pcm.map(Math.abs)),
            position: voice.position,
          });
          voice.stop();
          analyser.disconnect();
          mute.disconnect();
        }
        return out;
      } finally {
        owner.abort();
        w.AudioWorkletNode = Original;
      }
    });
    fs.writeFileSync(
      info.outputPath("audio-pitch.json"),
      JSON.stringify(measurements, null, 2),
    );
    for (const m of measurements) {
      expect(m.peak).toBeGreaterThan(0.01);
      expect(Math.abs(m.hz - 440)).toBeLessThan(4.4);
      expect(m.position).toBeGreaterThan(0.05);
    }
  });
  console.log("FULL AudioWorklet measured");
  await stop();
  const resourceKeys = [
    "physicsBodies",
    "physicsContacts",
    "physicsSubscriptions",
    "physicsCharacters",
    "physicsConstraints",
    "physicsShapeCache",
    "physicsDebugMeshes",
    "physicsQueriesActive",
    "animationPlayers",
    "animationControllers",
    "animationEventSubscriptions",
    "animationRetargetGroups",
    "audioVoices",
    "audioBuffers",
    "audioBuses",
    "audioStreams",
    "audioWorklets",
    "audioTransitions",
    "audioBlobURLs",
    "hudElements",
    "inputHeld",
    "uiSubscriptions",
    "uiBlobURLs",
    "inputCaptures",
  ];
  const cdp = await page.context().newCDPSession(page),
    samples: any[] = [];
  for (let cycle = 0; cycle < 20; cycle++) {
    console.log("FULL stress cycle", cycle);
    if (cycle === 2)
      await page.evaluate(() =>
        (window as any).s.getState().updateSettings({ fpsCap: 5 }),
      );
    if (cycle === 3)
      await page.evaluate(() =>
        (window as any).s.getState().updateSettings({ fpsCap: 60 }),
      );
    await play();
    if (cycle === 0) {
      await page.evaluate(() => (window as any).s.getState().pause());
      await runtime.waitForFunction(
        () =>
          !(window as any).running && (window as any).desiredState === "paused",
        undefined,
        { polling: 50 },
      );
      const snap = await runtime.evaluate(() => ({
        p: (window as any).sceneAPI.find("Player").getPosition(),
        t: (window as any).time.totalTime,
      }));
      await page.waitForTimeout(100);
      expect(
        await runtime.evaluate(() => ({
          p: (window as any).sceneAPI.find("Player").getPosition(),
          t: (window as any).time.totalTime,
        })),
      ).toEqual(snap);
      await page.evaluate(() => (window as any).s.getState().play());
      await runtime.waitForFunction(() => (window as any).running, undefined, {
        polling: 50,
      });
    }
    await runtime.evaluate(async () => {
      const w = window as any,
        owner = w.session.owner(null, "nested-stress"),
        api = w.prefabLibrary.forOwner(owner),
        p = api.findByName("补给箱组合");
      for (let i = 0; i < 3; i++) {
        const h = await api.instantiate(p.id, {
          position: { x: 0, y: 4, z: 1 },
        });
        if (!h.entities.some((e: any) => e.name === "Crate"))
          throw Error("nested model absent");
        h.destroy();
      }
      owner.abort();
    });
    if (cycle === 1) {
      await runtime
        .locator("#renderCanvas")
        .click({ position: { x: 200, y: 160 } });
      await page.keyboard.down("d");
      await page.getByRole("tab", { name: "UI 画布", exact: true }).click();
      await page.keyboard.up("d");
      expect(
        await runtime.evaluate(() => (window as any).input.getAction("moveX")),
      ).toBe(0);
    }
    await stop();
    const stats = await runtime.evaluate(() =>
      Object.assign(
        {},
        (window as any).physicsRuntime.stats(),
        (window as any).animationRuntime.stats(),
        (window as any).audioRuntime.stats(),
        (window as any).inputRuntime.stats(),
      ),
    );
    for (const key of resourceKeys) {
      expect(stats).toHaveProperty(key);
      expect(stats[key], key + " cycle " + cycle).toBe(0);
    }
    await cdp.send("HeapProfiler.collectGarbage");
    const heap = await cdp.send("Runtime.getHeapUsage");
    samples.push({
      cycle,
      usedSize: heap.usedSize,
      backingStorageSize: heap.backingStorageSize,
      embedderHeapUsedSize: heap.embedderHeapUsedSize,
      wasmBytes: await runtime.evaluate(
        () => (window as any).joltModule.HEAPU8.byteLength,
      ),
    });
  }
  fs.writeFileSync(
    info.outputPath("memory-20-sessions.json"),
    JSON.stringify(samples, null, 2),
  );
  const warmed = samples.slice(5),
    growth = warmed.at(-1).usedSize - warmed[0].usedSize;
  expect(growth).toBeLessThan(2 * 1024 * 1024);
  expect(
    warmed.at(-1).backingStorageSize - warmed[0].backingStorageSize,
  ).toBeLessThan(2 * 1024 * 1024);
  expect(
    warmed.at(-1).embedderHeapUsedSize - warmed[0].embedderHeapUsedSize,
  ).toBeLessThan(2 * 1024 * 1024);
  expect(new Set(warmed.map((s) => s.wasmBytes)).size).toBe(1);
  expect(errors).toEqual([]);
  expect(await runtime.evaluate(() => (window as any).scriptErrors)).toBe(0);
});
