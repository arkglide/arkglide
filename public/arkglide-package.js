// Streaming package session. Fetch/decode are supplied by the host, not editor state.
(function (root) {
  "use strict";
  function create(o) {
    let dead = false,
      boot = null,
      content = null,
      project = null;
    const indexCache = new Map(),
      rawData = new Map(),
      moduleRecords = new Map(),
      modules = new Map(),
      factories = new Map(),
      urls = new Map(),
      liveGroups = new Set(),
      resourceRefs = new Map();
    const modelData = Object.create(null),
      textureData = Object.create(null),
      audioData = Object.create(null),
      prefabLoads = new Map(),
      prefabDescriptors = new Map(),
      prefabRefs = new Map();
    const abort = () =>
      Object.assign(Error("Package session canceled"), { name: "AbortError" });
    function guard() {
      if (dead) throw abort();
    }
    async function read(d, binary = true) {
      guard();
      o.log?.("读取 " + d.path);
      const raw = await o.read(d);
      guard();
      if (raw.byteLength !== d.byteLength)
        throw Error("文件大小不一致: " + d.path);
      if (o.decode) return o.decode(raw, d.hash, binary);
      if (root.ArkGlideBinary.hash(raw) !== d.hash)
        throw Error("文件校验失败: " + d.path);
      return binary
        ? root.ArkGlideBinary.decode(raw, {
            maxBytes: boot?.limits.maxChunkBytes,
          })
        : raw;
    }
    async function lookup(key) {
      guard();
      let low = 0,
        high = boot.indexes.length - 1,
        part = null;
      while (low <= high) {
        const mid = (low + high) >>> 1,
          p = boot.indexes[mid];
        if (key < p.first) high = mid - 1;
        else if (key > p.last) low = mid + 1;
        else {
          part = p;
          break;
        }
      }
      if (!part) throw Error("包内资源不存在: " + key);
      let pending = indexCache.get(part.path);
      if (!pending) {
        pending = read(part);
        indexCache.set(part.path, pending);
        if (indexCache.size > (boot.limits.maxIndexChunks || 16))
          indexCache.delete(indexCache.keys().next().value);
        pending.catch(() => {
          if (indexCache.get(part.path) === pending)
            indexCache.delete(part.path);
        });
      }
      const values = await pending;
      guard();
      if (!Object.hasOwn(values, key)) throw Error("包内资源不存在: " + key);
      return values[key];
    }
    function moduleRecord(id) {
      let p = moduleRecords.get(id);
      if (!p) {
        p = lookup("script:" + id).then((d) => read(d));
        moduleRecords.set(id, p);
        p.catch(() => {
          if (moduleRecords.get(id) === p) moduleRecords.delete(id);
        });
      }
      return p;
    }
    async function moduleURL(id, chain = []) {
      guard();
      if (chain.includes(id)) throw Error("Compiled module cycle");
      if (modules.has(id)) return modules.get(id);
      const task = (async () => {
        const d = await moduleRecord(id);
        let code = d.code;
        const replacements = [];
        for (const ref of d.refs)
          replacements.push([
            ref.start,
            ref.end,
            JSON.stringify(await moduleURL(ref.id, [...chain, id])),
          ]);
        for (const [a, b, value] of replacements.sort((a, b) => b[0] - a[0]))
          code = code.slice(0, a) + value + code.slice(b);
        guard();
        const url = (
          o.createURL ||
          ((code) =>
            URL.createObjectURL(new Blob([code], { type: "text/javascript" })))
        )(code);
        urls.set(id, url);
        return url;
      })();
      modules.set(id, task);
      task.catch(() => {
        if (modules.get(id) === task) modules.delete(id);
      });
      return task;
    }
    const importModule =
      o.importModule || ((url) => import(/* @vite-ignore */ url));
    async function importPrepared(id) {
      return importModule(await moduleURL(id));
    }
    async function prepareScripts(nodes) {
      for (const id of new Set(nodes.flatMap((n) => n.scripts || []))) {
        if (factories.has(id)) continue;
        const d = await moduleRecord(id),
          namespace = await importPrepared(id);
        guard();
        if (typeof namespace.default !== "function")
          throw Error("挂载的脚本缺少工厂: " + id);
        factories.set(id, { factory: namespace.default, module: d.module });
        project.scripts[id] = "";
      }
    }
    const moduleLoader = {
      prepare: async () => {},
      get: (id) => {
        guard();
        return factories.get(id) || null;
      },
      locate: () => null,
      dispose: () => {},
      stats: () => ({ modules: modules.size, factories: factories.size }),
    };
    function refs(nodes) {
      const result = new Set();
      for (const n of nodes) {
        if (n.materialId) result.add("materials:" + n.materialId);
        for (const id of Object.values(n.materialSlots || {}))
          if (id) result.add("materials:" + id);
        if (n.audioSource?.assetId)
          result.add("audio:" + n.audioSource.assetId);
        if (n.animation?.controllerId)
          result.add("animationControllers:" + n.animation.controllerId);
        if (n.animation?.retarget?.profileId)
          result.add("retargetProfiles:" + n.animation.retarget.profileId);
      }
      return result;
    }
    function remove(key, d) {
      if (d && ["model", "texture", "audio"].includes(d.kind)) {
        const cached = rawData.get(d.hash);
        if (cached && --cached.refs === 0) rawData.delete(d.hash);
      }
      const [kind, ...rest] = key.split(":"),
        id = rest.join(":");
      if (kind === "model") delete modelData[id];
      else if (kind === "texture") {
        delete textureData[id];
        content.textures = content.textures.filter((a) => a.id !== id);
      } else if (kind === "audio") {
        delete audioData[id];
        content.audio = content.audio.filter((a) => a.id !== id);
        o.onAudioUnload?.(id);
      } else if (content[kind]) delete content[kind][id];
    }
    async function group(nodes, modelKeys = {}, extras = []) {
      const keys = refs(nodes);
      for (const key of extras) keys.add(key);
      for (const n of nodes)
        if (n.type === "model") keys.add("model:" + (modelKeys[n.id] || n.id));
      const held = new Set(),
        group = {
          release() {
            if (!liveGroups.delete(group)) return;
            for (const key of held) {
              const slot = resourceRefs.get(key);
              if (slot && --slot.refs === 0) {
                resourceRefs.delete(key);
                remove(key, slot.descriptor);
              }
            }
            o.onRelease?.();
          },
        };
      liveGroups.add(group);
      async function acquire(key) {
        guard();
        if (!liveGroups.has(group)) throw abort();
        if (held.has(key)) return;
        held.add(key);
        let slot = resourceRefs.get(key);
        if (!slot) {
          slot = { refs: 0, descriptor: null, promise: null };
          resourceRefs.set(key, slot);
          slot.promise = (async () => {
            const d = await lookup(key);
            guard();
            if (resourceRefs.get(key) !== slot || slot.refs === 0)
              throw abort();
            slot.descriptor = d;
            let value;
            if (["model", "texture", "audio"].includes(d.kind)) {
              let cached = rawData.get(d.hash);
              if (!cached) {
                cached = { refs: 0, promise: read(d, false) };
                rawData.set(d.hash, cached);
              }
              cached.refs++;
              value = await cached.promise;
            } else value = await read(d);
            guard();
            if (resourceRefs.get(key) !== slot || slot.refs === 0)
              throw abort();
            const [kind, ...parts] = key.split(":"),
              id = parts.join(":");
            if (kind === "model")
              modelData[id] =
                value.byteOffset === 0 &&
                value.byteLength === value.buffer.byteLength
                  ? value.buffer
                  : value.slice().buffer;
            else if (kind === "texture") {
              textureData[id] =
                value.byteOffset === 0 &&
                value.byteLength === value.buffer.byteLength
                  ? value.buffer
                  : value.slice().buffer;
              content.textures.push(d.definition);
            } else if (kind === "audio") {
              audioData[id] =
                value.byteOffset === 0 &&
                value.byteLength === value.buffer.byteLength
                  ? value.buffer
                  : value.slice().buffer;
              content.audio.push(d.definition);
              await o.onAudioLoad?.(d.definition, audioData[id]);
            } else {
              content[kind] ??= {};
              content[kind][id] = value;
            }
            return d;
          })();
        }
        slot.refs++;
        const d = await slot.promise;
        guard();
        if (!liveGroups.has(group)) throw abort();
        if (d.kind === "materials")
          for (const field of [
            "albedoTextureId",
            "normalTextureId",
            "metallicRoughnessTextureId",
            "aoTextureId",
            "lightmapTextureId",
            "emissiveTextureId",
            "clearCoatTextureId",
            "clearCoatNormalTextureId",
            "sheenTextureId",
            "anisotropyTextureId",
            "thicknessTextureId",
            "transmissionTextureId",
            "detailTextureId",
          ]) {
            const id = content.materials[d.id]?.[field];
            if (id) await acquire("texture:" + id);
          }
      }
      try {
        const queue = [...keys];
        await Promise.all(
          Array.from(
            { length: Math.min(boot.limits.concurrency, queue.length) },
            async () => {
              while (queue.length) await acquire(queue.shift());
            },
          ),
        );
        await prepareScripts(nodes);
        guard();
        return group;
      } catch (error) {
        group.release();
        throw error;
      }
    }
    async function preparePrefab(id) {
      guard();
      let p = prefabLoads.get(id);
      if (!p) {
        p = (async () => {
          const definition = await read(await lookup("prefab:" + id)),
            nodes = [];
          for (const part of definition.chunks)
            nodes.push(...(await read(part)));
          guard();
          return { ...definition, nodes };
        })();
        prefabLoads.set(id, p);
        p.catch(() => {
          if (prefabLoads.get(id) === p) prefabLoads.delete(id);
        });
      }
      const definition = await p,
        lease = await group(definition.nodes, definition.modelKeys);
      guard();
      const current = prefabDescriptors.get(id);
      prefabRefs.set(id, (prefabRefs.get(id) || 0) + 1);
      content.prefabs[id] = definition;
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          lease.release();
          const remaining = prefabRefs.get(id) - 1;
          if (remaining > 0) prefabRefs.set(id, remaining);
          else {
            prefabRefs.delete(id);
            content.prefabs[id] = { ...current, nodes: [] };
            prefabLoads.delete(id);
          }
        },
      };
    }
    async function initialize(descriptor) {
      boot = await read(descriptor);
      guard();
      for (const p of boot.prefabs) prefabDescriptors.set(p.id, p);
      content = {
        ...boot.globals,
        materials: {},
        textures: [],
        audio: [],
        animationControllers: {},
        retargetProfiles: {},
        prefabInstances: {},
        prefabs: Object.fromEntries(
          boot.prefabs.map((p) => [p.id, { ...p, nodes: [] }]),
        ),
      };
      project = {
        version: "0.6",
        projectId: boot.projectId,
        name: boot.name,
        settings: boot.settings,
        scene: { nodes: [] },
        content,
        scripts: {},
        activeFileId: "main.js",
      };
      for (const part of boot.scene) {
        const nodes = await read(part);
        project.scene.nodes.push(...nodes);
        o.log?.("场景块 " + nodes.length + " 个实体");
      }
      const hudKeys = [];
      if (boot.settings.rendering?.environment?.textureId)
        hudKeys.push("texture:" + boot.settings.rendering.environment.textureId);
      for (const p of boot.settings.rendering?.probes || []) hudKeys.push("texture:" + p.textureId);
      for (const h of content.gameplay?.hud || [])
        if (h.textureId) hudKeys.push("texture:" + h.textureId);
      await group(project.scene.nodes, {}, [
        ...boot.preload.filter((key) => !key.startsWith("prefab:")),
        ...hudKeys,
      ]);
      for (const key of boot.preload.filter((key) => key.startsWith("prefab:")))
        await preparePrefab(key.slice(7));
      guard();
      return {
        project,
        modelData,
        textureData,
        audioData,
        moduleLoader,
        batchNodes: boot.limits.batchNodes,
      };
    }
    return {
      initialize,
      preparePrefab,
      moduleLoader,
      async load(kind, id) {
        if (kind === "prefab") return this.preparePrefab(id);
        const lease = await group([], {}, [kind + ":" + id]);
        try {
          guard();
          await o.onResourcesChanged?.();
          return lease;
        } catch (error) {
          lease.release();
          throw error;
        }
      },
      importModule: importPrepared,
      stats: () => ({
        packageResources: resourceRefs.size,
        packageGroups: liveGroups.size,
        packageIndexes: indexCache.size,
        packageModules: modules.size,
      }),
      dispose() {
        if (dead) return;
        dead = true;
        for (const lease of [...liveGroups]) lease.release();
        for (const url of urls.values())
          (o.revokeURL || URL.revokeObjectURL)(url);
        urls.clear();
        modules.clear();
        moduleRecords.clear();
        factories.clear();
        indexCache.clear();
        rawData.clear();
        prefabLoads.clear();
        prefabDescriptors.clear();
        prefabRefs.clear();
        for (const map of [modelData, textureData, audioData])
          for (const key of Object.keys(map)) delete map[key];
      },
    };
  }
  root.ArkGlidePackage = { create };
})(globalThis);
