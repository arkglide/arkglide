// Finite, far-to-near scene refraction layers and native per-pixel dual-depth peeling.
(function(root){
 'use strict';
 function create(B,scene,options={}){
  const engine=scene.getEngine(),caps=engine.getCaps(),slots=new Map();
  const supported=engine.webGLVersion>=2&&!engine.isWebGPU&&!!(caps.textureHalfFloatRender||caps.textureFloatRender);
  const oitSupported=supported&&!!caps.drawBuffersExtension&&!!caps.textureFloat&&!!B.DepthPeelingRenderer;
  let rendered=0,pixels=0,fallbacks=0,oitOwned=false,previousOIT=false,previousPasses=0,previousRenderer=null,lastFrame=-1;
  function clearRefraction(){
   for(const s of slots.values())s.texture.dispose();slots.clear();rendered=pixels=fallbacks=0;lastFrame=-1;
  }
  function clear(){
   clearRefraction();
   if(oitOwned){scene.useOrderIndependentTransparency=previousOIT;if(scene._depthPeelingRenderer){if(previousRenderer)scene._depthPeelingRenderer.passCount=previousPasses;else{scene._depthPeelingRenderer.dispose();scene._depthPeelingRenderer=null;}}oitOwned=false;}
  }
  function configure(config){
   if(config.enabled&&oitSupported){
    if(!oitOwned){previousOIT=!!scene.useOrderIndependentTransparency;previousRenderer=scene._depthPeelingRenderer||null;previousPasses=previousRenderer?.passCount||5;oitOwned=true;}
    scene.useOrderIndependentTransparency=true;const renderer=scene.depthPeelingRenderer||(scene.depthPeelingRenderer=new B.DepthPeelingRenderer(scene));renderer.passCount=config.layers;
   }else if(oitOwned){scene.useOrderIndependentTransparency=previousOIT;if(scene._depthPeelingRenderer){if(previousRenderer)scene._depthPeelingRenderer.passCount=previousPasses;else{scene._depthPeelingRenderer.dispose();scene._depthPeelingRenderer=null;}}oitOwned=false;}
  }
  function sceneMaterial(mesh){const base=options.baseMaterial?.(mesh)||mesh.material;return base&&!base.subMaterials&&base.metadata?.arkglideTransmissionSource==='scene'&&base.subSurface?.isRefractionEnabled;}
  function visible(mesh){return !mesh.isDisposed()&&mesh.isEnabled()&&mesh.isVisible&&mesh.visibility>0&&mesh.getTotalVertices()>0&&!mesh.metadata?.arkglidePortalView;}
  function prepare(config,meshes,assign,frame){
   if(frame===lastFrame){assign();return;}lastFrame=frame;
   rendered=pixels=fallbacks=0;
   if(!config.enabled||!supported||!scene.activeCamera){clearRefraction();assign();return;}
   const camera=scene.activeCamera,all=meshes.filter(m=>visible(m)&&sceneMaterial(m));
   const selected=all.sort((a,b)=>B.Vector3.DistanceSquared(camera.globalPosition,b.getBoundingInfo().boundingBox.centerWorld)-B.Vector3.DistanceSquared(camera.globalPosition,a.getBoundingInfo().boundingBox.centerWorld)||a.uniqueId-b.uniqueId).slice(0,config.maxLayers);
   const scale=Math.min(config.scale,Math.sqrt(config.maxPixels/Math.max(1,engine.getRenderWidth()*engine.getRenderHeight()*selected.length)));
   const width=Math.max(1,Math.floor(engine.getRenderWidth()*scale)),height=Math.max(1,Math.floor(engine.getRenderHeight()*scale));
   const keep=new Set(selected);for(const[mesh,s]of slots)if(!keep.has(mesh)||s.width!==width||s.height!==height){s.texture.dispose();slots.delete(mesh);}
   for(const mesh of selected)if(!slots.has(mesh)){
    const texture=new B.RenderTargetTexture('arkglide:refraction:'+mesh.uniqueId,{width,height},scene,true,true,caps.textureHalfFloatRender?B.Constants.TEXTURETYPE_HALF_FLOAT:B.Constants.TEXTURETYPE_FLOAT);
    texture.isRenderTarget=false;texture.noPrePassRenderer=true;texture.renderParticles=false;texture.renderSprites=false;texture.useCameraPostProcesses=false;
    texture.coordinatesMode=B.Texture.PROJECTION_MODE;texture.gammaSpace=false;texture.activeCamera=camera;texture.ignoreCameraViewport=true;
    slots.set(mesh,{texture,width,height,key:'refraction:'+mesh.uniqueId});
   }
   assign();
   const done=new Set(),list=scene.meshes.filter(visible);
   for(const mesh of selected){
    const slot=slots.get(mesh);slot.texture.activeCamera=camera;
    // Only completed farther refractors can be sampled; the current target and
    // nearer layers are excluded, so no target can feed back into itself.
    slot.texture.renderList=list.filter(m=>!sceneMaterial(m)||done.has(m));
    const draw=()=>{
     const oit=scene.useOrderIndependentTransparency,linear=scene.imageProcessingConfiguration.applyByPostProcess;
     scene.useOrderIndependentTransparency=false;scene.imageProcessingConfiguration.applyByPostProcess=true;
     try{slot.texture.render(false,false);}finally{scene.useOrderIndependentTransparency=oit;scene.imageProcessingConfiguration.applyByPostProcess=linear;}
    };
    options.capture?options.capture(draw):draw();done.add(mesh);rendered++;pixels+=width*height;
   }
   fallbacks=all.length-selected.length;
  }
  return {configure,prepare,clear,textureFor:mesh=>slots.get(mesh),stats:()=>({sceneRefractionSupported:supported,sceneRefractionLayers:slots.size,sceneRefractionViews:rendered,sceneRefractionPixels:pixels,sceneRefractionFallbacks:fallbacks,layeredTransparencySupported:oitSupported,layeredTransparency:oitOwned&&scene.useOrderIndependentTransparency,transparencyLayers:oitOwned?scene._depthPeelingRenderer?.passCount||0:0})};
 }
 root.ArkGlideTransmission={create};
})(globalThis);
