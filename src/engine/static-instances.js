// Opt-in native instance groups. Node identity and transforms stay on each member.
(function(root){
  'use strict';
  function create(B,scene){
    const supported=!!scene.getEngine().getCaps().instancedArrays&&!!B.InstancedMesh;
    const groups=new Map();let definitions=new Map(),materials={},probes=[],requested=new Set();
    function configure(nodes,content,rendering){
      definitions=new Map(nodes.map(n=>[n.id,n]));materials=content?.materials||{};probes=rendering?.probes||[];
      requested=new Set(nodes.filter(n=>n.optimization?.instancing===true).map(n=>n.id));
    }
    function key(node,primitive){
      if(!supported||node.type!=='mesh'||node.optimization?.instancing!==true||node.optimization.shareGeometry===false||node.optimization.lod?.enabled||node.bakedLighting||node.planarReflection?.enabled||Object.keys(node.materialSlots||{}).length)return null;
      const material=materials[node.materialId];
      if(!material||material.alpha<1||material.alphaMode==='blend'||material.transmission?.enabled||material.lightmapTextureId||material.bakedDirectLighting)return null;
      const seen=new Set();
      for(let n=node;n;n=definitions.get(n.parentId)){
        if(seen.has(n.id)||n.animation||n.character||n.scripts?.length||n.physics&&n.physics.motion!=='static'||['x','y','z'].some(a=>(n.scale?.[a]??1)<=0))return null;
        seen.add(n.id);
      }
      // Probe availability changes while a live cube warms up. Only batch
      // primitives completely outside every probe, where all members retain
      // the environment material. Overlapping nodes keep independent bindings.
      if(probes.length){
        let world=B.Matrix.Identity();
        for(let n=node;n;n=definitions.get(n.parentId)){
          const p=n.transform||{},r=n.rotation||{},s=n.scale||{};
          world=world.multiply(B.Matrix.Compose(new B.Vector3(s.x??1,s.y??1,s.z??1),B.Quaternion.RotationYawPitchRoll(r.y||0,r.x||0,r.z||0),new B.Vector3(p.x||0,p.y||0,p.z||0)));
        }
        const center=B.Vector3.TransformCoordinates(B.Vector3.Zero(),world);
        // Unit primitives fit a radius-two sphere (including Babylon's torus
        // and capsule defaults). Frobenius norm bounds scale under parent shear.
        const m=world.m,radius=2*Math.hypot(m[0],m[1],m[2],m[4],m[5],m[6],m[8],m[9],m[10]);
        if(probes.some(p=>['x','y','z'].every(a=>Math.abs(center[a]-p.position[a])<=p.size[a]/2+radius)))return null;
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
    function clear(){for(const group of [...groups.values()])group.source.dispose(false,false);groups.clear();definitions.clear();materials={};probes=[];requested.clear();}
    return {configure,key,make,clear,stats};
  }
  root.ArkGlideStaticInstances={create};
})(globalThis);
