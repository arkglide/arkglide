import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as Babylon from "@babylonjs/core";

import "../public/lib/jolt-physics.js";
const Jolt = await globalThis.createArkGlideJolt();
function setup() {
  let clock = 1000,
    render;
  const messages = [],
    handlers = {},
    canvasHandlers = {};
  const parent = { postMessage: (message) => messages.push(message) };
  class Engine extends Babylon.NullEngine {
    runRenderLoop(callback) {
      render = callback;
    }
  }
  const context = vm.createContext({
    createArkGlideJolt: () => Promise.resolve(Jolt),
    BABYLON: { ...Babylon, Engine },
    window: {
      parent,
      removeEventListener() {},
      addEventListener: (name, callback) => {
        handlers[name] = callback;
      },
    },
    document: {
      addEventListener() {},
      removeEventListener() {},
      getElementById: () => ({
        style: {},
        querySelectorAll: () => [],
        replaceChildren() {},
        removeEventListener() {},
        addEventListener: (name, callback) => {
          canvasHandlers[name] = callback;
        },
      }),
    },
    console: { log() {}, warn() {}, error() {} },
    performance: { now: () => clock },
    setTimeout: () => 1,
    clearTimeout() {},
    URL,
    URLSearchParams,
    location:{search:""},
    Blob,
    structuredClone,
    TextEncoder,
    crypto,
  });
  vm.runInContext(
    fs.readFileSync(
      new URL("../public/arkglide-api.js", import.meta.url),
      "utf8",
    ),
    context,
  );
  vm.runInContext(
    fs.readFileSync(
      new URL("../public/arkglide-lifecycle.js", import.meta.url),
      "utf8",
    ),
    context,
  );
  vm.runInContext(
    fs.readFileSync(
      new URL("../public/arkglide-scene.js", import.meta.url),
      "utf8",
    ),
    context,
  );
  vm.runInContext(
    fs.readFileSync(
      new URL("../public/arkglide-prefabs.js", import.meta.url),
      "utf8",
    ),
    context,
  );
  for (const name of ["timing", "render-view-budget", "render-compute", "rendering-config", "rendering", "spatial", "state", "visuals", "surfaces", "fields", "triggers", "signals", "motion", "optics", "levels", "checkpoints", "portal-projection", "cameras", "portals", "interaction", "physics-tools", "physics", "input-ui", "audio", "animation"])
    vm.runInContext(
      fs.readFileSync(
        new URL("../public/arkglide-" + name + ".js", import.meta.url),
        "utf8",
      ),
      context,
    );
  for (const name of ["lib/acorn", "arkglide-modules"])
    vm.runInContext(
      fs.readFileSync(
        new URL("../public/" + name + ".js", import.meta.url),
        "utf8",
      ),
      context,
    );
  const html = fs.readFileSync(
    new URL("../public/runtime.html", import.meta.url),
    "utf8",
  );
  // Execute every inline block in document order, including the early boot reporter.
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
    vm.runInContext(match[1], context);
  return {
    context,
    messages,
    canvasHandlers,
    handlers,
    async send(message) {
      handlers.message({ source: parent, data: message });
      await new Promise((resolve) => setImmediate(resolve));
    },
    tick(ms = 100) {
      clock += ms;
      render();
    },
  };
}
const node = {
  id: "cube",
  name: "Player",
  type: "mesh",
  transform: { x: 0, y: 0, z: 0 },
  scripts: ["main.js"],
};

test("the integrated runtime renders every jittered 60 Hz callback at its default 60 FPS cap", async () => {
  const {context, send, tick} = setup();
  try {
    await send({type: "run", project: {scene: {nodes: [node]}, scripts: {"main.js": "return {};"}}});
    tick(0);
    const before = context.time.frameCount;
    for (let i = 0; i < 120; i++) tick(i % 2 ? 17 : 1000 / 30 - 17);
    assert.equal(context.time.frameCount - before, 120);
  } finally {
    await send({type: "stop"});
    context.engine?.dispose();
  }
});

