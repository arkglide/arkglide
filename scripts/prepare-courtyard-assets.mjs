// Rebuild the checked-in static models from licensed, pinned upstream resources.
// This is a build-time adapter, never included in the ArkGlide browser runtime.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { geometryGLB } from './courtyard-glb.mjs';
import { prepareCourtyardModels } from './courtyard-import-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'examples/chinese-courtyard-assets');
const lock = JSON.parse(await fs.readFile(path.join(output, 'sources.lock.json'), 'utf8'));
const copyright = await fs.readFile(path.join(output, 'LONG-WIND-LICENSE.txt'), 'utf8');
const offline = process.argv.includes('--offline');
const sha = data => createHash('sha256').update(data).digest('hex');
for (const file of lock.downloads) {
  const target = path.join(root, file.cache);
  let data = await fs.readFile(target).catch(() => null);
  if (!data) {
    if (offline) throw Error('Missing cached source: ' + file.cache);
    await fs.mkdir(path.dirname(target), { recursive: true });
    // curl respects the environment's proxy and TLS policy. No alternate proxy.
    data = execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '90', file.url], { maxBuffer: 32 * 1024 * 1024 });
    if (sha(data) !== file.sha256) throw Error('Upstream hash mismatch: ' + file.url);
    await fs.writeFile(target, data);
  }
  if (sha(data) !== file.sha256) throw Error('Cached source hash mismatch: ' + file.cache);
}
execFileSync('python', [path.join(root, 'scripts/courtyard-textures.py')], { stdio: 'inherit' });
const compiled = path.join(root, 'work/courtyard/compiled');
await fs.mkdir(compiled, { recursive: true });
const source = name => fs.readFile(path.join(root, 'work/courtyard/upstream/src/world', name), 'utf8');
await fs.writeFile(path.join(compiled, 'props-geo.js'), await source('props-geo.js'));
let pavilion = await source('props-pavilion.js');
pavilion = pavilion.slice(0, pavilion.indexOf('// ------------------------------------------------------------------------------------------------ materials'));
pavilion = pavilion.replace(/^import .*$/gm, '').replace(/  \/\/ plaque over[\s\S]*?  const ceramic = ridgeGeometries\(\);/, '  const ceramic = ridgeGeometries();');
pavilion = `import * as THREE from 'three';\nimport {box,cyl,beam,place,merge,partAttr} from './props-geo.js';\n` + pavilion;
await fs.writeFile(path.join(compiled, 'pavilion.js'), pavilion);
const { buildPavilion } = await import(new URL('../work/courtyard/compiled/pavilion.js', import.meta.url));
const pg = buildPavilion(null).geos;
function part(geo, value) {
  const positions = [], normals = [], uvs = [];
  for (let i = 0; i < geo.attributes.position.count; i += 3) {
    if (Math.round(geo.attributes.aPart.getX(i)) !== value) continue;
    for (let j = i; j < i + 3; j++) {
      positions.push(geo.attributes.position.getX(j), geo.attributes.position.getY(j), geo.attributes.position.getZ(j));
      normals.push(geo.attributes.normal.getX(j), geo.attributes.normal.getY(j), geo.attributes.normal.getZ(j));
      uvs.push(geo.attributes.uv.getX(j), geo.attributes.uv.getY(j));
    }
  }
  const g = new THREE.BufferGeometry();
  for (const [key, a, n] of [['position', positions, 3], ['normal', normals, 3], ['uv', uvs, 2]]) g.setAttribute(key, new THREE.Float32BufferAttribute(a, n));
  return g;
}
const pavilionParts = [['stone', pg.stone], ...[0,1,2,3].map(i => ['wood-'+i, part(pg.wood, i)]), ['tiles', pg.tiles], ['ceramic', pg.ceramic]];
await fs.writeFile(path.join(output, 'models/pavilion.glb'), geometryGLB(pavilionParts.map(([name,g])=>[name,mergeVertices(g,1e-5)]), 'Long Wind hexagonal pavilion, adapted PBR bindings', copyright));

await prepareCourtyardModels(root, output);
// Supporting garden joinery only. The main pavilion and all vegetation reuse
// existing upstream geometry; this simple opening closes the entrance wall.
const wall = new THREE.Shape(); wall.moveTo(-4.3,0);wall.lineTo(4.3,0);wall.lineTo(4.3,4.4);wall.lineTo(-4.3,4.4);wall.closePath();
const hole = new THREE.Path();hole.absarc(0,1.75,1.67,0,Math.PI*2,true);wall.holes.push(hole);
const gate = new THREE.ExtrudeGeometry(wall,{depth:.42,bevelEnabled:true,bevelSize:.035,bevelThickness:.035,bevelSegments:1,curveSegments:48});gate.translate(0,0,-.21);
await fs.writeFile(path.join(output,'models/moon-gate.glb'),geometryGLB([['plaster opening',gate]],'Supporting moon gate'));
const entries=[];
for(const dir of ['models','textures'])for(const file of (await fs.readdir(path.join(output,dir))).sort()){
  const name=dir+'/'+file,data=await fs.readFile(path.join(output,name));entries.push({path:name,bytes:data.length,sha256:sha(data)});
}
await fs.writeFile(path.join(output,'prepared.json'),JSON.stringify({version:2,pavilionSlots:pavilionParts.map(([name],i)=>({key:`mesh:${i+1}/slot:0`,name})),bambooCulmsPerPatch:6,resources:entries},null,2)+'\n');
console.log(`Courtyard assets: ${entries.length} files, ${(entries.reduce((s,f)=>s+f.bytes,0)/1048576).toFixed(2)} MiB. Source hashes verified.`);
