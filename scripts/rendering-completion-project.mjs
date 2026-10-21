import {renderingProject} from './rendering-project.mjs';
export function renderingCompletionProject(){
 const {project:p,textures}=renderingProject();p.name='Rendering Completion Lab';p.projectId='arkglide-rendering-completion';
 const node=(id,type,position,scale=[1,1,1],extra={})=>({id,name:id,type,visible:true,transform:{x:position[0],y:position[1],z:position[2]},rotation:{x:0,y:0,z:0},scale:{x:scale[0],y:scale[1],z:scale[2]},...extra});
 const mesh=(id,position,scale,materialId,extra={})=>node(id,'mesh',position,scale,{primitive:'box',materialId,...extra});
 const material=(id,baseColor,extra={})=>({id,name:id,baseColor,emissiveColor:'#000000',metallic:0,roughness:.5,alpha:1,doubleSided:false,uvScale:{u:1,v:1},...extra});
 p.content.materials={stone:material('stone','#59636F'),metal:material('metal','#D9E2EF',{metallic:1,roughness:.12,clearCoat:{enabled:true}}),red:material('red','#F52312',{emissiveColor:'#F52312',emissiveIntensity:1}),blue:material('blue','#145DFF',{emissiveColor:'#145DFF',emissiveIntensity:.5}),glass:material('glass','#FFFFFF',{roughness:.05,transmission:{enabled:true,source:'scene',intensity:1,ior:1.5,thickness:1.2}}),cyan:material('cyan','#15DBEE',{alpha:.35,alphaMode:'blend',doubleSided:true}),amber:material('amber','#FFB52C',{alpha:.4,alphaMode:'blend',doubleSided:true})};
 p.scene.nodes=[
  mesh('Ground',[0,-.25,7],[32,.5,42],'stone'),
  mesh('Reflector',[-2.5,2,2],[3.5,3.5,3.5],'metal',{primitive:'sphere'}),
  mesh('Glass',[2.5,2,1],[3.2,3.2,3.2],'glass',{primitive:'sphere'}),
  mesh('GlassBack',[2.7,2,3.2],[2.8,2.8,.25],'glass'),
  mesh('RedStripe',[2,2,5],[.6,4,.3],'red'),mesh('BlueStripe',[3,2,5],[.6,4,.3],'blue'),
  mesh('MovingEmitter',[-4,2.5,5],[1,3,1],'red',{scripts:['move.js']}),
  mesh('TransparentA',[-.5,1,0],[1.3,2,.05],'cyan',{rotation:{x:0,y:.5,z:0}}),
  mesh('TransparentB',[-.5,1,0],[1.3,2,.05],'amber',{rotation:{x:0,y:-.5,z:0}}),
  node('Camera','camera',[0,3,-12],[1,1,1],{activeCamera:true,fov:60,rotation:{x:-.08,y:0,z:0}}),
  node('Sun','light',[0,15,8],[1,1,1],{lightType:'directional',color:'#FFD5A8',intensity:2,rotation:{x:.6,y:0,z:-.3}}),
  node('Point','light',[-1,3,2],[1,1,1],{lightType:'point',color:'#479AFF',intensity:20,lightRange:12}),
  node('Spot','light',[4,5,-1],[1,1,1],{lightType:'spot',color:'#FF853D',intensity:25,lightRange:16,spotAngle:45,spotInnerAngle:25,rotation:{x:-.8,y:0,z:0}}),
  node('Controls','empty',[0,0,0],[1,1,1],{scripts:['main.js']})
 ];
 p.settings.backgroundColor='#6B91BE';p.settings.ambientIntensity=.1;
 p.settings.rendering=globalThis.ArkGlideRenderingConfig.settings({
  antialiasing:'taa',temporal:{samples:8,factor:.15},environment:{textureId:'studio',intensity:.35},color:{toneMapping:'aces',exposure:1.15},
  shadows:{enabled:true,mapSize:512,maxLights:2},sky:{enabled:true,sunAzimuth:155,sunElevation:38,luminance:.5},
  realtimeProbes:{maxActive:2,facesPerFrame:2,maxPixels:32768,transition:.25},
  probes:[{id:'live',name:'Live courtyard',mode:'realtime',position:{x:0,y:4,z:4},size:{x:24,y:14,z:32},resolution:128,interval:.3,blendDistance:2}],
  refraction:{enabled:true,scale:.5,maxPixels:131072,maxLayers:3},transparency:{enabled:true,layers:3},
  volumetric:{enabled:true,density:.012,falloff:.2,maxDistance:50,ambient:.12,lightIntensity:.25,steps:24,scale:.5,maxPixels:131072,shadowMapSize:256,shadowDistance:35},
  clouds:{enabled:true,base:8,thickness:12,coverage:.75,density:.12,scale:.065,detail:.3,windX:1.5,windZ:.3,maxDistance:160,steps:32,lightSteps:4},
  volumeLighting:{maxLocalLights:2,localIntensity:1,multipleScattering:.4,scatteringOrders:3}
 });
 p.scripts={'move.js':`return defineScript({onStart(){this.age=0;},onUpdate(){this.age+=time.deltaTime;this.entity.position.x=-3+Math.sin(this.age*.7)*2;}});`,'main.js':`return defineScript({
  onStart(){visuals.createParticles({backend:'auto',capacity:128,rate:20,lifetime:[1,2],size:[.01,.03],position:{x:-4,y:.5,z:1},emitBox:{min:{x:-.2,y:0,z:-.2},max:{x:.2,y:0,z:.2}},velocity:{min:{x:0,y:.2,z:0},max:{x:0,y:.8,z:0}},gravity:{x:0,y:-.1,z:0},colors:['#FFB54C','#FFF0C8'],blendMode:'additive'});ui.createText({id:'help',text:'1/2/3 画质 · T 时间抗锯齿 · C 云层 · L 体积灯 · R 场景折射 · O 分层透明',x:2,y:3,fontSize:14,color:'#FFFFFF'});},
  onUpdate(){
   if(input.wasKeyPressed('1'))rendering.setQuality('low');if(input.wasKeyPressed('2'))rendering.setQuality('medium');if(input.wasKeyPressed('3'))rendering.setQuality('high');
   if(input.wasKeyPressed('t'))rendering.setAntialiasing(rendering.getSettings().antialiasing==='taa'?'fxaa':'taa');
   if(input.wasKeyPressed('c'))rendering.setClouds({enabled:!rendering.getSettings().clouds.enabled});
   if(input.wasKeyPressed('l'))rendering.setVolumeLighting({maxLocalLights:rendering.getSettings().volumeLighting.maxLocalLights?0:2});
   if(input.wasKeyPressed('r'))rendering.setRefraction({enabled:!rendering.getSettings().refraction.enabled});
   if(input.wasKeyPressed('o'))rendering.setTransparency({enabled:!rendering.getSettings().transparency.enabled});
  }
 });`};
 p.content.textures=p.content.textures.filter(t=>t.id==='studio');for(const id of [...textures.keys()])if(id!=='studio')textures.delete(id);
 return {project:p,textures};
}
