import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {serveStatic} from '../scripts/serve-static.mjs';
import {spawn} from 'node:child_process';

test('a busy static server port rejects the startup promise',async()=>{
 const server=await serveStatic(tmpdir(),0);
 try {
  const script=`import {serveStatic} from ${JSON.stringify(new URL('../scripts/serve-static.mjs',import.meta.url).href)};try {await serveStatic(${JSON.stringify(tmpdir())},${server.address().port});process.exitCode=2;} catch(error) {if(error.code!=='EADDRINUSE')throw error;console.log('caught busy port');}`;
  const child=spawn(process.execPath,['--input-type=module','-e',script]);
  let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
  assert.equal(code,0,stderr);assert.match(stdout,/caught busy port/);
 } finally {await new Promise(resolve=>server.close(resolve));}
});

test('static directory redirects preserve encoded names and query strings',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'arkglide-static-'));
 const server=await serveStatic(root,0);
 try {
  for(const name of ['中文游戏','game#demo','game?demo']){
   await mkdir(path.join(root,name));await writeFile(path.join(root,name,'index.html'),'game');
   const url=`http://127.0.0.1:${server.address().port}/${encodeURIComponent(name)}?v=1`;
   const response=await fetch(url,{redirect:'manual'});
   assert.equal(response.status,301,name);
   assert.equal(response.headers.get('location'),`/${encodeURIComponent(name)}/?v=1`);
   assert.equal(await (await fetch(url)).text(),'game');
  }
 } finally {await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
