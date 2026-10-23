import fs from 'node:fs/promises';
import '../src/engine/rendering-config.js';
import { angles, views } from '../examples/chinese-courtyard-scripts/tour.js';

export async function chineseCourtyardProject() {
  const dir = new URL('../examples/chinese-courtyard-assets/', import.meta.url);
  const prepared = JSON.parse(await fs.readFile(new URL('prepared.json', dir), 'utf8'));
  const textures = new Map(), models = new Map(), textureAssets = [], materials = {}, nodes = [];
  const vec = a => ({ x:a[0], y:a[1], z:a[2] });
  const node = (id, type, position, scale=[1,1,1], extra={}) => {
    const n = { id, name:id, type, transform:vec(position), rotation:vec([0,0,0]), scale:vec(scale), visible:true, ...extra };
    nodes.push(n); return n;
  };
  const group = (id, name) => node(id,'empty',[0,0,0],[1,1,1],{name});
  const mesh = (id, position, scale, materialId, parentId, extra={}) => node(id,'mesh',position,scale,{primitive:'box',materialId,parentId,...extra});
  const material = (id, color, extra={}) => materials[id] = {id,name:id,baseColor:color,emissiveColor:'#000000',metallic:0,roughness:.75,alpha:1,doubleSided:false,uvScale:{u:1,v:1},...extra};
  const maps = name => ({ albedoTextureId:name+'-albedo',normalTextureId:name+'-normal',metallicRoughnessTextureId:name+'-arm' });
  const sourceModel = async file => {
    if(!models.has(file)) models.set(file,new Uint8Array(await fs.readFile(new URL('models/'+file,dir))));
  };
  const model = async (id,file,position,scale,parentId,extra={}) => {
    await sourceModel(file);
    return node(id,'model',position,Array.isArray(scale)?scale:[scale,scale,scale],{modelUrl:file,fileName:file,parentId,...extra});
  };
  for(const resource of prepared.resources.filter(f=>f.path.startsWith('textures/'))) {
    const name=resource.path.split('/').pop(),id=name.replace(/\.[^.]+$/,'');
    if(['rock_boulder_dry-albedo','rock_boulder_dry-arm'].includes(id))continue;
    const data=new Uint8Array(await fs.readFile(new URL(resource.path,dir)));textures.set(id,data);
    textureAssets.push({id,name,mime:name.endsWith('.hdr')?'image/vnd.radiance':name.endsWith('.png')?'image/png':'image/webp',byteLength:data.byteLength});
  }
  material('moss-ground','#C8D3AF',{...maps('garden-moss'),uvScale:{u:300,v:325},normalScale:.65});
  material('court-stone','#B3B6AD',{...maps('japanese_stone_wall'),uvScale:{u:4,v:11},normalScale:.6,roughness:.9});
  material('stone','#B3B6AD',{...maps('japanese_stone_wall'),normalScale:.7});
  material('wet-stone','#85988C',{...maps('japanese_stone_wall'),roughness:.5,normalScale:.5,clearCoat:{enabled:true,intensity:.65,roughness:.17}});
  material('moss-rock','#E2E5D8',{...maps('moss-rock'),doubleSided:true});
  material('tiles','#D1D9D4',{...maps('ceramic_roof_01'),normalScale:.8,uvScale:{u:1,v:1}});
  material('wood','#AAA18B',{...maps('weathered_planks'),normalScale:.5});
  material('wood-red','#635241',{...maps('weathered_planks'),normalScale:.35,clearCoat:{enabled:true,intensity:.2,roughness:.6}});
  material('wood-green','#344D42',{...maps('weathered_planks'),normalScale:.35});
  material('wood-dark','#3B3A31',{...maps('weathered_planks'),normalScale:.35});
  material('plaster','#DDDDCA',{normalTextureId:'rock_boulder_dry-normal',normalScale:.12,roughness:.95});
  material('bamboo','#DDE3CB',{...maps('bamboo-stem'),roughness:.8,normalScale:.65});
  material('bamboo-branch','#DDE3CB',{...maps('bamboo-branch'),roughness:.85,normalScale:.65,doubleSided:true});
  material('leaves','#DFE6CA',{...maps('bamboo-leaf'),roughness:.9,normalScale:.65,alphaMode:'mask',alphaCutoff:.45,doubleSided:true,sheen:{enabled:true,color:'#9EBB65',intensity:.12,roughness:.9}});
  material('fern','#C2D3A1',{...maps('fern'),roughness:.9,normalScale:.6,alphaMode:'mask',alphaCutoff:.45,doubleSided:true,sheen:{enabled:true,color:'#A9C686',intensity:.1,roughness:.9}});
  material('screen-wood','#E5DFCF',{...maps('chinese_screen_panels'),roughness:.9,normalScale:.65,doubleSided:true});
  material('chair-wood','#E8E0D2',{...maps('chinese_armchair'),roughness:.85,normalScale:.75,doubleSided:true,clearCoat:{enabled:true,intensity:.25,roughness:.35}});
  material('water','#577E71',{roughness:.12,normalTextureId:'water-normal',normalScale:.4,uvScale:{u:4,v:7},doubleSided:true,
    clearCoat:{enabled:true,intensity:.9,roughness:.09},transmission:{enabled:true,source:'scene',intensity:.45,ior:1.333,thickness:.16,tintColor:'#92B8A3',tintDistance:2}});
  material('lamp','#D6B778',{emissiveColor:'#F7B85A',emissiveIntensity:1.7,roughness:.8});
  material('bronze','#72664B',{metallic:.8,roughness:.42});

  group('Ground','00 · 林地与基座'); group('Entrance','01 · 月洞门入口'); group('Court','02 · 听雨庭院');
  group('Pond','03 · 映池水景'); group('Bamboo','04 · 竹林分块'); group('Overview','05 · 望园台');
  mesh('Foundation',[0,-.7,0],[44,1,50],'stone','Ground',{castShadows:false});
  // Background ground extends past the overview frustum; navigation remains
  // bounded to the courtyard. This prevents a visible dark edge at the horizon.
  mesh('ForestFloor',[0,-.18,0],[600,1,650],'moss-ground','Ground',{primitive:'plane',castShadows:false});
  mesh('CourtPaving',[0,-.05,1],[9,1,25],'court-stone','Court',{primitive:'plane',castShadows:false});
  // A continuous, shallow bed is visible through the scene-refraction surface.
  mesh('PondBed',[8,-.10,3],[8.8,1,16.8],'wet-stone','Pond',{primitive:'plane',castShadows:false});
  mesh('StillWater',[8,.055,3],[9,1,17],'water','Pond',{primitive:'plane',castShadows:false,planarReflection:{enabled:true,axis:'y',blur:1.1,intensity:.75}});
  const batch={optimization:{instancing:true}};
  for(let z=-19;z<8;z+=1.12)for(let x=-1;x<=1;x++)
    mesh(`Path-${Math.round((z+19)/1.12)}-${x+1}`,[x*.91,.02,z],[.87,.21,1.06],'wet-stone','Court',{...batch});
  for(let i=0;i<16;i++)mesh('PondWalk-'+i,[2.6,.035,-4+i*1.12],[1.35,.24,1.06],'wet-stone','Pond',{...batch});
  for(const [i,x,z,sx,sz]of [[0,3.35,3,.32,17.8],[1,12.65,3,.32,17.8],[2,8,-5.72,9.6,.32],[3,8,11.72,9.6,.32]])
    mesh('PondCurb-'+i,[x,.12,z],[sx,.35,sz],'stone','Pond');

  await model('MoonGate','moon-gate.glb',[0,-.08,-14.4],1,'Entrance',{materialId:'plaster'});
  for(const x of [-10.7,10.7]){
    mesh('EntryWall-'+x,[x,1.55,-14.4],[12.8,3.3,.42],'plaster','Entrance');
    mesh('EntryCap-'+x,[x,3.28,-14.4],[13.1,.16,.70],'tiles','Entrance');
    mesh('EntryPlinth-'+x,[x,.12,-14.4],[13.0,.5,.62],'stone','Entrance');
  }
  mesh('GateCap',[0,4.38,-14.4],[8.9,.18,.76],'tiles','Entrance');
  for(const [id,pos,size]of [['WestWall',[-18,1.3,2],[.4,2.9,33]],['EastWall',[18,1.3,2],[.4,2.9,33]],['NorthWall',[0,1.4,18.4],[36,3.1,.45]]]){
    mesh(id,pos,size,'plaster','Court');mesh(id+'-cap',[pos[0],pos[1]+size[1]/2,pos[2]],[size[0]+.2,.16,size[2]+.2],'tiles','Court');
  }
  const slotMaterials={stone:'stone','wood-0':'wood-red','wood-1':'wood-green','wood-2':'wood','wood-3':'wood-dark',tiles:'tiles',ceramic:'tiles'};
  await model('ListeningPavilion','pavilion.glb',[0,.10,9],1,'Court',{
    materialSlots:Object.fromEntries(prepared.pavilionSlots.map(p=>[p.key,slotMaterials[p.name]])),
  });
  for(const [i,x,angle]of [[0,-1.05,-Math.PI/2],[1,1.05,Math.PI/2]])await model('TeaChair-'+i,'chinese-armchair.glb',[x,.75,9],.72,'Court',{
    name:'雕花扶手椅 '+(i+1),materialId:'chair-wood',rotation:{x:0,y:angle,z:0},optimization:{lod:{enabled:true,levels:[{distance:18,grid:24},{distance:30,grid:12}]}}
  });
  mesh('TeaTable',[0,1.3,9],[.85,.08,.85],'wood-dark','Court',{primitive:'cylinder'});
  mesh('TeaTableLeg',[0,1.02,9],[.17,.53,.17],'wood-dark','Court',{primitive:'cylinder'});
  // Small roofed gallery: textured modular joinery complements the imported
  // pavilion; it remains individually editable, with opaque instance batches.
  for(let x=-14;x<=14;x+=4){
    for(const z of [14.2,17])mesh(`GalleryColumn-${x}-${z}`,[x,1.6,z],[.20,3.1,.20],'wood-dark','Court',{...batch});
    mesh('GalleryBeam-'+x,[x,3.17,15.6],[.18,.25,3.4],'wood-green','Court',{...batch});
  }
  mesh('GalleryFloor',[0,.06,15.6],[30,.3,3.7],'stone','Court');
  for(const sign of [-1,1])mesh('GalleryRoof-'+sign,[0,3.6,15.6+sign*.96],[30.8,.16,2.1],'tiles','Court',{rotation:{x:sign*.22,y:0,z:0}});
  mesh('GalleryRidge',[0,3.86,15.6],[31,.18,.2],'tiles','Court');
  for(const x of [-12,-8,-4,4,8,12])for(let panel=1;panel<=2;panel++)await model(`GalleryScreen-${x}-${panel}`,`chinese-screen-${panel}.glb`,[x,.25,17.95],1.6,'Court',{
    name:`雕花屏风 ${x} / ${panel}`,materialId:'screen-wood'
  });

  const patches=[[-7,-19],[8,-19],[-13,-6],[-13,2],[-13,10],[-11,21],[-3,23],[6,23],[14,22],[21,-3],[21,7],[21,16]];
  for(const [i,[x,z]] of patches.entries())await model('BambooPatch-'+i,`bamboo-patch-${i%3+1}.glb`,[x,-.12,z],1,'Bamboo',{
    name:`竹林分块 ${i+1} · 6 株真实资产`,materialSlots:{'mesh:1/slot:0':'bamboo-branch','mesh:2/slot:0':'leaves','mesh:3/slot:0':'bamboo'},
  });
  for(const [i,[x,z]]of [[-7,-16],[7,-16],[-9,-8],[-7,1],[-8,7],[-10,12],[14,-3],[14,6]].entries())await model('FernPatch-'+i,`fern-patch-${i%2+1}.glb`,[x,-.12,z],1,'Bamboo',{
    name:`池岸蕨丛 ${i+1} · 6 株`,materialId:'fern',rotation:{x:0,y:i*2.399,z:0}
  });
  const rocks=[[5,-5,.5],[8,-5.2,.42],[11,-5.4,.52],[13.1,-2,.4],[13.1,2,.6],[13,6,.48],[12.4,10.7,.7],[10,12,.45],[6,12,.5],[4.0,9,.45],[4.0,3,.38],[-6,-10,.65],[-8,-2,.60],[-6,5,.8],[-8,13,.68],[-14,13,.7],[-4,-17,.42],[4,-17,.46]];
  for(const [i,[x,z,scale]]of rocks.entries())await model('MossRock-'+i,`moss-rock-${i%6+1}.glb`,[x,.05,z],[scale,scale,scale],'Pond',{
    name:`苔石 ${i+1}`,materialId:'moss-rock',rotation:{x:0,y:i*2.399,z:0},optimization:{lod:{enabled:true,levels:[{distance:14,grid:24},{distance:28,grid:12}]}}
  });
  for(let i=0;i<7;i++)mesh('ViewingStep-'+i,[-12, i*.13-.01,-8+i*.5],[4,.24,.65],'stone','Overview',{...batch});
  mesh('ViewingTerrace',[-12,.79,-4.3],[5.2,.4,3.2],'stone','Overview');
  for(const x of [-14.4,-9.6])mesh('ViewingRail-'+x,[x,1.5,-4.3],[.10,.9,3.1],'wood-dark','Overview',{...batch});

  for(const [i,x,z]of [[0,-3,-11.8],[1,3,11.5]]){
    mesh('LanternFoot-'+i,[x,.13,z],[.56,.35,.56],'stone','Court',{...batch});
    mesh('LanternPost-'+i,[x,1.15,z],[.12,2,.12],'wood-dark','Court',{...batch});
    mesh('LanternShade-'+i,[x,2.1,z],[.45,.64,.45],'lamp','Court',{primitive:'cylinder'});
    mesh('LanternCap-'+i,[x,2.47,z],[.59,.09,.59],'wood-dark','Court',{...batch});
    node('LanternLight-'+i,'light',[x,2.15,z],[1,1,1],{parentId:'Court',lightType:'spot',intensity:7,color:'#E8B375',lightRange:6,spotAngle:75,spotInnerAngle:35,castShadows:false});
  }
  const start=views[0];node('Camera','camera',start.position,[1,1,1],{activeCamera:true,fov:59,rotation:angles(start.position,start.target),scripts:['main.js']});
  node('MorningSun','light',[-12,20,-10],[1,1,1],{lightType:'directional',color:'#FFE0AF',intensity:2.3,rotation:{x:.8,y:-.4,z:-.65}});
  const rendering=ArkGlideRenderingConfig.settings({
    quality:'high',antialiasing:'taa',gpuProfiling:true,temporal:{samples:8,factor:.14},
    environment:{textureId:'venice-sunset',intensity:.6,rotation:1.8},
    color:{toneMapping:'aces',exposure:1.15,contrast:1.07,saturation:-5},
    shadows:{enabled:true,mapSize:1024,maxLights:1,maxDistance:58,filter:'pcf',normalBias:.02},
    sky:{enabled:true,sunAzimuth:125,sunElevation:24,turbidity:2.8,rayleigh:1.2,luminance:.4},
    reflections:{ssr:{enabled:true,maxSteps:64,downsample:2,maxDistance:45,thickness:.18,strength:.65},planar:{enabled:true,maxMirrors:1,maxPixels:262144,scale:.5}},
    realtimeProbes:{maxActive:1,facesPerFrame:2,maxPixels:32768,transition:.3},
    probes:[{id:'pond-live',name:'映池 · 低频实时环境',mode:'realtime',position:{x:8,y:2,z:3},size:{x:10,y:9,z:19},resolution:128,interval:2,blendDistance:1.8,intensity:.7}],
    volumetric:{enabled:true,color:'#C8D3C5',density:.0048,height:.3,falloff:.24,maxDistance:68,ambient:.03,lightIntensity:.18,anisotropy:.35,noiseStrength:.22,noiseScale:.15,steps:48,scale:.5,maxPixels:262144,shadowMapSize:512,shadowDistance:50},
    volumeLighting:{maxLocalLights:1,localIntensity:.45,multipleScattering:.15,scatteringOrders:2},
    refraction:{enabled:true,maxLayers:1,maxPixels:65536,scale:.25},
    bloom:{enabled:true,threshold:1.6,weight:.13,kernel:24,scale:.25},
    ao:{enabled:true,ratio:.5,radius:.45,strength:.65,samples:8},
    // Dense bamboo already silhouettes the sky; clouds, DOF and layered glass
    // are intentionally left off to keep exploration legible and bounded.
    clouds:{enabled:false},dof:{enabled:false},transparency:{enabled:false},
  });
  const scripts={};for(const file of ['main.js','tour.js'])scripts[file]=await fs.readFile(new URL('../examples/chinese-courtyard-scripts/'+file,import.meta.url),'utf8');
  const project={version:'0.6',name:'竹隐 · Chinese Courtyard Showcase',projectId:'arkglide-chinese-courtyard-showcase',updatedAt:0,
    activeFileId:'main.js',scripts,assets:[],scene:{nodes},modelRefs:nodes.filter(n=>n.type==='model').map(n=>({assetId:n.id,fileName:n.fileName})),
    settings:{backgroundColor:'#BBC5AC',ambientIntensity:.28,ambientColor:'#CFDDD3',gravity:{x:0,y:-9.8,z:0},fixedTimeStep:1/60,maxSubSteps:8,timeScale:1,fpsCap:60,rendering},
    content:{materials,textures:textureAssets,prefabs:{},prefabInstances:{}}};
  return {project,textures,models};
}
