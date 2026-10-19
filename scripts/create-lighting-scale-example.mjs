import fs from 'node:fs/promises';
import {zipSync,strToU8} from 'fflate';
import * as B from '@babylonjs/core';
import factory from '../src/wasm/arkglide_math.js';
import {renderingProject} from './rendering-project.mjs';
import {rasterizeLightmap,padLightmap,encodeLightmap,sceneLightingSignature} from '../src/engine/light-bake.mjs';
import '../src/engine/lighting-uv.js';
const {project:p,textures}=renderingProject();p.name='Lighting and Scene Scale Lab';p.projectId='arkglide-lighting-scale-lab';
p.scene.nodes=p.scene.nodes.filter(n=>!['BackWall','SideWall'].includes(n.id));
const floor=p.scene.nodes.find(n=>n.id==='Floor');floor.transform.z=10;floor.scale={x:40,y:1,z:40};
for(let i=0;i<60;i++)p.scene.nodes.push({id:'LOD-'+i,name:'LOD '+i,type:'mesh',primitive:'sphere',materialId:i%2?'metal':'rough',visible:true,transform:{x:(i%12-5.5)*2.3,y:1,z:10+Math.floor(i/12)*2.5},rotation:{x:0,y:0,z:0},scale:{x:1.7,y:1.7,z:1.7},optimization:{lod:{enabled:true,levels:[{distance:20,grid:8},{distance:40,grid:4}]}}});
p.settings.rendering.shadows.cascades={enabled:true,count:3,lambda:.65,blend:.1,stabilize:true};
p.scripts['main.js']=`return defineScript({
 onStart(){this.view=cameras.active();ui.createText({id:'lighting-scale-help',text:'1/2/3 画质 · 4 近景 · 5 远景 LOD',x:2,y:3,fontSize:16,color:'#FFFFFF'});},
 onUpdate(){
  if(input.wasKeyPressed('1'))rendering.setQuality('low');if(input.wasKeyPressed('2'))rendering.setQuality('medium');if(input.wasKeyPressed('3'))rendering.setQuality('high');
  if(input.wasKeyPressed('4')||input.wasKeyPressed('5')){const pose=this.view.getPose();pose.position={x:0,y:3,z:input.wasKeyPressed('5')?-50:-9};this.view.setPose(pose);this.view.lookAt({x:0,y:1,z:10});}
 }
});`;
// Generate the fixture's actual lightmap with the same BVH kernel and UV rules
// as the editor. No external DCC assets or browser-only texture readback needed.
const engine=new B.NullEngine(),scene=new B.Scene(engine),meshes=[],triangles=[],module=await factory(),native=new module.LightBakeBatch();
try{
 const builders={box:'CreateBox',sphere:'CreateSphere',plane:'CreateGround'};
 for(const n of p.scene.nodes.filter(n=>n.type==='mesh'&&!n.scripts?.length)){
  const mesh=B.MeshBuilder[builders[n.primitive||'box']](n.id,{},scene);mesh.position.set(n.transform.x,n.transform.y,n.transform.z);mesh.scaling.set(n.scale.x,n.scale.y,n.scale.z);mesh.rotation.set(n.rotation.x,n.rotation.y,n.rotation.z);
  const world=mesh.computeWorldMatrix(true),normalMatrix=world.clone().invert().transpose(),source=mesh.getVerticesData('position'),ns=mesh.getVerticesData('normal'),positions=new Float64Array(source.length),normals=new Float64Array(ns.length),indices=new Uint32Array(mesh.getIndices());
  for(let i=0;i<source.length;i+=3){const v=B.Vector3.TransformCoordinates(B.Vector3.FromArray(source,i),world),normal=B.Vector3.TransformNormal(B.Vector3.FromArray(ns,i),normalMatrix).normalize();positions.set([v.x,v.y,v.z],i);normals.set([normal.x,normal.y,normal.z],i);}
  for(const index of indices)for(let a=0;a<3;a++)triangles.push(positions[index*3+a]);meshes.push({id:n.id,mesh,positions,normals,indices});
 }
 const target=meshes.find(m=>m.id==='Floor'),uvs=ArkGlideLightingUV.generateUV2(B,target.mesh,'plane',false),{samples,pixels}=rasterizeLightmap({...target,uvs},128),rgb=new Float32Array(128*128*3);
 const sun=p.scene.nodes.find(n=>n.id==='Sun'),rotation=B.Matrix.RotationYawPitchRoll(sun.rotation.y,sun.rotation.x,sun.rotation.z),direction=B.Vector3.TransformNormal(new B.Vector3(0,-1,0),rotation),color=B.Color3.FromHexString(sun.color).scale(sun.intensity),ambient=B.Color3.FromHexString(p.settings.ambientColor).scale(p.settings.ambientIntensity);
 native.reserve(triangles.length/9,4096,2);native.triangleView().set(triangles);native.lightView().set([0,direction.x,direction.y,direction.z,color.r,color.g,color.b,0,0,0,2,0,1,0,ambient.r,ambient.g,ambient.b,0,0,0]);if(!native.prepare(triangles.length/9))throw Error('Invalid fixture BVH');
 for(let i=0;i<pixels.length;i+=4096){const count=Math.min(4096,pixels.length-i);native.sampleView().set(samples.subarray(i*6,(i+count)*6));if(!native.bake(count,2,16,2,.002))throw Error('Fixture bake failed');const out=native.outputView();for(let j=0;j<count;j++)rgb.set(out.subarray(j*3,j*3+3),pixels[i+j]*3);}
 padLightmap(rgb,pixels,128);const {png,scale}=encodeLightmap(rgb,128);textures.set('static-floor',png.buffer);p.content.textures.push({id:'static-floor',name:'Baked floor.png',mime:'image/png',byteLength:png.byteLength});Object.assign(p.content.materials.floor,{lightmapTextureId:'static-floor',lightmapUV:1,lightmapIntensity:scale,bakedDirectLighting:true});floor.bakedLighting={autoUV2:true,signature:sceneLightingSignature({nodes:p.scene.nodes,settings:p.settings})};
 const files={'project.json':strToU8(JSON.stringify(p))};for(const [id,data]of textures)files['textures/'+id+'.bin']=new Uint8Array(data);await fs.writeFile(new URL('../examples/lighting-scale-lab.arkglide',import.meta.url),zipSync(files,{level:6}));console.log('Lighting/Scale Lab generated: real baked floor, CSM and 60 LOD spheres; '+native.rayCount()+' bake rays.');
}finally{native.delete();scene.dispose();engine.dispose();}
