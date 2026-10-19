import {renderingProject} from './rendering-project.mjs';
export function advancedRenderingProject(){
 const {project:p,textures}=renderingProject();
 p.name='Advanced Rendering Lab';p.projectId='arkglide-advanced-rendering-lab';
 p.settings.rendering=globalThis.ArkGlideRenderingConfig.preset({...p.settings.rendering,
  fog:{mode:'exp2',color:'#879FB8',density:.018},sky:{enabled:true,sunAzimuth:140,sunElevation:30,turbidity:3},
  dof:{enabled:true,focusDistance:12,focalLength:35,fStop:5.6,quality:1},
 },'medium');
 Object.assign(p.settings.rendering.reflections.planar,{enabled:true,maxMirrors:1,maxPixels:524288,scale:.75});
 const m=p.content.materials;
 Object.assign(m.floor,{metallic:.65,roughness:.18,lightmapIntensity:.15});
 Object.assign(m.metal,{metallic:.9,roughness:.25,anisotropy:{enabled:true,intensity:.85,rotation:.6}});
 Object.assign(m.rough,{baseColor:'#629E8A',roughness:.8,sheen:{enabled:true,color:'#B6EBD4',intensity:.9,roughness:.6},detail:{enabled:true,scale:4,diffuse:.25,normal:0,roughness:.2},detailTextureId:'baked'});
 m.paint={...m.rough,id:'paint',name:'Clear-coated paint',baseColor:'#CE573D',metallic:.15,roughness:.55,sheen:{enabled:false},detail:{enabled:false},detailTextureId:undefined,clearCoat:{enabled:true,intensity:1,roughness:.06}};
 m.glass={...m.metal,id:'glass',name:'Tinted environment transmission',metallic:0,roughness:.08,anisotropy:{enabled:false},transmission:{enabled:true,intensity:1,ior:1.5,thickness:.35,tintColor:'#78CFD8',tintDistance:1}};
 p.scene.nodes.find(n=>n.id==='Floor').planarReflection={enabled:true,axis:'y',blur:3,intensity:.7};
 p.scene.nodes.find(n=>n.id==='Rotating').materialId='paint';
 p.scene.nodes.push({id:'Glass',name:'Glass',type:'mesh',primitive:'sphere',materialId:'glass',transform:{x:1.9,y:1,z:4.2},rotation:{x:0,y:0,z:0},scale:{x:1.6,y:1.6,z:1.6},visible:true});
 p.scripts['main.js']=p.scripts['main.js'].replace('  onStart() {',`  onStart() {
    ui.createText({id:'rendering-help',text:'1 低 / 2 中 / 3 高 + SSR',x:2,y:3,fontSize:16,color:'#FFFFFF'});
    visuals.createParticles({backend:'auto',capacity:512,rate:70,lifetime:[.8,1.8],size:[.015,.045],position:{x:-3.1,y:.4,z:3.5},emitBox:{min:{x:-.3,y:0,z:-.3},max:{x:.3,y:0,z:.3}},velocity:{min:{x:-.15,y:.3,z:-.15},max:{x:.15,y:1,z:.15}},gravity:{x:0,y:-.3,z:0},colors:['#FF8C40','#FFF0C8'],blendMode:'additive',angularSpeed:[-1,1]});
  `);
 return {project:p,textures};
}