test("bound scripts receive factory context, axis input and pause-safe time", async () => {
  const { context, send, tick, handlers, canvasHandlers } = setup();
  try {
    await send({
      type: "run",
      project: {
        scene: { nodes: [node] },
        scripts: {
          "main.js": `
      const owner = this.entity;
      return defineScript({ speed: 3, onUpdate() {
        owner.translate(input.getAxis('a', 'd') * this.speed * time.deltaTime, 0, 0);
      } });`,
        },
      },
    });
    assert.equal(context.lifecycleInstances.length, 1);
    assert.equal(context.sceneAPI.findByName("Player").id, "cube");
    handlers.keydown({ key: "d", preventDefault() {} });
    tick();
    tick();
    assert.ok(Math.abs(context.sceneAPI.find("cube").position.x - 0.3) < 1e-6);
    handlers.keydown({ key: "a", preventDefault() {} });
    assert.equal(context.input.getAxis("a", "d"), 0);
    canvasHandlers.pointerdown({ clientX: 10, clientY: 10 });
    canvasHandlers.pointermove({ clientX: 13, clientY: 12 });
    canvasHandlers.pointermove({ clientX: 18, clientY: 15 });
    assert.equal(context.input.getMouseDelta().x, 8);
    assert.equal(context.input.getMouseDelta().y, 5);
    const elapsed = context.time.totalTime;
    await send({ type: "pause" });
    tick(5000);
    assert.equal(context.time.totalTime, elapsed);
    await send({ type: "resume" });
    tick(100);
    assert.equal(context.time.deltaTime, 0);
    assert.equal(context.time.totalTime, elapsed);
    await send({ type: "stop" });
    assert.equal(context.sceneAPI.getEntityCount(), 0);
    assert.equal(context.time.totalTime, 0);
  } finally {
    context.engine?.dispose();
  }
});

test("two entities bound to the same script keep independent custom state", async () => {
  const { context, send, tick } = setup();
  try {
    await send({
      type: "run",
      project: {
        scene: { nodes: [node, { ...node, id: "sphere", name: "Other" }] },
        scripts: {
          "main.js":
            "return defineScript({ count: 0, onUpdate() { this.count++; this.entity.position.x = this.count; } });",
        },
      },
    });
    tick();
    assert.equal(context.lifecycleInstances.length, 2);
    assert.notEqual(
      context.lifecycleInstances[0].instance,
      context.lifecycleInstances[1].instance,
    );
    assert.equal(context.sceneAPI.find("cube").position.x, 1);
    assert.equal(context.sceneAPI.find("sphere").position.x, 1);
    const destroyedRecord = context.lifecycleInstances[0];
    context.sceneAPI.find("cube").destroy();
    tick();
    assert.equal(destroyedRecord.instance.count, 1);
    assert.equal(context.lifecycleInstances.length, 1);
    assert.equal(context.sceneAPI.find("sphere").position.x, 2);
  } finally {
    context.engine?.dispose();
  }
});

test("legacy single-script projects update and retain old transform methods", async () => {
  const { context, send, tick } = setup();
  try {
    await send({
      type: "run",
      project: {
        scene: { nodes: [node] },
        script: `return {
      onStart() { entity.setPosition(1, 2, 3); },
      onUpdate() { this.entity.transform.x += 1; }
    };`,
      },
    });
    tick();
    assert.equal(context.sceneAPI.find("cube").getPosition().x, 2);
    context.sceneAPI.find("cube").destroy();
    tick(); // Destroyed entities must not keep invoking their hooks.
    assert.equal(context.sceneAPI.getEntityCount(), 0);
  } finally {
    context.engine?.dispose();
  }
});

