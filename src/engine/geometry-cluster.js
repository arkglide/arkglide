(function(root){
 'use strict';
 function simplify(input,indices,grid){
  const vertices=input.length/8;if(!Number.isInteger(vertices)||vertices>1000000||indices.length>3000000||indices.length%3||!Number.isInteger(grid)||grid<2||grid>128||Array.from(input).some(x=>!Number.isFinite(x)||Math.abs(x)>1e9)||Array.from(indices).some(i=>!Number.isInteger(i)||i<0||i>=vertices))throw Error('无效静态 LOD 几何');
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(let i=0;i<vertices;i++)for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],input[i*8+a]);hi[a]=Math.max(hi[a],input[i*8+a]);}
  const clusters=new Map(),sums=[],weights=[],remap=new Uint32Array(vertices);
  for(let i=0;i<vertices;i++){
   const at=i*8,key=[];for(let a=0;a<3;a++)key[a]=Math.max(0,Math.min(grid-1,Math.floor((input[at+a]-lo[a])/Math.max(1e-12,hi[a]-lo[a])*grid)));
   for(let a=3;a<6;a++)key[a]=Math.floor(Math.max(-1,Math.min(1,input[at+a]))*2+.5);
   for(let a=6;a<8;a++)key[a]=Math.floor(Math.max(-1000000,Math.min(1000000,input[at+a]))*4);
   const id=key.join(':');let group=clusters.get(id);if(group===undefined){group=sums.length;clusters.set(id,group);sums.push(new Float64Array(8));weights.push(0);}remap[i]=group;weights[group]++;for(let a=0;a<8;a++)sums[group][a]+=input[at+a];
  }
  const output=new Float32Array(sums.length*8);for(let i=0;i<sums.length;i++){const n=Math.hypot(sums[i][3],sums[i][4],sums[i][5]);for(let a=0;a<8;a++)output[i*8+a]=sums[i][a]/(a>=3&&a<6?Math.max(1e-12,n):weights[i]);}
  const triangles=[],faces=new Set();
  for(let i=0;i<indices.length;i+=3){
   const face=[remap[indices[i]],remap[indices[i+1]],remap[indices[i+2]]];if(new Set(face).size!==3)continue;
   const e=[],f=[],u=[],v=[];for(let a=0;a<3;a++){e[a]=input[indices[i+1]*8+a]-input[indices[i]*8+a];f[a]=input[indices[i+2]*8+a]-input[indices[i]*8+a];u[a]=output[face[1]*8+a]-output[face[0]*8+a];v[a]=output[face[2]*8+a]-output[face[0]*8+a];}
   let dot=0;for(let a=0;a<3;a++){const b=(a+1)%3,c=(a+2)%3;dot+=(e[b]*f[c]-e[c]*f[b])*(u[b]*v[c]-u[c]*v[b]);}if(dot<=1e-20)continue;
   const key=[...face].sort((a,b)=>a-b).join(':');if(faces.has(key))continue;faces.add(key);triangles.push(...face);
  }
  return {vertices:output,indices:new Uint32Array(triangles)};
 }
 root.ArkGlideGeometryCluster={simplify};
})(globalThis);
