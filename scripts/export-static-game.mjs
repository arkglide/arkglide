import fs from 'node:fs/promises';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { createServer } from 'vite';
import { RUNTIME_FILES, createStaticGame } from '../src/export/static-game.mjs';
const [input, destination] = process.argv.slice(2);
if (!input || !destination) {
  console.error('用法: npm run export:game -- project.arkglide output-directory'); process.exit(1);
}
let expanded = 0;
const archive = unzipSync(new Uint8Array(await fs.readFile(input)), {filter(entry){expanded+=entry.originalSize;if(expanded>512*1024*1024)throw Error('项目文件过大');return true;}});
if (!archive['project.json']) throw Error('项目缺少 project.json');
const server = await createServer({server:{middlewareMode:true,hmr:false,ws:false}, appType:'custom', optimizeDeps:{noDiscovery:true,include:[]}});
let project;
try { const {normalizeProject} = await server.ssrLoadModule('/src/utils/projectValidation.ts'); project = normalizeProject(JSON.parse(strFromU8(archive['project.json']))); }
finally { await server.close(); }
const buffer = p => archive[p]?.slice().buffer;
const maps = {
  models:new Map(project.modelRefs.map(r=>[r.assetId,buffer('assets/'+r.fileName)])),
  textures:new Map((project.content?.textures||[]).map(t=>[t.id,buffer('textures/'+encodeURIComponent(t.id)+'.bin')])),
  audio:new Map((project.content?.audio||[]).map(a=>[a.id,buffer('audio/'+encodeURIComponent(a.id)+'.bin')])),
};
const runtime = Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async p=>[p,new Uint8Array(await fs.readFile(new URL('../public/'+p,import.meta.url)))])));
const game = createStaticGame(project,maps,runtime);
const target = path.resolve(destination);
try {
  await fs.lstat(target+'.zip');
  throw Error('输出 ZIP 已存在: '+target+'.zip');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
// Do not mix old deployments with new files or overwrite a non-empty directory.
await fs.mkdir(target,{recursive:true});
if ((await fs.readdir(target)).length) throw Error('输出目录必须为空: '+target);
for (const [name,raw] of Object.entries(game.files)) { const file=path.join(target,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,raw); }
await fs.writeFile(target+'.zip',game.zip(),{flag:'wx'});
console.log(`独立游戏导出完成：${game.manifest.resources.length} 个资源，${game.manifest.files.length+1} 份文件。目录 ${target}`);
