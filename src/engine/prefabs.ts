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
    if (["transform", "rotation", "scale", "materialSlots"].includes(key)) {
      for (const axis of key === "materialSlots"
        ? new Set([...Object.keys(a || {}), ...Object.keys(b || {})])
        : ["x", "y", "z"])
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
      n[key] = ["transform", "rotation", "scale", "materialSlots"].includes(key)
        ? { ...n[key], ...value }
        : value;
    if (n.materialSlots)
      for (const key of Object.keys(n.materialSlots))
        if (n.materialSlots[key] === undefined) delete n.materialSlots[key];
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
      const original =
        n.prefab &&
        Object.values(copied).find(
          (c) =>
            c.prefabId === n.prefab!.prefabId &&
            c.nodeMap[n.prefab!.nodeId] === n.id,
        );
      if (original && n.prefab)
        n.prefab = { ...n.prefab, instanceId: original.id };
      else delete n.prefab;
      return n;
    }),
    instances: inferInstanceParents(nodes, copied),
  };
}

/** Closest containing instance owns the nested root; maps may overlap only along this ancestry. */
export function inferInstanceParents(
  nodes: SceneNode[],
  instances: Record<string, PrefabInstance>,
) {
  const result = clone(instances);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots = new Map(Object.values(result).map((i) => [i.rootId, i.id]));
  for (const i of Object.values(result)) {
    delete i.parentInstanceId;
    let parent = byId.get(i.rootId)?.parentId;
    while (parent) {
      const enclosing = roots.get(parent);
      if (enclosing) {
        i.parentInstanceId = enclosing;
        break;
      }
      parent = byId.get(parent)?.parentId;
    }
  }
  return result;
}
export function assertPrefabGraph(prefabs: Record<string, PrefabAsset>) {
  const done = new Set<string>(),
    visiting = new Set<string>();
  function visit(id: string, depth = 0) {
    if (depth > 64) throw new Error("预制体嵌套超过 64 层");
    if (visiting.has(id)) throw new Error("预制体嵌套依赖包含循环");
    if (done.has(id)) return;
    const p = prefabs[id];
    if (!p) throw new Error("嵌套预制体不存在");
    visiting.add(id);
    for (const i of Object.values(p.nestedInstances || {}))
      visit(i.prefabId, depth + 1);
    visiting.delete(id);
    done.add(id);
  }
  Object.keys(prefabs).forEach((id) => visit(id));
}
/** Capture direct nested mounts using enclosing-template local IDs, retaining child baselines. */
export function captureNestedPrefab(
  nodes: SceneNode[],
  rootId: string,
  id: string,
  name: string,
  instances: Record<string, PrefabInstance>,
  previous?: PrefabInstance,
): PrefabAsset {
  const p = capturePrefab(nodes, rootId, id, name, previous);
  const selected = subtree(nodes, rootId);
  const ids = new Map(selected.map((n, index) => [n.id, p.nodes[index].id]));
  const inferred = inferInstanceParents(nodes, instances);
  const nested = Object.values(inferred).filter(
    (i) => i.rootId !== rootId && ids.has(i.rootId),
  );
  const nestedIds = new Set(nested.map((i) => i.id));
  p.nestedInstances = {};
  for (const child of nested.filter(
    (i) => !i.parentInstanceId || !nestedIds.has(i.parentInstanceId),
  )) {
    const key = ids.get(child.rootId)!;
    p.nestedInstances[key] = {
      ...clone(child),
      id: key,
      rootId: key,
      parentInstanceId: undefined,
      mountId: undefined,
      nodeMap: Object.fromEntries(
        Object.entries(child.nodeMap).map(([local, scene]) => [
          local,
          ids.get(scene) || crypto.randomUUID(),
        ]),
      ),
    };
  }
  return p;
}
/** Restore deepest ownership and nested records after enclosing instances merge. */
export function linkNestedInstances(
  nodes: SceneNode[],
  instances: Record<string, PrefabInstance>,
  prefabs: Record<string, PrefabAsset>,
) {
  const existing = inferInstanceParents(nodes, instances),
    result: Record<string, PrefabInstance> = {};
  const ids = new Set(nodes.map((n) => n.id));
  const owned = new Map<string, SceneNode["prefab"]>();
  const used = new Set<string>();
  function link(i: PrefabInstance, depth = 0) {
    if (depth > 64) throw new Error("预制体嵌套超过 64 层");
    if (!ids.has(i.rootId) || used.has(i.id)) return;
    used.add(i.id);
    result[i.id] = i;
    for (const [local, scene] of Object.entries(i.nodeMap))
      if (ids.has(scene))
        owned.set(scene, {
          prefabId: i.prefabId,
          instanceId: i.id,
          nodeId: local,
        });
    const p = prefabs[i.prefabId];
    for (const [mount, definition] of Object.entries(
      p?.nestedInstances || {},
    )) {
      if (i.unpackedMounts?.includes(mount)) continue;
      const rootId = i.nodeMap[definition.rootId];
      if (!rootId || !ids.has(rootId)) continue;
      const old = Object.values(existing).find(
        (child) =>
          child.rootId === rootId && child.prefabId === definition.prefabId,
      );
      const child: PrefabInstance = {
        ...clone(definition),
        id: old?.id || crypto.randomUUID(),
        rootId,
        parentInstanceId: i.id,
        mountId: mount,
        unpackedMounts: old?.unpackedMounts,
        nodeMap: Object.fromEntries(
          Object.entries(definition.nodeMap).map(([local, outer]) => [
            local,
            i.nodeMap[outer] || old?.nodeMap[local] || crypto.randomUUID(),
          ]),
        ),
      };
      link(child, depth + 1);
    }
    // Scene-only linked children have not yet been applied to the enclosing template.
    for (const child of Object.values(existing))
      if (
        child.parentInstanceId === i.id &&
        !used.has(child.id) &&
        !Object.values(i.nodeMap).includes(child.rootId)
      )
        link(child, depth + 1);
  }
  for (const i of Object.values(existing)) if (!i.parentInstanceId) link(i);
  // Unpacked mounts can retain deeper linked instances as scene-only children.
  for (const i of Object.values(existing))
    if (
      !used.has(i.id) &&
      ids.has(i.rootId) &&
      (!i.parentInstanceId || !existing[i.parentInstanceId])
    )
      link({ ...i, parentInstanceId: undefined });
  return {
    nodes: nodes.map((n) => {
      const copy = { ...n };
      delete copy.prefab;
      if (owned.has(n.id)) copy.prefab = owned.get(n.id);
      return copy;
    }),
    instances: result,
  };
}
/** Propagate a child revision through template snapshots in dependency order. */
export function refreshDependentTemplates(
  prefabs: Record<string, PrefabAsset>,
  changed: string,
  buffers: Map<string, ArrayBuffer>,
) {
  assertPrefabGraph(prefabs);
  const result = clone(prefabs),
    affected = new Set([changed]),
    done = new Set<string>();
  function refresh(id: string) {
    if (done.has(id)) return;
    done.add(id);
    const p = result[id];
    for (const nested of Object.values(p.nestedInstances || {}))
      refresh(nested.prefabId);
    if (id === changed) return;
    let updated = false;
    for (const [key, nested] of Object.entries(p.nestedInstances || {})) {
      if (!affected.has(nested.prefabId)) continue;
      const next = applyPrefab(result[nested.prefabId], nested, p.nodes);
      p.nodes = next.nodes.map((n) => {
        const copy = { ...n };
        delete copy.prefab;
        return copy;
      });
      p.nestedInstances![key] = next.instance;
      for (const [local, source] of next.modelCopies) {
        const destination = "prefab:" + p.id + ":" + local,
          b = buffers.get(source);
        if (b) buffers.set(destination, b.slice(0));
        else buffers.delete(destination);
      }
      updated = true;
    }
    if (updated) {
      p.modelKeys = Object.fromEntries(
        p.nodes
          .filter((n) => n.type === "model")
          .map((n) => [n.id, "prefab:" + id + ":" + n.id]),
      );
      p.revision++;
      affected.add(id);
    }
  }
  Object.keys(result).forEach(refresh);
  return { prefabs: result, affected };
}
