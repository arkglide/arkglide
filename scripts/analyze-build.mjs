import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
const directory=new URL('../dist/',import.meta.url);
if(!existsSync(directory)){console.error('先执行 npm run build');process.exit(1);}
const root=fileURLToPath(directory);
function collect(path){return readdirSync(path).flatMap(name=>{const file=join(path,name);return statSync(file).isDirectory()?collect(file):[file];});}
const files=collect(root).map(file=>{const buffer=readFileSync(file);return {file:relative(root,file).replaceAll('\\','/'),bytes:buffer.length,gzipBytes:gzipSync(buffer).length};}).sort((a,b)=>b.bytes-a.bytes);
console.log(JSON.stringify({fileCount:files.length,totalBytes:files.reduce((n,f)=>n+f.bytes,0),totalGzipBytes:files.reduce((n,f)=>n+f.gzipBytes,0),largestFiles:files.slice(0,12),note:'gzip 是逐文件估算；需要服务器启用压缩。总量包含编辑器、运行器、workers 与静态库，不代表一次页面加载量。'},null,2));
