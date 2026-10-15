// Local-space planar coating patches. Tags/properties are game-defined, not gel enums.
(function (root) {
  'use strict';
  function create(B, o) {
    const S = root.ArkGlideSpatial, patches = new Map();
    let dead = false, serial = 0, limit = o.maxPatches ?? 4096;
    const guard = owner => { if (dead || (owner && (!owner.record.active || owner.record.destroying))) throw Error('Surface service expired'); };
    const object = e => { const m = e && !e.destroyed && o.find(e.id) === e && o.getObject(e.id); if (!m) throw Error('Surface entity absent'); return m; };
    const V = p => { S.vec(p); return new B.Vector3(p.x,p.y,p.z); };
    function validate(config) {
      if (!config || !['rectangle','ellipse'].includes(config.shape || 'ellipse')) throw Error('Invalid surface patch shape');
      for (const k of ['width','height','depth']) if (!Number.isFinite(config[k]) || config[k] <= 0) throw Error('Surface patch needs positive ' + k);
      if (!Array.isArray(config.tags) || config.tags.some(t => typeof t !== 'string' || !t)) throw Error('Invalid surface tags');
      if (!Number.isFinite(config.priority ?? 0)) throw Error('Invalid surface priority');
      const properties = root.ArkGlideState.clone(config.properties || {});
      if (Array.isArray(properties) || properties === null || typeof properties !== 'object') throw Error('Surface properties must be a JSON object');
      return { shape: 'ellipse', priority: 0, ...config, tags: [...config.tags], properties };
    }
    function paint(owner, entity, config) {
      guard(owner); const mesh = object(entity), settings = validate(config), id = config.id || 'surface:patch:' + ++serial;
      if (patches.size >= limit || patches.has(id)) throw Error('Surface patch budget/duplicate ID');
      const position = V(config.position), normal = V(config.normal);
      if (!normal.lengthSquared()) throw Error('Surface normal cannot be zero');
      const rotation = S.look(B,normal.normalize(),V(config.up || {x:0,y:1,z:0})),
        local = B.Matrix.Compose(B.Vector3.One(),rotation,position).multiply(B.Matrix.Invert(mesh.computeWorldMatrix(true)));
      let live = true, off, decal;
      function destroy() { if (!live) return; live = false; patches.delete(id); decal?.destroy(); off?.(); }
      function check() { guard(owner); if (!live || entity.destroyed) throw Error('Surface patch destroyed'); }
      const p = { id, entity, local, settings, sequence: serial++, destroy, owner };
      patches.set(id,p); off = owner.track(destroy); mesh.onDisposeObservable?.addOnce(destroy);
      const handle = Object.freeze({ id, entity, get active() { return live && !entity.destroyed; },
        update(patch) {
          check(); if (Object.keys(patch).some(k => !['tags','properties','priority'].includes(k))) throw Error('Only patch tags/properties/priority can be updated');
          p.settings = validate({...p.settings,...patch});
        }, destroy });
      p.handle = handle;
      try { if (settings.material) decal = o.visuals.forOwner(owner).createDecal(entity,{ position: S.plain(position), normal: S.plain(normal), size:{x:settings.width,y:settings.height,z:settings.depth}, material:settings.material }); }
      catch (error) { destroy(); throw error; }
      return handle;
    }
    function contains(p, point) {
      const world = p.local.multiply(object(p.entity).computeWorldMatrix(true)), inverse = B.Matrix.Invert(world), v = B.Vector3.TransformCoordinates(V(point),inverse), c = p.settings;
      if (Math.abs(v.z) > c.depth / 2) return false;
      return c.shape === 'rectangle' ? Math.abs(v.x) <= c.width/2 && Math.abs(v.y) <= c.height/2 : (v.x/(c.width/2))**2+(v.y/(c.height/2))**2 <= 1;
    }
    function candidates(e) { object(e); return [...patches.values()].filter(p => p.entity === e && !e.destroyed).sort((a,b)=>b.settings.priority-a.settings.priority || b.sequence-a.sequence); }
    function descriptor(p) { return { id:p.id, entity:p.entity, tags:[...p.settings.tags], properties:root.ArkGlideState.clone(p.settings.properties), priority:p.settings.priority }; }
    const api = owner => Object.freeze({
      paint:(e,c)=>paint(owner,e,c),
      get(id) { guard(owner); return patches.get(id)?.handle || null; },
      query(e, point) { guard(owner); V(point); return candidates(e).filter(p=>contains(p,point)).map(descriptor); },
      covers(e, points, tag) { guard(owner); if (!Array.isArray(points) || points.length<3) throw Error('Footprint needs at least three points'); points.forEach(V); return candidates(e).some(p => (!tag || p.settings.tags.includes(tag)) && points.every(point=>contains(p,point))); },
      clear(e) { guard(owner); for (const p of candidates(e)) p.destroy(); },
      setLimit(value) { guard(owner); if (!Number.isInteger(value) || value<patches.size || value<1) throw Error('Invalid patch budget'); limit=value; },
    });
    return { forOwner(owner) { guard(owner); return api(owner); }, stats:()=>({surfacePatches:patches.size}), dispose() { if(dead)return; for(const p of [...patches.values()])p.destroy(); dead=true; } };
  }
  root.ArkGlideSurfaces={create};
})(globalThis);
