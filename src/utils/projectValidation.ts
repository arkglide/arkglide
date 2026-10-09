import type { SceneNode } from '../store/useEditorStore';
import type { StoredProject } from './projectStorage';
export const PROJECT_VERSION = '0.2';
import { DEFAULT_SETTINGS, type ProjectSettings } from '../types/project';

export function validateProject(data: any): { nodes: SceneNode[]; scripts: Record<string, string>; activeFileId: string; settings: ProjectSettings } {
  if (data && data.version !== undefined && !['0.1', PROJECT_VERSION].includes(data.version)) throw new Error('项目格式版本 '+data.version+' 暂不支持，请使用对应版本编辑器打开');
  if (!data || !Array.isArray(data.scene?.nodes) || !data.scripts || typeof data.scripts !== 'object' || Array.isArray(data.scripts)) throw new Error('无效项目结构');
  const vector = (v: any, fallback: {x:number;y:number;z:number}) => {
    v ??= fallback;
    if (![v.x,v.y,v.z].every(Number.isFinite)) throw new Error('项目中包含无效变换数值');
    return {x:v.x,y:v.y,z:v.z};
  };
  const ids = new Set<string>();
  const nodes = data.scene.nodes.map((n: any): SceneNode => {
    if (!n || typeof n.id !== 'string' || !n.id || ids.has(n.id) || typeof n.name !== 'string' || !['mesh','model','empty','light','camera'].includes(n.type)) throw new Error('项目中包含无效或重复节点');
    ids.add(n.id);
    if (n.scripts && (!Array.isArray(n.scripts) || n.scripts.some((name: unknown) => typeof name !== 'string'))) throw new Error('无效脚本绑定');
    if (n.primitive && !['box','sphere','plane','cylinder','capsule','torus'].includes(n.primitive)) throw new Error('无效几何类型');
    if (n.lightType && !['point','directional','hemispheric'].includes(n.lightType)) throw new Error('无效灯光类型');
    if (n.color && !/^#[0-9a-f]{6}$/i.test(n.color)) throw new Error('无效颜色');
    if (n.intensity !== undefined && (!Number.isFinite(n.intensity) || n.intensity < 0)) throw new Error('无效灯光强度');
    if (n.fov !== undefined && (!Number.isFinite(n.fov) || n.fov <= 0 || n.fov >= 180)) throw new Error('无效相机 FOV');
    return {...n,transform:vector(n.transform,{x:0,y:0,z:0}),rotation:vector(n.rotation,{x:0,y:0,z:0}),scale:vector(n.scale,{x:1,y:1,z:1}),visible:n.visible !== false,primitive:n.type==='mesh' ? n.primitive ?? (/sphere/i.test(n.name) ? 'sphere' : 'box') : undefined};
  });
  const byId = new Map<string,SceneNode>(nodes.map((n: SceneNode)=>[n.id,n]));
  for (const node of nodes) {
    const seen = new Set([node.id]); let parent = node.parentId;
    while (parent) {
      if (seen.has(parent) || !byId.has(parent)) throw new Error('项目层级包含循环或缺失的父节点');
      seen.add(parent);parent=byId.get(parent)?.parentId;
    }
  }
  const scripts: Record<string,string> = Object.create(null);
  for (const [name,code] of Object.entries(data.scripts)) {
    if (!name || typeof code !== 'string') throw new Error('无效脚本文件');
    scripts[name]=code;
  }
  if (!Object.hasOwn(scripts,'main.js')) scripts['main.js']='';
  const activeFileId = Object.hasOwn(scripts,data.activeFileId) ? data.activeFileId : 'main.js';
  const settings = {...DEFAULT_SETTINGS,...data.settings,gravity:vector(data.settings?.gravity,DEFAULT_SETTINGS.gravity)};
  if (![settings.ambientIntensity,settings.fpsCap].every(Number.isFinite) || settings.ambientIntensity<0 || settings.fpsCap<0 || !/^#[0-9a-f]{6}$/i.test(settings.backgroundColor) || !/^#[0-9a-f]{6}$/i.test(settings.ambientColor)) throw new Error('无效项目设置');
  if (!Number.isFinite(settings.fixedTimeStep) || settings.fixedTimeStep<1/240 || settings.fixedTimeStep>0.1 || !Number.isInteger(settings.maxSubSteps) || settings.maxSubSteps<1 || settings.maxSubSteps>32 || !Number.isFinite(settings.timeScale) || settings.timeScale<0 || settings.timeScale>100) throw new Error('无效时间设置');
  return {nodes,scripts,activeFileId,settings};
}

/** Migrate legacy 0.1 before replacing live state; unknown future versions are rejected. */
export function normalizeProject(data: any): StoredProject {
  const valid=validateProject(data);
  const models=new Map(valid.nodes.filter(n=>n.type==='model').map(n=>[n.id,n]));
  if(data.modelRefs!==undefined&&!Array.isArray(data.modelRefs))throw new Error('无效模型引用列表');
  const seen=new Set<string>();
  const modelRefs=(data.modelRefs ?? []).map((ref:any)=>{
    if(!ref || typeof ref.assetId!=='string' || !models.has(ref.assetId) || seen.has(ref.assetId) || typeof ref.fileName!=='string' || !ref.fileName || ref.fileName.includes('\\') || ref.fileName.startsWith('/') || ref.fileName.includes(':') || ref.fileName.split('/').includes('..'))throw new Error('无效或重复的模型引用');
    seen.add(ref.assetId);return {assetId:ref.assetId,fileName:ref.fileName};
  });
  for(const [id,node] of models)if(!seen.has(id))modelRefs.push({assetId:id,fileName:node.modelUrl || id+'.glb'});
  return {projectId:typeof data.projectId==='string'?data.projectId:'',name:typeof data.name==='string'&&data.name.trim()?data.name:'未命名项目',
    version:PROJECT_VERSION,updatedAt:Number.isFinite(data.updatedAt)?data.updatedAt:Date.now(),scene:{nodes:valid.nodes},scripts:valid.scripts,
    activeFileId:valid.activeFileId,modelRefs,settings:valid.settings};
}
