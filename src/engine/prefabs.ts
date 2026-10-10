import type { SceneNode } from "../store/useEditorStore";
import type { PrefabAsset, PrefabInstance } from "../types/content";
const clone = <T>(value: T): T => structuredClone(value);
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function subtree(nodes: SceneNode[], rootId: string): SceneNode[] {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes)
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        changed = true;
      }
  }
  return nodes.filter((n) => ids.has(n.id));
}
export function capturePrefab(
  nodes: SceneNode[],
  rootId: string,
  id: string,
  name: string,
  previous?: PrefabInstance,
): PrefabAsset {
  const selected = subtree(nodes, rootId);
  if (!selected.length) throw new Error("请选择预制体根节点");
  const reverse = new Map(
    Object.entries(previous?.nodeMap || {}).map(([local, scene]) => [
      scene,
      local,
    ]),
  );
  const ids = new Map(
    selected.map((n) => [n.id, reverse.get(n.id) || crypto.randomUUID()]),
  );
  const normalized = selected.map((node) => {
    const n = clone(node);
    delete n.prefab;
    n.id = ids.get(node.id)!;
    n.parentId = ids.get(node.parentId || "") || null;
    if (node.id === rootId) n.transform = { x: 0, y: 0, z: 0 };
    return n;
  });
  return {
    id,
    name,
    revision: 1,
    rootId: ids.get(rootId)!,
    nodes: normalized,
    modelKeys: Object.fromEntries(
      normalized
        .filter((n) => n.type === "model")
        .map((n) => [n.id, "prefab:" + id + ":" + n.id]),
    ),
  };
}
export function createInstance(
  prefab: PrefabAsset,
  nodes: SceneNode[],
  position?: SceneNode["transform"],
  reuse?: SceneNode[],
): { nodes: SceneNode[]; instance: PrefabInstance } {
  const id = crypto.randomUUID(),
    nodeMap: Record<string, string> = Object.fromEntries(
      prefab.nodes.map((n, i) => [n.id, reuse?.[i]?.id || crypto.randomUUID()]),
    );
  const copies = prefab.nodes.map((n, i) => ({
    ...clone(n),
    id: nodeMap[n.id],
    parentId: nodeMap[n.parentId || ""] || reuse?.[i]?.parentId || null,
    transform:
      n.id === prefab.rootId
        ? { ...(position || reuse?.[i]?.transform || n.transform) }
        : { ...n.transform },
    prefab: { prefabId: prefab.id, instanceId: id, nodeId: n.id },
  }));
  return {
    nodes: copies,
    instance: {
      id,
      prefabId: prefab.id,
      rootId: nodeMap[prefab.rootId],
      nodeMap,
      baseline: clone(prefab.nodes),
      revision: prefab.revision,
    },
  };
}
function localNode(node: SceneNode, instance: PrefabInstance): SceneNode {
  const reverse = new Map(
    Object.entries(instance.nodeMap).map(([local, scene]) => [scene, local]),
  );
  const n = clone(node);
  delete n.prefab;
  n.id = reverse.get(node.id)!;
  n.parentId =
    reverse.get(node.parentId || "") ||
    (node.parentId ? "external:" + node.parentId : null);
  if (node.id === instance.rootId) {
    n.parentId = null;
    n.transform = { x: 0, y: 0, z: 0 };
  }
  return n;
}
function overrides(current: SceneNode, base: SceneNode): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(current)])) {
    if (["id", "prefab"].includes(key)) continue;
    const a = (current as any)[key],
      b = (base as any)[key];
    if (["transform", "rotation", "scale"].includes(key)) {
      for (const axis of ["x", "y", "z"])
        if (!equal(a?.[axis], b?.[axis]))
          (result[key] ??= {})[axis] = a?.[axis];
    } else if (!equal(a, b)) result[key] = clone(a);
  }
  return result;
}
export function instanceOverrides(
  instance: PrefabInstance,
  nodes: SceneNode[],
): { changed: number; removed: number; added: number } {
  let changed = 0,
    removed = 0;
  for (const base of instance.baseline) {
    const node = nodes.find((n) => n.id === instance.nodeMap[base.id]);
    if (!node) removed++;
    else if (Object.keys(overrides(localNode(node, instance), base)).length)
      changed++;
  }
  const mapped = new Set(Object.values(instance.nodeMap));
  return {
    changed,
    removed,
    added: subtree(nodes, instance.rootId).filter((n) => !mapped.has(n.id))
      .length,
  };
}
/** Three-way update: merge changed fields/axes against the last applied template. */
export function applyPrefab(
  prefab: PrefabAsset,
  instance: PrefabInstance,
  nodes: SceneNode[],
  reset = false,
): {
  nodes: SceneNode[];
  instance: PrefabInstance;
  modelCopies: [string, string][];
} {
  const base = new Map(instance.baseline.map((n) => [n.id, n])),
    existing = new Map(nodes.map((n) => [n.id, n]));
  const root = existing.get(instance.rootId);
  if (!root) throw new Error("预制体实例根节点不存在");
  const removed = new Set(
    instance.baseline
      .filter((n) => !existing.has(instance.nodeMap[n.id]))
      .map((n) => n.id),
  );
  const nextIds = new Set(prefab.nodes.map((n) => n.id));
  const map = { ...instance.nodeMap };
  for (const n of prefab.nodes) map[n.id] ??= crypto.randomUUID();
  const result: SceneNode[] = [],
    modelCopies: [string, string][] = [];
  for (const definition of prefab.nodes) {
    if (!reset) {
      let p: SceneNode | undefined = definition;
      const seen = new Set<string>();
      while (p) {
        if (removed.has(p.id)) break;
        if (seen.has(p.id)) throw new Error("预制体层级循环");
        seen.add(p.id);
        p = prefab.nodes.find((n) => n.id === p?.parentId);
      }
      if (p) continue;
    }
    const current = existing.get(instance.nodeMap[definition.id]),
      old = base.get(definition.id);
    const patch =
      !reset && current && old
        ? overrides(localNode(current, instance), old)
        : {};
    const n: any = clone(definition);
    for (const [key, value] of Object.entries(patch))
      n[key] = ["transform", "rotation", "scale"].includes(key)
        ? { ...n[key], ...value }
        : value;
    n.id = map[definition.id];
    n.parentId = n.parentId?.startsWith("external:")
      ? n.parentId.slice(9)
      : map[n.parentId] || null;
    if (definition.id === prefab.rootId) {
      n.transform = { ...root.transform };
      n.parentId = root.parentId || null;
    }
    n.prefab = {
      prefabId: prefab.id,
      instanceId: instance.id,
      nodeId: definition.id,
    };
    result.push(n);
    if (
      n.type === "model" &&
      (!current ||
        reset ||
        !equal(n.modelUrl, current.modelUrl) ||
        !equal(n.modelRevision, current.modelRevision))
    )
      modelCopies.push([n.id, prefab.modelKeys[definition.id]]);
  }
  const inherited = new Set(Object.values(instance.nodeMap)),
    present = new Set(result.map((n) => n.id));
  const others = nodes
    .filter((n) => !inherited.has(n.id))
    .map((n) =>
      inherited.has(n.parentId || "") && !present.has(n.parentId!)
        ? { ...n, parentId: root.id }
        : n,
    );
  for (const id of Object.keys(map)) if (!nextIds.has(id)) delete map[id];
  return {
    nodes: [...others, ...result],
    instance: {
      ...instance,
      nodeMap: map,
      baseline: clone(prefab.nodes),
      revision: prefab.revision,
    },
    modelCopies,
  };
}
export function cloneInstanceLinks(
  nodes: SceneNode[],
  instances: Record<string, PrefabInstance>,
  idMap: Map<string, string>,
): { nodes: SceneNode[]; instances: Record<string, PrefabInstance> } {
  const copied: Record<string, PrefabInstance> = {};
  for (const instance of Object.values(instances))
    if (idMap.has(instance.rootId)) {
      const id = crypto.randomUUID(),
        nodeMap = Object.fromEntries(
          Object.entries(instance.nodeMap).map(([local, scene]) => [
            local,
            idMap.get(scene) || crypto.randomUUID(),
          ]),
        );
      copied[id] = {
        ...clone(instance),
        id,
        rootId: idMap.get(instance.rootId)!,
        nodeMap,
      };
    }
  return {
    nodes: nodes.map((node) => {
      const n = clone(node),
        i = Object.values(copied).find((i) =>
          Object.values(i.nodeMap).includes(n.id),
        );
      if (i && n.prefab) n.prefab = { ...n.prefab, instanceId: i.id };
      else delete n.prefab;
      return n;
    }),
    instances: copied,
  };
}
