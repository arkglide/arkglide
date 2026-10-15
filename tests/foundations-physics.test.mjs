import test from 'node:test';import assert from 'node:assert/strict';import {setup}from './helpers/foundations.mjs';
test('native contact points/stay events and pre-solver material override are oriented and owner scoped',()=>{const s=setup({x:0,y:-9.8,z:0});try{
 const floor=s.body('floor',{x:0,y:-.5,z:0},{x:10,y:1,z:10},'static'),box=s.body('box',{x:0,y:1,z:0}),events=[];let calls=0;
 s.p.onContact(box,e=>events.push(e));s.p.onContactMaterial(floor,e=>{calls++;assert.equal(e.self,floor);return {friction:1.2,restitution:0};});
 for(let i=0;i<90;i++)s.physics.step(1/60);
 assert.ok(calls>0);assert.ok(events.some(e=>e.phase==='enter'));const stay=events.find(e=>e.phase==='stay');assert.equal(stay.other,floor);assert.ok(stay.normal.y<-.9);assert.ok(stay.points.length>0);assert.ok(Number.isInteger(stay.subShape));
 s.p.teleport(box,{x:0,y:8,z:0});s.physics.step(1/60);assert.ok(events.some(e=>e.phase==='exit'));
 s.p.onContactMaterial(floor,()=>{s.p.setVelocity(box,{x:0,y:0,z:0});});s.p.teleport(box,{x:0,y:1,z:0});for(let i=0;i<60;i++)s.physics.step(1/60);assert.ok(s.errors.some(e=>/mutations/.test(e.error.message)));
 }finally{s.done();}});
test('runtime mass/gravity/damping and force are real native properties; force survives substeps',()=>{const s=setup();try{
 const e=s.body('force');s.p.configure(e,{mass:2,gravityFactor:0,linearDamping:0});s.p.applyForce(e,{x:12,y:0,z:0});s.physics.beginFrame(.5);for(let i=0;i<5;i++)s.physics.step(.1);s.physics.endFrame();assert.ok(Math.abs(s.p.getVelocity(e).x-3)<.01);s.physics.step(.1);assert.ok(Math.abs(s.p.getVelocity(e).x-3)<.01);assert.equal(s.p.getProperties(e).mass,2);
 assert.throws(()=>s.p.configure(e,{friction:-1}));assert.equal(s.p.getProperties(e).friction,0);
 }finally{s.done();}});
test('collider update keeps native joints, body identity, authored mass and responds to larger shape',()=>{const s=setup();try{
 const a=s.body('a',{x:0,y:0,z:0}),b=s.body('b',{x:3,y:0,z:0});const joint=s.p.createJoint(a,b,{kind:'distance',min:3,max:3});
 const count=s.physics.stats().physicsBodies;s.p.updateShape(a,{size:{x:2,y:2,z:2}});assert.equal(s.physics.stats().physicsBodies,count);assert.equal(joint.active,true);assert.deepEqual(s.p.getConnectedBodies(a).map(e=>e.id),['a','b']);assert.ok(s.p.raycast({x:0,y:3,z:0},{x:0,y:-5,z:0}).distance<2.1);assert.equal(s.p.getState(a).mass,1);
 }finally{s.done();}});
test('hinge/slider motors switch between position, velocity and off and expose measured state',()=>{for(const kind of ['hinge','slider']){const s=setup();try{
 const anchor=s.body('anchor',{x:0,y:0,z:0},{x:1,y:1,z:1},'static'),e=s.body('motor',{x:0,y:2,z:0});const j=s.p.createJoint(anchor,e,{kind,axis:{x:0,y:1,z:0},anchor:{x:0,y:2,z:0},min:kind==='hinge'?-1:0,max:1});
 j.setMotor({mode:'position',position:.4,force:100,frequency:4,damping:1});for(let i=0;i<90;i++)s.physics.step(1/60);assert.ok(Math.abs(j.getState().current-.4)<.08,JSON.stringify(j.getState()));j.setLimits(0,.8);assert.equal(j.getState().min,0);j.setMotor({velocity:.2,force:100});s.physics.step(1/60);assert.equal(j.getState().motor.velocity,.2);j.setMotor({mode:'off'});assert.equal(j.getState().motor.mode,'off');assert.throws(()=>j.setLimits(1,0));
 }finally{s.done();}}});
