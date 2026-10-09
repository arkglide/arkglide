import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as Babylon from '@babylonjs/core';

function setup() {
  let clock = 1000, render;
  const messages = [], handlers = {}, canvasHandlers = {};
  const parent = { postMessage: message => messages.push(message) };
  class Engine extends Babylon.NullEngine {
    runRenderLoop(callback) { render = callback; }
  }
  const context = vm.createContext({
    BABYLON: { ...Babylon, Engine },
    window: { parent, addEventListener: (name, callback) => { handlers[name] = callback; } },
    document: { getElementById: () => ({ addEventListener: (name, callback) => { canvasHandlers[name] = callback; } }) },
    console: { log() {}, warn() {}, error() {} },
    performance: { now: () => clock },
    setTimeout: () => 1, clearTimeout() {}, URL, Blob,
  });
  vm.runInContext(fs.readFileSync(new URL('../public/arkglide-api.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../public/arkglide-lifecycle.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../public/arkglide-scene.js', import.meta.url), 'utf8'), context);
  const html = fs.readFileSync(new URL('../public/runtime.html', import.meta.url), 'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return {
    context, messages, canvasHandlers, handlers,
    async send(message) { handlers.message({ source: parent, data: message }); await new Promise(resolve => setImmediate(resolve)); },
    tick(ms = 100) { clock += ms; render(); },
  };
}
const node = { id: 'cube', name: 'Player', type: 'mesh', transform: { x: 0, y: 0, z: 0 }, scripts: ['main.js'] };

test('bound scripts receive factory context, axis input and pause-safe time', async () => {
  const { context, send, tick, handlers, canvasHandlers } = setup();
  try {
    await send({ type: 'run', project: { scene: { nodes: [node] }, scripts: { 'main.js': `
      const owner = this.entity;
      return defineScript({ speed: 3, onUpdate() {
        owner.translate(input.getAxis('a', 'd') * this.speed * time.deltaTime, 0, 0);
      } });` } } });
    assert.equal(context.lifecycleInstances.length, 1);
    assert.equal(context.sceneAPI.findByName('Player').id, 'cube');
    handlers.keydown({ key: 'd', preventDefault() {} });
    tick(); tick();
    assert.ok(Math.abs(context.sceneAPI.find('cube').position.x - 0.3) < 1e-6);
    handlers.keydown({ key: 'a', preventDefault() {} });
    assert.equal(context.input.getAxis('a', 'd'), 0);
    canvasHandlers.mousedown({ clientX: 10, clientY: 10 });
    canvasHandlers.mousemove({ clientX: 13, clientY: 12 });
    canvasHandlers.mousemove({ clientX: 18, clientY: 15 });
    assert.equal(context.input.getMouseDelta().x, 8);
    assert.equal(context.input.getMouseDelta().y, 5);
    const elapsed = context.time.totalTime;
    await send({ type: 'pause' });
    tick(5000);
    assert.equal(context.time.totalTime, elapsed);
    await send({ type: 'resume' });
    tick(100);
    assert.equal(context.time.deltaTime, 0);
    assert.equal(context.time.totalTime, elapsed);
    await send({ type: 'stop' });
    assert.equal(context.sceneAPI.getEntityCount(), 0);
    assert.equal(context.time.totalTime, 0);
  } finally { context.engine?.dispose(); }
});

test('two entities bound to the same script keep independent custom state', async () => {
  const { context, send, tick } = setup();
  try {
    await send({ type: 'run', project: {
      scene: { nodes: [node, { ...node, id: 'sphere', name: 'Other' }] },
      scripts: { 'main.js': 'return defineScript({ count: 0, onUpdate() { this.count++; this.entity.position.x = this.count; } });' },
    } });
    tick();
    assert.equal(context.lifecycleInstances.length, 2);
    assert.notEqual(context.lifecycleInstances[0].instance, context.lifecycleInstances[1].instance);
    assert.equal(context.sceneAPI.find('cube').position.x, 1);
    assert.equal(context.sceneAPI.find('sphere').position.x, 1);
    context.sceneAPI.find('cube').destroy();
    tick();
    assert.equal(context.lifecycleInstances[0].instance.count, 1);
    assert.equal(context.sceneAPI.find('sphere').position.x, 2);
  } finally { context.engine?.dispose(); }
});

test('legacy single-script projects update and retain old transform methods', async () => {
  const { context, send, tick } = setup();
  try {
    await send({ type: 'run', project: { scene: { nodes: [node] }, script: `return {
      onStart() { entity.setPosition(1, 2, 3); },
      onUpdate() { this.entity.transform.x += 1; }
    };` } });
    tick();
    assert.equal(context.sceneAPI.find('cube').getPosition().x, 2);
    context.sceneAPI.find('cube').destroy();
    tick(); // Destroyed entities must not keep invoking their hooks.
    assert.equal(context.sceneAPI.getEntityCount(), 0);
  } finally { context.engine?.dispose(); }
});

test('destroy hooks run before disposal and stop releases all owned timers/listeners/materials',async()=>{
 const {context,send,tick}=setup();
 try{
  await send({type:'run',project:{scene:{nodes:[{...node,color:'#123456'}]},scripts:{'main.js': `return {
   onStart(){setInterval(()=>this.entity.position.x++,50);timers.every(.1,()=>{});events.on('score',()=>{});},
   onDestroy(){console.log('destroy-live:'+this.entity.getName());}
  };`}}});tick();tick();
  assert.ok(context.session.stats().timers>0);context.sceneAPI.destroy('cube');
  assert.equal(context.session.stats().timers,0);assert.equal(context.session.stats().subscriptions,0);assert.equal(context.scene.materials.filter(m=>m.name==='cube:material').length,0);
  await send({type:'stop'});assert.equal(context.session.stats().scripts,0);assert.equal(context.entityMap.size,0);
 }finally{context.engine?.dispose();}
});
test('a failing script reports its filename and hook once without disabling other entities',async()=>{
 const {context,messages,send,tick}=setup();
 try{
  await send({type:'run',project:{scene:{nodes:[node,{...node,id:'other',scripts:['good.js']}]},scripts:{'main.js':'return {onUpdate(){throw new Error("failure");}};','good.js':'return {onUpdate(){this.entity.position.x++;}};'}}});
  tick();tick();tick();
  const errors=messages.filter(m=>m.type==='diagnostic');assert.equal(errors.length,1);assert.equal(errors[0].file,'main.js');assert.equal(errors[0].hook,'onUpdate');assert.equal(context.sceneAPI.find('other').position.x,3);
  await send({type:'stop'});
 }finally{context.engine?.dispose();}
});
