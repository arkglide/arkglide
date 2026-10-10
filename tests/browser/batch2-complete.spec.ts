import { test, expect } from "@playwright/test";
function twoPartGLB() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: "Left", mesh: 0, translation: [-1, 0, 0] },
      { name: "Right", mesh: 1, translation: [1, 0, 0] },
    ],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 }, material: 0 }] },
      { primitives: [{ attributes: { POSITION: 0 }, material: 1 }] },
    ],
    materials: [
      {
        name: "OriginalRed",
        pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] },
      },
      {
        name: "OriginalBlue",
        pbrMetallicRoughness: { baseColorFactor: [0, 0, 1, 1] },
      },
    ],
    buffers: [{ byteLength: positions.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
  };
  const raw = Buffer.from(JSON.stringify(json)),
    n = Math.ceil(raw.length / 4) * 4,
    buffer = Buffer.alloc(28 + n + positions.byteLength);
  buffer.writeUInt32LE(0x46546c67, 0);
  buffer.writeUInt32LE(2, 4);
  buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(n, 12);
  buffer.writeUInt32LE(0x4e4f534a, 16);
  buffer.fill(32, 20, 20 + n);
  raw.copy(buffer, 20);
  buffer.writeUInt32LE(positions.byteLength, 20 + n);
  buffer.writeUInt32LE(0x004e4942, 24 + n);
  Buffer.from(positions.buffer).copy(buffer, 28 + n);
  return [...buffer];
}
test("second batch completion: real model slots, nested template updates, script-driven runtime spawning and persistence", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let coreUrl: string | undefined;
  async function connect() {
    await page.waitForSelector("#viewport");
    if (!coreUrl) {
      await page.waitForFunction(() =>
        performance
          .getEntriesByType("resource")
          .some((r) => r.name.includes("/@babylonjs_core.js?")),
      );
      coreUrl = await page.evaluate(
        () =>
          performance
            .getEntriesByType("resource")
            .map((r) => r.name)
            .find((n) => n.includes("/@babylonjs_core.js?"))!,
      );
    }
    await page.evaluate(async (url) => {
      (window as any).s = (
        await import("/src/store/useEditorStore.ts")
      ).useEditorStore;
      (window as any).B = await import(url!);
    }, coreUrl);
    const frame = page.frames().find((f) => f.url().endsWith("/runtime.html"))!;
    await frame.waitForFunction(
      () => (window as any).math?.backend === "wasm",
      undefined,
      { polling: 50 },
    );
    return frame;
  }
  await page.goto("/");
  let runtime = await connect();
  let ids: any;
  await test.step("actual model parts expose material slots; original and inherited assignments render separately", async () => {
    ids = await page.evaluate((bytes) => {
      const s = (window as any).s;
      s.getState().newProject();
      const model = s.getState().addNode("model", "VehiclePart");
      s.getState().updateTransform(model, { modelUrl: "two-parts.glb" });
      s.getState().setModelBuffer(model, new Uint8Array(bytes).buffer);
      const gold = s.getState().createMaterial("Gold"),
        green = s.getState().createMaterial("Green");
      s.getState().updateMaterial(gold, {
        baseColor: "#FFD700",
        metallic: 0.8,
      });
      s.getState().updateMaterial(green, { baseColor: "#00FF00" });
      s.getState().setNodeMaterial(model, gold);
      s.getState().selectNode(model);
      return { model, gold, green };
    }, twoPartGLB());
    await expect
      .poll(() =>
        page.evaluate(
          (id) => (window as any).s.getState().modelParts[id]?.length || 0,
          ids.model,
        ),
      )
      .toBe(2);
    const parts = await page.evaluate(
      (id) => (window as any).s.getState().modelParts[id],
      ids.model,
    );
    ids.left = parts.find((p: any) => p.name.startsWith("Left")).key;
    ids.right = parts.find((p: any) => p.name.startsWith("Right")).key;
    const panel = page.getByTestId("model-material-slots");
    await panel
      .getByLabel(parts.find((p: any) => p.key === ids.left).name, {
        exact: true,
      })
      .click();
    await page.getByRole("option", { name: "Green", exact: true }).click();
    await panel
      .getByLabel(parts.find((p: any) => p.key === ids.right).name, {
        exact: true,
      })
      .click();
    await page
      .getByRole("option", { name: "使用此部件原始材质", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const B = (window as any).B,
            scene = B.EngineStore.LastCreatedScene,
            root = scene.getTransformNodeByName(id);
          return root
            ?.getChildMeshes()
            .filter((m: any) => m.getTotalVertices())
            .map((m: any) => ({
              name: m.name,
              color: m.material.albedoColor.toHexString(),
            }));
        }, ids.model),
      )
      .toEqual([
        { name: "Left", color: "#00FF00" },
        { name: "Right", color: "#0000FF" },
      ]);
    await page.evaluate(() => {
      (window as any).s.getState().undo();
      (window as any).s.getState().redo();
    });
    await page
      .getByTestId("node-content")
      .getByRole("button", { name: "创建预制体", exact: true })
      .click();
    ids.inner = await page.evaluate(
      (id) =>
        (window as any).s.getState().nodes.find((n: any) => n.id === id).prefab
          .prefabId,
      ids.model,
    );
  });
  await test.step("nested templates retain associations and merge per-slot overrides when inner templates update", async () => {
    ids = {
      ...ids,
      ...(await page.evaluate((ids) => {
        const s = (window as any).s,
          group = s.getState().addNode("empty", "Vehicle");
        s.getState().setParent(ids.model, group);
        s.getState().selectNode(group);
        return { group };
      }, ids)),
    };
    await page
      .getByTestId("node-content")
      .getByRole("button", { name: "创建预制体", exact: true })
      .click();
    ids = {
      ...ids,
      ...(await page.evaluate((ids) => {
        const s = (window as any).s,
          outer = s.getState().nodes.find((n: any) => n.id === ids.group)
            .prefab.prefabId,
          other = s.getState().instantiatePrefab(outer);
        const otherModel = s
          .getState()
          .nodes.find(
            (n: any) => n.parentId === other && n.type === "model",
          ).id;
        s.getState().setModelSlotMaterial(otherModel, ids.right, ids.green);
        s.getState().setModelSlotMaterial(ids.model, ids.left, ids.gold);
        const innerInstance = s
          .getState()
          .nodes.find((n: any) => n.id === ids.model).prefab.instanceId;
        s.getState().updatePrefabFromInstance(innerInstance);
        s.getState().selectNode(otherModel);
        return { outer, other, otherModel };
      }, ids)),
    };
    await expect(
      page
        .getByTestId("node-content")
        .getByRole("button", { name: "选择外层预制体：Vehicle", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate((ids) => {
        const s = (window as any).s.getState(),
          model = s.nodes.find((n: any) => n.id === ids.otherModel);
        return {
          left: model.materialSlots[ids.left],
          right: model.materialSlots[ids.right],
          parent:
            s.content.prefabInstances[model.prefab.instanceId]
              .parentInstanceId !== undefined,
        };
      }, ids),
    ).toEqual({ left: ids.gold, right: ids.green, parent: true });
    await page.evaluate((ids) => {
      const s = (window as any).s;
      s.getState().createScript("vehicle.js");
      s.getState().updateScript(
        "vehicle.js",
        "return {count:0,onStart(){timers.every(1,()=>this.count++);},onUpdate(){this.entity.position.y+=time.deltaTime;}};",
      );
      s.getState().attachScript(ids.model, "vehicle.js");
      s.getState().updatePrefabFromInstance(
        s.getState().nodes.find((n: any) => n.id === ids.model).prefab
          .instanceId,
      );
      s.getState().updateScript(
        "main.js",
        "return {onStart(){const p=prefabs.findByName('Vehicle');prefabs.instantiate(p.id,{position:{x:7,y:0,z:0}}).then(instance=>{globalThis.generated=instance;console.log('spawn-ready');}).catch(e=>console.error(e));}};",
      );
    }, ids);
  });
  await test.step("injected prefab API loads template models, starts independent scripts and preserves existing movement", async () => {
    await page.getByRole("button", { name: "播放", exact: true }).click();
    await runtime.waitForFunction(
      () => (window as any).generated?.root && (window as any).running,
    );
    expect(
      await runtime.evaluate(() => {
        const w = window as any,
          g = w.generated,
          m = g.entities.find((e: any) => e.name === "VehiclePart");
        return {
          entities: g.entities.length,
          x: g.root.position.x,
          modelMeshes: w.sceneAdapter.nodes
            .get(m.id)
            .getChildMeshes()
            .filter((m: any) => m.getTotalVertices()).length,
        };
      }),
    ).toEqual({ entities: 2, x: 7, modelMeshes: 2 });
    const state = await runtime.evaluate(async () => {
      const w = window as any,
        existing = w.generated.entities.find(
          (e: any) => e.name === "VehiclePart",
        );
      existing.position.x = 42;
      const template = w.prefabs.findByName("Vehicle"),
        a = await w.prefabs.instantiate(template.id),
        b = await w.prefabs.instantiate(template.id, { parent: a.root });
      const parts = w.sceneAdapter.nodes
        .get(a.entities.find((e: any) => e.name === "VehiclePart").id)
        .getChildMeshes()
        .filter((m: any) => m.getTotalVertices());
      const result = {
        liveX: existing.position.x,
        independent: a.root.id !== b.root.id,
        colors: parts.map((m: any) => m.material.albedoColor.toHexString()),
        scripts: w.session.stats().scripts,
      };
      a.destroy();
      return { ...result, childDestroyed: b.root.destroyed };
    });
    expect(state).toEqual({
      liveX: 42,
      independent: true,
      colors: ["#FFD700", "#0000FF"],
      scripts: 6,
      childDestroyed: true,
    });
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await runtime.waitForFunction(
      () => (window as any).desiredState === "paused",
    );
    const clock = await runtime.evaluate(() => (window as any).time.totalTime);
    await page.waitForTimeout(150);
    expect(await runtime.evaluate(() => (window as any).time.totalTime)).toBe(
      clock,
    );
    await page.getByRole("button", { name: "停止", exact: true }).click();
    await runtime.waitForFunction(() => (window as any).entityMap.size === 0);
    expect(
      await runtime.evaluate(() => {
        const w = window as any;
        return {
          scripts: w.session.stats().scripts,
          pending: w.prefabLibrary.pendingCount,
          materials: w.scene.materials.filter(
            (m: any) => m.metadata?.arkglideManagedMaterial,
          ).length,
        };
      }),
    ).toEqual({ scripts: 0, pending: 0, materials: 0 });
    expect(
      await page.evaluate(
        (id) => (window as any).s.getState().modelBuffers.get(id).byteLength,
        ids.model,
      ),
    ).toBeGreaterThan(0);
  });
  await test.step("native archive download, import and reload recovery retain nested mappings and part materials", async () => {
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "导出为 .arkglide 文件", exact: true })
      .click();
    const download = await downloadPromise;
    await download.saveAs("test-results/batch2-complete.arkglide");
    await page.evaluate(async () => {
      const { createProjectArchive, importProject } = await import(
        "/src/utils/projectExport.ts"
      );
      const bytes = createProjectArchive();
      (window as any).s.getState().newProject();
      await importProject(new File([bytes], "nested.arkglide"));
    });
    expect(
      await page.evaluate((ids) => {
        const s = (window as any).s.getState();
        return {
          slot: s.nodes.find((n: any) => n.id === ids.model).materialSlots[
            ids.right
          ],
          nested: Object.keys(s.content.prefabs[ids.outer].nestedInstances)
            .length,
        };
      }, ids),
    ).toEqual({ slot: null, nested: 1 });
    await page.evaluate(async () => {
      await (window as any).s.getState().saveCurrentProject("第二批补齐验收");
      const { startProjectRecovery } = await import(
        "/src/utils/projectRecovery.ts"
      );
      const c = startProjectRecovery({ delay: 100000, maxWait: 100000 });
      try {
        (window as any).s.getState().updateSettings({ ambientIntensity: 0.3 });
        await c.flush();
      } finally {
        c.dispose();
      }
    });
    await page.reload();
    runtime = await connect();
    const dialog = page.getByRole("dialog", { name: "项目恢复" });
    await expect(dialog).toBeVisible();
    await dialog
      .getByText("第二批补齐验收", { exact: true })
      .locator("..")
      .locator("..")
      .getByRole("button", { name: "恢复", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(
      await page.evaluate((ids) => {
        const s = (window as any).s.getState();
        return {
          slot: s.nodes.find((n: any) => n.id === ids.model).materialSlots[
            ids.left
          ],
          nested: Object.keys(s.content.prefabs[ids.outer].nestedInstances)
            .length,
        };
      }, ids),
    ).toEqual({ slot: ids.gold, nested: 1 });
  });
  await page.screenshot({ path: "test-results/batch2-complete-editor.png" });
  expect(errors).toEqual([]);
});
