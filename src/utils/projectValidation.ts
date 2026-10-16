import { exportSettings } from "../export/export-settings.mjs";
import { validateAdvancedReferences } from "./advancedGameplayValidation";
import {
  validateComponents,
  validateGameplayContent,
} from "./gameplayValidation";
import type { SceneNode } from "../store/useEditorStore";
import type { StoredProject } from "./projectStorage";
import { emptyContent, type ProjectContent } from "../types/content";
import { assertPrefabGraph, inferInstanceParents } from "../engine/prefabs";
import { collectModelRefs } from "./contentResources";
export const PROJECT_VERSION = "0.6";
import { DEFAULT_SETTINGS, type ProjectSettings } from "../types/project";
import "../engine/render-compute.js";

export function assertScriptPath(name: string): void {
  if (
    !name ||
    !name.endsWith(".js") ||
    /[\\\u0000?#:]/.test(name) ||
    name.startsWith("/") ||
    name.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("无效脚本文件路径");
}

export function assertModelPath(name: string): void {
  if (
    typeof name !== "string" ||
    !name ||
    !/\.(?:glb|gltf)$/i.test(name) ||
    name.includes("\\") ||
    name.includes(":") ||
    name.startsWith("/") ||
    name.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("无效模型文件路径");
}

export function validateProject(data: any): {
  nodes: SceneNode[];
  scripts: Record<string, string>;
  activeFileId: string;
  settings: ProjectSettings;
  content: ProjectContent;
} {
  if (
    data &&
    data.version !== undefined &&
    !["0.1", "0.2", "0.3", "0.4", "0.5", PROJECT_VERSION].includes(data.version)
  )
    throw new Error(
      "项目格式版本 " + data.version + " 暂不支持，请使用对应版本编辑器打开",
    );
  if (
    !data ||
    !Array.isArray(data.scene?.nodes) ||
    !data.scripts ||
    typeof data.scripts !== "object" ||
    Array.isArray(data.scripts)
  )
    throw new Error("无效项目结构");
  const vector = (v: any, fallback: { x: number; y: number; z: number }) => {
    v ??= fallback;
    if (![v.x, v.y, v.z].every(Number.isFinite))
      throw new Error("项目中包含无效变换数值");
    return { x: v.x, y: v.y, z: v.z };
  };
  const ids = new Set<string>();
  const nodes = data.scene.nodes.map((n: any): SceneNode => {
    if (
      !n ||
      typeof n.id !== "string" ||
      !n.id ||
      ["__proto__", "constructor", "prototype"].includes(n.id) ||
      ids.has(n.id) ||
      typeof n.name !== "string" ||
      !["mesh", "model", "empty", "light", "camera"].includes(n.type)
    )
      throw new Error("项目中包含无效或重复节点");
    ids.add(n.id);
    if (
      n.parentId !== undefined &&
      n.parentId !== null &&
      typeof n.parentId !== "string"
    )
      throw new Error("无效父节点引用");
    validateComponents(n);
    if (
      n.scripts &&
      (!Array.isArray(n.scripts) ||
        n.scripts.some((name: unknown) => typeof name !== "string"))
    )
      throw new Error("无效脚本绑定");
    if (n.type === "model" && n.modelUrl !== undefined)
      assertModelPath(n.modelUrl);
    if (
      n.primitive &&
      !["box", "sphere", "plane", "cylinder", "capsule", "torus"].includes(
        n.primitive,
      )
    )
      throw new Error("无效几何类型");
    if (
      n.lightType &&
      !["point", "directional", "hemispheric"].includes(n.lightType)
    )
      throw new Error("无效灯光类型");
    if (n.color && !/^#[0-9a-f]{6}$/i.test(n.color))
      throw new Error("无效颜色");
    if (
      n.intensity !== undefined &&
      (!Number.isFinite(n.intensity) || n.intensity < 0)
    )
      throw new Error("无效灯光强度");
    if (
      n.fov !== undefined &&
      (!Number.isFinite(n.fov) || n.fov <= 0 || n.fov >= 180)
    )
      throw new Error("无效相机 FOV");
    return {
      ...n,
      transform: vector(n.transform, { x: 0, y: 0, z: 0 }),
      rotation: vector(n.rotation, { x: 0, y: 0, z: 0 }),
      scale: vector(n.scale, { x: 1, y: 1, z: 1 }),
      visible: n.visible !== false,
      primitive:
        n.type === "mesh"
          ? (n.primitive ?? (/sphere/i.test(n.name) ? "sphere" : "box"))
          : undefined,
    };
  });
  const byId = new Map<string, SceneNode>(
    nodes.map((n: SceneNode) => [n.id, n]),
  );
  const checked = new Set<string>();
  for (const node of nodes) {
    const seen = new Set<string>();
    let current: string | null | undefined = node.id;
    while (current && !checked.has(current)) {
      if (seen.has(current) || !byId.has(current))
        throw new Error("项目层级包含循环或缺失的父节点");
      seen.add(current);
      current = byId.get(current)?.parentId;
    }
    for (const id of seen) checked.add(id);
  }
  const scripts: Record<string, string> = Object.create(null);
  for (const [name, code] of Object.entries(data.scripts)) {
    assertScriptPath(name);
    if (typeof code !== "string") throw new Error("无效脚本文件内容");
    scripts[name] = code;
  }
  if (!Object.hasOwn(scripts, "main.js")) scripts["main.js"] = "";
  const activeFileId = Object.hasOwn(scripts, data.activeFileId)
    ? data.activeFileId
    : "main.js";
  const settings = {
    ...DEFAULT_SETTINGS,
    ...data.settings,
    gravity: vector(data.settings?.gravity, DEFAULT_SETTINGS.gravity),
  };

  if (settings.build !== undefined)
    settings.build = exportSettings(settings.build);
  if (settings.renderCompute !== undefined)
    settings.renderCompute = (globalThis as any).ArkGlideRenderCompute.settings(settings.renderCompute);
  if (
    ![settings.ambientIntensity, settings.fpsCap].every(Number.isFinite) ||
    settings.ambientIntensity < 0 ||
    settings.fpsCap < 0 ||
    !/^#[0-9a-f]{6}$/i.test(settings.backgroundColor) ||
    !/^#[0-9a-f]{6}$/i.test(settings.ambientColor)
  )
    throw new Error("无效项目设置");
  if (
    !Number.isFinite(settings.fixedTimeStep) ||
    settings.fixedTimeStep < 1 / 240 ||
    settings.fixedTimeStep > 0.1 ||
    !Number.isInteger(settings.maxSubSteps) ||
    settings.maxSubSteps < 1 ||
    settings.maxSubSteps > 32 ||
    !Number.isFinite(settings.timeScale) ||
    settings.timeScale < 0 ||
    settings.timeScale > 100 ||
    (settings.maxFrameDelta !== undefined &&
      (!Number.isFinite(settings.maxFrameDelta) ||
        settings.maxFrameDelta <= 0 ||
        settings.maxFrameDelta > 10))
  )
    throw new Error("无效时间设置");
  const content = validateContent(data.content, nodes, scripts, settings);
  validateAdvancedReferences(content, nodes);
  return { nodes, scripts, activeFileId, settings, content };
}

/** Migrate legacy 0.1 before replacing live state; unknown future versions are rejected. */
export function normalizeProject(data: any): StoredProject {
  const valid = validateProject(data);
  const models = new Map(
    collectModelRefs(valid.nodes, valid.content).map((ref) => [
      ref.assetId,
      ref,
    ]),
  );
  if (data.modelRefs !== undefined && !Array.isArray(data.modelRefs))
    throw new Error("无效模型引用列表");
  const seen = new Set<string>();
  const modelRefs = (data.modelRefs ?? []).map((ref: any) => {
    if (
      !ref ||
      typeof ref.assetId !== "string" ||
      !models.has(ref.assetId) ||
      seen.has(ref.assetId) ||
      typeof ref.fileName !== "string" ||
      !ref.fileName ||
      !/\.(?:glb|gltf)$/i.test(ref.fileName) ||
      ref.fileName.includes("\\") ||
      ref.fileName.startsWith("/") ||
      ref.fileName.includes(":") ||
      ref.fileName.split("/").includes("..")
    )
      throw new Error("无效或重复的模型引用");
    seen.add(ref.assetId);
    return { assetId: ref.assetId, fileName: ref.fileName };
  });
  for (const [id, node] of models)
    if (!seen.has(id)) modelRefs.push({ assetId: id, fileName: node.fileName });
  return {
    projectId: typeof data.projectId === "string" ? data.projectId : "",
    name:
      typeof data.name === "string" && data.name.trim()
        ? data.name
        : "未命名项目",
    version: PROJECT_VERSION,
    updatedAt: Number.isFinite(data.updatedAt) ? data.updatedAt : Date.now(),
    scene: { nodes: structuredClone(valid.nodes) },
    scripts: valid.scripts,
    activeFileId: valid.activeFileId,
    modelRefs,
    settings: valid.settings,
    content: valid.content,
  };
}

function validateContent(
  input: any,
  nodes: SceneNode[],
  scripts: Record<string, string>,
  settings: ProjectSettings,
): ProjectContent {
  const content: ProjectContent =
    input === undefined ? emptyContent() : structuredClone(input);
  const record = (v: any) => v && typeof v === "object" && !Array.isArray(v);
  const id = (v: any) =>
    typeof v === "string" &&
    v.length > 0 &&
    !["__proto__", "constructor", "prototype"].includes(v);
  if (
    !record(content) ||
    !record(content.materials) ||
    !Array.isArray(content.textures) ||
    !record(content.prefabs) ||
    !record(content.prefabInstances)
  )
    throw new Error("无效项目资源结构");
  validateGameplayContent(content);
  const textureIds = new Set<string>();
  for (const t of content.textures) {
    if (
      !t ||
      !id(t.id) ||
      textureIds.has(t.id) ||
      typeof t.name !== "string" ||
      !["image/png", "image/jpeg", "image/webp"].includes(t.mime) ||
      !Number.isInteger(t.byteLength) ||
      t.byteLength <= 0 ||
      t.byteLength > 64 * 1024 * 1024
    )
      throw new Error("无效贴图资源");
    textureIds.add(t.id);
  }
  for (const [key, m] of Object.entries(content.materials)) {
    if (
      !m ||
      !id(key) ||
      m.id !== key ||
      typeof m.name !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(m.baseColor) ||
      !/^#[0-9a-f]{6}$/i.test(m.emissiveColor) ||
      ![m.metallic, m.roughness, m.alpha].every(
        (v) => Number.isFinite(v) && v >= 0 && v <= 1,
      ) ||
      typeof m.doubleSided !== "boolean" ||
      !m.uvScale ||
      ![m.uvScale.u, m.uvScale.v].every(
        (v) => Number.isFinite(v) && Math.abs(v) <= 10000,
      )
    )
      throw new Error("无效材质参数");
    for (const ref of [
      m.albedoTextureId,
      m.normalTextureId,
      m.metallicRoughnessTextureId,
    ])
      if (ref !== undefined && !textureIds.has(ref))
        throw new Error("材质引用的贴图不存在");
  }
  const checkNodes = (items: SceneNode[]) => {
    for (const n of items) {
      if (
        n.audioSource &&
        !content.audio?.some((a) => a.id === n.audioSource!.assetId)
      )
        throw new Error("音源引用的音频不存在");
      if (
        n.materialId !== undefined &&
        (!Object.hasOwn(content.materials, n.materialId) ||
          !["mesh", "model"].includes(n.type))
      )
        throw new Error("节点引用的材质不存在");
      if (n.materialSlots !== undefined) {
        if (n.type !== "model" || !record(n.materialSlots))
          throw new Error("无效模型材质槽");
        for (const [key, ref] of Object.entries(n.materialSlots))
          if (
            !/^mesh:\d+\/slot:\d+$/.test(key) ||
            (ref !== null &&
              (typeof ref !== "string" ||
                !Object.hasOwn(content.materials, ref)))
          )
            throw new Error("无效部件材质引用");
      }
      if (n.scripts?.some((name) => !Object.hasOwn(scripts, name)))
        throw new Error("节点引用的脚本不存在");
    }
  };
  checkNodes(nodes);
  const modelKeys = new Set<string>();
  for (const [key, p] of Object.entries(content.prefabs)) {
    if (
      !p ||
      !id(key) ||
      p.id !== key ||
      typeof p.name !== "string" ||
      !Number.isInteger(p.revision) ||
      p.revision < 1 ||
      !Array.isArray(p.nodes) ||
      !record(p.modelKeys)
    )
      throw new Error("无效预制体");
    if (p.nodes.some((n) => n.prefab))
      throw new Error("模板节点关联应存储在嵌套映射中");
    p.nodes = validateNodeSubtree(p.nodes, scripts, settings);
    if (
      !p.nodes.some((n) => n.id === p.rootId) ||
      p.nodes.some((n) => !n.parentId && n.id !== p.rootId)
    )
      throw new Error("预制体必须包含一个根节点");
    checkNodes(p.nodes);
    const expected = new Set(
      p.nodes.filter((n) => n.type === "model").map((n) => n.id),
    );
    for (const [local, resource] of Object.entries(p.modelKeys)) {
      if (
        !expected.has(local) ||
        typeof resource !== "string" ||
        resource !== "prefab:" + key + ":" + local ||
        modelKeys.has(resource) ||
        nodes.some((n) => n.id === resource)
      )
        throw new Error("无效预制体模型引用");
      modelKeys.add(resource);
      expected.delete(local);
    }
    if (expected.size) throw new Error("预制体模型引用缺失");
  }
  assertPrefabGraph(content.prefabs);
  for (const p of Object.values(content.prefabs)) {
    if (p.nestedInstances !== undefined && !record(p.nestedInstances))
      throw new Error("无效嵌套预制体结构");
    const mounted = new Set<string>();
    for (const [key, mount] of Object.entries(p.nestedInstances || {})) {
      const child = content.prefabs[mount?.prefabId];
      if (
        !mount ||
        !child ||
        key !== mount.id ||
        key !== mount.rootId ||
        !p.nodes.some((n) => n.id === key) ||
        !record(mount.nodeMap) ||
        !Array.isArray(mount.baseline) ||
        !Number.isInteger(mount.revision) ||
        mount.revision < 1 ||
        mount.revision > child.revision ||
        mount.parentInstanceId !== undefined
      )
        throw new Error("无效嵌套预制体引用");
      mount.baseline = validateNodeSubtree(mount.baseline, scripts, settings);
      checkNodes(mount.baseline);
      if (
        mount.nodeMap[child.rootId] !== mount.rootId ||
        !mount.baseline.some((n) => n.id === child.rootId) ||
        mount.baseline.some((n) => !Object.hasOwn(mount.nodeMap, n.id))
      )
        throw new Error("嵌套预制体根节点或基线不一致");
      for (const [local, outer] of Object.entries(mount.nodeMap)) {
        if (
          !mount.baseline.some((n) => n.id === local) ||
          !id(outer) ||
          mounted.has(outer)
        )
          throw new Error("无效嵌套节点映射");
        mounted.add(outer);
        const node = p.nodes.find((n) => n.id === outer);
        if (node && node.id !== mount.rootId) {
          let ancestor = node.parentId;
          while (ancestor && ancestor !== mount.rootId)
            ancestor = p.nodes.find((n) => n.id === ancestor)?.parentId;
          if (ancestor !== mount.rootId)
            throw new Error("嵌套节点已移出挂载点");
        }
      }
    }
  }
  const scene = new Map(nodes.map((n) => [n.id, n]));
  const roots = new Set<string>();
  const owners = new Map<string, string[]>();
  const inferred = inferInstanceParents(nodes, content.prefabInstances);
  const ancestorOf = (parent: string, child: string) => {
    let current = content.prefabInstances[child]?.parentInstanceId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      if (current === parent) return true;
      seen.add(current);
      current = content.prefabInstances[current]?.parentInstanceId;
    }
    return false;
  };
  for (const [key, i] of Object.entries(content.prefabInstances)) {
    const p = content.prefabs[i?.prefabId];
    if (
      !i ||
      !id(key) ||
      i.id !== key ||
      !p ||
      !scene.has(i.rootId) ||
      roots.has(i.rootId) ||
      !record(i.nodeMap) ||
      !Array.isArray(i.baseline) ||
      !Number.isInteger(i.revision) ||
      i.revision < 1 ||
      i.revision > p.revision ||
      i.parentInstanceId !== inferred[key]?.parentInstanceId
    )
      throw new Error("无效预制体实例或嵌套父关联");
    roots.add(i.rootId);
    if (
      i.unpackedMounts !== undefined &&
      (!Array.isArray(i.unpackedMounts) || i.unpackedMounts.some((m) => !id(m)))
    )
      throw new Error("无效解除嵌套标记");
    if (i.baseline.some((n) => n.prefab))
      throw new Error("实例基线不应包含关联");
    i.baseline = validateNodeSubtree(i.baseline, scripts, settings);
    checkNodes(i.baseline);
    if (
      i.nodeMap[p.rootId] !== i.rootId ||
      !i.baseline.some((n) => n.id === p.rootId)
    )
      throw new Error("实例根节点引用不一致");
    const baselineIds = new Set(i.baseline.map((n) => n.id)),
      mapped = new Set<string>();
    for (const [local, sceneId] of Object.entries(i.nodeMap)) {
      if (!baselineIds.has(local) || !id(sceneId) || mapped.has(sceneId))
        throw new Error("重复或无效实例节点映射");
      mapped.add(sceneId);
      const prior = owners.get(sceneId) || [];
      if (
        prior.some(
          (other) => !ancestorOf(other, key) && !ancestorOf(key, other),
        )
      )
        throw new Error("实例映射仅可在嵌套祖先之间重叠");
      owners.set(sceneId, [...prior, key]);
      const node = scene.get(sceneId);
      if (node && node.id !== i.rootId) {
        let parent = node.parentId;
        while (parent && parent !== i.rootId)
          parent = scene.get(parent)?.parentId;
        if (parent !== i.rootId) throw new Error("实例子节点已移出根节点");
      }
    }
    if (i.baseline.some((n) => !Object.hasOwn(i.nodeMap, n.id)))
      throw new Error("实例基线映射缺失");
  }
  for (const n of nodes) {
    const mapped = owners.get(n.id) || [];
    if (n.prefab) {
      const i = content.prefabInstances[n.prefab.instanceId];
      if (
        !i ||
        i.prefabId !== n.prefab.prefabId ||
        i.nodeMap[n.prefab.nodeId] !== n.id ||
        mapped.some((other) => ancestorOf(i.id, other))
      )
        throw new Error("无效节点预制体关联或最内层所有权");
    } else if (mapped.length) throw new Error("实例节点关联缺失");
  }
  return content;
}

function validateNodeSubtree(
  nodes: SceneNode[],
  scripts: Record<string, string>,
  settings: ProjectSettings,
): SceneNode[] {
  const plain = nodes.map((n) => {
    const copy = { ...n };
    validateComponents(copy);
    delete copy.audioSource;
    if (copy.physics) copy.physics = { ...copy.physics, group: undefined };
    if (copy.character)
      copy.character = { ...copy.character, group: undefined };
    if (copy.animation)
      copy.animation = {
        ...copy.animation,
        controllerId: undefined,
        retarget: undefined,
        rootMotion: undefined,
      };
    delete copy.materialId;
    delete copy.materialSlots;
    delete copy.prefab;
    return copy;
  });
  return validateProject({
    scene: { nodes: plain },
    scripts,
    settings,
  }).nodes.map((n, index) => ({
    ...n,
    ...(nodes[index].physics
      ? { physics: structuredClone(nodes[index].physics) }
      : {}),
    ...(nodes[index].character
      ? { character: structuredClone(nodes[index].character) }
      : {}),
    ...(nodes[index].animation
      ? { animation: structuredClone(nodes[index].animation) }
      : {}),
    ...(nodes[index].audioSource
      ? { audioSource: structuredClone(nodes[index].audioSource) }
      : {}),
    ...(nodes[index].materialId ? { materialId: nodes[index].materialId } : {}),
    ...(nodes[index].materialSlots
      ? { materialSlots: structuredClone(nodes[index].materialSlots) }
      : {}),
  }));
}
