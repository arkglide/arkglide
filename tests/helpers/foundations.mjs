import * as B from '@babylonjs/core';
import '../../public/lib/jolt-physics.js';
import '../../public/arkglide-api.js';
import '../../src/engine/spatial-runtime.js';
import '../../src/engine/lifecycle-runtime.js';
import '../../src/engine/state-runtime.js';
import '../../src/engine/visual-runtime.js';
import '../../src/engine/surface-runtime.js';
import '../../src/engine/physics-advanced.js';
import '../../src/engine/physics-runtime.js';
import '../../src/engine/portal-projection.js';
import '../../src/engine/portal-runtime.js';
import '../../src/engine/field-runtime.js';
import '../../src/engine/trigger-runtime.js';
import '../../src/engine/signal-runtime.js';
import '../../src/engine/motion-runtime.js';
import '../../src/engine/optics-runtime.js';
const J=await createArkGlideJolt();
export function setup(gravity={x:0,y:0,z:0}){
 const engine=new B.NullEngine(),scene=new B.Scene(engine),session=ArkGlideLifecycle.createSession(),owner=session.owner(null,'foundations'),errors=[];
 owner.attach({});session.startRecords([owner.record]);
 const entities=ArkGlideRuntime.createEntityAPI(B,()=>scene,()=>null,{onBeforeMutate:()=>physics.assertMutable(),onBeforeDestroy:id=>{session.destroyEntity(id);physics.remove(id);}}),options={scene,find:entities.sceneAPI.find,getObject:entities.getObject,register:entities.register,onError:e=>errors.push(e)};
 const physics=ArkGlidePhysics.createPhysics(J,B,{...options,gravity}),p=physics.forOwner(owner),visuals=ArkGlideVisuals.create(B,options),v=visuals.forOwner(owner),surfaces=ArkGlideSurfaces.create(B,{...options,visuals}),s=surfaces.forOwner(owner),portals=ArkGlidePortals.create(B,{...options,physics}),a=portals.forOwner(owner),fields=ArkGlideFields.create({...options,physics}),f=fields.forOwner(owner);
 const triggers=ArkGlideTriggers.create({...options,physics}),t=triggers.forOwner(owner);
 const signals=ArkGlideSignals.create(options),sig=signals.forOwner(owner),motion=ArkGlideMotion.create(B,{...options,physics}),m=motion.forOwner(owner),optics=ArkGlideOptics.create(B,{...options,physics,portals}),opt=optics.forOwner(owner);
 const vec=(x,y,z)=>({x,y,z});
 function body(id,pos=vec(0,0,0),size=vec(1,1,1),motion='dynamic',shape='box'){
  const e=entities.sceneAPI.create('box',id);e.position=pos;e.scale=size;
  p.add(e,{motion,shape,size:vec(1,1,1),mass:1,friction:0,restitution:0,sensor:false,lockRotation:false,linearDamping:0,angularDamping:0});return e;
 }
 function pair(){const a0=body('wall-a',vec(0,0,0),vec(10,10,.2),'static'),b0=body('wall-b',vec(8,0,0),vec(.2,10,10),'static');a.addSurface(a0);a.addSurface(b0);const pa=a.create({id:'A'}),pb=a.create({id:'B'});if(!pa.place(vec(0,0,3),vec(0,0,-6)).placed||!pb.place(vec(6,0,0),vec(4,0,0)).placed)throw Error('Pair setup failed');pa.link(pb);return [pa,pb,a0,b0];}
 return {B,J,engine,scene,session,owner,errors,entities,physics,p,visuals,v,surfaces,s,portals,a,fields,f,triggers,t,signals,sig,motion,m,optics,opt,body,pair,vec,done(){session.stop();signals.dispose();motion.dispose();optics.dispose();triggers.dispose();fields.dispose();portals.dispose();surfaces.dispose();visuals.dispose();physics.dispose();engine.dispose();}};
}
