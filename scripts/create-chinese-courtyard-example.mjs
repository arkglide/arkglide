import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { zipSync,strToU8 } from 'fflate';
import { chineseCourtyardProject } from './chinese-courtyard-project.mjs';

const dir=new URL('../examples/chinese-courtyard-assets/',import.meta.url);
const prepared=JSON.parse(await fs.readFile(new URL('prepared.json',dir),'utf8'));
for(const resource of prepared.resources){
  const data=await fs.readFile(new URL(resource.path,dir));
  if(createHash('sha256').update(data).digest('hex')!==resource.sha256)throw Error('资源校验失败：'+resource.path);
}
const {project,textures,models}=await chineseCourtyardProject();
const files={'project.json':strToU8(JSON.stringify(project))};
for(const [name,data]of models)files['assets/'+name]=data;
for(const [id,data]of textures)files['textures/'+encodeURIComponent(id)+'.bin']=data;
for(const name of ['ASSETS.md','LONG-WIND-LICENSE.txt','sources.lock.json'])files['licenses/'+name]=new Uint8Array(await fs.readFile(new URL(name,dir)));
const archive=zipSync(files,{level:6,mtime:new Date('2026-01-01T00:00:00Z')});
await fs.writeFile(new URL('../examples/chinese-courtyard-showcase.arkglide',import.meta.url),archive);
console.log(`竹隐庭院：${project.scene.nodes.length} 个可编辑节点，${models.size} 个共享模型，${textures.size} 张贴图，项目 ${(archive.length/1048576).toFixed(2)} MiB。`);
