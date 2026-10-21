import fs from 'node:fs/promises';
import {zipSync,strToU8} from 'fflate';
import {renderingCompletionProject} from './rendering-completion-project.mjs';
const {project,textures}=renderingCompletionProject(),files={'project.json':strToU8(JSON.stringify(project))};
for(const[id,data]of textures)files['textures/'+id+'.bin']=new Uint8Array(data);
await fs.writeFile(new URL('../examples/rendering-completion-lab.arkglide',import.meta.url),zipSync(files,{level:6}));
console.log('Rendering Completion Lab: probes, TAA, layered scene refraction and cloud/local scattering.');
