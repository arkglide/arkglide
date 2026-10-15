import fs from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import { compositionProject } from './composition-project.mjs';
const project = await compositionProject();
await fs.writeFile(new URL('../examples/composition-lab.json', import.meta.url), JSON.stringify(project, null, 2) + '\n');
await fs.writeFile(new URL('../examples/composition-lab.arkglide', import.meta.url), zipSync({ 'project.json': strToU8(JSON.stringify(project)) }, { level: 6 }));
console.log('Composition lab generated. Import examples/composition-lab.arkglide.');