test('character runtime parameters, ground identity, blocked resize and force integrate without changing its handle',()=>{const s=setup({x:0,y:-9.8,z:0});try{
 const floor=s.body('floor',{x:0,y:-.5,z:0},{x:20,y:1,z:20},'static'),e=s.entities.sceneAPI.create('box','player');e.position={x:0,y:1,z:0};const ch=s.p.addCharacter(e,{radius:.3,height:1.8,stepHeight:.2,maxSlope:45,speed:2,jumpSpeed:4,mass:2});for(let i=0;i<60;i++)s.physics.step(1/60);assert.equal(ch.getGround().entity,floor);assert.ok(ch.configure({speed:5,height:1.2}));assert.equal(ch.getConfig().height,1.2);assert.ok(ch.configure({gravityFactor:0}));ch.applyForce({x:20,y:0,z:0});s.physics.step(.1);assert.ok(ch.velocity.x>.9);assert.ok(ch.configure({controlEnabled:false}));ch.move({x:1,y:0,z:0});
 const roof=s.body('roof',{x:e.getWorldPosition().x,y:2,z:0},{x:8,y:.2,z:8},'static');assert.equal(ch.configure({height:3}),false);assert.equal(ch.getConfig().height,1.2);assert.equal(ch.getGround()?.entity===roof,false);
 }finally{s.done();}});
test('force fields apply acceleration to both rigid bodies and characters, deduplicate volumes and release callbacks',()=>{const s=setup();try{
 const e=s.body('box'),player=s.entities.sceneAPI.create('box','player'),ch=s.p.addCharacter(player,{radius:.2,height:1,stepHeight:0,maxSlope:45,speed:0,jumpSpeed:0,mass:3});let enter=0,exit=0;
 const volume={shape:{kind:'box',size:{x:10,y:10,z:10}},position:{x:0,y:0,z:0}},field=s.f.create({volumes:[volume,volume],mode:'acceleration',vector:{x:0,y:4,z:0},onEnter:()=>enter++,onExit:()=>exit++});
 s.fields.step(.25);s.physics.step(.25);assert.ok(Math.abs(s.p.getVelocity(e).y-1)<.01);assert.ok(Math.abs(ch.velocity.y-1)<.01);assert.equal(enter,2);field.setEnabled(false);s.fields.step(.25);assert.equal(exit,2);field.destroy();assert.equal(s.fields.stats().physicsFields,0);
 }finally{s.done();}});
test('pre-solver scene destruction rejects before changing entity lifetime, then destruction works after the step',()=>{const s=setup({x:0,y:-9.8,z:0});try{
 const floor=s.body('floor',{x:0,y:-.5,z:0},{x:10,y:1,z:10},'static'),e=s.body('actor',{x:0,y:1,z:0});s.p.onContactMaterial(floor,()=>{e.destroy();});for(let i=0;i<60;i++)s.physics.step(1/60);assert.equal(e.destroyed,false);assert.ok(s.errors.some(e=>/mutations/.test(e.error.message)));e.destroy();assert.equal(e.destroyed,true);
 }finally{s.done();}});
test('off-center convex queries and force volumes preserve their authored origins',()=>{const s=setup();try{
 const e=s.body('offset',{x:20,y:0,z:0}),points=[];for(const x of [19,21])for(const y of [-1,1])for(const z of [-1,1])points.push({x,y,z});
 const hull={kind:'convex',points};assert.equal(s.p.overlap(hull,{x:0,y:0,z:0})[0].entity,e);assert.equal(s.p.overlap(hull,{x:-20,y:0,z:0}).length,0);
 const field=s.f.create({mode:'acceleration',vector:{x:0,y:0,z:0},volumes:[{shape:hull,position:{x:0,y:0,z:0},vector:{x:4,y:0,z:0}}]});s.fields.step(.25);s.physics.step(.25);assert.ok(Math.abs(s.p.getVelocity(e).x-1)<.01);assert.equal(field.getEntities()[0],e);
 }finally{s.done();}});
