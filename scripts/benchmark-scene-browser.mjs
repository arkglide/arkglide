import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {serveStatic} from './serve-static.mjs';
import './sync-runtime.mjs';
const server=await serveStatic(fileURLToPath(new URL('../public/',import.meta.url)),0),software=process.env.BENCH_SOFTWARE==='1';
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,headless:process.env.BENCH_HEADFUL!=='1',args:['--no-sandbox',...(software?['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']:[])]});
 const page=await browser.newPage({viewport:{width:1400,height:1000}});await page.goto('http://127.0.0.1:'+server.address().port+'/scene-benchmark.html');await page.bringToFront();
 const config={};for(const [variable,field]of [['BENCH_MESHES','meshes'],['BENCH_WIDTH','width'],['BENCH_HEIGHT','height'],['BENCH_WARMUP','warmup'],['BENCH_SAMPLES','samples']])if(process.env[variable])config[field]=Number(process.env[variable]);
 const report=await page.evaluate(config=>ArkGlideSceneBenchmark.run(config),config),path=process.env.BENCH_OUTPUT||'work/scene-benchmark.json';await fs.mkdir(new URL('../work/',import.meta.url),{recursive:true});await fs.writeFile(path,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({path,renderMode:report.renderMode,resolution:report.resolution,results:report.results.map(r=>({lod:r.lod,frameMs:r.frameMs,cpuRenderMs:r.cpuRenderMs,gpuMs:r.gpuMs,triangles:r.triangles}))},null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