test("destroy hooks run before disposal and stop releases all owned timers/listeners/materials", async () => {
  const { context, send, tick } = setup();
  try {
    await send({
      type: "run",
      project: {
        scene: { nodes: [{ ...node, color: "#123456" }] },
        scripts: {
          "main.js": `return {
   onStart(){setInterval(()=>this.entity.position.x++,50);timers.every(.1,()=>{});events.on('score',()=>{});},
   onDestroy(){console.log('destroy-live:'+this.entity.getName());}
  };`,
        },
      },
    });
    tick();
    tick();
    assert.ok(context.session.stats().timers > 0);
    context.sceneAPI.destroy("cube");
    assert.equal(context.session.stats().timers, 0);
    assert.equal(context.session.stats().subscriptions, 0);
    assert.equal(
      context.scene.materials.filter((m) => m.name === "cube:material").length,
      0,
    );
    await send({ type: "stop" });
    assert.equal(context.session.stats().scripts, 0);
    assert.equal(context.entityMap.size, 0);
  } finally {
    context.engine?.dispose();
  }
});
test("a failing script reports its filename and hook once without disabling other entities", async () => {
  const { context, messages, send, tick } = setup();
  try {
    await send({
      type: "run",
      project: {
        scene: {
          nodes: [node, { ...node, id: "other", scripts: ["good.js"] }],
        },
        scripts: {
          "main.js": 'return {onUpdate(){throw new Error("failure");}};',
          "good.js": "return {onUpdate(){this.entity.position.x++;}};",
        },
      },
    });
    tick();
    tick();
    tick();
    const errors = messages.filter((m) => m.type === "diagnostic");
    assert.equal(errors.length, 1);
    assert.equal(errors[0].file, "main.js");
    assert.equal(errors[0].hook, "onUpdate");
    assert.equal(context.sceneAPI.find("other").position.x, 3);
    await send({ type: "stop" });
  } finally {
    context.engine?.dispose();
  }
});

