import { test, expect } from "@playwright/test";
function glb() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
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
    buf = Buffer.alloc(12 + 8 + n + 8 + positions.byteLength);
  buf.writeUInt32LE(0x46546c67, 0);
  buf.writeUInt32LE(2, 4);
  buf.writeUInt32LE(buf.length, 8);
  buf.writeUInt32LE(n, 12);
  buf.writeUInt32LE(0x4e4f534a, 16);
  buf.fill(32, 20, 20 + n);
  raw.copy(buf, 20);
  buf.writeUInt32LE(positions.byteLength, 20 + n);
  buf.writeUInt32LE(0x004e4942, 24 + n);
  Buffer.from(positions.buffer).copy(buf, 28 + n);
  return [...buf];
}
test("batch two: material editing, texture rendering, prefabs, runtime and portable recovery", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let coreUrl: string | undefined;
  const connect = async () => {
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
      const { useEditorStore } = await import("/src/store/useEditorStore.ts");
      (window as any).s = useEditorStore;
      (window as any).B = await import(url!);
    }, coreUrl);
    const frame = page.frames().find((f) => f.url().endsWith("/runtime.html"))!;
    await frame.waitForFunction(
      () => (window as any).math?.backend === "wasm",
      undefined,
      { polling: 50 },
    );
    return frame;
  };
  await page.goto("/");
  let runtime = await connect();
  const panel = page.getByTestId("content-panel");
  let ids: any;
  await test.step("material and texture controls create a persistent PBR material", async () => {
    await page.getByRole("tab", { name: "材质与预制体", exact: true }).click();
    await panel.getByRole("button", { name: "新建材质", exact: true }).click();
    await panel
      .getByRole("button", { name: "绑定选中物体", exact: true })
      .click();
    await panel.getByLabel("金属度", { exact: true }).fill(".3");
    await panel.getByLabel("粗糙度", { exact: true }).fill(".45");
    await panel.getByLabel("UV U", { exact: true }).fill("2");
    await panel.getByRole("tab", { name: "贴图 (0)", exact: true }).click();
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = c.height = 4;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#ff4444";
      ctx.fillRect(0, 0, 4, 4);
      ctx.fillStyle = "#44ff44";
      ctx.fillRect(0, 0, 2, 2);
      return c.toDataURL("image/png").split(",")[1];
    });
    await panel
      .getByLabel("导入贴图", { exact: true })
      .setInputFiles({
        name: "checker.png",
        mimeType: "image/png",
        buffer: Buffer.from(png, "base64"),
      });
    await expect(
      panel.getByRole("img", { name: "checker.png", exact: true }),
    ).toBeVisible();
    await panel.getByRole("tab", { name: "材质 (1)", exact: true }).click();
    await panel.getByLabel("颜色贴图", { exact: true }).click();
    await page
      .getByRole("option", { name: "checker.png", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const m = (
            window as any
          ).B.EngineStore.LastCreatedScene.getMeshByName("cube")?.material;
          return m?.albedoTexture?.isReady();
        }),
      )
      .toBe(true);
    expect(
      await page.evaluate(() => {
        const m = (window as any).B.EngineStore.LastCreatedScene.getMeshByName(
          "cube",
        ).material;
        return {
          metallic: m.metallic,
          roughness: m.roughness,
          u: m.albedoTexture.uScale,
          gamma: m.albedoTexture.gammaSpace,
        };
      }),
    ).toEqual({ metallic: 0.3, roughness: 0.45, u: 2, gamma: true });
  });
  await test.step("a mixed subtree becomes a template with independent model resources", async () => {
    ids = await page.evaluate((bytes) => {
      const s = (window as any).s;
      const mat = Object.keys(s.getState().content.materials)[0],
        tex = s.getState().content.textures[0].id;
      const group = s.getState().addNode("empty", "Enemy"),
        body = s.getState().addNode("mesh", "Body"),
        model = s.getState().addNode("model", "Triangle");
      s.getState().setParent(body, group);
      s.getState().setParent(model, group);
      s.getState().updateTransform(model, { modelUrl: "triangle.glb" });
      s.getState().setModelBuffer(model, new Uint8Array(bytes).buffer);
      s.getState().setNodeMaterial(body, mat);
      s.getState().setNodeMaterial(model, mat);
      s.getState().createScript("enemy.js");
      s.getState().updateScript(
        "enemy.js",
        "return {counter:0,onUpdate(){this.counter++;}};",
      );
      s.getState().attachScript(body, "enemy.js");
      s.getState().selectNode(group);
      return { mat, tex, group, body, model };
    }, glb());
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            (
              window as any
            ).B.EngineStore.LastCreatedScene.getTransformNodeByName(id)
              ?.getChildMeshes()
              .reduce((n: number, m: any) => n + m.getTotalVertices(), 0),
          ids.model,
        ),
      )
      .toBe(3);
    await panel.getByRole("tab", { name: "预制体 (0)", exact: true }).click();
    await panel
      .getByRole("button", { name: "从选中子树创建预制体", exact: true })
      .click();
    await panel.getByRole("button", { name: "生成实例", exact: true }).click();
    ids = {
      ...ids,
      ...(await page.evaluate(() => {
        const s = (window as any).s.getState(),
          i = Object.values(s.content.prefabInstances).find(
            (i: any) => i.rootId === s.selectedNodeId,
          ) as any;
        return {
          prefab: i.prefabId,
          root: i.rootId,
          otherBody:
            i.nodeMap[
              s.nodes.find(
                (n: any) =>
                  n.name === "Body" &&
                  n.id !== (window as any).s.getState().selectedNodeId,
              ).prefab.nodeId
            ],
          instance: i.id,
        };
      })),
    };
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const s = (window as any).s.getState(),
            i = s.content.prefabInstances[id];
          const model = s.nodes.find(
            (n: any) => n.type === "model" && n.prefab?.instanceId === id,
          );
          return model
            ? (
                window as any
              ).B.EngineStore.LastCreatedScene.getTransformNodeByName(model.id)
                ?.getChildMeshes()
                .reduce((n: number, m: any) => n + m.getTotalVertices(), 0)
            : 0;
        }, ids.instance),
      )
      .toBe(3);
  });
  await test.step("template updates retain per-axis overrides; reset and undo restore the expected state", async () => {
    await page.evaluate((ids) => {
      const s = (window as any).s;
      s.getState().updateTransform(ids.otherBody, {
        scale: { x: 3, y: 1, z: 1 },
      });
      s.getState().updateTransform(ids.body, { scale: { x: 2, y: 4, z: 1 } });
      s.getState().updateTransform(ids.root, {
        transform: { x: 5, y: 1, z: 0 },
      });
      s.getState().selectNode(ids.body);
    }, ids);
    await page
      .getByTestId("node-content")
      .getByRole("button", { name: "应用到模板", exact: true })
      .click();
    expect(
      await page.evaluate((ids) => {
        const s = (window as any).s.getState();
        return {
          scale: s.nodes.find((n: any) => n.id === ids.otherBody).scale,
          x: s.nodes.find((n: any) => n.id === ids.root).transform.x,
          revision: s.content.prefabs[ids.prefab].revision,
        };
      }, ids),
    ).toEqual({ scale: { x: 3, y: 4, z: 1 }, x: 5, revision: 2 });
    await page.evaluate(
      (id) => (window as any).s.getState().selectNode(id),
      ids.root,
    );
    await expect(page.getByTestId("prefab-overrides")).toContainText(
      "覆盖 1 个节点",
    );
    await page
      .getByTestId("node-content")
      .getByRole("button", { name: "重置覆盖", exact: true })
      .click();
    expect(
      await page.evaluate(
        (id) =>
          (window as any).s.getState().nodes.find((n: any) => n.id === id).scale
            .x,
        ids.otherBody,
      ),
    ).toBe(2);
    await page.evaluate(() => (window as any).s.getState().undo());
    expect(
      await page.evaluate(
        (id) =>
          (window as any).s.getState().nodes.find((n: any) => n.id === id).scale
            .x,
        ids.otherBody,
      ),
    ).toBe(3);
  });
  await test.step("runtime receives live textures and independent prefab script factories; destroy does not break shared material", async () => {
    await page.getByRole("button", { name: "播放", exact: true }).click();
    await runtime.waitForFunction(() => (window as any).running, undefined, {
      polling: 50,
    });
    expect(
      await runtime.evaluate((ids) => {
        const m = (window as any).sceneAdapter.nodes.get(ids.body).material;
        const records = (window as any).lifecycleInstances.filter(
          (r: any) => r.file === "enemy.js",
        );
        return {
          ready: m.albedoTexture.isReady(),
          u: m.albedoTexture.uScale,
          records: records.length,
        };
      }, ids),
    ).toEqual({ ready: true, u: 2, records: 2 });
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await runtime.waitForFunction(() => !(window as any).running, undefined, {
      polling: 50,
    });
    expect(
      await runtime.evaluate((ids) => {
        const rows = (window as any).lifecycleInstances.filter(
          (r: any) => r.file === "enemy.js",
        );
        rows[0].instance.counter = 999;
        const independent = rows[1].instance.counter !== 999;
        (window as any).sceneAPI.find(ids.group).destroy();
        const m = (window as any).sceneAdapter.nodes.get(
          ids.otherBody,
        ).material;
        return {
          independent,
          materialAlive: (window as any).scene.materials.includes(m),
          textureAlive: m.albedoTexture.isReady(),
        };
      }, ids),
    ).toEqual({ independent: true, materialAlive: true, textureAlive: true });
    await page.getByRole("button", { name: "停止", exact: true }).click();
    await expect
      .poll(() =>
        runtime.evaluate(
          () =>
            (window as any).scene.materials.filter(
              (m: any) => m.metadata?.arkglideManagedMaterial,
            ).length,
        ),
      )
      .toBe(0);
    await expect
      .poll(() =>
        runtime.evaluate(
          () =>
            (window as any).scene.textures.filter((t: any) =>
              t.name.startsWith("arkglide:texture:"),
            ).length,
        ),
      )
      .toBe(0);
    expect(
      await page.evaluate(
        (ids) => ({
          model: (window as any).s.getState().modelBuffers.get(ids.model)
            .byteLength,
          texture: (window as any).s.getState().textureBuffers.get(ids.tex)
            .byteLength,
        }),
        ids,
      ),
    ).toEqual({
      model: glb().length,
      texture: await page.evaluate(
        (id) =>
          (window as any).s
            .getState()
            .content.textures.find((t: any) => t.id === id).byteLength,
        ids.tex,
      ),
    });
  });
  await test.step("ZIP and IndexedDB preserve template-only binaries after source deletion", async () => {
    await page.evaluate(async (ids) => {
      const s = (window as any).s;
      s.getState().removeNodes([ids.group, ids.root]);
      const { createProjectArchive, importProject } = await import(
        "/src/utils/projectExport.ts"
      );
      const zip = createProjectArchive();
      s.getState().newProject();
      await importProject(new File([zip], "batch2.arkglide"));
      const root = s.getState().instantiatePrefab(ids.prefab);
      (window as any).newRoot = root;
      await s.getState().saveCurrentProject("第二批验收");
      const id = s.getState().currentProjectId;
      s.getState().newProject();
      await s.getState().loadProjectById(id);
    }, ids);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const s = (window as any).s.getState(),
            root = (window as any).newRoot,
            model = s.nodes.find(
              (n: any) => n.parentId === root && n.type === "model",
            );
          return model
            ? (
                window as any
              ).B.EngineStore.LastCreatedScene.getTransformNodeByName(model.id)
                ?.getChildMeshes()
                .reduce((n: number, m: any) => n + m.getTotalVertices(), 0)
            : 0;
        }),
      )
      .toBe(3);
    expect(
      await page.evaluate((ids) => {
        const s = (window as any).s.getState();
        return {
          prefabs: Object.keys(s.content.prefabs).length,
          textures: s.textureBuffers.size,
          templateModel: Array.from(s.modelBuffers.keys()).some((k: any) =>
            k.startsWith("prefab:" + ids.prefab),
          ),
        };
      }, ids),
    ).toEqual({ prefabs: 1, textures: 1, templateModel: true });
  });
  await test.step("auto recovery retains content, texture replacements and overrides across reload", async () => {
    await page.evaluate((ids) => {
      const s = (window as any).s;
      s.getState().updateMaterial(ids.mat, { alpha: 0.65 });
      s.getState().renameNode((window as any).newRoot, "恢复的预制体实例");
    }, ids);
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).s.getState().recoveryStatus),
      )
      .toBe("saved");
    await page.reload();
    runtime = await connect();
    const dialog = page.getByRole("dialog", { name: "项目恢复" });
    await expect(dialog).toBeVisible();
    await dialog
      .getByText("第二批验收", { exact: true })
      .locator("..")
      .locator("..")
      .getByRole("button", { name: "恢复", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(
      await page.evaluate((ids) => {
        const s = (window as any).s.getState();
        return {
          alpha: s.content.materials[ids.mat].alpha,
          texture: s.textureBuffers.size,
          instances: Object.keys(s.content.prefabInstances).length,
          name: s.nodes.some((n: any) => n.name === "恢复的预制体实例"),
        };
      }, ids),
    ).toEqual({ alpha: 0.65, texture: 1, instances: 1, name: true });
  });
  expect(errors).toEqual([]);
  await page.screenshot({ path: "test-results/batch2-editor.png" });
});
