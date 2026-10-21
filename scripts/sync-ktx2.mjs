import {build} from 'esbuild';
import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const project=new URL('../',import.meta.url),source=new URL('./',import.meta.resolve('@babylonjs/ktx2decoder')),target=new URL('../public/lib/ktx2/',import.meta.url);
await mkdir(target,{recursive:true});
// Resolve the package's public entry instead of a private legacy file. Keep the
// working directory explicit so package resolution also works outside the repo.
await build({absWorkingDir:fileURLToPath(project),entryPoints:['@babylonjs/ktx2decoder'],bundle:true,minify:true,format:'iife',globalName:'KTX2DECODER',platform:'browser',outfile:fileURLToPath(new URL('babylon.ktx2Decoder.js',target)),legalComments:'eof'});
for(const file of ['msc_basis_transcoder.js','msc_basis_transcoder.wasm','uastc_astc.wasm','uastc_bc7.wasm','uastc_r8_unorm.wasm','uastc_rg8_unorm.wasm','uastc_rgba8_srgb_v2.wasm','uastc_rgba8_unorm_v2.wasm','zstddec.wasm'])await copyFile(new URL('wasm/'+file,source),new URL(file,target));
await copyFile(new URL('license.md',source),new URL('decoder-LICENSE.md',target));
await copyFile(new URL('wasm/license.md',source),new URL('transcoders-LICENSE.md',target));
await copyFile(new URL('../src/engine/ktx2-validate-worker.js',import.meta.url),new URL('validate-worker.js',target));
// Classic scripts can load in our opaque-origin game iframe; fetch(WASM) cannot
// rely on the static host granting CORS. Load this companion only for KTX2 in
// that iframe and give the native worker data URLs owned by the package.
const entries={jsDecoderModule:'babylon.ktx2Decoder.js',wasmUASTCToASTC:'uastc_astc.wasm',wasmUASTCToBC7:'uastc_bc7.wasm',wasmUASTCToRGBA_UNORM:'uastc_rgba8_unorm_v2.wasm',wasmUASTCToRGBA_SRGB:'uastc_rgba8_srgb_v2.wasm',wasmUASTCToR8_UNORM:'uastc_r8_unorm.wasm',wasmUASTCToRG8_UNORM:'uastc_rg8_unorm.wasm',jsMSCTranscoder:'msc_basis_transcoder.js',wasmMSCTranscoder:'msc_basis_transcoder.wasm',wasmZSTDDecoder:'zstddec.wasm'};
const resources=Object.fromEntries(await Promise.all(Object.entries(entries).map(async([key,file])=>[key,'data:'+(file.endsWith('.wasm')?'application/wasm':'text/javascript')+';base64,'+(await readFile(new URL(file,target))).toString('base64')])));
await writeFile(new URL('decoder-resources.js',target),'// Generated from the local decoder and WASM files; licenses ship alongside.\nglobalThis.ArkGlideKTX2Resources='+JSON.stringify(resources)+';\n');
