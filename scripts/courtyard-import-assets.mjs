// Offline adaptation of pinned static glTF assets. Runtime uses ordinary GLB.
import fs from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { geometryGLB } from './courtyard-glb.mjs';

export async function prepareCourtyardModels(root, output) {
  async function read(file) {
    const bytes = await fs.readFile(path.join(root, file));
    let doc, buffer;
    if (file.endsWith('.glb')) {
      const length = bytes.readUInt32LE(12);
      doc = JSON.parse(bytes.subarray(20, 20 + length));
      buffer = bytes.subarray(28 + length);
    } else {
      doc = JSON.parse(bytes);
      buffer = await fs.readFile(path.join(root, path.dirname(file), doc.buffers[0].uri));
    }
    function attribute(index) {
      const a = doc.accessors[index], v = doc.bufferViews[a.bufferView];
      if (a.sparse || a.normalized) throw Error('Unexpected sparse/normalized source accessor');
      const size = {SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];
      const [width, get] = {5123:[2,'readUInt16LE'],5125:[4,'readUInt32LE'],5126:[4,'readFloatLE']}[a.componentType];
      const data = a.componentType === 5126 ? new Float32Array(a.count * size) : new Uint32Array(a.count * size);
      const start = (v.byteOffset || 0) + (a.byteOffset || 0), stride = v.byteStride || size * width;
      for (let i=0; i<a.count; i++) for (let k=0; k<size; k++) data[i*size+k] = buffer[get](start+i*stride+k*width);
      return new THREE.BufferAttribute(data, size);
    }
    function geometry(p) {
      const g = new THREE.BufferGeometry();
      for (const [key, name] of [['POSITION','position'],['NORMAL','normal'],['TEXCOORD_0','uv']]) g.setAttribute(name, attribute(p.attributes[key]));
      if (p.indices !== undefined) g.setIndex(attribute(p.indices));
      // Project material textures use invertY=true; imported glTF textures use
      // invertY=false. Flip V once here so normal/albedo/ARM stay aligned.
      const uv=g.attributes.uv; for(let i=0;i<uv.count;i++) uv.setY(i,1-uv.getY(i));
      return g;
    }
    return {doc, geometry};
  }
  const write = (file, parts, label, credit) => fs.writeFile(path.join(output,'models',file), geometryGLB(parts,label,credit));
  const bamboo = await read('work/courtyard/raw/sketchfab/free-bamboo-set.glb');
  const credit = 'Free Bamboo Set by JonhGillessen / Jonh Gillessen. https://sketchfab.com/3d-models/free-bamboo-set-e9f9fa5397814f81bf85ad06acf5bf30 . CC BY 4.0 https://creativecommons.org/licenses/by/4.0/ . Adapted: three green variants selected, display translations removed, scaled, rotated and merged into six-culm patches; shared PBR textures, alpha test. Original author retains copyright.';
  const names=['bambooBlock.016_13','bambooBlock.015_14','bambooBlock.008_21'];
  for(let variant=0;variant<3;variant++) {
    const buckets=[[],[],[]];
    for(let i=0;i<6;i++) {
      const n=bamboo.doc.nodes.find(n=>n.name===names[(i+variant)%3]);
      // Selected nodes have translation only; their mesh coordinates already
      // contain authored branches and leaves in a common upright frame.
      if(n.rotation || n.scale) throw Error('Unexpected bamboo variant transform');
      const parts=n.children.flatMap(id=>bamboo.doc.meshes[bamboo.doc.nodes[id].mesh].primitives.map(p=>({material:p.material,g:bamboo.geometry(p)})));
      const bounds=new THREE.Box3();for(const {g}of parts){g.computeBoundingBox();bounds.union(g.boundingBox);}
      const center=bounds.getCenter(new THREE.Vector3()), height=7.5+((i*7+variant*3)%6)*.42, scale=height/(bounds.max.y-bounds.min.y);
      const x=(i%2-.5)*3.3+Math.sin(i*2.3+variant)*.45,z=(Math.floor(i/2)-1)*2.3+Math.cos(i*3.1+variant)*.4;
      const matrix=new THREE.Matrix4().makeTranslation(x,0,z)
        .multiply(new THREE.Matrix4().makeRotationY(i*2.399+variant*1.3))
        .multiply(new THREE.Matrix4().makeScale(scale,scale,scale))
        .multiply(new THREE.Matrix4().makeTranslation(-center.x,-bounds.min.y,-center.z));
      for(const {material,g}of parts) {
        if(material>2)throw Error('Selected an unintended bamboo material');
        g.applyMatrix4(matrix);buckets[material].push(g);
      }
    }
    await write(`bamboo-patch-${variant+1}.glb`,buckets.map((geos,i)=>[['branches','leaves','culms'][i],mergeGeometries(geos)]),'Six artist-authored bamboo culms, shared PBR',credit);
  }
  for(const [folder,source,name]of [['screens','screen.gltf','chinese-screen'],['chair','chair.gltf','chinese-armchair']]) {
    const asset=await read(`work/courtyard/raw/${folder}/${source}`);
    for(let i=0;i<asset.doc.meshes.length;i++) {
      const parts=asset.doc.meshes[i].primitives.map((p,k)=>[`part-${k}`,asset.geometry(p)]);
      await write(`${name}${asset.doc.meshes.length>1?'-'+(i+1):''}.glb`,parts,name,'Kirill Sannikov / Poly Haven, CC0. https://polyhaven.com/a/'+(folder==='screens'?'chinese_screen_panels':'chinese_armchair')+'. Geometry/UV adapted for shared ArkGlide PBR material; original proportions retained.');
    }
  }
  const fern=await read('work/courtyard/raw/refinement/fern/fern.gltf');
  for(let variant=0;variant<2;variant++) {
    const geos=[];
    for(let i=0;i<6;i++)for(const p of fern.doc.meshes[(i+variant)%4].primitives) {
      const g=fern.geometry(p),s=.72+((i*3+variant)%5)*.12;
      g.applyMatrix4(new THREE.Matrix4().makeTranslation((i%3-1)*.85,0,(Math.floor(i/3)-.5)*.85)
        .multiply(new THREE.Matrix4().makeRotationY(i*2.399+variant))
        .multiply(new THREE.Matrix4().makeScale(s,s,s)));
      geos.push(g);
    }
    await write(`fern-patch-${variant+1}.glb`,[['ferns',mergeGeometries(geos)]],'Six scanned ferns, alpha test','Fern 02 by Rico Cilliers / Rob Tuytel, Poly Haven. CC0. https://polyhaven.com/a/fern_02 . Six plants merged, source display offsets removed, UV adapted; shared complete PBR with restored alpha mask.');
  }
}
