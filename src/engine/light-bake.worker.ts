import factory from '../wasm/arkglide_math.js';
import { bakeOptions, rasterizeLightmap, padLightmap, encodeLightmap } from './light-bake.mjs';
self.onmessage=async({data})=>{
 let native:any;
 try{
  const options=bakeOptions(data.options),module:any=await factory();
  native=new module.LightBakeBatch();
  if(!native.reserve(data.triangles.length/9,4096,data.lights.length/10))throw Error('烘焙场景超过计算预算');
  native.triangleView().set(data.triangles);native.lightView().set(data.lights);
  if(!native.prepare(data.triangles.length/9))throw Error('烘焙场景包含无效几何');
  const results=[];let complete=0;
  for(const target of data.targets){
   const {samples,pixels,coverage}=rasterizeLightmap(target,options.resolution),rgb=new Float32Array(options.resolution*options.resolution*3);
   for(let i=0;i<pixels.length;i+=4096){
    const count=Math.min(4096,pixels.length-i);native.sampleView().set(samples.subarray(i*6,(i+count)*6));
    if(!native.bake(count,data.lights.length/10,options.aoSamples,options.aoDistance,options.bias))throw Error('光照射线批次失败');
    const output=native.outputView();for(let j=0;j<count;j++)rgb.set(output.subarray(j*3,j*3+3),pixels[i+j]*3);
    self.postMessage({type:'progress',value:(complete+(i+count)/pixels.length)/data.targets.length});
    await new Promise(resolve=>setTimeout(resolve,0));
   }
   padLightmap(rgb,pixels,options.resolution);const {png,scale}=encodeLightmap(rgb,options.resolution);
   results.push({nodeId:target.nodeId,part:target.part,autoUV2:target.autoUV2,png:png.buffer,scale,coverage});complete++;
  }
  (self as any).postMessage({type:'done',results,backend:'wasm-bvh',rays:native.rayCount()},results.map(r=>r.png));
 }catch(error){self.postMessage({type:'error',message:String(error)});}finally{native?.delete();}
};
