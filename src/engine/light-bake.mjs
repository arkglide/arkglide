import { zlibSync } from 'fflate';

export function bakeOptions(input={}) {
  const c={resolution:128,aoSamples:16,aoDistance:2,bias:.002,...input};
  if(![32,64,128,256,512,1024].includes(c.resolution)||![0,8,16,32,64,128].includes(c.aoSamples)||!Number.isFinite(c.aoDistance)||c.aoDistance<=0||c.aoDistance>10000||!Number.isFinite(c.bias)||c.bias<.000001||c.bias>1)throw Error('无效烘焙参数');
  return c;
}

// Each sample is a world-space position and inverse-transpose normal. Shared
// edges are allowed; distinct surfaces occupying the same texel are rejected.
export function rasterizeLightmap({positions,normals,uvs,indices},resolution) {
  if(positions.length%3||normals.length!==positions.length||uvs.length!==positions.length/3*2||indices.length%3||[positions,normals,uvs].some(values=>Array.from(values).some(v=>!Number.isFinite(v)))||Array.from(uvs).some(v=>v<-.00001||v>1.00001))throw Error('烘焙需要完整且位于 0–1 内的 UV2、顶点与法线');
  const samples=new Float64Array(resolution*resolution*6),valid=new Uint8Array(resolution*resolution);
  for(let t=0;t<indices.length;t+=3){
    const ids=Array.from(indices.slice(t,t+3));if(ids.some(i=>!Number.isInteger(i)||i<0||i>=positions.length/3))throw Error('无效三角形索引');
    const e=[0,1,2].map(k=>positions[ids[1]*3+k]-positions[ids[0]*3+k]),f=[0,1,2].map(k=>positions[ids[2]*3+k]-positions[ids[0]*3+k]);
    if(Math.hypot(e[1]*f[2]-e[2]*f[1],e[2]*f[0]-e[0]*f[2],e[0]*f[1]-e[1]*f[0])<1e-12)continue;
    const [a,b,c]=ids.map(i=>[uvs[i*2]*resolution,uvs[i*2+1]*resolution]);
    const det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(det)<1e-10)continue;
    const minX=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),maxX=Math.min(resolution-1,Math.ceil(Math.max(a[0],b[0],c[0])));
    const minY=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),maxY=Math.min(resolution-1,Math.ceil(Math.max(a[1],b[1],c[1])));
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
      const u=((b[1]-c[1])*(x+.5-c[0])+(c[0]-b[0])*(y+.5-c[1]))/det,v=((c[1]-a[1])*(x+.5-c[0])+(a[0]-c[0])*(y+.5-c[1]))/det,w=1-u-v;
      if(Math.min(u,v,w)<-1e-8)continue;
      const pixel=y*resolution+x,at=pixel*6,weights=[u,v,w],point=[0,0,0],normal=[0,0,0];
      for(let j=0;j<3;j++)for(let k=0;k<3;k++){point[k]+=positions[ids[j]*3+k]*weights[j];normal[k]+=normals[ids[j]*3+k]*weights[j];}
      if(valid[pixel]&&Math.hypot(...point.map((n,k)=>n-samples[at+k]))>1e-5)throw Error('UV2 存在重叠；请在建模工具中展开后重新导入');
      const length=Math.hypot(...normal);if(length<1e-10)continue;
      samples.set([...point,...normal.map(n=>n/length)],at);valid[pixel]=1;
    }
  }
  const pixels=[];for(let i=0;i<valid.length;i++)if(valid[i])pixels.push(i);
  if(!pixels.length)throw Error('UV2 在当前分辨率下没有有效像素，请提高分辨率或修复 UV2');
  const packed=new Float64Array(pixels.length*6);pixels.forEach((p,i)=>packed.set(samples.subarray(p*6,p*6+6),i*6));
  return {samples:packed,pixels:new Uint32Array(pixels),coverage:pixels.length/(resolution*resolution)};
}

export function padLightmap(rgb,pixels,resolution,passes=3){
  const mask=new Uint8Array(resolution*resolution);for(const p of pixels)mask[p]=1;
  for(let pass=0;pass<passes;pass++){
    const next=mask.slice();
    for(let y=0;y<resolution;y++)for(let x=0;x<resolution;x++){
      const p=y*resolution+x;if(mask[p])continue;let count=0;const color=[0,0,0];
      for(const [dx,dy]of [[-1,0],[1,0],[0,-1],[0,1]]){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=resolution||yy>=resolution)continue;const q=yy*resolution+xx;if(mask[q]){count++;for(let c=0;c<3;c++)color[c]+=rgb[q*3+c];}}
      if(count){for(let c=0;c<3;c++)rgb[p*3+c]=color[c]/count;next[p]=1;}
    }mask.set(next);
  }return rgb;
}

const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(type,data){const out=new Uint8Array(data.length+12),view=new DataView(out.buffer);view.setUint32(0,data.length);out.set(new TextEncoder().encode(type),4);out.set(data,8);let crc=0xffffffff;for(let i=4;i<out.length-4;i++)crc=crcTable[(crc^out[i])&255]^(crc>>>8);view.setUint32(out.length-4,(crc^0xffffffff)>>>0);return out;}
export function encodeLightmap(rgb,resolution){
  let scale=1;for(const v of rgb)scale=Math.max(scale,v);if(!Number.isFinite(scale))throw Error('烘焙产生了无效亮度');
  const raw=new Uint8Array(resolution*(resolution*3+1));
  for(let y=0;y<resolution;y++)for(let x=0;x<resolution;x++)for(let c=0;c<3;c++)raw[y*(resolution*3+1)+1+x*3+c]=Math.round(Math.max(0,Math.min(1,rgb[((resolution-1-y)*resolution+x)*3+c]/scale))*255);
  const header=new Uint8Array(13),view=new DataView(header.buffer);view.setUint32(0,resolution);view.setUint32(4,resolution);header[8]=8;header[9]=2;
  const chunks=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlibSync(raw)),chunk('IEND',new Uint8Array())];
  const png=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let at=0;for(const c of chunks){png.set(c,at);at+=c.length;}return {png,scale};
}

export function sceneLightingSignature(state){
  // Include parent transforms, occluders, lights, material bindings and source
  // revisions; omit bake metadata itself so adding a result does not stale it.
  const nodes=state.nodes.map(({bakedLighting,...n})=>n);
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])])):value;
  let hash=2166136261;const text=JSON.stringify(canonical([nodes,state.settings.ambientColor,state.settings.ambientIntensity]));
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(16).padStart(8,'0');
}
