// Opt-in native instance groups. Node identity and transforms stay on each member.
(function(root){
  'use strict';
  function create(B,scene){
    const supported=!!scene.getEngine().getCaps().instancedArrays&&!!B.InstancedMesh;
    const groups=new Map();let definitions=new Map(),materials={},hasProbes=false,requested=new Set();
    function configure(nodes,content,rendering){
      definitions=new Map(nodes.map(n=>[n.id,n]));materials=content?.materials||{};hasProbes=!!rendering?.probes?.length;
      requested=new Set(nodes.filter(n=>n.optimization?.instancing===true).map(n=>n.id));
    }
    function key(node,primitive){
      if(!supported||hasProbes||node.type!=='mesh'||node.optimization?.instancing!==true||node.optimization.shareGeometry===false||node.optimization.lod?.enabled||node.bakedLighting||node.planarReflection?.enabled||Object.keys(node.materialSlots||{}).length)return null;
      const material=materials[node.materialId];
      if(!material||material.alpha<1||material.alphaMode==='blend'||material.transmission?.enabled||material.lightmapTextureId||material.bakedDirectLighting)return null;
      const seen=new Set();
      for(let n=node;n;n=definitions.get(n.parentId)){
        if(seen.has(n.id)||n.animation||n.character||n.scripts?.length||n.physics&&n.physics.motion!=='static'||['x','y','z'].some(a=>(n.scale?.[a]??1)<=0))return null;
        seen.add(n.id);
      }
      return JSON.stringify([primitive,node.materialId,node.castShadows!==false,node.receiveShadows!==false]);
    }
    function make(node,primitive,makeSource){
      const id=key(node,primitive);if(!id)return null;
      let group=groups.get(id);
      if(!group){
        const source=makeSource();source.name=source.id='arkglide:instance-source:'+id;
        source.isVisible=false;source.isPickable=false;source.receiveShadows=node.receiveShadows!==false;
        source.metadata={arkglideRenderInternal:true,arkglideInstanceSource:true,arkglideRendering:{castShadows:node.castShadows!==false,receiveShadows:node.receiveShadows!==false}};
        group={source,members:new Map(),disposing:false};groups.set(id,group);
        const original=source.dispose.bind(source),slot=group;
        source.dispose=(recurse,material)=>{
          if(slot.disposing||source.isDisposed())return;
          slot.disposing=true;if(groups.get(id)===slot)groups.delete(id);
          // Managed material ownership stays with the material library.
          original(recurse,false);
        };
      }
      const member=new B.InstancedMesh(node.id,group.source),slot=group;
      member.metadata={arkglideBatchMember:true};member.isPickable=true;
      group.members.set(node.id,member);
      const original=member.dispose.bind(member);member.dispose=(recurse,material)=>original(recurse,false);
      member.onDisposeObservable.add(()=>{
        if(slot.members.get(node.id)===member)slot.members.delete(node.id);
        if(!slot.members.size&&!slot.disposing)slot.source.dispose(false,false);
      });
      return member;
    }
    function stats(nodes){
      let count=0,wanted=0;
      for(const group of groups.values())for(const id of group.members.keys()){count++;if(requested.has(id))wanted++;}
      const total=nodes?[...requested].filter(id=>nodes.has(id)).length:requested.size;
      return {instancingSupported:supported,instanceBatches:groups.size,instancedMeshes:count,instanceSkippedMeshes:Math.max(0,total-wanted)};
    }
    function clear(){for(const group of [...groups.values()])group.source.dispose(false,false);groups.clear();definitions.clear();materials={};hasProbes=false;requested.clear();}
    return {configure,key,make,clear,stats};
  }
  root.ArkGlideStaticInstances={create};
})(globalThis);
