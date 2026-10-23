import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { zipSync } from 'fflate';

const root=new URL('../',import.meta.url),destination=path.resolve(process.argv[2]||new URL('../work/chinese-courtyard-static/',import.meta.url).pathname);
execFileSync(process.execPath,['scripts/create-chinese-courtyard-example.mjs'],{cwd:root,stdio:'inherit'});
execFileSync(process.execPath,['scripts/export-static-game.mjs','examples/chinese-courtyard-showcase.arkglide',destination],{cwd:root,stdio:'inherit'});
await fs.mkdir(path.join(destination,'licenses'),{recursive:true});
for(const file of ['ASSETS.md','LONG-WIND-LICENSE.txt','sources.lock.json'])await fs.copyFile(new URL('../examples/chinese-courtyard-assets/'+file,import.meta.url),path.join(destination,'licenses',file));
await fs.copyFile(new URL('../docs/chinese-courtyard/README.md',import.meta.url),path.join(destination,'SHOWCASE-README.md'));
for(const file of ['VALIDATION.md','CHANGES.md','FILES.txt','ACCEPTANCE.json','SNAPSHOT.json','preview-entrance.png','preview-overview.png','preview-pond.png'])await fs.copyFile(new URL('../docs/chinese-courtyard/'+file,import.meta.url),path.join(destination,file));
const files={};
async function collect(folder,prefix=''){
  for(const item of await fs.readdir(folder,{withFileTypes:true})){
    const name=prefix+item.name,file=path.join(folder,item.name);
    if(item.isDirectory())await collect(file,name+'/');else files[name]=new Uint8Array(await fs.readFile(file));
  }
}
await collect(destination);await fs.writeFile(destination+'.zip',zipSync(files,{level:6,mtime:new Date('2026-01-01T00:00:00Z')}));
console.log('已把资产清单、许可证和使用说明加入独立网页 ZIP。');
