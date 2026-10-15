// Finite sweeps and clipped convex cross-section extrusions through paired apertures.
(function(root){
  'use strict';
  function create(B,o){
    const {S,V,Q,guard,portals,physics,mapping,active,local,transform,contour,inside,fits}=o;
    const tolerance=o.tolerance;
    let limits={maxHops:32,maxProfileVertices:64,...o.limits};
    const center=points=>points.reduce((a,p)=>a.add(p),B.Vector3.Zero()).scale(1/points.length);
    function budget(filter){const n=filter.maxHops??Math.min(8,limits.maxHops);if(!Number.isInteger(n)||n<0||n>limits.maxHops)throw Error('Invalid/exceeded hop budget');return n;}
    function nearest(start,delta,remaining,select){
      let best=null;
      for(const p of portals.values())if(active(p)){
        const a=local(p,start),d=B.Vector3.TransformNormal(delta,B.Matrix.Invert(transform(p)));
        if(a.z < -tolerance || d.z>=0)continue;
        const t=-a.z/d.z;if(t < 0 || t>remaining || (best&&t>=best.t))continue;
        const cross=a.add(d.scale(t)), extra=select(p,cross,t);
        if(extra)best={p,t,cross,...extra};
      }
      return best;
    }
    function shapeState(shape,rotation){
      if(!shape||!['box','sphere','capsule','convex'].includes(shape.kind))throw Error('Unsupported sweep shape');
      if(shape.kind==='convex'){if(!Array.isArray(shape.points)||shape.points.length<4)throw Error('Invalid hull');shape.points.forEach(S.vec);return {shape:'convex',points:shape.points,rotation};}
      if(shape.kind==='box'){S.vec(shape.size);if(['x','y','z'].some(k=>shape.size[k]<=0))throw Error('Invalid box size');return {shape:'box',size:shape.size,convexRadius:Math.min(0.001,shape.size.x/4,shape.size.y/4,shape.size.z/4),rotation};}
      if(!Number.isFinite(shape.radius)||shape.radius<=0 || (shape.kind==='capsule'&&(!Number.isFinite(shape.height)||shape.height<shape.radius*2)))throw Error('Invalid rounded shape');
      return {shape:shape.kind,size:{x:shape.radius*2,y:shape.height||shape.radius*2,z:shape.radius*2},radius:shape.radius,height:shape.height,rotation};
    }
    function shapeCast(owner,shape,origin,direction,filter={}){
      guard(owner);if(filter.all)throw Error('Portal sweeps return the first obstruction only');
      let start=V(origin),delta=V(direction),remaining=delta.length(),rotation=filter.rotation||{x:0,y:0,z:0,w:1};
      Q(rotation);if(!remaining)throw Error('Sweep direction cannot be zero');delta.normalize();
      const range=remaining,segments=[],path=[],max=budget(filter),api=physics.forOwner(owner);let distance=0;
      for(let hop=0;hop<=max;hop++){
        const state=shapeState(shape,rotation),best=nearest(start,delta,remaining,(p,cross)=>inside(p,cross)?{}:null),hit=api.shapeCast(shape,S.plain(start),S.plain(delta.scale(remaining)),{...filter,all:false,rotation});
        let blocked=null,stop=best?.t??remaining;
        if(best){
          const nextRotation=best.p.handle.mapRotation(rotation),exit=B.Vector3.TransformCoordinates(start.add(delta.scale(best.t)),mapping(best.p));
          if(!fits(best.p,state,best.cross))blocked={portalId:best.p.id,reason:'entrance-does-not-fit'};
          else if(!fits(best.p.link,shapeState(shape,nextRotation),local(best.p.link,exit)))blocked={portalId:best.p.id,reason:'exit-does-not-fit'};
          else if(hop===max)blocked={portalId:best.p.id,reason:'hop-limit'};
          if(blocked&&blocked.reason!=='hop-limit')stop=Math.max(0,best.t-o.extent(state,o.normal(best.p))/Math.abs(B.Vector3.Dot(delta,o.normal(best.p))));
        }
        if(hit&&hit.distance<stop-tolerance){segments.push({origin:S.plain(start),end:S.plain(start.add(delta.scale(hit.distance))),rotation});return {hit:{...hit,distance:distance+hit.distance,fraction:(distance+hit.distance)/range},segments,path,truncated:false,blocked:null};}
        const end=start.add(delta.scale(stop));segments.push({origin:S.plain(start),end:S.plain(end),rotation,...(best&&!blocked?{portalId:best.p.id}:{})});
        if(blocked)return {hit:null,segments,path,truncated:blocked.reason==='hop-limit',blocked};
        if(!best)return {hit:hit?{...hit,distance:distance+hit.distance,fraction:(distance+hit.distance)/range}:null,segments,path,truncated:false,blocked:null};
        path.push(best.p.id);const m=mapping(best.p);rotation=best.p.handle.mapRotation(rotation);delta=B.Vector3.TransformNormal(delta,m).normalize();distance+=best.t;remaining-=best.t;
        const advance=Math.min(tolerance,remaining);start=B.Vector3.TransformCoordinates(end,m).add(delta.scale(advance));distance+=advance;remaining-=advance;
        if(remaining<=0)return {hit:null,segments,path,truncated:false,blocked:null};
      }
    }
    function clip(points,p,inset){
      const matrix=transform(p),result=contour(p).map(q=>B.Vector3.TransformCoordinates(q,matrix)),normal=o.normal(p);
      let poly=points;
      for(let i=0;i<result.length&&poly.length;i++){
        const a=result[i],b=result[(i+1)%result.length],n=B.Vector3.Cross(b.subtract(a),normal).normalize(),d=-B.Vector3.Dot(n,a)+inset,out=[];
        for(let j=0;j<poly.length;j++){
          const x=poly[j],y=poly[(j+1)%poly.length],dx=B.Vector3.Dot(n,x)+d,dy=B.Vector3.Dot(n,y)+d;
          if(dx<=0)out.push(x);if((dx<0&&dy>0)||(dx>0&&dy<0))out.push(B.Vector3.Lerp(x,y,dx/(dx-dy)));
        }
        poly=out;
      }
      return poly;
    }
    function geometry(start,end){const positions=[...start,...end].flatMap(p=>[p.x,p.y,p.z]),indices=[],n=start.length;for(let i=1;i<n-1;i++)indices.push(0,i+1,i,n,n+i,n+i+1);for(let i=0;i<n;i++){const j=(i+1)%n;indices.push(i,j,n+i,j,n+j,n+i);}return {positions,indices};}
    function project(owner,options){
      guard(owner);const filter=options.filter||{},max=budget({...filter,maxHops:options.maxHops??filter.maxHops}),direction=V(options.direction),range=direction.length(),profile=options.profile;
      if(!range||!Array.isArray(profile)||profile.length<3||profile.length>limits.maxProfileVertices||!Number.isFinite(options.thickness)||options.thickness<=0)throw Error('Volume needs direction, bounded convex profile and positive query thickness');
      profile.forEach(p=>{if(!p||![p.x,p.y].every(Number.isFinite))throw Error('Invalid profile point');});
      let sign=0;
      for(let i=0;i<profile.length;i++){const a=profile[i],b=profile[(i+1)%profile.length],c=profile[(i+2)%profile.length],cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);if(cross){if(sign&&Math.sign(cross)!==sign)throw Error('Profile must be convex');sign=Math.sign(cross);}}
      if(!sign)throw Error('Profile has zero area');
      for(let i=0;i<profile.length;i++)for(const p of profile){const a=profile[i],b=profile[(i+1)%profile.length],cross=(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);if(cross*sign<0)throw Error('Profile must be a simple convex polygon');}
      const inset=options.inset??tolerance;
      if(!Number.isFinite(inset)||inset<0)throw Error('Invalid aperture inset');
      let delta=direction.normalize(),remaining=range,frame=B.Matrix.Compose(B.Vector3.One(),S.look(B,delta,V(options.up||{x:0,y:1,z:0})),V(options.origin)),cap=profile.map(p=>B.Vector3.TransformCoordinates(new B.Vector3(p.x,p.y,0),frame));
      const segments=[],path=[],api=physics.forOwner(owner);let distance=0,exitHost=null;
      for(let hop=0;hop<=max;hop++){
        const start=center(cap),best=nearest(start,delta,remaining,(p,_cross,t)=>{
          const n=o.normal(p),den=B.Vector3.Dot(delta,n),ends=cap.map(v=>v.add(delta.scale(-B.Vector3.Dot(v.subtract(p.position),n)/den))),clipped=clip(ends,p,inset);
          return clipped.length>=3?{ends,clipped}:null;
        });
        const hull={kind:'convex',points:cap.flatMap(p=>[p.subtract(start).subtract(delta.scale(options.thickness/2)),p.subtract(start).add(delta.scale(options.thickness/2))]).map(S.plain)},
          ignore=[...(filter.ignore||[]),...(best?.p.surface?[best.p.surface.entity]:[]),...(exitHost?[exitHost]:[])],hit=api.shapeCast(hull,S.plain(start),S.plain(delta.scale(remaining)),{...filter,ignore,all:false,rotation:{x:0,y:0,z:0,w:1}});
        const obstructed=hit&&(!best||hit.distance<best.t-tolerance),length=obstructed?hit.distance:best?.t??remaining,
          end=best&&!obstructed?best.ends:cap.map(p=>p.add(delta.scale(length)));
        segments.push({origin:S.plain(start),end:S.plain(center(end)),direction:S.plain(delta),start:cap.map(S.plain),finish:end.map(S.plain),geometry:geometry(cap,end),...(best&&!obstructed?{portalId:best.p.id}:{})});
        if(obstructed||!best)return {hit:hit?{...hit,distance:distance+hit.distance,fraction:(distance+hit.distance)/range}:null,segments,path,truncated:false};
        if(hop===max)return {hit:null,segments,path,truncated:true};
        const m=mapping(best.p);path.push(best.p.id);exitHost=best.p.link.surface?.entity||null;delta=B.Vector3.TransformNormal(delta,m).normalize();remaining-=best.t;distance+=best.t;
        const advance=Math.min(tolerance,remaining);cap=best.clipped.map(p=>B.Vector3.TransformCoordinates(p,m).add(delta.scale(advance)));remaining-=advance;distance+=advance;
        if(remaining<=0)return {hit:null,segments,path,truncated:false};
      }
    }
    return {shapeCast,project,setLimits(patch){const next={...limits,...patch};if(Object.keys(patch).some(k=>!Object.hasOwn(limits,k))||!Number.isInteger(next.maxHops)||next.maxHops<0||!Number.isInteger(next.maxProfileVertices)||next.maxProfileVertices<3)throw Error('Invalid projection budgets');limits=next;}};
  }
  root.ArkGlidePortalProjection={create};
})(globalThis);
