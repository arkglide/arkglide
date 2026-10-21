// Explicit face scheduling. A back cube is never sampled until all six faces exist.
(function(root){
 'use strict';
 const faceDirections=[[1,0,0],[-1,0,0],[0,-1,0],[0,1,0],[0,0,1],[0,0,-1]];
 function resolution(request,pixels,limit=1024){return 2**Math.floor(Math.log2(Math.max(1,Math.min(request,Math.sqrt(pixels),limit))));}
 function create(B,scene,options={}){
  const engine=scene.getEngine(),caps=engine.getCaps(),slots=new Map();
  const supported=engine.webGLVersion>=2&&!engine.isWebGPU&&!!caps.textureLOD&&!!B.ReflectionProbe;
  let frame=-1,cursor=0,faces=0,pixels=0,completed=0,waiting=0,config=null,definitions=[];
  function clear(){for(const slot of slots.values())for(const probe of slot.probes)probe.dispose();slots.clear();frame=-1;faces=pixels=completed=waiting=0;}
  function make(p,size){
   const slot={definition:p,size,face:0,front:-1,back:0,previous:-1,published:-Infinity,probes:[]};
   for(let i=0;i<2;i++){
    const probe=new B.ReflectionProbe('arkglide:live-probe:'+p.id+':'+i,size,scene,true,true,true),texture=probe.cubeTexture;
    probe.position.copyFromFloats(p.position.x,p.position.y,p.position.z);
    texture.isRenderTarget=false;texture.renderParticles=false;texture.renderSprites=false;texture.noPrePassRenderer=true;
    texture.useCameraPostProcesses=false;texture.ignoreCameraViewport=true;texture.gammaSpace=false;
    texture.boundingBoxPosition=probe.position.clone();texture.boundingBoxSize=new B.Vector3(p.size.x,p.size.y,p.size.z);texture.level=p.intensity;
    const render=texture._renderToTarget;
    // Babylon's public render owns UBO/camera/framebuffer restoration. Narrow its
    // six-face loop on this owned instance; no engine or prototype is patched.
    texture._renderToTarget=function(face,...args){if(face===slot.face)return render.call(this,face,...args);};
    slot.probes.push(probe);
   }
   return slot;
  }
  function eligible(mesh,p){
   if(mesh.isDisposed()||!mesh.isEnabled()||!mesh.isVisible||mesh.visibility<=0||!(mesh.layerMask&p.layerMask)||mesh.metadata?.arkglidePortalView)return false;
   if(mesh.metadata?.arkglideRenderInternal&&mesh.name!=='arkglide:atmosphere')return false;
   const m=options.baseMaterial?.(mesh)||mesh.material;
   const parts=m?.subMaterials||[m];
   return !parts.some(part=>part?.needAlphaBlendingForMesh?.(mesh)||part?.subSurface?.isRefractionEnabled);
  }
  function capture(slot){
   const probe=slot.probes[slot.back],p=slot.definition,texture=probe.cubeTexture,camera=scene.activeCamera;
   const direction=B.Vector3.FromArray(faceDirections[slot.face]);if(scene.useRightHandedSystem)direction.z*=-1;
   const view=(scene.useRightHandedSystem?B.Matrix.LookAtRH:B.Matrix.LookAtLH)(probe.position,probe.position.add(direction),B.Vector3.Up());
   const projection=(scene.useRightHandedSystem?B.Matrix.PerspectiveFovRH:B.Matrix.PerspectiveFovLH)(Math.PI/2,1,camera.minZ,camera.maxZ,engine.isNDCHalfZRange);
   const draw=()=>{
    const list=scene.meshes.filter(m=>eligible(m,p));
    const selected=options.renderCompute?.select?.(list,B.Frustum.GetPlanes(view.multiply(projection)));
    texture.renderList=selected||list;
    if(!texture.isReadyForRendering())return false;
    texture.render(false,false);return true;
   };
   return options.capture?options.capture(draw):draw();
  }
  function prepare(next,probes,number){
   if(frame===number)return;frame=number;faces=pixels=0;config=next;definitions=probes;
   if(!supported||!scene.activeCamera){clear();return;}
   const position=scene.activeCamera.globalPosition;
   const active=probes.filter(p=>p.mode==='realtime').sort((a,b)=>b.priority-a.priority||B.Vector3.DistanceSquared(position,a.position)-B.Vector3.DistanceSquared(position,b.position)||a.id.localeCompare(b.id)).slice(0,next.maxActive);
   const keep=new Set(active.map(p=>p.id));
   for(const[id,slot]of slots)if(!keep.has(id)){for(const probe of slot.probes)probe.dispose();slots.delete(id);}
   for(const p of active){
    const size=resolution(p.resolution,next.maxPixels,caps.maxCubemapTextureSize||1024),key=JSON.stringify([p,size]);let slot=slots.get(p.id);
    if(slot?.key!==key){if(slot)for(const probe of slot.probes)probe.dispose();slot=make(p,size);slot.key=key;slots.set(p.id,slot);}
   }
   const queue=[...slots.values()],now=scene._arkglideRenderTime||0;let attempts=0;
   while(queue.length&&faces<next.facesPerFrame&&attempts<queue.length*next.facesPerFrame){
    const slot=queue[(cursor++)%queue.length];attempts++;
    if(slot.front>=0&&slot.face===0&&(now-slot.published<next.transition||!slot.force&&now-slot.published<slot.definition.interval))continue;
    if(pixels+slot.size**2>next.maxPixels)continue;
    if(!capture(slot))continue;
    faces++;pixels+=slot.size**2;
    if(++slot.face===6){slot.face=0;slot.previous=slot.front;slot.front=slot.back;slot.back=1-slot.back;slot.published=now;slot.force=false;completed++;}
   }
   waiting=queue.filter(s=>s.face>0||s.front<0||now-s.published>=Math.max(next.transition,s.definition.interval)).length;
  }
  function binding(id){
   const slot=slots.get(id);if(!slot||slot.front<0)return null;
   const now=scene._arkglideRenderTime||0;
   return {texture:slot.probes[slot.front].cubeTexture,previous:slot.previous<0?null:slot.probes[slot.previous].cubeTexture,mix:slot.previous<0?1:config.transition?Math.min(1,Math.max(0,(now-slot.published)/config.transition)):1,raw:true};
  }
  return {prepare,clear,binding,supported,refresh(id){for(const[key,slot]of slots)if(id===undefined||key===id){slot.force=true;slot.face=0;}},stats:()=>({realtimeProbesSupported:supported,realtimeProbes:slots.size,probeCapturedFaces:faces,probeCapturedPixels:pixels,probeCompletedUpdates:completed,probeWaiting:waiting,probeFallbacks:definitions.filter(p=>p.mode==='realtime'&&!binding(p.id)).length,probeCubeBytes:[...slots.values()].reduce((n,s)=>n+Math.ceil(s.size*s.size*6*2*4/3*(caps.textureHalfFloatRender?8:caps.textureFloatRender?16:4)),0)})};
 }
 function applyBlend(B,material,getState){
  if(!material?.getClassName?.().startsWith('PBR'))return;
  let plugin=material.pluginManager?.getPlugin('ArkGlideProbeBlend');
  if(plugin){plugin.state=getState;return;}
  const zero=B.Vector3.Zero(),coefficients=['x','y','z','xx','yy','zz','xy','yz','zx'];
  class Blend extends B.MaterialPluginBase{
   constructor(){super(material,'ArkGlideProbeBlend',220,{ARK_PROBE_BLEND:true},true,true);this.state=getState;this.doNotSerialize=true;}
   getClassName(){return 'ArkGlideProbeBlend';}
   getSamplers(s){s.push('arkProbeOld','arkProbeOutside');}
   getUniforms(){return {ubo:[{name:'arkProbeCenter',size:3,type:'vec3'},{name:'arkProbeSize',size:3,type:'vec3'},{name:'arkProbeTransition',size:4,type:'vec4'},{name:'arkProbeOldInfo',size:4,type:'vec4'},{name:'arkProbeOutsideInfo',size:4,type:'vec4'},{name:'arkProbeOutsideCenter',size:3,type:'vec3'},{name:'arkProbeOutsideSize',size:3,type:'vec3'},{name:'arkProbeOutsideMatrix',size:16,type:'mat4'},{name:'arkProbeDiffuseInfo',size:4,type:'vec4'},...['X','Y','Z','XX','YY','ZZ','XY','YZ','ZX'].map(s=>({name:'arkProbeSH'+s,size:3,type:'vec3'}))],fragment:`
    #ifdef ARK_PROBE_BLEND
    uniform vec3 arkProbeCenter,arkProbeSize,arkProbeOutsideCenter,arkProbeOutsideSize;
    uniform vec4 arkProbeTransition,arkProbeOldInfo,arkProbeOutsideInfo;
    uniform mat4 arkProbeOutsideMatrix;
    uniform vec4 arkProbeDiffuseInfo;
    uniform vec3 arkProbeSHX,arkProbeSHY,arkProbeSHZ,arkProbeSHXX,arkProbeSHYY,arkProbeSHZZ,arkProbeSHXY,arkProbeSHYZ,arkProbeSHZX;
    #endif
   `};}
   bindForSubMesh(ubo){
    const s=this.state(),current=s.current,t=s.definition,old=current.previous||current.texture,out=s.outside?.texture||current.texture;
    ubo.updateFloat3('arkProbeCenter',t.position.x,t.position.y,t.position.z);ubo.updateFloat3('arkProbeSize',t.size.x,t.size.y,t.size.z);
    const flip=texture=>(material.getScene().useRightHandedSystem?!texture.invertZ:texture.invertZ)?-1:1;
    ubo.updateFloat4('arkProbeTransition',current.mix??1,t.blendDistance||0,flip(current.texture),s.outside?.raw?1:0);
    const polynomial=s.outside&&!s.outside.raw?out.sphericalPolynomial:null;
    ubo.updateFloat4('arkProbeDiffuseInfo',polynomial?1:0,flip(out),0,0);
    for(const key of coefficients)ubo.updateVector3('arkProbeSH'+key.toUpperCase(),polynomial?.[key]||zero);
    const info=(name,texture,level)=>ubo.updateFloat4(name,Math.log2(texture.getSize().width),texture.isRGBD?1:0,texture.gammaSpace?1:0,level);
    info('arkProbeOldInfo',old,current.previous?t.intensity:0);info('arkProbeOutsideInfo',out,s.outside?out.level:0);
    ubo.updateVector3('arkProbeOutsideCenter',out.boundingBoxPosition||zero);ubo.updateVector3('arkProbeOutsideSize',out.boundingBoxSize||zero);ubo.updateMatrix('arkProbeOutsideMatrix',out.getReflectionTextureMatrix());
    ubo.setTexture('arkProbeOld',old);ubo.setTexture('arkProbeOutside',out);
   }
   getCustomCode(type){if(type!=='fragment')return null;return {
    CUSTOM_FRAGMENT_DEFINITIONS:`
     #if defined(ARK_PROBE_BLEND) && defined(REFLECTIONMAP_3D)
     uniform samplerCube arkProbeOld,arkProbeOutside;
     vec3 arkProbeDecode(vec4 color,vec4 info){vec3 c=info.y>.5?fromRGBD(color):color.rgb;if(info.z>.5)c=toLinearSpace(c);return c*info.w;}
     vec3 arkProbeBlend(vec3 current,vec3 coords,float alphaG){
       float lod=clamp(arkProbeOldInfo.x+log2(max(alphaG,.0001))*.5,0.,arkProbeOldInfo.x);
       vec3 previous=arkProbeDecode(textureCubeLodEXT(arkProbeOld,coords,lod),arkProbeOldInfo);
       vec3 updated=mix(previous,current,arkProbeTransition.x);
       vec3 gap=arkProbeSize*.5-abs(vPositionW-arkProbeCenter);
       float weight=arkProbeTransition.y>0.?smoothstep(0.,arkProbeTransition.y,min(gap.x,min(gap.y,gap.z))):1.;
       vec3 direction=coords;direction.z*=arkProbeTransition.z;
       direction=normalize(direction+arkProbeCenter-vPositionW);
       if(arkProbeOutsideSize.x>0.)direction=parallaxCorrectNormal(vPositionW,direction,arkProbeOutsideSize,arkProbeOutsideCenter);
       direction=(arkProbeOutsideMatrix*vec4(direction,0.)).xyz;
       float outsideLod=clamp(arkProbeOutsideInfo.x+log2(max(alphaG,.0001))*.5,0.,arkProbeOutsideInfo.x);
       vec3 outside=arkProbeDecode(textureCubeLodEXT(arkProbeOutside,direction,outsideLod),arkProbeOutsideInfo);
       return mix(outside,updated,weight);
     }
     #endif`,
    '!environmentIrradiance\\*=vReflectionColor\\.rgb\\*vReflectionInfos\\.x;':`environmentIrradiance*=vReflectionColor.rgb*vReflectionInfos.x;
     #if defined(ARK_PROBE_BLEND) && defined(REFLECTIONMAP_3D)
     vec3 arkIrradianceNormal=normalW;arkIrradianceNormal.z*=arkProbeTransition.z;
     if(arkProbeTransition.x<.999){
       #ifdef REALTIME_FILTERING
       vec3 arkOldDiffuse=irradiance(arkProbeOld,arkIrradianceNormal,vec2(exp2(arkProbeOldInfo.x),arkProbeOldInfo.x),diffuseRoughness,surfaceAlbedo,viewDirectionW
       #ifdef IBL_CDF_FILTERING
       ,icdfSampler
       #endif
       )*arkProbeOldInfo.w;
       #else
       vec3 arkOldDiffuse=arkProbeDecode(textureCubeLodEXT(arkProbeOld,arkIrradianceNormal,arkProbeOldInfo.x),arkProbeOldInfo);
       #endif
       environmentIrradiance=mix(arkOldDiffuse,environmentIrradiance,arkProbeTransition.x);
     }
     if(arkProbeTransition.y>0.){
       vec3 arkGap=arkProbeSize*.5-abs(vPositionW-arkProbeCenter);
       float arkWeight=smoothstep(0.,arkProbeTransition.y,min(arkGap.x,min(arkGap.y,arkGap.z)));
       vec3 n=(arkProbeOutsideMatrix*vec4(normalW,0.)).xyz;n.z*=arkProbeDiffuseInfo.y;
       vec3 arkOutsideDiffuse;
       if(arkProbeDiffuseInfo.x>.5){
         arkOutsideDiffuse=arkProbeSHX*n.x+arkProbeSHY*n.y+arkProbeSHZ*n.z+arkProbeSHXX*n.x*n.x+arkProbeSHYY*n.y*n.y+arkProbeSHZZ*n.z*n.z+arkProbeSHXY*n.x*n.y+arkProbeSHYZ*n.y*n.z+arkProbeSHZX*n.z*n.x;
         arkOutsideDiffuse=max(vec3(0.),arkOutsideDiffuse)*arkProbeOutsideInfo.w;
       }else arkOutsideDiffuse=arkProbeDecode(textureCubeLodEXT(arkProbeOutside,n,arkProbeOutsideInfo.x),arkProbeOutsideInfo);
       environmentIrradiance=mix(arkOutsideDiffuse,environmentIrradiance,arkWeight);
     }
     #endif`,
    '!environmentRadiance\\.rgb\\*=vReflectionInfos\\.x;environmentRadiance\\.rgb\\*=vReflectionColor\\.rgb;':`environmentRadiance.rgb*=vReflectionInfos.x;environmentRadiance.rgb*=vReflectionColor.rgb;
     #if defined(ARK_PROBE_BLEND) && defined(REFLECTIONMAP_3D)
     environmentRadiance.rgb=arkProbeBlend(environmentRadiance.rgb,reflectionCoords,alphaG);
     #endif`,
   };}
  }
  plugin=new Blend();
 }
 root.ArkGlideRealtimeProbes={create,resolution,applyBlend};
})(globalThis);
