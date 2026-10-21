importScripts('../../arkglide-ktx2.js','./babylon.ktx2Decoder.js');
ArkGlideKTX2.configureModule(KTX2DECODER,new URL('./',self.location.href));
self.onmessage=async({data})=>{
 try{
  const info=ArkGlideKTX2.inspect(data.bytes),decoded=await new KTX2DECODER.KTX2Decoder().decode(new Uint8Array(data.bytes),data.caps);
  if(decoded.errors||decoded.mipmaps.length!==info.mipLevels||decoded.mipmaps.some(m=>!m.data?.byteLength)||decoded.mipmaps[0].width!==info.width||decoded.mipmaps[0].height!==info.height)throw Error(decoded.errors||'贴图数据不完整');
  self.postMessage({format:decoded.transcodedFormat,transcoder:decoded.transcoderName});
 }catch(e){self.postMessage({error:String(e?.message||e)});}
 self.close();
};
