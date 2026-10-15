import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

test('CLI export preserves an existing sibling ZIP and leaves the output directory empty',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'arkglide-cli-')),target=path.join(root,'game');
 try {
  await mkdir(target);await writeFile(target+'.zip','existing archive');
  const child=spawn(process.execPath,['scripts/export-static-game.mjs','examples/fourth-static.arkglide',target]);
  let stderr='';child.stderr.on('data',data=>stderr+=data);child.stdout.resume();
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  assert.notEqual(code,0);assert.match(stderr,/ZIP.*存在/);
  assert.equal(await readFile(target+'.zip','utf8'),'existing archive');
  assert.deepEqual(await readdir(target),[]);
 } finally {await rm(root,{recursive:true,force:true});}
});
