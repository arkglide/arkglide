import {renderingProject} from './rendering-project.mjs';
export function volumetricProject(){
 const {project:p,textures}=renderingProject();p.name='Volumetric Atmosphere Lab';p.projectId='arkglide-volumetric-lab';
 const mesh=(id,x,y,z,sx,sy,sz,materialId='stone')=>({id,name:id,type:'mesh',primitive:'box',materialId,visible:true,transform:{x,y,z},rotation:{x:0,y:0,z:0},scale:{x:sx,y:sy,z:sz}});
 p.content.materials.stone={...p.content.materials.wall,id:'stone',name:'Weathered stone',baseColor:'#455665',roughness:.92};
 p.content.materials.bronze={...p.content.materials.metal,id:'bronze',name:'Brass sculpture',baseColor:'#DAA35B',roughness:.27};
 p.scene.nodes=[mesh('Floor',0,-.25,10,32,.5,52),mesh('LeftWall',-8,5,12,1,10,40),mesh('BackWall',0,5,30,16,10,1),
  {id:'Camera',name:'Camera',type:'camera',activeCamera:true,fov:63,visible:true,transform:{x:1,y:2.5,z:-11},rotation:{x:-.04,y:0,z:0},scale:{x:1,y:1,z:1}},
  {id:'Sun',name:'Sun',type:'light',lightType:'directional',color:'#FFD49A',intensity:2,visible:true,transform:{x:10,y:12,z:16},rotation:{x:.65,y:0,z:-.55},scale:{x:1,y:1,z:1}},
  {id:'Controls',name:'Controls',type:'empty',visible:true,transform:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},scripts:['main.js']}
 ];
 for(let i=0;i<7;i++){
  const z=i*4+1;p.scene.nodes.push(mesh('Pillar-L-'+i,-6,4,z,.8,8,.8),mesh('Pillar-R-'+i,6,4,z,.8,8,.8),mesh('Roof-slat-'+i,0,8,z,14,.5,1.5));
 }
 p.scene.nodes.push({...mesh('Sculpture',0,1.8,8,3,3,3,'bronze'),primitive:'sphere'});
 p.settings.backgroundColor='#151E29';p.settings.ambientIntensity=.12;p.settings.ambientColor='#9FB9DF';
 p.settings.rendering=globalThis.ArkGlideRenderingConfig.settings({antialiasing:'fxaa',color:{toneMapping:'aces',exposure:1.15},environment:{textureId:'studio',intensity:.25},shadows:{enabled:true,mapSize:1024,cascades:{enabled:true,count:3}},
  sky:{enabled:true,sunAzimuth:145,sunElevation:35,luminance:.5},volumetric:{enabled:true,density:.027,height:1,falloff:.16,maxDistance:65,color:'#DAD3C0',ambient:.035,lightIntensity:.4,anisotropy:.3,noiseStrength:.25,noiseScale:.18,steps:48,scale:.5,shadowDistance:40,shadowMapSize:1024}});
 p.scripts={'main.js':`return defineScript({
 onStart(){this.view=cameras.active();ui.createText({id:'volume-help',text:'体积大气 · V 开关 · 1/2/3 质量 · 4 地面 / 5 高处',x:2,y:3,fontSize:16,color:'#FFF1D4'});},
 onUpdate(){
  if(input.wasKeyPressed('v'))rendering.setVolumetric({enabled:!rendering.getSettings().volumetric.enabled});
  if(input.wasKeyPressed('1'))rendering.setQuality('low');if(input.wasKeyPressed('2'))rendering.setQuality('medium');if(input.wasKeyPressed('3'))rendering.setQuality('high');
  if(input.wasKeyPressed('4')||input.wasKeyPressed('5')){const pose=this.view.getPose();pose.position={x:1,y:input.wasKeyPressed('5')?10:2.5,z:-11};this.view.setPose(pose);this.view.lookAt({x:0,y:3,z:12});}
 }
});`};
 // Keep only the environment used by the demo; all geometry is procedural.
 p.content.textures=p.content.textures.filter(t=>t.id==='studio');for(const id of [...textures.keys()])if(id!=='studio')textures.delete(id);
 for(const id of Object.keys(p.content.materials))if(!['stone','bronze'].includes(id))delete p.content.materials[id];
 return {project:p,textures};
}
