// Runtime template factory. Templates are flattened snapshots with retained editor nesting metadata.
(function (root) {
  "use strict";
  function createPrefabAPI(options) {
    const pending = new Set(),
      liveBuffers = new Map();
    function abortError() {
      const error = new Error(
        "预制体生成已取消：运行停止、父节点或所属脚本已销毁",
      );
      error.name = "AbortError";
      return error;
    }
    function descriptor(p) {
      return {
        id: p.id,
        name: p.name,
        revision: p.revision,
        nodeCount: p.nodes.length,
      };
    }
    function vector(v, fallback) {
      if (v === undefined) return { ...fallback };
      if (!v || ![v.x, v.y, v.z].every(Number.isFinite))
        throw new TypeError("预制体变换必须是有限 Vec3 数值");
      return { x: v.x, y: v.y, z: v.z };
    }
    async function instantiate(id, settings = {}, owner) {
      if (
        !options.isRunning() ||
        (owner &&
          (!owner.record.active ||
            owner.record.destroying ||
            owner.record.entity?.destroyed))
      )
        throw abortError();
      const content = options.getContent(),
        prefab = content.prefabs?.[id];
      if (!prefab) throw new Error("预制体不存在: " + id);
      if (!settings || typeof settings !== "object")
        throw new TypeError("预制体生成参数必须是对象");
      const scene = options.sceneAPI,
        parent = settings.parent;
      if (parent && (parent.destroyed || scene.find(parent.id) !== parent))
        throw new Error("父实体不存在或已销毁");
      const source = prefab.nodes.find((n) => n.id === prefab.rootId);
      const position = vector(settings.position, source.transform),
        rotation = vector(settings.rotation, source.rotation),
        scale = vector(settings.scale, source.scale);
      const generation = options.getGeneration(),
        nodeMap = Object.create(null);
      for (const n of prefab.nodes) {
        let next;
        do {
          next = "prefab_" + crypto.randomUUID();
        } while (scene.find(next));
        nodeMap[n.id] = next;
      }
      const buffers = options.getBuffers();
      // Validate all model dependencies before creating any entity.
      for (const n of prefab.nodes)
        if (n.type === "model" && !buffers[prefab.modelKeys[n.id]])
          throw new Error("预制体模型资源缺失: " + n.name);
      const nodes = prefab.nodes.map((n) => {
        const copy = structuredClone(n);
        delete copy.prefab;
        copy.id = nodeMap[n.id];
        copy.parentId = nodeMap[n.parentId] || null;
        if (n.id === prefab.rootId) {
          copy.transform = position;
          copy.rotation = rotation;
          copy.scale = scale;
          copy.parentId = parent?.id || null;
        }
        return copy;
      });
      const token = {
        live: true,
        cancel: null,
        ids: nodes.map((n) => n.id),
        parentId: parent?.id,
      };
      let succeeded = false;
      let rejectCancel;
      const canceled = new Promise((_, reject) => {
        rejectCancel = reject;
      });
      const destroy = () => {
        for (const n of [...nodes].reverse()) scene.destroy(n.id);
      };
      token.cancel = () => {
        if (!token.live) return;
        token.live = false;
        destroy();
        rejectCancel(abortError());
      };
      pending.add(token);
      const untrack = owner?.track(token.cancel);
      for (const n of prefab.nodes)
        if (n.type === "model")
          buffers[nodeMap[n.id]] = buffers[prefab.modelKeys[n.id]].slice(0);
      try {
        await Promise.race([
          Promise.resolve().then(() => {
            if (!token.live) throw abortError();
            return options
              .getAdapter()
              .add(nodes, buffers, content, options.getTextureBuffers());
          }),
          canceled,
        ]);
        if (
          !token.live ||
          generation !== options.getGeneration() ||
          !options.isRunning() ||
          (parent && parent.destroyed)
        )
          throw abortError();
        const rootEntity = scene.find(nodeMap[prefab.rootId]);
        if (!rootEntity || nodes.some((n) => !scene.find(n.id)))
          throw abortError();
        options.attachScripts(nodes);
        if (
          !token.live ||
          generation !== options.getGeneration() ||
          rootEntity.destroyed
        )
          throw abortError();
        succeeded = true;
        for (const n of nodes)
          if (n.type === "model") liveBuffers.set(n.id, buffers);
        const entities = Object.freeze(
          nodes.map((n) => scene.find(n.id)).filter(Boolean),
        );
        return Object.freeze({
          root: rootEntity,
          entities,
          find: (localId) => scene.find(nodeMap[localId]) || null,
          findByName: (name) =>
            entities.find((e) => !e.destroyed && e.name === name) || null,
          destroy: () => rootEntity.destroy(),
        });
      } catch (error) {
        token.live = false;
        destroy();
        throw error;
      } finally {
        token.live = false;
        pending.delete(token);
        untrack?.();
        if (!succeeded) for (const n of nodes) delete buffers[n.id];
      }
    }
    const api = Object.freeze({
      list: () =>
        Object.values(options.getContent().prefabs || {}).map(descriptor),
      findByName: (name) => {
        const p = Object.values(options.getContent().prefabs || {}).find(
          (p) => p.name === name,
        );
        return p ? descriptor(p) : null;
      },
      instantiate: (id, settings) => instantiate(id, settings),
    });
    return {
      api,
      forOwner: (owner) =>
        Object.freeze({
          ...api,
          instantiate: (id, settings) => instantiate(id, settings, owner),
        }),
      onEntityDestroyed(id) {
        for (const token of [...pending])
          if (token.parentId === id || token.ids.includes(id)) token.cancel();
        const buffers = liveBuffers.get(id);
        if (buffers) {
          delete buffers[id];
          liveBuffers.delete(id);
        }
      },
      stop() {
        for (const token of [...pending]) token.cancel();
        for (const [id, buffers] of liveBuffers) delete buffers[id];
        liveBuffers.clear();
      },
      get pendingCount() {
        return pending.size;
      },
    };
  }
  root.ArkGlidePrefabs = { createPrefabAPI };
})(globalThis);
