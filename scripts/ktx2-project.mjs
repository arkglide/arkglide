import fs from 'node:fs/promises';
import {renderingProject} from './rendering-project.mjs';
import '../src/engine/ktx2-runtime.js';
export async function ktx2Project(){
 const {project:p,textures}=renderingProject();p.name='KTX2 WASM Material Lab';p.projectId='arkglide-ktx2-lab';
 for(const id of [...textures.keys()])if(id!=='studio')textures.delete(id);
 const names=['colors-uastc.ktx2','colors-etc1s.ktx2','normal-tilt.ktx2','detail.ktx2','mask.ktx2'];
 const assets=[p.content.textures.find(t=>t.id==='studio')];
 for(const id of names){const b=await fs.readFile(new URL('../tests/fixtures/ktx2/'+id,import.meta.url)),bytes=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);textures.set(id,bytes);assets.push({id,name:id,mime:'image/ktx2',byteLength:b.byteLength,ktx2:ArkGlideKTX2.inspect(bytes)});}
 p.content.textures=assets;
 const material=(id,extra={})=>({id,name:id,baseColor:'#FFFFFF',emissiveColor:'#000000',metallic:0,roughness:.55,alpha:1,doubleSided:false,uvScale:{u:1,v:1},...extra});
 p.content.materials={floor:material('floor',{baseColor:'#566575',roughness:.85}),uastc:material('uastc',{albedoTextureId:'colors-uastc.ktx2',normalTextureId:'normal-tilt.ktx2',clearCoat:{enabled:true,roughness:.2},clearCoatNormalTextureId:'normal-tilt.ktx2'}),etc1s:material('etc1s',{albedoTextureId:'colors-etc1s.ktx2'}),detail:material('detail',{baseColor:'#B4CAD9',detailTextureId:'detail.ktx2',detail:{enabled:true,scale:2,diffuse:.3,normal:1,roughness:.3}}),mask:material('mask',{albedoTextureId:'mask.ktx2',alphaMode:'mask',doubleSided:false})};
 const mesh=(id,x,y,z,s,materialId,primitive='box')=>({id,name:id,type:'mesh',primitive,materialId,visible:true,transform:{x,y,z},rotation:{x:0,y:0,z:0},scale:{x:s,y:s,z:s}});
 p.scene.nodes=[{...mesh('Floor',0,0,3,14,'floor','plane')},mesh('UASTC',-3,1,3,2,'uastc'),mesh('ETC1S',0,1,3,2,'etc1s'),mesh('Detail',3,1,3,2,'detail','sphere'),{...mesh('Alpha',0,2,6,2,'mask'),scale:{x:3,y:3,z:.05}},
  {id:'Sun',name:'Sun',type:'light',lightType:'directional',intensity:2,color:'#FFF5E8',transform:{x:-3,y:6,z:-4},rotation:{x:.5,y:0,z:-.3},scale:{x:1,y:1,z:1}},
  {id:'Camera',name:'Camera',type:'camera',activeCamera:true,fov:60,transform:{x:0,y:3,z:-7},rotation:{x:.12,y:0,z:0},scale:{x:1,y:1,z:1}},
  {id:'Controls',name:'Controls',type:'empty',transform:{x:0,y:0,z:0},scripts:['main.js']}
 ];
 p.settings.rendering=ArkGlideRenderingConfig.settings({environment:{textureId:'studio',intensity:.6},color:{toneMapping:'aces',exposure:1.1},antialiasing:'fxaa'});
 p.scripts={'main.js':"return defineScript({onStart(){ui.createText({id:'ktx2-help',text:'KTX2 · UASTC 清漆 / ETC1S / 细节法线 / Alpha 裁切',x:2,y:3,fontSize:16,color:'#F3F7FF'});}});"};
 return {project:p,textures};
}
