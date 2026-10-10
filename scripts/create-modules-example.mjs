import fs from "node:fs";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
const base = new URL("../examples/", import.meta.url);
const files = unzipSync(
  new Uint8Array(fs.readFileSync(new URL("collect-gems.arkglide", base))),
);
const project = JSON.parse(strFromU8(files["project.json"]));
project.name = "JavaScript 模块示例：收集宝石";
project.scripts["movement.js"] = `export const speed = 3;
export function movement(input) {
  return {x:input.getAction('moveX')*speed, z:input.getAction('moveZ')*speed};
}
`;
project.scripts["main.js"] =
  "import { movement } from './movement.js';\n" +
  project.scripts["main.js"].replace(
    "physics.setVelocity(this.entity,{x:input.getAction('moveX')*3,y:v.y,z:input.getAction('moveZ')*3});",
    "const step=movement(input); physics.setVelocity(this.entity,{x:step.x,y:v.y,z:step.z});",
  );
files["project.json"] = strToU8(JSON.stringify(project, null, 2));
fs.writeFileSync(
  new URL("collect-gems-modules.arkglide", base),
  zipSync(files),
);
fs.writeFileSync(
  new URL("collect-gems-modules.json", base),
  JSON.stringify(project, null, 2),
);
console.log("模块化收集游戏示例已生成");
