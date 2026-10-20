import fs from 'node:fs/promises';import {zipSync,strToU8} from 'fflate';
import {volumetricProject} from './volumetric-project.mjs';
const {project:p,textures}=volumetricProject();p.name='Static Instance Batch Lab';p.projectId='arkglide-static-instance-lab';
for(const n of p.scene.nodes)if(n.type==='mesh'&&n.materialId==='stone')n.optimization={instancing:true};
p.scene.nodes.find(n=>n.id==='Floor').physics={motion:'static',shape:'mesh',size:{x:1,y:1,z:1},mass:1,friction:.5,restitution:0,sensor:false,lockRotation:true};
p.scripts['main.js']=p.scripts['main.js'].replace('体积大气 · V 开关','实例批次 · 24 石构共享 1 批 · V 体积雾').replace('onStart(){',"onStart(){const hit=physics.raycast({x:0,y:5,z:0},{x:0,y:-10,z:0});console.log('Instance floor collider',hit?.entity.id,hit?.distance);");
const files={'project.json':strToU8(JSON.stringify(p))};for(const [id,data]of textures)files['textures/'+id+'.bin']=new Uint8Array(data);
await fs.writeFile(new URL('../examples/instance-lab.arkglide',import.meta.url),zipSync(files,{level:6}));console.log('Instance Lab: 24 stone meshes in one native batch, volumetric shafts and a static mesh collider.');
