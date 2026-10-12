import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// Rebuild from current source on every run; never validate a stale checked-in game.
import './sync-runtime.mjs';
const root=new URL('../.static-test-fixtures/',import.meta.url);
await fs.rm(root,{recursive:true,force:true});await fs.mkdir(root,{recursive:true});
const built=new URL('built/',root),served=new URL('served/',root);
const result=spawnSync(process.execPath,['scripts/export-static-game.mjs','examples/fourth-static.arkglide',fileURLToPath(built)],{stdio:'inherit'});
if(result.error)throw result.error;
if(result.status!==0)throw Error('静态验收包生成失败');
await fs.cp(built,served,{recursive:true});
await fs.cp(built,new URL('deep/games/demo/',served),{recursive:true});
