// Plain-value math API; all Embind allocations stay private and are released.
(function (root) {
  'use strict';
  function createMathAPI(module) {
    const backend = module ? 'wasm' : 'javascript';
    const readV = value => {
      if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) throw new TypeError('Expected a finite Vec3');
      return value;
    };
    const readQ = value => {
      if (!value || ![value.x, value.y, value.z, value.w].every(Number.isFinite)) throw new TypeError('Expected a finite Quaternion');
      return value;
    };
    const readM = value => {
      if (!value || value.length !== 16 || !Array.from(value).every(Number.isFinite)) throw new TypeError('Expected 16 finite matrix values');
      return value;
    };
    const plainV = v => ({ x: v.x, y: v.y, z: v.z });
    const plainQ = q => ({ x: q.x, y: q.y, z: q.z, w: q.w });
    const plainM = m => Array.from({ length: 16 }, (_, i) => m.get(i));
    function scoped(callback) {
      const owned = [];
      const own = value => { owned.push(value); return value; };
      try { return callback(own); } finally { for (let i = owned.length - 1; i >= 0; i--) owned[i].delete(); }
    }
    const v = value => { readV(value); return new module.Vector3(value.x, value.y, value.z); };
    const q = value => { readQ(value); return new module.Quaternion(value.x, value.y, value.z, value.w); };
    const m = value => { readM(value); const result = new module.Matrix4(); value.forEach((n, i) => result.set(i, n)); return result; };
    const jsAdd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
    function vecBinary(name, a, b, scalarResult = false, parameter) {
      readV(a); readV(b);
      if (module) return scoped(own => {
        const left = own(v(a)), right = own(v(b));
        const result = parameter === undefined ? left[name](right) : left[name](right, parameter);
        return scalarResult ? result : plainV(own(result));
      });
      if (name === 'add') return jsAdd(a, b);
      if (name === 'sub') return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
      if (name === 'dot') return a.x*b.x + a.y*b.y + a.z*b.z;
      if (name === 'cross') return { x: a.y*b.z-a.z*b.y, y: a.z*b.x-a.x*b.z, z: a.x*b.y-a.y*b.x };
      if (name === 'distance') return Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
      return { x: a.x+(b.x-a.x)*parameter, y: a.y+(b.y-a.y)*parameter, z: a.z+(b.z-a.z)*parameter };
    }
    const vec3 = {
      add: (a,b) => vecBinary('add',a,b), sub: (a,b) => vecBinary('sub',a,b),
      dot: (a,b) => vecBinary('dot',a,b,true), cross: (a,b) => vecBinary('cross',a,b),
      distance: (a,b) => vecBinary('distance',a,b,true),
      lerp(a,b,t) { if (!Number.isFinite(t)) throw new TypeError('Expected finite t'); return vecBinary('lerp',a,b,false,t); },
      length(a) { readV(a); return module ? scoped(own => own(v(a)).length()) : Math.hypot(a.x,a.y,a.z); },
      scale(a,s) {
        readV(a); if (!Number.isFinite(s)) throw new TypeError('Expected finite scale');
        return module ? scoped(own => plainV(own(own(v(a)).scale(s)))) : { x:a.x*s,y:a.y*s,z:a.z*s };
      },
      normalize(a) {
        readV(a);
        if (module) return scoped(own => plainV(own(own(v(a)).normalize())));
        const n=Math.hypot(a.x,a.y,a.z); return n ? vec3.scale(a,1/n) : {x:0,y:0,z:0};
      },
    };
    const identity = () => [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
    const mat4 = {
      identity() { return module ? scoped(own => plainM(own(new module.Matrix4()))) : identity(); },
      multiply(a,b) {
        readM(a);readM(b);
        if (module) return scoped(own => plainM(own(own(m(a)).multiply(own(m(b))))));
        const r=new Array(16).fill(0);
        for(let c=0;c<4;c++) for(let row=0;row<4;row++) for(let k=0;k<4;k++) r[c*4+row]+=a[k*4+row]*b[c*4+k];
        return r;
      },
      translation(p) { readV(p);if(module) return scoped(own=>plainM(own(module.Matrix4.translate(p.x,p.y,p.z))));const r=identity();r[12]=p.x;r[13]=p.y;r[14]=p.z;return r; },
      scaling(s) { readV(s);if(module) return scoped(own=>plainM(own(module.Matrix4.scale(s.x,s.y,s.z))));const r=identity();r[0]=s.x;r[5]=s.y;r[10]=s.z;return r; },
      rotation(angle,axis) {
        readV(axis); if(!Number.isFinite(angle)) throw new TypeError('Expected finite angle');
        if(module) return scoped(own=>plainM(own(module.Matrix4.rotate(angle,axis.x,axis.y,axis.z))));
        const {x,y,z}=vec3.normalize(axis);if(!(x||y||z))return identity();const c=Math.cos(angle),s=Math.sin(angle),t=1-c;
        return [t*x*x+c,t*x*y+s*z,t*x*z-s*y,0,t*x*y-s*z,t*y*y+c,t*y*z+s*x,0,t*x*z+s*y,t*y*z-s*x,t*z*z+c,0,0,0,0,1];
      },
      // Babylon-compatible yaw(Y), pitch(X), roll(Z), column-major matrices.
      compose(p,r,s) {
        readV(p);readV(r);readV(s);
        const y=mat4.rotation(r.y,{x:0,y:1,z:0}),x=mat4.rotation(r.x,{x:1,y:0,z:0}),z=mat4.rotation(r.z,{x:0,y:0,z:1});
        return mat4.multiply(mat4.translation(p),mat4.multiply(mat4.multiply(mat4.multiply(y,x),z),mat4.scaling(s)));
      },
      transformPoint(matrix,point) {
        readM(matrix);readV(point);
        // Use WASM dot products as well as matrix operations at the API boundary.
        const row = i => ({x:matrix[i],y:matrix[i+4],z:matrix[i+8]});
        const w=vec3.dot(row(3),point)+matrix[15];
        return { x:(vec3.dot(row(0),point)+matrix[12])/w, y:(vec3.dot(row(1),point)+matrix[13])/w, z:(vec3.dot(row(2),point)+matrix[14])/w };
      },
    };
    const quat = {
      normalize(a) {
        readQ(a);if(module)return scoped(own=>plainQ(own(own(q(a)).normalize())));
        const n=Math.hypot(a.x,a.y,a.z,a.w);return n ? {x:a.x/n,y:a.y/n,z:a.z/n,w:a.w/n} : {x:0,y:0,z:0,w:1};
      },
      // The C++ constructor uses XYZ Euler composition; scene compose uses YXZ above.
      fromEuler(r) {
        readV(r);if(module)return scoped(own=>plainQ(own(module.Quaternion.fromEuler(r.x,r.y,r.z))));
        const cx=Math.cos(r.x/2),sx=Math.sin(r.x/2),cy=Math.cos(r.y/2),sy=Math.sin(r.y/2),cz=Math.cos(r.z/2),sz=Math.sin(r.z/2);
        return {x:sx*cy*cz-cx*sy*sz,y:cx*sy*cz+sx*cy*sz,z:cx*cy*sz-sx*sy*cz,w:cx*cy*cz+sx*sy*sz};
      },
      slerp(a,b,t) {
        if(!Number.isFinite(t))throw new TypeError('Expected finite t');
        a=quat.normalize(a);b=quat.normalize(b);
        let dot=a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w;
        if(dot<0){b={x:-b.x,y:-b.y,z:-b.z,w:-b.w};dot=-dot;}
        // Stable, t-dependent near-angle interpolation and shortest-path correction.
        if(dot>0.9995) return quat.normalize({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t,w:a.w+(b.w-a.w)*t});
        if(module)return scoped(own=>plainQ(own(own(q(a)).slerp(own(q(b)),t))));
        const angle=Math.acos(Math.min(1,dot)),den=Math.sin(angle),u=Math.sin((1-t)*angle)/den,v=Math.sin(t*angle)/den;
        return {x:a.x*u+b.x*v,y:a.y*u+b.y*v,z:a.z*u+b.z*v,w:a.w*u+b.w*v};
      },
      toMatrix(a) {
        a=quat.normalize(a);if(module)return scoped(own=>plainM(own(own(q(a)).toMatrix())));
        const {x,y,z,w}=a;
        return [1-2*(y*y+z*z),2*(x*y+w*z),2*(x*z-w*y),0,2*(x*y-w*z),1-2*(x*x+z*z),2*(y*z+w*x),0,2*(x*z+w*y),2*(y*z-w*x),1-2*(x*x+y*y),0,0,0,0,1];
      },
    };
    return { backend, vec3, mat4, quat };
  }
  root.ArkGlideMath = { createMathAPI };
})(globalThis);