const fullNode = (id, type = "mesh", extra = {}) => ({
  id,
  name: id,
  type,
  transform: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  visible: true,
  ...extra,
});
const runtimePrefab = (extra = {}) => ({
  id: "enemy",
  name: "Enemy",
  revision: 1,
  rootId: "root",
  nodes: [
    fullNode("root", "empty", { scripts: ["enemy.js"] }),
    fullNode("part", "mesh", { parentId: "root", scripts: ["enemy.js"] }),
  ],
  modelKeys: {},
  ...extra,
});
function content(prefab = runtimePrefab()) {
  return {
    prefabs: { enemy: prefab },
    materials: {},
    textures: [],
    prefabInstances: {},
  };
}
test("runtime spawning creates independent hierarchies and scripts without resetting existing live transforms or clock", async () => {
  const t = setup();
  try {
    await t.send({
      type: "run",
      project: {
        scene: { nodes: [fullNode("original")] },
        content: content(),
        scripts: {
          "main.js": "",
          "enemy.js": `return {count:0,onStart(){this.entity.name+=':started';},onUpdate(){this.entity.position.x=++this.count;},onDestroy(){console.log('destroyed');}};`,
        },
      },
    });
    t.context.sceneAPI.find("original").position.x = 20;
    t.tick();
    t.tick();
    const time = t.context.time.totalTime;
    const a = await t.context.prefabs.instantiate("enemy", {
        position: { x: 3, y: 2, z: 1 },
      }),
      b = await t.context.prefabs.instantiate("enemy");
    assert.equal(t.context.sceneAPI.find("original").position.x, 20);
    assert.equal(t.context.time.totalTime, time);
    assert.equal(a.entities.length, 2);
    assert.notEqual(a.root.id, b.root.id);
    assert.equal(a.root.position.x, 3);
    assert.match(a.root.name, /:started$/);
    assert.equal(a.find("part").getWorldPosition().y, 2);
    t.tick();
    assert.equal(a.find("part").position.x, 1);
    a.destroy();
    assert.ok(a.entities.every((e) => e.destroyed));
    assert.equal(t.context.session.stats().scripts, 2);
    await t.send({ type: "pause" });
    const elapsed = t.context.time.totalTime;
    const c = await t.context.prefabs.instantiate("enemy");
    t.tick(1000);
    assert.equal(t.context.time.totalTime, elapsed);
    assert.equal(c.root.position.x, 0);
    await t.send({ type: "stop" });
    assert.equal(t.context.session.stats().scripts, 0);
    assert.equal(t.context.entityMap.size, 0);
  } finally {
    t.context.engine?.dispose();
  }
});
test("runtime spawning rejects missing dependencies and invalid options before mutating scene", async () => {
  const t = setup();
  try {
    const prefab = runtimePrefab({
      nodes: [fullNode("root", "model")],
      modelKeys: { root: "prefab:enemy:root" },
    });
    await t.send({
      type: "run",
      project: {
        scene: { nodes: [fullNode("original")] },
        content: content(prefab),
        scripts: { "main.js": "" },
      },
    });
    const before = t.context.entityMap.size;
    await assert.rejects(t.context.prefabs.instantiate("missing"), /不存在/);
    await assert.rejects(
      t.context.prefabs.instantiate("enemy", {
        position: { x: NaN, y: 0, z: 0 },
      }),
      /Vec3/,
    );
    await assert.rejects(t.context.prefabs.instantiate("enemy"), /资源缺失/);
    assert.equal(t.context.entityMap.size, before);
  } finally {
    await t.send({ type: "stop" });
    t.context.engine?.dispose();
  }
});
test("pending runtime model spawn cancels immediately on stop and disposes late model containers", async () => {
  const t = setup();
  let resolve,
    disposed = 0;
  try {
    t.context.BABYLON.SceneLoader = {
      LoadAssetContainerAsync: () => new Promise((r) => (resolve = r)),
    };
    await t.send({
      type: "run",
      modelData: { "prefab:enemy:root": new ArrayBuffer(4) },
      project: {
        scene: { nodes: [fullNode("original")] },
        content: content(
          runtimePrefab({
            nodes: [fullNode("root", "model")],
            modelKeys: { root: "prefab:enemy:root" },
          }),
        ),
        scripts: { "main.js": "" },
      },
    });
    const pending = t.context.prefabs.instantiate("enemy");
    const rejected = assert.rejects(pending, (e) => e.name === "AbortError");
    await new Promise((r) => setImmediate(r));
    assert.equal(t.context.prefabLibrary.pendingCount, 1);
    await t.send({ type: "stop" });
    await rejected;
    assert.equal(t.context.entityMap.size, 0);
    resolve({
      meshes: [],
      transformNodes: [],
      addAllToScene() {
        throw new Error("late add");
      },
      dispose() {
        disposed++;
      },
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(disposed, 1);
    assert.equal(t.context.prefabLibrary.pendingCount, 0);
  } finally {
    t.context.engine?.dispose();
  }
});
test("script-owned pending spawn cancels on owner destruction and does not attach late scripts", async () => {
  const t = setup();
  let resolve;
  try {
    t.context.BABYLON.SceneLoader = {
      LoadAssetContainerAsync: () => new Promise((r) => (resolve = r)),
    };
    await t.send({
      type: "run",
      modelData: { "prefab:enemy:root": new ArrayBuffer(4) },
      project: {
        scene: {
          nodes: [fullNode("original", "mesh", { scripts: ["main.js"] })],
        },
        content: content(
          runtimePrefab({
            nodes: [fullNode("root", "model")],
            modelKeys: { root: "prefab:enemy:root" },
          }),
        ),
        scripts: {
          "main.js": `return {onStart(){globalThis.pendingSpawn=prefabs.instantiate('enemy');globalThis.pendingSpawn.catch(e=>globalThis.spawnError=e.name);}};`,
        },
      },
    });
    t.context.sceneAPI.destroy("original");
    await new Promise((r) => setImmediate(r));
    assert.equal(t.context.spawnError, "AbortError");
    assert.equal(t.context.entityMap.size, 0);
    resolve({
      meshes: [],
      transformNodes: [],
      addAllToScene() {},
      dispose() {},
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(t.context.session.stats().scripts, 0);
  } finally {
    await t.send({ type: "stop" });
    t.context.engine?.dispose();
  }
});
test("successful model instances survive subsequent spawns; parent disposal cancels pending children", async () => {
  const t = setup();
  let resolve;
  try {
    t.context.BABYLON.SceneLoader = {
      LoadAssetContainerAsync: () => new Promise((r) => (resolve = r)),
    };
    await t.send({
      type: "run",
      modelData: { "prefab:enemy:root": new ArrayBuffer(4) },
      project: {
        scene: { nodes: [fullNode("original")] },
        content: content(
          runtimePrefab({
            nodes: [fullNode("root", "model")],
            modelKeys: { root: "prefab:enemy:root" },
          }),
        ),
        scripts: { "main.js": "" },
      },
    });
    const container = () => ({
      meshes: [],
      transformNodes: [],
      addAllToScene() {},
      dispose() {
        this.disposed = true;
      },
    });
    const first = t.context.prefabs.instantiate("enemy");
    await new Promise((r) => setImmediate(r));
    const resource = container();
    resolve(resource);
    const a = await first;
    const second = t.context.prefabs.instantiate("enemy", { parent: a.root });
    const rejected = assert.rejects(second, (e) => e.name === "AbortError");
    await new Promise((r) => setImmediate(r));
    assert.equal(t.context.sceneAdapter.resources.get(a.root.id), resource);
    assert.ok(!resource.disposed);
    a.destroy();
    await rejected;
    resolve(container());
    await new Promise((r) => setImmediate(r));
    assert.equal(t.context.prefabLibrary.pendingCount, 0);
  } finally {
    await t.send({ type: "stop" });
    t.context.engine?.dispose();
  }
});

test("model load failure cleans partial prefab entities and reports the failure without disturbing the existing scene", async () => {
  const t = setup();
  try {
    t.context.BABYLON.SceneLoader = {
      LoadAssetContainerAsync: async () => {
        throw new Error("invalid glb");
      },
    };
    await t.send({
      type: "run",
      modelData: { "prefab:enemy:root": new ArrayBuffer(4) },
      project: {
        scene: { nodes: [fullNode("original")] },
        content: content(
          runtimePrefab({
            nodes: [fullNode("root", "model")],
            modelKeys: { root: "prefab:enemy:root" },
          }),
        ),
        scripts: { "main.js": "" },
      },
    });
    t.context.sceneAPI.find("original").position.x = 12;
    await assert.rejects(t.context.prefabs.instantiate("enemy"), /加载失败/);
    assert.equal(t.context.entityMap.size, 1);
    assert.equal(t.context.sceneAPI.find("original").position.x, 12);
    assert.equal(t.context.prefabLibrary.pendingCount, 0);
    assert.ok(
      t.messages.some(
        (m) => m.type === "diagnostic" && m.message === "invalid glb",
      ),
    );
  } finally {
    await t.send({ type: "stop" });
    t.context.engine?.dispose();
  }
});
test("repeated model spawn/destroy releases model buffers, factory records and subscriptions without disposing shared materials", async () => {
  const t = setup();
  try {
    t.context.BABYLON.SceneLoader = {
      LoadAssetContainerAsync: async () => {
        const mesh = Babylon.MeshBuilder.CreateBox("part", {}, t.context.scene);
        mesh.material = new Babylon.StandardMaterial(
          "original",
          t.context.scene,
        );
        return {
          meshes: [mesh],
          transformNodes: [],
          addAllToScene() {},
          dispose() {
            mesh.dispose(false, true);
          },
        };
      },
    };
    const c = content(
      runtimePrefab({
        nodes: [
          fullNode("root", "model", { scripts: ["enemy.js"], materialId: "m" }),
        ],
        modelKeys: { root: "prefab:enemy:root" },
      }),
    );
    c.materials.m = {
      id: "m",
      name: "Shared",
      baseColor: "#FFFFFF",
      emissiveColor: "#000000",
      metallic: 0,
      roughness: 1,
      alpha: 1,
      doubleSided: false,
      uvScale: { u: 1, v: 1 },
    };
    await t.send({
      type: "run",
      modelData: { "prefab:enemy:root": new ArrayBuffer(4) },
      project: {
        scene: { nodes: [fullNode("original")] },
        content: c,
        scripts: {
          "main.js": "",
          "enemy.js":
            "return {onStart(){timers.every(1,()=>{});events.on('ping',()=>{});}};",
        },
      },
    });
    const base = {
      meshes: t.context.scene.meshes.length,
      materials: t.context.scene.materials.length,
      buffers: Object.keys(t.context.runtimeModelData).length,
    };
    for (let i = 0; i < 25; i++) {
      const handle = await t.context.prefabs.instantiate("enemy");
      assert.equal(t.context.session.stats().scripts, 1);
      handle.destroy();
      assert.equal(t.context.session.records.length, 0);
      assert.equal(t.context.session.stats().timers, 0);
      assert.equal(t.context.session.stats().subscriptions, 0);
      assert.equal(t.context.scene.meshes.length, base.meshes);
      assert.equal(t.context.scene.materials.length, base.materials);
      assert.equal(
        Object.keys(t.context.runtimeModelData).length,
        base.buffers,
      );
    }
  } finally {
    await t.send({ type: "stop" });
    t.context.engine?.dispose();
  }
});


test("early bootstrap resource failures report fatal errors with the current boot token", () => {
  const messages = [], handlers = {};
  const context = vm.createContext({
    window: {parent: {postMessage: msg => messages.push(msg)}, addEventListener: (name, callback) => {handlers[name] = callback;}},
    URLSearchParams, location: {search: "?boot=f13-probe"},
  });
  const html = fs.readFileSync(new URL("../public/runtime.html", import.meta.url), "utf8");
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  handlers.error({target: {tagName: "SCRIPT", src: "http://localhost/game/lib/missing.js"}});
  assert.equal(messages[0].type, "fatal");
  assert.equal(messages[0].bootToken, "f13-probe");
  assert.match(messages[0].message, /missing.js/);
  context.arkglideBootFinished = true;
  handlers.error({target: {tagName: "CANVAS"}, message: "later script error"});
  assert.equal(messages.length, 1);
});

test('all foundation services are injected and storage responses require the current parent/run',async()=>{
 const {context,send,handlers,messages}=setup();try{
  await send({type:'run',runId:27,project:{scene:{nodes:[node]},scripts:{'main.js':`return {onStart(){globalThis.foundationCheck={apis:[visuals,surfaces,fields,levels,storage,saves,triggers,signals,motion,optics].every(Boolean),value:null,error:null};storage.read('probe').then(v=>foundationCheck.value=v).catch(e=>foundationCheck.error=e.message);}};`}}});
  assert.equal(context.foundationCheck.apis,true);const request=messages.find(m=>m.type==='storage');assert.ok(request);assert.equal(request.runId,27);
  handlers.message({source:{},data:{type:'storage-result',runId:27,requestId:request.requestId,value:1}});assert.equal(context.foundationCheck.value,null);
  await send({type:'storage-result',runId:26,requestId:request.requestId,value:2});assert.equal(context.foundationCheck.value,null);
  await send({type:'storage-result',runId:27,requestId:request.requestId,value:{chapter:3}});assert.equal(context.foundationCheck.value.chapter,3);assert.equal(context.storageRuntime.stats().storageRequests,0);
  await send({type:'stop'});assert.equal(context.session.stats().scripts,0);assert.equal(context.visualsRuntime,null);assert.equal(context.savesRuntime,null);
 }finally{await send({type:'stop'});context.engine.dispose();}
});

test('legacy-script triggers sample the completed physics step and release telemetry on stop', async () => {
  const { context, send, tick } = setup();
  try {
    await send({ type: 'run', project: { settings: { gravity: { x: 0, y: 0, z: 0 } },
      scene: { nodes: [node] }, scripts: { 'main.js': `
        physics.add(entity,{motion:'dynamic',shape:'box',size:{x:1,y:1,z:1},mass:1,friction:0,restitution:0,sensor:false,lockRotation:false,linearDamping:0,angularDamping:0});
        physics.teleport(entity,{x:2,y:0,z:0});
        physics.setVelocity(entity,{x:-60,y:0,z:0});
        globalThis.triggerPhases=[];
        triggers.create({volumes:[{shape:{kind:'sphere',radius:.1},position:{x:1.3,y:0,z:0}}],onEnter:e=>{triggerPhases.push(e.phase);physics.setVelocity(e.entity,{x:0,y:0,z:0});},onStay:e=>triggerPhases.push(e.phase)});
        return {};` } } });
    assert.deepEqual(Array.from(context.triggerPhases), []);
    tick(0); // The first render initializes the simulation timestamp.
    tick(20);
    assert.deepEqual(Array.from(context.triggerPhases), ['enter']);
    assert.equal(context.triggersRuntime.stats().physicsTriggers, 1);
    context.time.timeScale = 0;
    tick(20);
    assert.deepEqual(Array.from(context.triggerPhases), ['enter']);
    context.time.timeScale = 1;
    tick(20);
    assert.deepEqual(Array.from(context.triggerPhases), ['enter', 'stay']);
    await send({ type: 'stop' });
    assert.equal(context.triggersRuntime, null);
    const telemetry = context.session.stats();
    assert.equal(telemetry.scripts, 0);
  } finally { await send({ type: 'stop' }); context.engine.dispose(); }
});
