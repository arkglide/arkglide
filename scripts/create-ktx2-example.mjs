import fs from 'node:fs/promises';
import {zipSync,strToU8} from 'fflate';
import {ktx2Project} from './ktx2-project.mjs';
const {project,textures}=await ktx2Project(),files={'project.json':strToU8(JSON.stringify(project))};
for(const [id,data]of textures)files['textures/'+id+'.bin']=new Uint8Array(data);
await fs.writeFile(new URL('../examples/ktx2-lab.arkglide',import.meta.url),zipSync(files,{level:6}));
console.log('KTX2 Lab: offline UASTC/ETC1S, clearcoat, detail normals and alpha mask.');
