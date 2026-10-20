import fs from 'node:fs/promises';
import {zipSync,strToU8} from 'fflate';
import {volumetricProject} from './volumetric-project.mjs';
const {project,textures}=volumetricProject(),files={'project.json':strToU8(JSON.stringify(project))};
for(const [id,data]of textures)files['textures/'+id+'.bin']=new Uint8Array(data);
await fs.writeFile(new URL('../examples/volumetric-lab.arkglide',import.meta.url),zipSync(files,{level:6}));
console.log('Volumetric Lab: V atmosphere on/off, 1/2/3 quality, 4/5 low/high camera.');
