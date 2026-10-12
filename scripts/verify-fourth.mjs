import fs from 'node:fs';
import {spawn, spawnSync} from 'node:child_process';
const npm=process.platform==='win32'?'npm.cmd':'npm';
fs.mkdirSync('docs/verification',{recursive:true});
const gitHead=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
const record={base:gitHead.status===0?gitHead.stdout.trim():null, originalF13Base:'1f7bacd421f9ede86a46079e9cf47f84288f4b81',startedAt:new Date().toISOString(),node:process.version,steps:[]};
for (const [name,args,extraEnv] of [
 ['unit',['test'],{}],
 ['static-browser',['run','test:static'],{}],
 ['build',['run','build'],{NODE_OPTIONS:'--max-old-space-size=5120'}],
 ['editor-browser',['run','test:browser'],{}],
]) {
 console.log('VERIFY starting '+name);
 const start=Date.now(),log=fs.createWriteStream('docs/verification/f13-'+name+'.log');
 const child=spawn(npm,args,{env:{...process.env,...extraEnv},stdio:['ignore','pipe','pipe'],shell:process.platform==='win32'});
 child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
 const {code,signal}=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal}));});
 await new Promise(resolve=>log.end(resolve));
 record.steps.push({name,command:'npm '+args.join(' '),passed:code===0,exitCode:code,signal,durationSeconds:(Date.now()-start)/1000});
 fs.writeFileSync('docs/verification/f13-checks.json',JSON.stringify(record,null,2)+'\n');
 console.log('VERIFY '+name+': '+(code===0?'PASS':'FAIL')+' ('+((Date.now()-start)/1000).toFixed(1)+'s)');
 if(code!==0){console.error('See docs/verification/f13-'+name+'.log');process.exitCode=1;break;}
}
record.finishedAt=new Date().toISOString();
fs.writeFileSync('docs/verification/f13-checks.json',JSON.stringify(record,null,2)+'\n');
