import type { Scene } from '@babylonjs/core';
let current:{scene:Scene;adapter:any}|null=null;
export function registerEditorScene(scene:Scene,adapter:any){const value={scene,adapter};current=value;return()=>{if(current===value)current=null;};}
export function getEditorScene(){if(!current)throw Error('编辑视口尚未就绪');return current;}
