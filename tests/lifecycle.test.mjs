import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/engine/lifecycle-runtime.js';
const create=options=>globalThis.ArkGlideLifecycle.createSession(options);

test('fixed-step results agree at 30, 60 and 120 FPS and run before frame hooks',()=>{
  for(const fps of [30,60,120]){
    const session=create(),order=[];let distance=0;
    const owner=session.owner({id:'player'},'move.js');
    owner.attach({onFixedUpdate(){distance+=3*session.time.fixedDeltaTime;order.push('fixed');},onUpdate(){order.push('frame');}});
    session.start();session.tick(0);
    for(let frame=1;frame<=fps;frame++)session.tick(frame*1000/fps);
    assert.ok(Math.abs(distance-3)<1e-9);assert.equal(session.time.fixedFrameCount,60);
    assert.equal(order.at(-1),'frame');session.stop();
  }
});
test('time scaling freezes timers; pause/resume and catch-up limits avoid a large jump',()=>{
  const session=create(),owner=session.owner({id:'one'},'timer.js');let count=0;
  owner.attach({});owner.timers.every(0.1,()=>count++);session.start({timeScale:2,maxSubSteps:2});
  session.tick(0);session.tick(50);assert.equal(count,1);assert.equal(session.time.totalTime,0.1);
  session.time.timeScale=0;session.tick(100);assert.equal(count,1);
  session.pause();session.tick(50000);session.resume();session.tick(60000);
  assert.equal(session.time.deltaTime,0);assert.equal(session.time.totalTime,0.1);
  session.time.timeScale=1;session.tick(61000);assert.equal(session.time.fixedFrameCount,4);
  assert.ok(session.stats().droppedTime>0.9);session.stop();
  assert.throws(()=>{session.time.timeScale=NaN;},RangeError);
});
test('timer/event ownership, native listener cleanup and repeated stop are deterministic',()=>{
  const session=create(),a=session.owner({id:'a'},'a.js'),b=session.owner({id:'b'},'b.js'),target=new EventTarget();
  let fired=0,event=0,destroyed=0,native=0;
  a.attach({onDestroy(){destroyed++;}});b.attach({});
  a.timers.every(0.1,()=>fired++);a.events.on('score',()=>event++);a.events.listen(target,'ping',()=>native++);
  const id=a.globals.setTimeout(()=>fired++,100);a.globals.clearTimeout(id);
  session.start();session.tick(0);session.tick(100);b.events.emit('score');target.dispatchEvent(new Event('ping'));
  assert.equal(fired,1);assert.equal(event,1);assert.equal(native,1);
  session.destroyEntity('a');session.destroyEntity('a');b.events.emit('score');target.dispatchEvent(new Event('ping'));session.tick(200);
  assert.equal(fired,1);assert.equal(event,1);assert.equal(native,1);assert.equal(destroyed,1);
  session.stop();session.stop();const stats=session.stats();
  for(const key of ['scripts','timers','subscriptions','listeners'])assert.equal(stats[key],0,key);
});
test('all factories complete before startup; destroyed and aborted owners release resources',()=>{
  const session=create(),order=[];
  const a=session.owner({id:'a'},'a.js'),b=session.owner({id:'b'},'b.js'),failed=session.owner({id:'bad'},'bad.js');
  a.attach({onStart(){order.push('a');b.events.emit('ready');},onDestroy(){order.push('destroy-a');}});
  b.attach({onStart(){order.push('b');},onDestroy(){order.push('destroy-b');}});b.events.on('ready',()=>order.push('event'));
  failed.timers.after(0,()=>assert.fail('aborted timer ran'));failed.events.on('ready',()=>assert.fail('aborted event ran'));failed.abort();
  session.start();assert.deepEqual(order,['a','event','b']);session.stop();
  assert.deepEqual(order.slice(-2),['destroy-b','destroy-a']);assert.equal(session.stats().timers,0);
});
test('a throwing hook is disabled once while other scripts continue',()=>{
  const errors=[],session=create({onError:e=>errors.push(e)}),a=session.owner({id:'a'},'broken.js'),b=session.owner({id:'b'},'good.js');let frames=0;
  a.attach({onUpdate(){throw new Error('bad');}});b.attach({onUpdate(){frames++;}});session.start();
  for(let i=0;i<10;i++)session.tick(i*20);
  assert.equal(errors.length,1);assert.equal(errors[0].file,'broken.js');assert.equal(errors[0].hook,'onUpdate');assert.equal(frames,10);session.stop();
});
test('invalid fixed settings fail rather than looping and a timer cannot fire after cancel',()=>{
  assert.throws(()=>create().start({fixedTimeStep:0}),RangeError);
  const session=create(),owner=session.owner({id:'one'},'one.js');let calls=0;
  const cancel=owner.timers.after(0.1,()=>calls++);cancel();cancel();session.start();session.tick(0);session.tick(100);
  assert.equal(calls,0);session.stop();
});

test('one bad subscriber does not cancel other same-name subscriptions and once listeners are counted accurately',()=>{
 const errors=[],session=create({onError:e=>errors.push(e)}),owner=session.owner({id:'one'},'one.js'),target=new EventTarget();let events=0,native=0;
 owner.attach({});owner.events.on('score',()=>{throw new Error('bad listener');});owner.events.on('score',()=>events++);
 owner.events.listen(target,'once',()=>native++,{once:true});session.start();
 owner.events.emit('score');owner.events.emit('score');target.dispatchEvent(new Event('once'));target.dispatchEvent(new Event('once'));
 assert.equal(events,2);assert.equal(errors.length,1);assert.equal(native,1);assert.equal(session.stats().listeners,0);session.stop();
});
