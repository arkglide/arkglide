import test from 'node:test';import assert from 'node:assert/strict';import {setup}from './helpers/foundations.mjs';
test('finite sweeps preserve orientation, report aperture rejection and hit an obstruction after crossing',()=>{const s=setup();try{
 s.pair();const target=s.body('target',{x:6,y:0,z:0},{x:1,y:1,z:1},'static');const trace=s.a.shapeCast({kind:'sphere',radius:.2},{x:0,y:0,z:3},{x:0,y:0,z:-9});assert.deepEqual(trace.path,['A']);assert.equal(trace.hit?.entity,target);assert.ok(trace.hit.distance>3&&trace.hit.distance<5);
 const large=s.a.shapeCast({kind:'sphere',radius:2},{x:0,y:0,z:3},{x:0,y:0,z:-9});assert.equal(large.path.length,0);assert.ok(large.blocked||large.hit);
 const limited=s.a.shapeCast({kind:'sphere',radius:.1},{x:0,y:0,z:3},{x:0,y:0,z:-9},{maxHops:0});assert.equal(limited.truncated,true);
 }finally{s.done();}});
test('wide convex extrusion clips through an aperture and produces usable native convex colliders on both sides',()=>{const s=setup();try{
 const [pa]=s.pair();const trace=s.a.projectVolume({origin:{x:0,y:0,z:3},direction:{x:0,y:0,z:-7},profile:[{x:-2,y:-.1},{x:2,y:-.1},{x:2,y:.1},{x:-2,y:.1}],thickness:.01});assert.deepEqual(trace.path,['A']);assert.equal(trace.segments.length,2);assert.ok(trace.segments[1].start.length>=4);const width=Math.max(...trace.segments[1].start.map(p=>p.z))-Math.min(...trace.segments[1].start.map(p=>p.z));assert.ok(width<=pa.width+.01&&width>pa.width*.8,'width '+width);
 for(const [i,segment]of trace.segments.entries()){const m=s.v.createMesh(segment.geometry,{id:'bridge'+i});s.p.add(m.entity,{motion:'static',shape:'convex',size:{x:1,y:1,z:1},mass:1,friction:.5,restitution:0,sensor:false,lockRotation:false});}
 const hit=s.p.raycast({x:6,y:2,z:0},{x:0,y:-4,z:0});assert.equal(hit?.entity.id,'bridge1');
 }finally{s.done();}});
test('extrusion checks finite width against obstacles outside its center line, supports limits and rejects concave profiles',()=>{const s=setup();try{
 const wall=s.body('offset-obstacle',{x:.8,y:0,z:-2},{x:.2,y:1,z:.2},'static');const options={origin:{x:0,y:0,z:0},direction:{x:0,y:0,z:-5},profile:[{x:-1,y:-.1},{x:1,y:-.1},{x:1,y:.1},{x:-1,y:.1}],thickness:.01};const trace=s.a.projectVolume(options);assert.equal(trace.hit.entity,wall);assert.ok(trace.segments[0].end.z>-2.1);
 assert.throws(()=>s.a.projectVolume({...options,profile:[{x:0,y:0},{x:1,y:0},{x:.3,y:.2},{x:1,y:1},{x:0,y:1}]}),/convex/);
 }finally{s.done();}});
test('static model planar regions validate actual coverage, cut native holes and restore their original geometry',()=>{const s=setup();try{
 const mesh=s.B.MeshBuilder.CreateBox('model',{width:8,height:8,depth:.2},s.scene),e=s.entities.register(mesh,'model');s.p.add(e,{motion:'static',shape:'mesh',size:{x:1,y:1,z:1},mass:1,friction:.5,restitution:0,sensor:false,lockRotation:false});
 const surface=s.a.addSurface(e,{regions:[{id:'front',position:{x:0,y:0,z:.1},normal:{x:0,y:0,z:1},width:7,height:7,depth:.2}]});const a=s.a.create({id:'model-portal'}),b=s.a.create({position:{x:10,y:0,z:0}});assert.equal(a.place({x:0,y:0,z:3},{x:0,y:0,z:-6}).placed,true);a.link(b);assert.equal(s.p.raycast({x:0,y:0,z:3},{x:0,y:0,z:-6}),null);surface.destroy();assert.equal(s.p.raycast({x:0,y:0,z:3},{x:0,y:0,z:-6}).entity,e);
 assert.throws(()=>s.a.addSurface(e,{regions:[{id:'large',position:{x:0,y:0,z:.1},normal:{x:0,y:0,z:1},width:20,height:20,depth:.2}]}),/covered/);
 }finally{s.done();}});
test('projection rejects self-intersecting profiles and enforces configurable budgets before native work',()=>{const s=setup();try{
 const regular=Array.from({length:5},(_,i)=>({x:Math.cos(i*2*Math.PI/5),y:Math.sin(i*2*Math.PI/5)})),star=[regular[0],regular[2],regular[4],regular[1],regular[3]],options={origin:{x:0,y:0,z:0},direction:{x:0,y:0,z:4},profile:star,thickness:.1};assert.throws(()=>s.a.projectVolume(options),/simple convex/);
 s.a.setProjectionLimits({maxProfileVertices:3});assert.throws(()=>s.a.projectVolume({...options,profile:regular}),/bounded/);assert.throws(()=>s.a.setProjectionLimits({maxHops:-1}));
 }finally{s.done();}});
