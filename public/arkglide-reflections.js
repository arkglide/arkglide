// Explicitly scheduled planar captures: bounded once per main frame, never recursive.
(function(root){
 "use strict";
 function create(B,scene,options={}){
  const engine=scene.getEngine(),slots=new Map();
  let lastFrame=-1,rendered=0,pixels=0;
  let input=new Float64Array(0);const cameraData=new Float64Array(19);
  function reflector(mesh){
   for(let node=mesh;node;node=node.parent){const p=node.metadata?.arkglideRendering?.planarReflection;if(p?.enabled)return {node,settings:p};}
   return null;
  }
  function clear(){for(const slot of slots.values())slot.texture.dispose();slots.clear();lastFrame=-1;rendered=pixels=0;}
  function prepare(config,meshes,frame){
   if(lastFrame===frame)return;lastFrame=frame;rendered=pixels=0;
   const c=config.reflections.planar,camera=scene.activeCamera;
   if(!c.enabled||!camera){clear();return;}
   const roots=new Map();
   for(const mesh of meshes){
    if(mesh.isDisposed()||!mesh.isEnabled()||mesh.visibility<=0)continue;
    const r=reflector(mesh);if(!r)continue;
    mesh.computeWorldMatrix(true);
    let group=roots.get(r.node);
    if(!group){group={...r,min:new B.Vector3(Infinity,Infinity,Infinity),max:new B.Vector3(-Infinity,-Infinity,-Infinity)};roots.set(r.node,group);}
    const b=mesh.getBoundingInfo().boundingBox;group.min.minimizeInPlace(b.minimumWorld);group.max.maximizeInPlace(b.maximumWorld);
   }
   const candidates=[...roots.values()];
   if(!candidates.length){for(const slot of slots.values())slot.texture.dispose();slots.clear();return;}
   if(input.length<candidates.length*10)input=new Float64Array(Math.max(candidates.length*10,input.length*2));
   for(let i=0;i<candidates.length;i++){
    const r=candidates[i],normal=B.Vector3.Zero();normal[r.settings.axis||'y']=1;
    const plane=new B.Plane(normal.x,normal.y,normal.z,-(r.settings.offset??0)).transform(r.node.computeWorldMatrix(true)).normalize();
    const n=plane.normal,u=B.Vector3.Cross(Math.abs(n.y)<.9?B.Axis.Y:B.Axis.X,n).normalize(),v=B.Vector3.Cross(n,u).normalize();
    const center=r.min.add(r.max).scale(.5),ext=r.max.subtract(r.min).scale(.5);
    center.subtractInPlace(n.scale(B.Vector3.Dot(n,center)+plane.d));
    const width=Math.max(.001,2*(Math.abs(u.x)*ext.x+Math.abs(u.y)*ext.y+Math.abs(u.z)*ext.z));
    const height=Math.max(.001,2*(Math.abs(v.x)*ext.x+Math.abs(v.y)*ext.y+Math.abs(v.z)*ext.z));
    const q=B.Quaternion.RotationQuaternionFromAxis(u,v,n);
    input.set([center.x,center.y,center.z,q.x,q.y,q.z,q.w,width,height,1],i*10);
    r.plane=new B.Plane(-n.x,-n.y,-n.z,-plane.d-.001);
   }
   cameraData.set(camera.getViewMatrix(true).multiply(camera.getProjectionMatrix(true)).m);
   cameraData.set(camera.globalPosition.asArray(),16);
   const budget={width:Math.max(1,Math.round(engine.getRenderWidth()*c.scale)),height:Math.max(1,Math.round(engine.getRenderHeight()*c.scale)),maxSize:Math.min(4096,engine.getCaps().maxTextureSize||4096),minArea:.0001,maxViews:c.maxMirrors,maxPixels:c.maxPixels,minResolution:32};
   const batch=input.subarray(0,candidates.length*10);
   const allocations=options.renderCompute?.planViews?options.renderCompute.planViews(batch,cameraData,budget):root.ArkGlideViewBudget.plan(batch,cameraData,budget);
   const keep=new Set(allocations.map(a=>candidates[a.index].node));
   for(const [node,slot]of slots)if(!keep.has(node)){slot.texture.dispose();slots.delete(node);}
   const list=scene.meshes.filter(m=>!m.isDisposed()&&m.isEnabled()&&!reflector(m)&&!m.metadata?.arkglidePortalView&&(!m.metadata?.arkglideRenderInternal||m.name==='arkglide:atmosphere'));
   for(const allocation of allocations){
    const r=candidates[allocation.index],{width,height}=allocation;
    let slot=slots.get(r.node);
    if(slot&&(slot.width!==width||slot.height!==height)){slot.texture.dispose();slots.delete(r.node);slot=null;}
    if(!slot){
     const caps=engine.getCaps(),type=caps.textureHalfFloatRender?B.Constants.TEXTURETYPE_HALF_FLOAT:caps.textureFloatRender?B.Constants.TEXTURETYPE_FLOAT:B.Constants.TEXTURETYPE_UNSIGNED_BYTE;
     const texture=new B.MirrorTexture('arkglide:mirror:'+r.node.uniqueId,{width,height},scene,true,type,B.Texture.BILINEAR_SAMPLINGMODE);
     // Materials normally enqueue reflection RTTs themselves. Explicit scheduling
     // owns capture order and budgets, so suppress automatic duplicate rendering.
     texture.isRenderTarget=false;texture.renderParticles=false;texture.noPrePassRenderer=true;
     slot={texture,width,height,key:'planar:'+r.node.uniqueId};slots.set(r.node,slot);
    }
    slot.texture.mirrorPlane=r.plane;slot.texture.gammaSpace=false;
    slot.texture.level=r.settings.intensity??1;slot.texture.blurKernel=r.settings.blur??0;
    slot.texture.renderList=list;slot.texture.render(false,false);rendered++;pixels+=width*height;
   }
  }
  return {prepare,clear,textureFor(mesh){const r=reflector(mesh);return r&&slots.get(r.node);},stats:()=>({planarReflections:slots.size,planarRenderedViews:rendered,planarRenderedPixels:pixels})};
 }
 root.ArkGlideReflections={create};
})(globalThis);
