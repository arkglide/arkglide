// Native per-object/skinned velocity, jitter and ping-pong history, owned by one host.
(function(root){
 'use strict';
 const resolveShader=`precision highp float;
 varying vec2 vUV;uniform sampler2D textureSampler,historySampler;
 #ifdef TAA_REPROJECT_HISTORY
 uniform sampler2D velocitySampler;
 #endif
 uniform float factor;
 void main(){
   ivec2 size=textureSize(textureSampler,0),pixel=clamp(ivec2(gl_FragCoord.xy),ivec2(0),size-1);
   vec4 current=texelFetch(textureSampler,pixel,0);vec2 historyUV=vUV;float blend=factor;
   #ifdef TAA_REPROJECT_HISTORY
   vec2 velocity=texelFetch(velocitySampler,pixel,0).xy;historyUV+=velocity;
   blend=max(blend,min(.8,length(velocity)*8.));
   #endif
   vec4 history=texture2D(historySampler,clamp(historyUV,vec2(0.),vec2(1.)));
   if(any(lessThan(historyUV,vec2(0.)))||any(greaterThan(historyUV,vec2(1.))))blend=1.;
   #ifdef TAA_CLAMP_HISTORY
   vec4 lo=vec4(1.e20),hi=vec4(-1.e20);
   for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){
     vec4 c=texelFetch(textureSampler,clamp(pixel+ivec2(x,y),ivec2(0),size-1),0);lo=min(lo,c);hi=max(hi,c);
   }
   history=clamp(history,lo,hi);
   #endif
   gl_FragColor=mix(history,current,blend);
 }`;
 function create(B,scene){
  const engine=scene.getEngine(),caps=engine.getCaps();
  const supported=engine.webGLVersion>=2&&!engine.isWebGPU&&!!caps.texelFetch&&!!caps.drawBuffersExtension&&!!caps.textureHalfFloatRender&&!!B.TAARenderingPipeline;
  let pipeline=null,camera=null,config=null,lastPosition=null,lastDirection=null,lastShape='',lastSize='',lastTime=0,resets=0,materialWatch=null;
  function reset(){pipeline?._taaThinPostProcess?._reset();resets++;}
  function clear(){if(materialWatch)scene.onNewMaterialAddedObservable.remove(materialWatch);materialWatch=null;pipeline?.dispose();pipeline=null;camera=null;lastPosition=lastDirection=null;lastShape=lastSize='';lastTime=0;}
  function configure(next,target,enabled){
   clear();config=next;if(!enabled||!supported||!target)return;
   camera=target;pipeline=new B.TAARenderingPipeline('arkglide:temporal',scene,[camera],B.Constants.TEXTURETYPE_HALF_FLOAT);
   // Keep Babylon's native velocity/jitter/history ownership; scope the resolve
   // shader to this instance to add edge rejection and correct HDR bounds.
   B.Effect.ShadersStore.arkglideTemporalPixelShader=resolveShader;
   pipeline._taaThinPostProcess._shaderPath.fragment='arkglideTemporal';
   pipeline.reprojectHistory=true;pipeline.clampHistory=next.clampHistory;pipeline.disableOnCameraMove=false;pipeline.samples=next.samples;pipeline.factor=next.factor;
   const manager=pipeline._taaThinPostProcess._taaMaterialManager,getPlugin=manager._getPlugin.bind(manager);
   // Babylon's registration is global. Limit jitter ownership to this scene;
   // the scene observer also covers multiple independent hosts in one JS realm.
   manager._getPlugin=material=>material.getScene()===scene?getPlugin(material):null;
   materialWatch=scene.onNewMaterialAddedObservable.add(material=>queueMicrotask(()=>{if(pipeline?._taaThinPostProcess._taaMaterialManager===manager&&scene.materials.includes(material))manager._getPlugin(material);}));
   reset();
  }
  function prepare(){
   if(!pipeline)return;
   const position=camera.globalPosition,direction=camera.getForwardRay().direction,now=performance.now();
   const shape=[camera.mode,camera.fov,camera.minZ,camera.maxZ,camera.orthoLeft,camera.orthoRight,camera.orthoTop,camera.orthoBottom].join(','),size=engine.getRenderWidth()+','+engine.getRenderHeight();
   if(lastPosition&&(B.Vector3.Distance(position,lastPosition)>config.cutDistance||B.Vector3.Dot(direction,lastDirection)<Math.cos(config.cutAngle*Math.PI/180)||shape!==lastShape||size!==lastSize||now-lastTime>1000))reset();
   lastPosition=position.clone();lastDirection=direction.clone();lastShape=shape;lastSize=size;lastTime=now;
  }
  function capture(fn){
   const jitter=pipeline?._taaThinPostProcess?._taaMaterialManager?.jitter;
   const prepass=scene.prePassRenderer,enabled=prepass?._enabled,x=jitter?.x,y=jitter?.y;
   // noPrePassRenderer alone leaves currentRTisSceneRT=true. PBR would then
   // advance previousWorld during an offscreen bind and erase object velocity.
   if(prepass)prepass._enabled=false;jitter?.set(0,0);
   try{return fn();}finally{if(prepass)prepass._enabled=enabled;jitter?.set(x,y);}
  }
  return {configure,prepare,clear,reset,capture,supported,stats:()=>({taaSupported:supported,taaEnabled:!!pipeline,taaHistoryResets:resets,motionVectors:!!pipeline&&scene.prePassRenderer?.getIndex(11)>=0,taaSamples:pipeline?.samples||0})};
 }
 root.ArkGlideTemporal={create};
})(globalThis);
