// Shared KTX2 bounds/format inspection and local decoder configuration.
(function(root){
 'use strict';
 const magic=[171,75,84,88,32,50,48,187,13,10,26,10];
 const decoderFiles={jsDecoderModule:'babylon.ktx2Decoder.js',wasmUASTCToASTC:'uastc_astc.wasm',wasmUASTCToBC7:'uastc_bc7.wasm',wasmUASTCToRGBA_UNORM:'uastc_rgba8_unorm_v2.wasm',wasmUASTCToRGBA_SRGB:'uastc_rgba8_srgb_v2.wasm',wasmUASTCToR8_UNORM:'uastc_r8_unorm.wasm',wasmUASTCToRG8_UNORM:'uastc_rg8_unorm.wasm',jsMSCTranscoder:'msc_basis_transcoder.js',wasmMSCTranscoder:'msc_basis_transcoder.wasm',wasmZSTDDecoder:'zstddec.wasm'};
 const script=root.document?.currentScript?.src||root.document?.baseURI||root.location?.href;
 const defaultBase=script?new URL('lib/ktx2/',script).href:null;
 const oriented=new WeakSet();
 const normalPlugins=new WeakMap();
 let preparation;
 function isKTX2(input){const b=ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):new Uint8Array(input);return b.length>=12&&magic.every((v,i)=>b[i]===v);}
 function inspect(input){
  const b=ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):new Uint8Array(input);
  if(b.length<104||b.length>64*1024*1024||!isKTX2(b))throw Error('无效 KTX2 文件头或文件大小');
  const d=new DataView(b.buffer,b.byteOffset,b.byteLength),u=i=>d.getUint32(i,true);
  const wide=i=>{const n=d.getBigUint64(i,true);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('KTX2 数据范围溢出');return Number(n);};
  const vk=u(12),type=u(16),width=u(20),height=u(24),mips=u(40),scheme=u(44),dfd=u(48),dfdLength=u(52),kvd=u(56),kvdLength=u(60),sgd=wide(64),sgdLength=wide(72);
  if(width<1||height<1||width>8192||height>8192||width*height>16777216||u(28)!==0||u(32)!==0||u(36)!==1||type!==1||mips<1||mips>Math.floor(Math.log2(Math.max(width,height)))+1||![0,1,2].includes(scheme)||![0,37,43].includes(vk))throw Error('KTX2 需要不超过 16 MP 的 2D 单层 ETC1S/UASTC 或 RGBA8 贴图');
  if(mips!==1&&mips!==Math.floor(Math.log2(Math.max(width,height)))+1)throw Error('KTX2 需要单个 mip 或完整 mip 链');
  const segments=[];
  function range(at,length,label,required=true){if(!Number.isSafeInteger(at)||!Number.isSafeInteger(length)||length<0||at<0||at+length>b.length||required&&length===0)throw Error('KTX2 数据范围损坏：'+label);if(length)segments.push({at,end:at+length,label});}
  range(0,80+mips*24,'header');range(dfd,dfdLength,'DFD');range(kvd,kvdLength,'KVD',false);range(sgd,sgdLength,'SGD',false);
  if(dfdLength<44||u(dfd)!==dfdLength||d.getUint16(dfd+4,true)!==0||d.getUint16(dfd+6,true)!==0||d.getUint16(dfd+8,true)!==2||d.getUint16(dfd+10,true)+4!==dfdLength||(dfdLength-28)%16!==0||b[dfd+15]&1)throw Error('不支持或损坏的 KTX2 数据格式描述');
  const model=b[dfd+12],transfer=b[dfd+14];
  if(![0,1].includes(b[dfd+13]))throw Error('KTX2 颜色图需要 BT.709/sRGB 原色');
  if(![1,2].includes(transfer)||vk===0&&!((model===163&&scheme===1&&sgdLength>=20)||(model===166&&[0,2].includes(scheme)))||vk!==0&&(model!==1||scheme===1||sgdLength!==0)||vk===37&&transfer!==1||vk===43&&transfer!==2)throw Error('不支持的 KTX2 编码或色彩空间');
  if(model===166&&sgdLength!==0)throw Error('无效 UASTC 全局数据');
  const block=vk?0:3;if(b[dfd+16]!==block||b[dfd+17]!==block||b[dfd+18]||b[dfd+19])throw Error('不支持的 KTX2 块尺寸');
  let estimatedRgbaBytes=0;
  for(let i=0;i<mips;i++){
   const w=Math.max(1,width>>i),h=Math.max(1,height>>i),offset=wide(80+i*24),length=wide(88+i*24),raw=wide(96+i*24),expected=vk? w*h*4:Math.ceil(w/4)*Math.ceil(h/4)*16;
   range(offset,length,'mip '+i);estimatedRgbaBytes+=w*h*4;
   if(scheme!==1&&(raw!==expected||scheme===0&&length!==expected))throw Error('KTX2 mip 数据大小不匹配');
  }
  if(scheme===1){
   const descriptors=20+mips*20;
   if(sgdLength<descriptors||descriptors+u(sgd+4)+u(sgd+8)+u(sgd+12)+u(sgd+16)!==sgdLength)throw Error('ETC1S 全局数据大小不匹配');
   for(let i=0;i<mips;i++){
    const at=sgd+20+i*20,size=wide(88+i*24),rgb=u(at+4),rgbLength=u(at+8),alpha=u(at+12),alphaLength=u(at+16);
    if(!rgbLength||rgb+rgbLength>size||alpha+alphaLength>size||alphaLength&&alpha<rgb+rgbLength&&rgb<alpha+alphaLength)throw Error('ETC1S 图像切片范围损坏');
   }
  }
  segments.sort((a,c)=>a.at-c.at);for(let i=1;i<segments.length;i++)if(segments[i].at<segments[i-1].end)throw Error('KTX2 数据范围重叠');
  let orientation='rd',count=0;
  if(kvdLength>65536)throw Error('KTX2 元数据超过上限');
  for(let at=kvd;at<kvd+kvdLength;){
   if(at+4>kvd+kvdLength||++count>64)throw Error('KTX2 元数据损坏');const size=u(at);at+=4;
   if(size<2||at+size>kvd+kvdLength)throw Error('KTX2 元数据长度损坏');
   const entry=b.subarray(at,at+size),zero=entry.indexOf(0);if(zero<1)throw Error('KTX2 元数据键损坏');
   const key=new TextDecoder().decode(entry.subarray(0,zero)),value=new TextDecoder().decode(entry.subarray(zero+1)).replace(/\0+$/,'');
   if(key==='KTXorientation'){if(!['rd','ru','ld','lu'].includes(value))throw Error('不支持的 KTX2 方向');orientation=value;}
   if(key==='KTXswizzle'&&value!=='rgba')throw Error('请在编码时应用 KTX2 通道重排');
   at+=Math.ceil(size/4)*4;if(at>kvd+kvdLength)throw Error('KTX2 元数据填充损坏');
  }
  return {width,height,mipLevels:mips,colorSpace:transfer===2?'srgb':'linear',encoding:vk?'rgba8':model===163?'etc1s':'uastc',supercompression:scheme===2?'zstd':scheme===1?'basisLZ':'none',orientation,estimatedRgbaBytes};
 }
 function decoderConfig(base=defaultBase){if(!base)throw Error('KTX2 解码资源地址未配置');return {...Object.fromEntries(Object.entries(decoderFiles).map(([key,file])=>[key,new URL(file,base).href])),...root.ArkGlideKTX2Resources};}
 function configure(B,base=defaultBase){if(base&&B.KhronosTextureContainer2)Object.assign(B.KhronosTextureContainer2.URLConfig,decoderConfig(base));}
 function needsPreparation(content){return root.origin==='null'&&!root.ArkGlideKTX2Resources&&(content?.textures||[]).some(t=>t.mime==='image/ktx2');}
 function prepare(B){
  if(root.origin!=='null'||root.ArkGlideKTX2Resources){configure(B);return Promise.resolve();}
  if(!preparation)preparation=new Promise((resolve,reject)=>{
   const script=root.document.createElement('script');script.src=new URL('decoder-resources.js',defaultBase).href;
   script.onload=()=>{script.remove();root.ArkGlideKTX2Resources?resolve():reject(Error('KTX2 本地解码资源未初始化'));};
   script.onerror=()=>{script.remove();reject(Error('KTX2 本地解码资源加载失败'));};root.document.head.append(script);
  }).catch(error=>{preparation=null;throw error;});
  return preparation.then(()=>configure(B));
 }
 function configureModule(module,base){
  const urls=decoderConfig(base);
  for(const [name,key]of [['ASTC','wasmUASTCToASTC'],['BC7','wasmUASTCToBC7'],['RGBA_UNORM','wasmUASTCToRGBA_UNORM'],['RGBA_SRGB','wasmUASTCToRGBA_SRGB'],['R8_UNORM','wasmUASTCToR8_UNORM'],['RG8_UNORM','wasmUASTCToRG8_UNORM']])module['LiteTranscoder_UASTC_'+name].WasmModuleURL=urls[key];
  module.MSCTranscoder.JSModuleURL=urls.jsMSCTranscoder;module.MSCTranscoder.WasmModuleURL=urls.wasmMSCTranscoder;module.MSCTranscoder.UseFromWorkerThread=true;module.ZSTDDecoder.WasmModuleURL=urls.wasmZSTDDecoder;
 }
 function assertRole(info,role){if(!['albedo','emissive','sheen'].includes(role)&&info.colorSpace!=='linear')throw Error('KTX2 法线和数据贴图需要线性色彩空间：'+role);}
 function textureFlips(texture){
  const info=texture?.metadata?.arkglideKTX2;if(!info)return [false,false];
  const internal=texture.getInternalTexture?.(),uploadedFlip=!!internal?.isReady&&[5,6,7].includes(internal.format)&&texture.invertY;
  return [info.orientation[0]==='l',(info.orientation[1]==='d')!==!!uploadedFlip];
 }
 function applyTexture(B,texture,info,role){
  texture.gammaSpace=info.colorSpace==='srgb';
  texture.metadata={...texture.metadata,arkglideKTX2:info,arkglideKTX2Role:role};
  const internal=texture.getInternalTexture?.();
  // Babylon 9.28's RGBA mip upload leaves width/height at the last mip.
  // Keep source dimensions on this owned texture after its native load settles.
  if(internal?.isReady){internal.width=internal.baseWidth=info.width;internal.height=internal.baseHeight=info.height;}
  // Normal/detail sampling is corrected in the material shader. Its original
  // UV derivatives must continue defining the tangent frame.
  if(['normal','coatNormal','detail'].includes(role))return;
  if(!oriented.has(texture)&&texture.getTextureMatrix){
   oriented.add(texture);texture.optimizeUVAllocation=false;
   const original=texture.getTextureMatrix.bind(texture),output=B.Matrix.Identity();let last='';
   // Correct the encoded image orientation AFTER the authored UV transform.
   // Flipping vScale alone would reverse the user's UV rotation and offsets.
   texture.getTextureMatrix=(uBase=1)=>{
    const source=original(uBase),[flipU,flipV]=textureFlips(texture),key=source.updateFlag+':'+flipU+':'+flipV;
    if(key!==last){last=key;output.copyFrom(source);const m=source.m;
     output.setRowFromFloats(0,flipU?-m[0]:m[0],flipV?-m[1]:m[1],m[2],m[3]);
     output.setRowFromFloats(1,flipU?-m[4]:m[4],flipV?-m[5]:m[5],m[6],m[7]);
     output.setRowFromFloats(2,flipU?1-m[8]:m[8],flipV?1-m[9]:m[9],m[10],m[11]);
    }return output;
   };
  }
 }
 function applyMaterial(B,material){
  if(!material)return;
  const maps=()=>({BUMP:material.bumpTexture,COAT:material.clearCoat?.bumpTexture,DETAIL:material.detailMap?.texture});
  const textures=maps(),needed=Object.values(textures).some(t=>t?.metadata?.arkglideKTX2)||!!(material.detailMap?.isEnabled&&material.detailMap.texture);
  material.metadata={...material.metadata,arkglideKTX2NormalMaps:needed};
  let plugin=normalPlugins.get(material);if(!plugin&&!needed)return;
  if(!plugin){
   const defines=Object.fromEntries(['BUMP','COAT','DETAIL'].flatMap(name=>[[`ARK_KTX_${name}_U`,false],[`ARK_KTX_${name}_V`,false]]));
   class KtxOrientation extends B.MaterialPluginBase{
    constructor(){super(material,'ArkGlideKtxOrientation',205,defines);this.signature='';this._enable(true);}
    getClassName(){return 'ArkGlideKtxOrientation';}
    prepareDefinesBeforeAttributes(defines,scene){
     // Babylon 9.28 prepares DETAIL after UV attributes. Detail-only materials
     // otherwise sample constant (0,0) even when their mesh has valid UVs.
     if(material.detailMap?.isEnabled&&material.detailMap.texture&&scene.texturesEnabled&&scene.getEngine().getCaps().standardDerivatives)defines._needUVs=true;
    }
    prepareDefines(defines){for(const [name,t]of Object.entries(maps())){const [u,v]=textureFlips(t);defines['ARK_KTX_'+name+'_U']=u;defines['ARK_KTX_'+name+'_V']=v;}}
    getCustomCode(shader){
     if(shader==='vertex')return {
      CUSTOM_VERTEX_DEFINITIONS:`
// Babylon 9.28's detail-only fragment path reads vTBN for authored tangents,
// while its vertex include omits DETAIL from the tangent-frame guard.
#if defined(DETAIL) && defined(TANGENT) && defined(NORMAL) && !defined(BUMP) && !defined(PARALLAX) && !defined(CLEARCOAT_BUMP) && !defined(ANISOTROPIC)
varying mat3 vTBN;
#endif
`,
      CUSTOM_VERTEX_MAIN_END:`
#if defined(DETAIL) && defined(TANGENT) && defined(NORMAL) && !defined(BUMP) && !defined(PARALLAX) && !defined(CLEARCOAT_BUMP) && !defined(ANISOTROPIC)
vec3 arkKtxNormal=normalize(normalUpdated),arkKtxTangent=normalize(tangentUpdated.xyz);
vTBN=mat3(finalWorld)*mat3(arkKtxTangent,cross(arkKtxNormal,arkKtxTangent)*tangentUpdated.w,arkKtxNormal);
#endif
`};
     if(shader!=='fragment')return null;
     const code={CUSTOM_FRAGMENT_DEFINITIONS:''};
     for(const [name,guard,sampler]of [['BUMP','BUMP','bumpSampler'],['COAT','CLEARCOAT_BUMP','clearCoatBumpSampler'],['DETAIL','DETAIL','detailSampler']]){
      code.CUSTOM_FRAGMENT_DEFINITIONS+=`
#ifdef ${guard}
vec4 arkKtxSample${name}(vec2 uv) {
#ifdef ARK_KTX_${name}_U
uv.x=1.0-uv.x;
#endif
#ifdef ARK_KTX_${name}_V
uv.y=1.0-uv.y;
#endif
// Space before '(' prevents this wrapper from matching our source replacement.
return texture2D (${sampler},uv);
}
#endif
`;
      code['!(?:TEXRD|texture2D)\\('+sampler+',']='arkKtxSample'+name+'(';
     }return code;
    }
   }
   plugin=new KtxOrientation();normalPlugins.set(material,plugin);
  }
  const signature=Object.entries(textures).map(([name,t])=>name+':'+t?.uniqueId+':'+textureFlips(t).join(',')).join('|');
  if(signature!==plugin.signature){plugin.signature=signature;plugin.markAllDefinesAsDirty();}
 }
 function validate(bytes,caps={},base=defaultBase){
  const info=inspect(bytes);if(!base)return Promise.reject(Error('KTX2 解码资源地址未配置'));
  return new Promise((resolve,reject)=>{
   const worker=new Worker(new URL('validate-worker.js',base)),timer=setTimeout(()=>finish(Error('KTX2 解码验证超时')),30000);
   let settled=false;
   function finish(error,result){if(settled)return;settled=true;clearTimeout(timer);worker.terminate();error?reject(error):resolve({...info,decodedFormat:result.format});}
   worker.onerror=e=>finish(Error('KTX2 解码工作线程失败：'+e.message));
   worker.onmessage=({data})=>data.error?finish(Error('KTX2 解码失败：'+data.error)):finish(null,data);
   const copy=ArrayBuffer.isView(bytes)?bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength):bytes.slice(0);
   try{worker.postMessage({bytes:copy,caps},[copy]);}catch(e){finish(e);}
  });
 }
 function storageBytes(format,width,height,mips){
  const formats={5:[1,1,4],6:[1,1,1],7:[1,1,2],32856:[1,1,4],33776:[4,4,8],33777:[4,4,8],33778:[4,4,16],33779:[4,4,16],35916:[4,4,8],35918:[4,4,16],35919:[4,4,16],36196:[4,4,8],36492:[4,4,16],36493:[4,4,16],37492:[4,4,8],37493:[4,4,8],37494:[4,4,8],37495:[4,4,8],37496:[4,4,16],37497:[4,4,16],37808:[4,4,16],37840:[4,4,16]};
  const block=formats[format];if(!block&&! [35840,35841,35842,35843].includes(format))return null;
  let bytes=0;for(let level=0;level<mips;level++){const w=Math.max(1,width>>level),h=Math.max(1,height>>level);
   if(block)bytes+=Math.ceil(w/block[0])*Math.ceil(h/block[1])*block[2];
   else {const two=format===35841||format===35843;bytes+=Math.max(two?16:8,w)*Math.max(8,h)*(two?2:4)/8;}
  }return bytes;
 }
 root.ArkGlideKTX2={isKTX2,inspect,configure,configureModule,decoderConfig,needsPreparation,prepare,assertRole,applyTexture,applyMaterial,textureFlips,validate,storageBytes};
})(globalThis);
