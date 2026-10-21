// Shared scene construction for the editor and the opaque-origin runtime.
(function (root) {
  "use strict";
  function primitiveOf(node) {
    return (
      node.primitive ||
      (/sphere/i.test(node.name || "") || node.id === "sphere"
        ? "sphere"
        : "box")
    );
  }
  function createMaterialLibrary(B, scene, options) {
    const materials = new Map(),
      slots = new Map(),
      originals = new WeakMap(),
      wrappers = new Map();
    const warnedUVs = new WeakMap();
    let content = {},
      buffers = new Map();
    function release(slot) {
      slot.texture?.dispose();
      slot.finish?.();
      if (slot.url) URL.revokeObjectURL(slot.url);
    }
    function texture(materialId, role, definition, textureId) {
      const key = materialId + ":" + role,
        asset = (content.textures || []).find((t) => t.id === textureId),
        buffer =
          buffers instanceof Map ? buffers.get(textureId) : buffers[textureId];
      let old = slots.get(key);
      let ktx2=null;
      if(asset&&buffer&&asset.mime==='image/ktx2'){
        if(!root.ArkGlideKTX2)throw Error('KTX2 运行库未加载');
        ktx2=root.ArkGlideKTX2.inspect(buffer);root.ArkGlideKTX2.assertRole(ktx2,role);
        const limit=scene.getEngine().getCaps().maxTextureSize||8192;
        if(ktx2.width>limit||ktx2.height>limit)throw Error('KTX2 尺寸超过当前设备纹理上限：'+limit);
      }
      if (old && (old.id !== textureId || old.buffer !== buffer || old.mime !== asset?.mime)) {
        release(old);
        slots.delete(key);
        old = null;
      }
      if (!asset || !buffer) {
        if (old) {
          release(old);
          slots.delete(key);
        }
        return null;
      }
      if (!old) {
        const url = URL.createObjectURL(
          new Blob([buffer], { type: asset.mime }),
        );
        let resolve,
          finished = false;
        const promise = new Promise((r) => (resolve = r)),
          finish = () => {
            if (finished) return;
            finished = true;
            options.onLoading?.(-1);
            resolve();
          };
        options.onLoading?.(1);
        const item = {
          materialId,
          mime:asset.mime,
          ktx2,
          id: textureId,
          buffer,
          promise,
          finish,
          url,
          texture: null,
        };
        slots.set(key, item);
        try {
          item.texture = new B.Texture(
            url,
            scene,
            false,
            true,
            B.Texture.TRILINEAR_SAMPLINGMODE,
            () => {if(!finished&&slots.get(key)===item&&item.texture&&ktx2){root.ArkGlideKTX2.applyTexture(B,item.texture,ktx2,role);root.ArkGlideKTX2.applyMaterial(B,materials.get(materialId));}finish();},
            (message, error) => {
              if (slots.get(key) === item)
                options.onError?.(
                  { id: textureId, name: asset.name, type: "texture" },
                  error || new Error(message || "贴图解码失败"),
                );
              finish();
            },
            undefined,
            false,
            undefined,
            asset.mime,
            ktx2?{forceRGBA:!!((ktx2.width&(ktx2.width-1))||(ktx2.height&(ktx2.height-1)))}:undefined,
            undefined,
            ktx2?'.ktx2':undefined,
          );
        } catch (error) {
          if (slots.get(key) === item) slots.delete(key);
          release(item);
          throw error;
        }
        item.texture.name = "arkglide:texture:" + key;
        if(ktx2)root.ArkGlideKTX2.applyTexture(B,item.texture,ktx2,role);
        else item.texture.gammaSpace = role === "albedo" || role === "emissive" || role === "sheen";
        old = item;
      }
      old.texture.uScale = definition.uvScale.u;
      old.texture.vScale = definition.uvScale.v;
      old.texture.uOffset = definition.uvOffset?.u ?? 0; old.texture.vOffset = definition.uvOffset?.v ?? 0;
      old.texture.wAng = definition.uvRotation ?? 0;
      return old.texture;
    }
    function sync(next = {}, nextBuffers = new Map()) {
      content = next;
      buffers = nextBuffers;
      const definitions = content.materials || {};
      for (const [id, mat] of materials)
        if (!Object.hasOwn(definitions, id)) {
          mat.dispose(false, false);
          materials.delete(id);
          for (const [key, item] of slots)
            if (item.materialId === id) {
              release(item);
              slots.delete(key);
            }
        }
      for (const [id, d] of Object.entries(definitions)) {
        let mat = materials.get(id);
        if (!mat) {
          mat = new B.PBRMaterial("arkglide:material:" + id, scene);
          mat.metadata = { arkglideManagedMaterial: true };
          materials.set(id, mat);
        }
        mat.albedoColor = B.Color3.FromHexString(d.baseColor);
        mat.emissiveColor = B.Color3.FromHexString(d.emissiveColor);
        mat.emissiveIntensity = d.emissiveIntensity ?? 1;
        mat.emissiveTexture = texture(id, "emissive", d, d.emissiveTextureId);
        mat.metallic = d.metallic;
        mat.directIntensity = d.bakedDirectLighting ? 0 : 1;
        root.ArkGlideBakedLighting?.apply(B,mat,!!d.bakedDirectLighting);
        mat.roughness = d.roughness;
        mat.alpha = d.alpha;
        mat.backFaceCulling = !d.doubleSided;
        mat.transparencyMode =
          d.alpha < 1
            ? B.PBRMaterial.PBRMATERIAL_ALPHABLEND
            : B.PBRMaterial.PBRMATERIAL_OPAQUE;
        mat.albedoTexture = texture(id, "albedo", d, d.albedoTextureId);
        mat.bumpTexture = texture(id, "normal", d, d.normalTextureId);
        mat.metallicTexture = texture(
          id,
          "metallicRoughness",
          d,
          d.metallicRoughnessTextureId,
        );
        mat.useRoughnessFromMetallicTextureAlpha = false;
        mat.useRoughnessFromMetallicTextureGreen = true;
        mat.useMetallnessFromMetallicTextureBlue = true;
        mat.ambientTexture = texture(id, "ao", d, d.aoTextureId);
        mat.ambientTextureStrength = d.aoStrength ?? 1;
        mat.useAmbientInGrayScale = true;
        mat.lightmapTexture = texture(id, "lightmap", d, d.lightmapTextureId);
        if (mat.lightmapTexture) {
          mat.lightmapTexture.coordinatesIndex = d.lightmapUV ?? 1;
          mat.lightmapTexture.level = d.lightmapIntensity ?? 1;
          mat.lightmapTexture.uScale = mat.lightmapTexture.vScale = 1;
          mat.lightmapTexture.uOffset = mat.lightmapTexture.vOffset = mat.lightmapTexture.wAng = 0;
        }
        mat.useLightmapAsShadowmap = false;
        const a=root.ArkGlideRenderingConfig?.material(d);
        if(a){
          mat.transparencyMode=a.alphaMode==='auto'?(d.alpha<1?B.PBRMaterial.PBRMATERIAL_ALPHABLEND:B.PBRMaterial.PBRMATERIAL_OPAQUE):{opaque:B.PBRMaterial.PBRMATERIAL_OPAQUE,mask:B.PBRMaterial.PBRMATERIAL_ALPHATEST,blend:B.PBRMaterial.PBRMATERIAL_ALPHABLEND}[a.alphaMode];
          mat.alphaCutOff=a.alphaCutoff;mat.useAlphaFromAlbedoTexture=['mask','blend'].includes(a.alphaMode);
          if(mat.albedoTexture)mat.albedoTexture.hasAlpha=mat.useAlphaFromAlbedoTexture;
          if(mat.bumpTexture){mat.bumpTexture.level=a.normalScale;if(a.normalScale===0)mat.bumpTexture=null;}
          const coat=mat.clearCoat;coat.isEnabled=a.clearCoat.enabled;coat.intensity=a.clearCoat.intensity;coat.roughness=a.clearCoat.roughness;
          coat.texture=texture(id,'coat',d,d.clearCoatTextureId);coat.useRoughnessFromMainTexture=true;
          coat.bumpTexture=texture(id,'coatNormal',d,d.clearCoatNormalTextureId);
          if(coat.bumpTexture){coat.bumpTexture.level=a.clearCoat.normalScale;if(a.clearCoat.normalScale===0)coat.bumpTexture=null;}
          const sheen=mat.sheen;sheen.isEnabled=a.sheen.enabled;sheen.intensity=a.sheen.intensity;sheen.roughness=a.sheen.roughness;
          sheen.color=B.Color3.FromHexString(a.sheen.color);sheen.texture=texture(id,'sheen',d,d.sheenTextureId);sheen.useRoughnessFromMainTexture=true;
          mat.anisotropy.isEnabled=a.anisotropy.enabled;mat.anisotropy.intensity=a.anisotropy.intensity;mat.anisotropy.angle=a.anisotropy.rotation;
          mat.anisotropy.texture=texture(id,'anisotropy',d,d.anisotropyTextureId);
          const sub=mat.subSurface;sub.isRefractionEnabled=a.transmission.enabled;sub.refractionIntensity=a.transmission.intensity;sub.indexOfRefraction=a.transmission.ior;
          sub.linkRefractionWithTransparency=false;sub.useGltfStyleTextures=true;
          sub.thicknessTexture=texture(id,'thickness',d,d.thicknessTextureId);sub.minimumThickness=sub.thicknessTexture?0:a.transmission.thickness;sub.maximumThickness=a.transmission.thickness;
          sub.refractionIntensityTexture=texture(id,'transmission',d,d.transmissionTextureId);sub.tintColor=B.Color3.FromHexString(a.transmission.tintColor);sub.tintColorAtDistance=a.transmission.tintDistance;
          const detail=mat.detailMap;detail.isEnabled=a.detail.enabled;detail.diffuseBlendLevel=a.detail.diffuse;detail.bumpLevel=a.detail.normal;detail.roughnessBlendLevel=a.detail.roughness;
          detail.texture=texture(id,'detail',d,d.detailTextureId);
          if(detail.texture){detail.texture.uScale=d.uvScale.u*a.detail.scale;detail.texture.vScale=d.uvScale.v*a.detail.scale;}
        }
        root.ArkGlideKTX2?.applyMaterial(B,mat);
      }
      return Promise.all([...slots.values()].map((s) => s.promise));
    }
    function restore(mesh) {
      if (mesh.metadata?.arkglideBatchMember) return;
      if (mesh.material?.metadata?.arkglideManagedMaterial)
        mesh.material = originals.get(mesh) || null;
    }
    function apply(node, object) {
      const targets =
        node.type === "mesh"
          ? [object.metadata?.arkglideBatchMember ? object.sourceMesh : object]
          : node.type === "model"
            ? object
                .getChildMeshes(false)
                .filter((mesh) => mesh.metadata?.arkglideId === node.id)
            : [];
      for (const mesh of targets) {
        if (!mesh.material?.metadata?.arkglideManagedMaterial)
          originals.set(mesh, mesh.material || null);
        const original = originals.get(mesh) || null;
        const part = mesh.metadata?.arkglidePartKey;
        const source = original?.subMaterials || [original];
        const resolved = source.map((mat, index) => {
          const key = part + "/slot:" + index;
          const id = Object.hasOwn(node.materialSlots || {}, key)
            ? node.materialSlots[key]
            : node.materialId;
          return id === null ? mat : materials.get(id) || mat;
        });
        for (const mat of resolved) if (mat?.lightmapTexture && mat.lightmapTexture.coordinatesIndex === 1 && !mesh.isVerticesDataPresent(B.VertexBuffer.UV2Kind) && warnedUVs.get(mesh) !== mat.lightmapTexture) {
          warnedUVs.set(mesh, mat.lightmapTexture);
          options.onError?.(node, Error("烘焙光照需要模型 UV2；请导入带 UV2 的模型或选择 UV1"));
        }
        const old = wrappers.get(mesh);
        if (resolved.every((mat, i) => mat === source[i])) {
          mesh.material = original;
          if (old) {
            old.dispose(false, false);
            wrappers.delete(mesh);
          }
        } else if (source.length > 1) {
          let wrapper = old;
          if (!wrapper) {
            wrapper = new B.MultiMaterial(
              "arkglide:slots:" + node.id + ":" + part,
              scene,
            );
            wrapper.metadata = { arkglideManagedMaterial: true };
            wrappers.set(mesh, wrapper);
          }
          wrapper.subMaterials = resolved;
          mesh.material = wrapper;
        } else {
          mesh.material = resolved[0];
          if (old) {
            old.dispose(false, false);
            wrappers.delete(mesh);
          }
        }
      }
    }
    function prepareDestroy(object) {
      if (!object) return;
      restore(object);
      const owner = object.metadata?.arkglideId;
      for (const mesh of [object, ...(object.getChildMeshes?.(false) || [])]) {
        if (mesh !== object && owner && mesh.metadata?.arkglideId !== owner)
          continue;
        restore(mesh);
        const wrapper = wrappers.get(mesh);
        if (wrapper) {
          wrapper.dispose(false, false);
          wrappers.delete(mesh);
        }
      }
    }
    function clear() {
      for (const wrapper of wrappers.values()) wrapper.dispose(false, false);
      wrappers.clear();
      for (const s of slots.values()) release(s);
      slots.clear();
      for (const m of materials.values()) m.dispose(false, false);
      materials.clear();
      content = {};
      buffers = new Map();
    }
    function stats(){
      let textures=0,compressed=0,bytes=0,unknown=false;
      for(const slot of slots.values())if(slot.ktx2){textures++;const t=slot.texture.getInternalTexture?.();if(!t?.isReady){unknown=true;continue;}if(![5,6,7].includes(t.format))compressed++;const n=root.ArkGlideKTX2.storageBytes(t.format,slot.ktx2.width,slot.ktx2.height,slot.ktx2.mipLevels);if(n===null)unknown=true;else bytes+=n;}
      return {ktx2Textures:textures,ktx2CompressedTextures:compressed,ktx2EstimatedGpuBytes:unknown?null:bytes};
    }
    return { sync, apply, prepareDestroy, clear, materials, stats };
  }
  function createSceneAdapter(B, scene, options = {}) {
    root.ArkGlideKTX2?.configure(B);
    const optimization = root.ArkGlideSceneOptimization?.create(B, scene, options), geometryPool = new Map();
    const instances = root.ArkGlideStaticInstances?.create(B,scene);
    const rendering = root.ArkGlideRendering?.create(B, scene, {...options,onPrepareGeometry:()=>optimization?.prepare(),getOptimizationStats:()=>({...optimization?.stats(),...instances?.stats(nodes),...materialLibrary.stats()})});
    const nodes = new Map(),
      records = new Map(),
      resources = new Map(),
      legacyMaterials = new Map(),
      pending = new Map();
    let definitions = [],
      disposed = false;
    const materialLibrary = createMaterialLibrary(B, scene, options);
    function disposeContent(id) {
      materialLibrary.prepareDestroy(nodes.get(id));
      pending.delete(id);
      const resource = resources.get(id);
      resources.delete(id);
      if (resource) resource.dispose();
      if (definitions.find((n) => n.id === id)?.type === "model" ||
          records.get(id)?.definition.type === "model") {
        options.onParts?.(id, []);
        options.onAnimations?.(id, []);
      }
    }
    function decorate(mesh, id) {
      mesh.metadata = { ...(mesh.metadata || {}), arkglideId: id };
    }
    function marker(node, id) {
      if (!options.editor || node.type === "mesh" || node.type === "model")
        return;
      const mesh = B.MeshBuilder.CreateBox(
        id + ":marker",
        { size: 0.2 },
        scene,
      );
      mesh.parent = nodes.get(id);
      decorate(mesh, id);
      mesh.metadata.arkglideRenderInternal = true;
      const mat = new B.StandardMaterial(id + ":marker-material", scene);
      mat.emissiveColor = B.Color3.FromHexString(
        node.type === "light"
          ? "#FFD166"
          : node.type === "camera"
            ? "#69D2E7"
            : "#B6B6B6",
      );
      mat.wireframe = true;
      mesh.material = mat;
    }
    function primitiveMesh(id,primitive,shared) {
        const builders = {
          box: "CreateBox",
          sphere: "CreateSphere",
          plane: "CreateGround",
          cylinder: "CreateCylinder",
          capsule: "CreateCapsule",
          torus: "CreateTorus",
        };
        const cached=geometryPool.get(primitive);let object;
        if(shared&&cached&&!cached.isDisposed()){object=new B.Mesh(id,scene);cached.applyToMesh(object);}
        else {object=B.MeshBuilder[builders[primitive]||'CreateBox'](id,{},scene);if(shared)geometryPool.set(primitive,object.geometry);}
        return object;
    }
    function make(node) {
      let object;
      if (node.type === "mesh") {
        const primitive=primitiveOf(node),factory=()=>primitiveMesh(node.id,primitive,node.optimization?.shareGeometry!==false);
        object=instances?.make(node,primitive,factory)||factory();
      } else object = new B.TransformNode(node.id, scene);
      nodes.set(node.id, object);
      object.onDisposeObservable?.add(() => {
        disposeContent(node.id);
        nodes.delete(node.id);
        records.delete(node.id);
      });
      decorate(object, node.id);
      marker(node, node.id);
      if (node.type === "light") {
        const type = node.lightType || "directional";
        const light =
          type === "point"
            ? new B.PointLight(node.id + ":light", B.Vector3.Zero(), scene)
            : type === "hemispheric"
              ? new B.HemisphericLight(
                  node.id + ":light",
                  B.Vector3.Up(),
                  scene,
                )
              : new B.DirectionalLight(
                  node.id + ":light",
                  new B.Vector3(0, -1, 0),
                  scene,
                );
        light.parent = object;
        resources.set(node.id, light);
      } else if (node.type === "camera") {
        const camera = new B.FreeCamera(
          node.id + ":camera",
          B.Vector3.Zero(),
          scene,
        );
        camera.parent = object;
        resources.set(node.id, camera);
      }
      options.onCreate?.(object, node);
      return object;
    }
    function update(node) {
      const object = nodes.get(node.id);
      object.metadata = { ...object.metadata, arkglideRendering: { castShadows: node.castShadows !== false, receiveShadows: node.receiveShadows !== false, planarReflection: node.planarReflection } };
      const p = node.transform || { x: 0, y: 0, z: 0 },
        r = node.rotation || { x: 0, y: 0, z: 0 },
        s = node.scale || { x: 1, y: 1, z: 1 };
      object.position.set(p.x, p.y, p.z);
      object.rotationQuaternion = null;
      object.rotation.set(r.x, r.y, r.z);
      object.scaling.set(s.x, s.y, s.z);
      object.setEnabled(node.visible !== false);
      if(node.type==='mesh'&&node.bakedLighting?.autoUV2&&!object.metadata.arkglideBakeUV2){root.ArkGlideLightingUV?.generateUV2(B,object,primitiveOf(node));object.metadata.arkglideBakeUV2=true;}
      if (node.type === "mesh" && !node.materialId && node.color) {
        materialLibrary.prepareDestroy(object);
        let mat = object.material;
        if (!mat) {
          object.material = mat = new B.StandardMaterial(
            node.id + ":material",
            scene,
          );
          legacyMaterials.set(node.id,mat);
        }
        mat.diffuseColor = B.Color3.FromHexString(node.color);
      }
      materialLibrary.apply(node, object);
      const resource = resources.get(node.id);
      if (node.type === "light" && resource) {
        resource.intensity = node.intensity ?? 1;
        resource.diffuse = B.Color3.FromHexString(node.color || "#FFFFFF");
        resource.setEnabled(node.visible !== false);
      } else if (node.type === "camera" && resource) {
        resource.fov = ((node.fov ?? 60) * Math.PI) / 180;
      }
    }
    function linkParents() {
      // All nodes exist first, so scene array order does not affect parenting.
      definitions.forEach((node) => {
        const object = nodes.get(node.id);
        object.parent = nodes.get(node.parentId) || null;
      });
    }
    function activeCamera() {
      const node =
        definitions.find(
          (n) => n.type === "camera" && n.activeCamera && n.visible !== false,
        ) ||
        definitions.find(
          (n) =>
            n.type === "camera" &&
            n.activeCamera === undefined &&
            n.visible !== false,
        );
      return node ? resources.get(node.id) : null;
    }
    function modelExtension(node) {
      return /\.gltf$/i.test(node.modelUrl || "") ? ".gltf" : ".glb";
    }
    function kindOf(node){return node.type+':'+(node.type==='mesh'?primitiveOf(node)+':'+(node.optimization?.shareGeometry!==false)+':'+(instances?.key(node,primitiveOf(node))||'mesh'):node.lightType||'');}
    async function loadModel(node, buffer) {
      const token = {},
        object = nodes.get(node.id);
      pending.set(node.id, token);
      options.onLoading?.(1);
      const url = URL.createObjectURL(new Blob([buffer]));
      let container, registered = false;
      try {
        container = await B.SceneLoader.LoadAssetContainerAsync(
          "",
          url,
          scene,
          undefined,
          modelExtension(node),
        );
        if (
          disposed ||
          pending.get(node.id) !== token ||
          object !== nodes.get(node.id)
        ) {
          container.dispose();
          return false;
        }
        container.addAllToScene();
        container.animationGroups?.forEach((g) => g.stop());
        options.onAnimations?.(
          node.id,
          (container.animationGroups || []).map((g) => g.name),
        );
        if (disposed || pending.get(node.id) !== token || object !== nodes.get(node.id)) {
          container.dispose();
          return false;
        }
        const parts = [];
        container.meshes.forEach((mesh, index) => {
          if (!mesh.getTotalVertices?.()) return;
          const key = "mesh:" + index;
          mesh.metadata = { ...(mesh.metadata || {}), arkglidePartKey: key };
          (mesh.material?.subMaterials || [mesh.material]).forEach(
            (mat, slot) => {
              parts.push({
                key: key + "/slot:" + slot,
                name: mesh.name + "（" + (mat?.name || "材质 " + slot) + "）",
              });
            },
          );
        });
        options.onParts?.(node.id, parts);
        if (disposed || pending.get(node.id) !== token || object !== nodes.get(node.id)) {
          container.dispose();
          return false;
        }
        const imported = new Set([
          ...container.meshes,
          ...container.transformNodes,
        ]);
        imported.forEach((mesh) => {
          if (!mesh.parent || !imported.has(mesh.parent)) mesh.parent = object;
          decorate(mesh, node.id);
        });
        resources.set(node.id, container);
        registered = true;
        materialLibrary.apply(
          definitions.find((n) => n.id === node.id) || node,
          object,
        );
        options.onLoaded?.(node.id);
        if (disposed || pending.get(node.id) !== token || object !== nodes.get(node.id))
          return false;
      } catch (error) {
        const ownsContainer = !registered || resources.get(node.id) === container;
        if (resources.get(node.id) === container && container) {
          materialLibrary.prepareDestroy(object);
          resources.delete(node.id);
        }
        if (ownsContainer) container?.dispose();
        if (!disposed && pending.get(node.id) === token) {
          options.onAnimations?.(node.id, []);
          options.onParts?.(node.id, []);
          options.onError?.(node, error);
        }
        return false;
      } finally {
        URL.revokeObjectURL(url);
        if (pending.get(node.id) === token) pending.delete(node.id);
        options.onLoading?.(-1);
      }
    }
    function sync(
      next,
      buffers = new Map(),
      content = {},
      textureBuffers = new Map(),
    ) {
      if (disposed) return Promise.resolve();
      if(root.ArkGlideKTX2?.needsPreparation(content)){
        const generation=batchGeneration;
        return root.ArkGlideKTX2.prepare(B).then(()=>{
          if(disposed||generation!==batchGeneration)throw Error('场景解码资源加载已取消');
          return sync(next,buffers,content,textureBuffers);
        });
      }
      definitions = next;
      instances?.configure(next,content,rendering?.settings());
      const ids = new Set(next.map((n) => n.id));
      // Detach surviving children before deleting/replacing a parent.
      nodes.forEach((object, id) => {
        if (ids.has(id)) object.parent = null;
      });
      nodes.forEach((object, id) => {
        if (!ids.has(id)) {
          disposeContent(id);
          options.onRemove?.(id);
          object.dispose(false, true);
          nodes.delete(id);
          records.delete(id);
        }
      });
      const loads = [materialLibrary.sync(content, textureBuffers), rendering?.sync(content, textureBuffers)];
      next.forEach((node) => {
        const buffer =
          buffers instanceof Map ? buffers.get(node.id) : buffers[node.id];
        const old = records.get(node.id);
        const kind = kindOf(node);
        if (old && old.kind !== kind) {
          disposeContent(node.id);
          options.onRemove?.(node.id);
          nodes.get(node.id).dispose(false, true);
          nodes.delete(node.id);
        }
        if (!nodes.has(node.id)) make(node);
        if (!old || old.definition !== node || old.kind !== kind) update(node);
        else materialLibrary.apply(node, nodes.get(node.id));
        if (
          node.type === "model" &&
          (!old || old.buffer !== buffer || old.url !== node.modelUrl)
        ) {
          disposeContent(node.id);
          if (buffer) loads.push(loadModel(node, buffer));
        }
        records.set(node.id, {
          kind,
          buffer,
          url: node.modelUrl,
          definition: node,
        });
      });
      linkParents();
      rendering?.invalidate();
      return Promise.all(loads).then(async results => { await optimization?.sync(nodes,definitions);rendering?.invalidate(); return results; });
    }
    let batchGeneration=0;
    function clear() {
      optimization?.clear();
      rendering?.clear();
      batchGeneration++;
      definitions = [];
      pending.clear();
      nodes.forEach((object) => {
        object.parent = null;
      });
      [...nodes].forEach(([id, object]) => {
        disposeContent(id);
        options.onRemove?.(id);
        object.dispose(false, true);
      });
      nodes.clear();
      instances?.clear();
      geometryPool.clear();
      records.clear();
      for(const mat of legacyMaterials.values())mat.dispose(false,false);
      legacyMaterials.clear();
      materialLibrary.clear();
    }
    function dispose() {
      disposed = true;
      clear();
      rendering?.dispose();
      optimization?.dispose();
    }
    return {
      rendering,
      optimization,
      instanceStats:()=>instances?.stats(nodes)||{},
      nodes,
      resources,
      sync,
      async refreshMaterials(content,textureBuffers){
        const generation=batchGeneration;
        if(root.ArkGlideKTX2?.needsPreparation(content))await root.ArkGlideKTX2.prepare(B);
        if(disposed||generation!==batchGeneration)return;
        return Promise.all([materialLibrary.sync(content,textureBuffers), rendering?.sync(content,textureBuffers)]);
      },
      async syncBatched(next,buffers,content,textureBuffers,batchNodes=128) {
        clear();
        const generation=batchGeneration;
        if(root.ArkGlideKTX2?.needsPreparation(content))await root.ArkGlideKTX2.prepare(B);
        if(disposed||generation!==batchGeneration)throw Error('场景分块创建已取消');
        const all=next; definitions=all;
        instances?.configure(all,content,rendering?.settings());
        await Promise.all([materialLibrary.sync(content,textureBuffers), rendering?.sync(content,textureBuffers)]);
        for(let offset=0;offset<all.length;offset+=batchNodes){
          if(disposed||generation!==batchGeneration)throw Error('场景分块创建已取消');
          const slice=all.slice(offset,offset+batchNodes);
          // Incrementally append without rescanning the previously constructed prefix.
          const loading=[];
          for(const node of slice){
            const buffer=buffers instanceof Map?buffers.get(node.id):buffers[node.id];
            make(node);update(node);
            if(node.type==='model'&&buffer)loading.push(loadModel(node,buffer));
            records.set(node.id,{kind:kindOf(node),buffer,url:node.modelUrl,definition:node});
          }
          await Promise.all(loading);
          await new Promise(resolve=>setTimeout(resolve,0));
        }
        if(disposed||generation!==batchGeneration)throw Error('场景分块创建已取消');
        linkParents();
        await optimization?.sync(nodes,definitions);
      },
      add(next, buffers, content, textureBuffers) {
        if (disposed) return Promise.reject(new Error("场景已销毁，实体添加已取消"));
        definitions = definitions.filter((n) => nodes.has(n.id));
        const loading = sync(
          [...definitions, ...next],
          buffers,
          content,
          textureBuffers,
        );
        const added = next.map((node) => [node.id, nodes.get(node.id)]);
        return loading.then((results) => {
          if (disposed || added.some(([id, object]) => !object || nodes.get(id) !== object) ||
              results?.some((result) => result === false))
            throw new Error("预制体模型加载失败或已取消");
        });
      },
      clear,
      dispose,
      activeCamera,
      materials: materialLibrary.materials,
      prepareDestroy: (id) => {
        materialLibrary.prepareDestroy(nodes.get(id));
        legacyMaterials.get(id)?.dispose(false,false);
        legacyMaterials.delete(id);
        disposeContent(id);
      },
    };
  }
  root.ArkGlideScene = { createSceneAdapter, primitiveOf };
})(globalThis);
