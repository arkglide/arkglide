import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {png} from './rendering-project.mjs';
const folder=new URL('../tests/fixtures/ktx2/',import.meta.url);
await fs.mkdir(folder,{recursive:true});
const color=(x,y,w=64,h=64)=>[[224,40,16,255],[24,160,224,255],[32,208,48,255],[128,48,208,255]][(x>=w/2?1:0)+(y>=h/2?2:0)];
const normal=(x,y)=>{const nx=.15+.35*x/63,ny=-.25+.5*y/63;return [Math.round((nx+1)*127.5),Math.round((ny+1)*127.5),Math.round((Math.sqrt(1-nx*nx-ny*ny)+1)*127.5),255];};
const pixels={colors:color,normal:()=>[128,128,255,255],mask:(x,y)=>[255,255,255,(Math.floor(x/16)+Math.floor(y/16))%2?0:255],'normal-tilt':normal,detail:(x,y)=>{const n=normal(x,y);return [128,n[1],128,n[0]];}};
for(const [name,pixel]of Object.entries(pixels))await fs.writeFile(new URL(name+'.png',folder),png(64,64,pixel));
// A spec-shaped, uncompressed RGBA8 KTX2 fixture also covers NPOT portability.
export function rgbaKtx2(width,height,pixel,orientation='rd'){
 const kv=new TextEncoder().encode('KTXorientation\0'+orientation+'\0'),kvSize=4+Math.ceil(kv.length/4)*4,dfd=104,kvd=dfd+92,offset=kvd+kvSize;
 const bytes=new Uint8Array(offset+width*height*4),d=new DataView(bytes.buffer),u=(at,n)=>d.setUint32(at,n,true);
 bytes.set([171,75,84,88,32,50,48,187,13,10,26,10]);
 for(const [at,n]of [[12,43],[16,1],[20,width],[24,height],[36,1],[40,1],[48,dfd],[52,92],[56,kvd],[60,kvSize]])u(at,n);
 for(const [at,n]of [[80,offset],[88,width*height*4],[96,width*height*4]])d.setBigUint64(at,BigInt(n),true);
 u(dfd,92);d.setUint16(dfd+8,2,true);d.setUint16(dfd+10,88,true);bytes.set([1,1,2,0,0,0,0,0,4],dfd+12);
 for(let i=0;i<4;i++){const at=dfd+28+i*16;d.setUint16(at,i*8,true);bytes[at+2]=7;bytes[at+3]=i===3?31:i;u(at+12,255);}
 u(kvd,kv.length);bytes.set(kv,kvd+4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)bytes.set(pixel(x,y),offset+(y*width+x)*4);
 return bytes;
}
await fs.writeFile(new URL('colors-rgba.ktx2',folder),rgbaKtx2(64,64,color));
await fs.writeFile(new URL('colors-lu.ktx2',folder),rgbaKtx2(64,64,(x,y)=>color(63-x,63-y),'lu'));
await fs.writeFile(new URL('colors-npot.ktx2',folder),rgbaKtx2(30,18,(x,y)=>color(x,y,30,18)));
await fs.writeFile(new URL('colors-npot.png',folder),png(30,18,(x,y)=>color(x,y,30,18)));
const encoder=process.argv[2];
if(encoder){
 for(const [source,target,flags]of [['colors','colors-uastc',['-uastc']],['colors','colors-etc1s',[]],['colors-npot','colors-npot-uastc',['-uastc']],['normal','normal',['-uastc','-linear']],['normal-tilt','normal-tilt',['-uastc','-linear']],['detail','detail',['-uastc','-linear']],['mask','mask',['-uastc']]])
  execFileSync(encoder,['-file',fileURLToPath(new URL(source+'.png',folder)),'-ktx2','-mipmap','-no_multithreading',...flags,'-output_file',fileURLToPath(new URL(target+'.ktx2',folder))],{stdio:'pipe'});
}
console.log('Generated PNG/RGBA fixtures'+(encoder?' and Basis fixtures.':'; pass a basisu executable path to regenerate the checked-in Basis fixtures.'));
