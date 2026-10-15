import fs from 'node:fs/promises';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
// Extend the third-batch real project, retaining its audio, rigs, mixer, UI,
// animation controllers and runtime-only nested model templates.
const files = unzipSync(new Uint8Array(await fs.readFile(new URL('../examples/third-full.arkglide',import.meta.url))));
const project = JSON.parse(strFromU8(files['project.json']));
project.name = 'ArkGlide 独立导出演示';
// These sounds are referenced by script IDs rather than attached AudioSources.
project.settings.build = {preload: ['audio:music', 'audio:tone']};
project.content.materials['export-material']={id:'export-material',name:'导出示例 PBR 贴图材质',baseColor:'#809BCC',emissiveColor:'#000000',metallic:0.1,roughness:0.7,alpha:1,doubleSided:false,uvScale:{u:2,v:2},albedoTextureId:project.content.textures[0].id};
const materialNode=project.scene.nodes.find(n=>n.type==='mesh'&&!n.parentId);
if(materialNode)materialNode.materialId='export-material';
project.scripts['lib/export-counter.js'] = 'let count=0; export function next(){return ++count;}';
project.scripts['lib/export-label.js'] = 'export const label="独立包中的字面量动态导入已就绪";';
project.scripts['export-demo.js'] = `import {next} from './lib/export-counter.js';
export default function({timers,console,prefabs,scene}) {
  return {
    onStart(){
      console.log('export session counter',next());
      import('./lib/export-label.js').then(({label})=>{if(!this.entity.destroyed)console.log(label);});
      // The third project exposes its runtime template via the gameplay action;
      // list all templates so the exported project visibly verifies inclusion.
      console.log('打包模板',prefabs.list().map(p=>p.name).join(', '));
    },
    onDestroy(){console.log('独立示例脚本已销毁');}
  };
}`;
project.scene.nodes.push({id:'export-demo',name:'独立模块验证',type:'empty',parentId:null,transform:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},visible:true,scripts:['export-demo.js']});
files['project.json']=strToU8(JSON.stringify(project,null,2));
await fs.writeFile(new URL('../examples/fourth-static.arkglide',import.meta.url),zipSync(files));
await fs.writeFile(new URL('../examples/fourth-static.json',import.meta.url),JSON.stringify(project,null,2)+'\n');
console.log('第四批项目示例已生成');
