(function(root){
 'use strict';
 function summary(values){const sorted=values.filter(v=>Number.isFinite(v)&&v>=0).sort((a,b)=>a-b),n=sorted.length;return {samples:n,median:n?(sorted[Math.floor((n-1)/2)]+sorted[Math.ceil((n-1)/2)])/2:null,p95:n?sorted[Math.max(0,Math.ceil(n*.95)-1)]:null,min:n?sorted[0]:null,max:n?sorted[n-1]:null};}
 function renderMode(renderer=''){if(/swiftshader|llvmpipe|softpipe|software|basic render|WARP/i.test(renderer))return 'software';if(/NVIDIA|GeForce|Radeon|AMD|Intel|Apple|Adreno|Mali|PowerVR|D3D|Metal/i.test(renderer))return 'hardware-reported';return 'unknown';}
 function config(input={}){const c={meshes:500,width:1920,height:1080,warmup:120,samples:300,...input};for(const [k,min,max]of [['meshes',4,2000],['width',128,3840],['height',96,2160],['warmup',5,600],['samples',10,1800]])if(!Number.isInteger(c[k])||c[k]<min||c[k]>max)throw Error('无效基准参数：'+k);return c;}
 root.ArkGlideSceneBenchmarkMetrics={summary,renderMode,config};
})(globalThis);
