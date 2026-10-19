import fs from 'node:fs/promises';
import {zipSync,strToU8} from 'fflate';
import {advancedRenderingProject} from './advanced-rendering-project.mjs';
const {project,textures}=advancedRenderingProject();
const files={'project.json':strToU8(JSON.stringify(project))};
for(const [id,data] of textures)files['textures/'+id+'.bin']=new Uint8Array(data);
await fs.writeFile(new URL('../examples/advanced-rendering-lab.arkglide',import.meta.url),zipSync(files,{level:6}));
console.log('Advanced Rendering Lab generated: 1 low / 2 medium / 3 high + SSR.');
