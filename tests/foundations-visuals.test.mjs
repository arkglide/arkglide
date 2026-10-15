import test from 'node:test';import assert from 'node:assert/strict';import {setup}from './helpers/foundations.mjs';
const triangle={positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,2]};
test('owned material changes restore sharing chains and do not dispose another entity material',()=>{const s=setup();try{
 const a=s.body('a'),b=s.body('b',{x:3,y:0,z:0}),old=new s.B.StandardMaterial('old',s.scene);s.entities.getObject(a.id).material=old;s.entities.getObject(b.id).material=old;
 const first=s.v.createMaterial({color:'#336699',alpha:.5}),second=s.v.createMaterial({emissive:'#abcdef'});first.apply(a);second.apply(a);first.destroy();second.destroy();assert.equal(s.entities.getObject(a.id).material,old);a.destroy();assert.equal(s.entities.getObject(b.id).material,old);assert.ok(!old.isDisposed?.());
 const counts=s.scene.materials.length;assert.throws(()=>s.v.createMaterial({color:'bad'}));assert.equal(s.scene.materials.length,counts);
 }finally{s.done();}});
test('dynamic visual geometry, separated beam segments, decal attachment and particle cleanup use actual Babylon resources',()=>{const s=setup();try{
 const material=s.v.createMaterial({color:'#ffffff',emissive:'#ff0000'}),m=s.v.createMesh(triangle,{id:'mesh',material});assert.equal(s.entities.sceneAPI.find('mesh'),m.entity);m.updateGeometry({...triangle,positions:[0,0,0,2,0,0,0,2,0]});assert.equal(s.entities.getObject('mesh').getBoundingInfo().boundingBox.maximum.x,2);const count=s.scene.meshes.length;assert.throws(()=>m.updateGeometry({...triangle,indices:[0,1,99]}));assert.equal(s.scene.meshes.length,count);
 const beam=s.v.createBeam({segments:[{origin:{x:0,y:0,z:0},end:{x:0,y:0,z:2}},{origin:{x:5,y:0,z:0},end:{x:5,y:0,z:1}}],radius:.05,color:'#00ffff'});assert.equal(s.entities.getObject(beam.entity.id).getTotalVertices(),48);beam.update({radius:.1});
 const host=s.body('host',{x:0,y:0,z:0},{x:2,y:2,z:2},'static');const decal=s.v.createDecal(host,{position:{x:0,y:0,z:1},normal:{x:0,y:0,z:1},size:{x:1,y:1,z:.1},material});const x=decal.entity.getWorldPosition().x;host.position.x=3;assert.ok(Math.abs(decal.entity.getWorldPosition().x-x-3)<.001);
 const particles=s.v.createParticles({capacity:16,rate:8,lifetime:[.2,.5],size:[.01,.05],velocity:{min:{x:-1,y:0,z:0},max:{x:1,y:2,z:0}},colors:['#ff0000','#ffffff'],entity:host});assert.equal(s.scene.particleSystems.length,1);host.destroy();assert.equal(particles.active,false);assert.equal(decal.active,false);beam.destroy();m.destroy();s.owner.abort();assert.equal(s.visuals.stats().visualResources,0);assert.equal(s.scene.particleSystems.length,0);
 }finally{s.done();}});
test('surface coatings follow rotated/scaled hosts and placement predicate checks the complete footprint',()=>{const s=setup();try{
 const host=s.body('wall',{x:0,y:0,z:0},{x:8,y:8,z:.2},'static');const patch=s.s.paint(host,{id:'coating',position:{x:0,y:0,z:.1},normal:{x:0,y:0,z:1},width:4,height:4,depth:.2,shape:'rectangle',tags:['portalable'],properties:{speedMultiplier:2}});
 assert.equal(s.s.query(host,{x:0,y:0,z:.1})[0].properties.speedMultiplier,2);assert.equal(s.s.query(host,{x:3,y:0,z:.1}).length,0);
 s.a.addSurface(host,{canPlace:c=>s.s.covers(c.entity,c.footprint,'portalable')});const portal=s.a.create();assert.equal(portal.place({x:0,y:0,z:3},{x:0,y:0,z:-6}).placed,true);assert.equal(portal.place({x:2,y:0,z:3},{x:0,y:0,z:-6}).reason,'placement-policy');patch.update({tags:['painted']});assert.equal(portal.place({x:0,y:0,z:3},{x:0,y:0,z:-6}).reason,'placement-policy');
 host.position.x=4;assert.equal(s.s.query(host,{x:4,y:0,z:.1})[0].id,'coating');host.destroy();assert.equal(patch.active,false);assert.equal(s.surfaces.stats().surfacePatches,0);
 }finally{s.done();}});
test('failed beam creation is atomic and direct visual entity destruction releases its owned resources',()=>{const s=setup();try{
 s.v.createMesh(triangle,{id:'occupied'});const count=s.visuals.stats().visualResources;assert.throws(()=>s.v.createBeam({id:'occupied',segments:[{origin:{x:0,y:0,z:0},end:{x:1,y:0,z:0}}],radius:.1,color:'#ffffff'}),/Duplicate/);assert.equal(s.visuals.stats().visualResources,count);
 const beam=s.v.createBeam({segments:[{origin:{x:0,y:0,z:0},end:{x:1,y:0,z:0}}],radius:.1,color:'#ffffff'});assert.equal(s.visuals.stats().visualResources,count+2);beam.entity.destroy();assert.equal(s.visuals.stats().visualResources,count);assert.equal(beam.active,false);
 }finally{s.done();}});
