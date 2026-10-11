import { test, expect } from "@playwright/test";
test("JavaScript project modules: real sandbox imports, live bindings, prefab instances, diagnostics and restart", async ({
  page,
}) => {
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
  // The runtime iframe is hidden while editing; RAF polling may never run in CI.
  await runtime.waitForFunction(
    () => (window as any).math?.backend === "wasm",
    undefined,
    { polling: 50 },
  );
  await test.step("legacy imports and module factories retain instance ownership and share module state once per play", async () => {
    await page.evaluate(() => {
      const s = (window as any).s;
      s.getState().newProject();
      s.getState().createScript("utils.js");
      s.getState().updateScript(
        "utils.js",
        "export let starts=0; export function begin(){starts++;} export default x=>x*2; export const speed=3;",
      );
      s.getState().createScript("barrel.js");
      s.getState().updateScript(
        "barrel.js",
        "export {default, speed as velocity, starts, begin} from './utils.js';",
      );
      s.getState().updateScript(
        "main.js",
        "import double, {velocity, starts, begin} from './barrel.js'; let local=0; return defineScript({onStart(){begin();this.entity.position.x=double(velocity);console.log('module-start:'+starts);timers.every(1,()=>{});events.on('probe',()=>{local++;this.entity.position.z=local;});}});",
      );
      const second = s.getState().addNode("mesh", "Second");
      s.getState().attachScript(second, "main.js");
      s.getState().createScript("player.js");
      s.getState().updateScript(
        "player.js",
        "/** @param {ScriptContext} context */\nexport default function({entity,events,timers,defineScript}) { let count=0; return defineScript({onStart(){timers.every(1,()=>{});events.on('probe',()=>{count++; entity.position.z=count;});}, async load(){const m=await import('./utils.js'); entity.position.y=m.speed;}}); }",
      );
      const template = s.getState().addNode("mesh", "Template");
      s.getState().attachScript(template, "player.js");
      (window as any).prefab = s
        .getState()
        .createPrefab(template, "Module Prefab");
      s.getState().removeNode(template);
      (window as any).second = second;
      s.getState().play();
    });
    await runtime.waitForFunction(
      () =>
        (window as any).running &&
        (window as any).lifecycleInstances?.length === 2,
      undefined,
      { polling: 50 },
    );
    expect(
      await runtime.evaluate(
        () => (window as any).sceneAPI.findByName("Second").position.x,
      ),
    ).toBe(6);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).s
            .getState()
            .consoleLogs.filter((l: any) => l.text.startsWith("module-start:"))
            .map((l: any) => l.text),
        ),
      )
      .toEqual(["module-start:1", "module-start:2"]);
    const prefab = await page.evaluate(() => (window as any).prefab);
    await runtime.evaluate(async (id) => {
      const w = window as any,
        owner = w.session.owner(w.sceneAPI.findByName("Second"), "test-owner");
      owner.attach({});
      w.session.startRecords([owner.record]);
      w.spawned = await w.prefabLibrary.forOwner(owner).instantiate(id);
      const record = w.lifecycleInstances.find(
        (r: any) => r.file === "player.js",
      );
      await record.instance.load();
      w.testOwner = owner;
    }, prefab);
    expect(
      await runtime.evaluate(() => (window as any).spawned.root.position.y),
    ).toBe(3);
    const before = await runtime.evaluate(() =>
      (window as any).session.stats(),
    );
    await runtime.evaluate(() => {
      const w = window as any;
      w.testOwner.events.emit("probe");
    });
    expect(
      await runtime.evaluate(() => {
        const w = window as any;
        return [
          w.sceneAPI.findByName("Second").position.z,
          w.spawned.root.position.z,
        ];
      }),
    ).toEqual([1, 1]);
    await runtime.evaluate(() => {
      const w = window as any;
      w.spawned.destroy();
    });
    const after = await runtime.evaluate(() => (window as any).session.stats());
    expect(after.timers).toBe(before.timers - 1);
    expect(after.subscriptions).toBe(before.subscriptions - 1);
    await page.evaluate(() => (window as any).s.getState().stop());
    await runtime.waitForFunction(
      () =>
        (window as any).moduleLoader === null &&
        (window as any).session.stats().scripts === 0,
      undefined,
      { polling: 50 },
    );
    await page.evaluate(() => {
      const s = (window as any).s;
      s.getState().clearConsoleLogs();
      s.getState().play();
    });
    await runtime.waitForFunction(
      () =>
        (window as any).running &&
        (window as any).lifecycleInstances?.length === 2,
      undefined,
      { polling: 50 },
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).s
            .getState()
            .consoleLogs.filter((l: any) => l.text.startsWith("module-start:"))
            .map((l: any) => l.text),
        ),
      )
      .toEqual(["module-start:1", "module-start:2"]);
    await page.evaluate(() => (window as any).s.getState().stop());
  });
  await test.step("rename/undo and ZIP roundtrip keep module source and relative references", async () => {
    await page.evaluate(async () => {
      const s = (window as any).s;
      s.getState().renameScript("utils.js", "math.js");
      if (!s.getState().scripts["barrel.js"].includes("./math.js"))
        throw Error("rename did not update reexport");
      s.getState().undo();
      if (!s.getState().scripts["barrel.js"].includes("./utils.js"))
        throw Error("undo");
      s.getState().redo();
      const { createProjectArchive, importProject } = await import(
        "/src/utils/projectExport.ts"
      );
      const zip = createProjectArchive();
      (window as any).savedSource = JSON.stringify(s.getState().scripts);
      s.getState().newProject();
      await importProject(new File([zip], "modules.arkglide"));
    });
    expect(
      await page.evaluate(() =>
        JSON.stringify((window as any).s.getState().scripts),
      ),
    ).toBe(await page.evaluate(() => (window as any).savedSource));
  });
  await test.step("module error navigation points at the original utility line and other entities keep running", async () => {
    await page.evaluate(() => {
      const s = (window as any).s;
      s.getState().clearConsoleLogs();
      s.getState().updateScript(
        "math.js",
        "export const speed=3;\nexport function begin(){throw new Error('module-boom');}\nexport let starts=0; export default x=>x*2;",
      );
      s.getState().createScript("good.js");
      s.getState().updateScript(
        "good.js",
        "export default function({entity}){return {onStart(){entity.position.y=9;}};}",
      );
      s.getState().attachScript((window as any).second, "good.js");
      s.getState().play();
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).s
              .getState()
              .consoleLogs.filter((l: any) => l.text.includes("module-boom"))
              .length,
        ),
      )
      .toBe(2);
    const diagnostic = await page.evaluate(() =>
      (window as any).s
        .getState()
        .consoleLogs.find((l: any) => l.text.includes("module-boom")),
    );
    expect(diagnostic.location.file).toBe("math.js");
    expect(diagnostic.location.line).toBe(2);
    expect(
      await runtime.evaluate(
        () => (window as any).sceneAPI.findByName("Second").position.y,
      ),
    ).toBe(9);
    await page.evaluate(() => (window as any).s.getState().stop());
  });
  await test.step("stopping pending module imports cannot start a stale lifecycle", async () => {
    // A fresh sandbox is created on replay; install the delay in that document.
    await page.addInitScript(() => {
      window.addEventListener("DOMContentLoaded", () => {
        const w = window as any;
        if (!w.ArkGlideModules) return;
        const create = w.ArkGlideModules.createLoader;
        w.ArkGlideModules.createLoader = function (...args: any[]) {
          const loader = create(...args),
            prepare = loader.prepare;
          loader.prepare = async () => {
            w.__modulePrepareStarted = true;
            await prepare();
            await new Promise((r) => setTimeout(r, 150));
          };
          return loader;
        };
      });
    });
    await page.evaluate(() => {
      const s = (window as any).s;
      s.getState().play();
    });
    await runtime.waitForFunction(
      () => (window as any).__modulePrepareStarted === true,
      undefined,
      { polling: 10 },
    );
    await page.waitForTimeout(30);
    await page.evaluate(() => (window as any).s.getState().stop());
    await page.waitForTimeout(250);
    expect(
      await runtime.evaluate(() => {
        const w = window as any;
        return {
          entities: w.sceneAPI.getEntityCount(),
          scripts: w.session.stats().scripts,
          modules: w.moduleLoader,
        };
      }),
    ).toEqual({ entities: 0, scripts: 0, modules: null });
  });
  expect(errors).toEqual([]);
});
