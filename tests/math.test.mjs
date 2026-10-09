import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '@babylonjs/core';
import factory from '../src/wasm/arkglide_math.js';
import '../public/arkglide-math.js';
const module=await factory();
const wasm=globalThis.ArkGlideMath.createMathAPI(module),js=globalThis.ArkGlideMath.createMathAPI(null);
function close(actual,expected,epsilon=1e-5){
 const a=Array.isArray(actual) ? actual : Object.values(actual),b=Array.isArray(expected)?expected:Object.values(expected);
 assert.equal(a.length,b.length);a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<epsilon,`${i}: ${v} != ${b[i]}`));
}
test('WASM Vector3 API matches JS including zero vectors and interpolation',()=>{
 const a={x:1,y:-2,z:3},b={x:-4,y:5,z:6};
 for(const op of ['add','sub','cross'])close(wasm.vec3[op](a,b),js.vec3[op](a,b));
 for(const op of ['dot','distance'])assert.ok(Math.abs(wasm.vec3[op](a,b)-js.vec3[op](a,b))<1e-5);
 close(wasm.vec3.lerp(a,b,0.2),js.vec3.lerp(a,b,0.2));
 close(wasm.vec3.normalize({x:0,y:0,z:0}),{x:0,y:0,z:0});
 assert.throws(()=>wasm.vec3.add(a,{x:NaN,y:0,z:0}),TypeError);
});
test('WASM Matrix4 scene compose matches Babylon YXZ transforms and hierarchy',()=>{
 const p={x:5,y:7,z:9},r={x:0.3,y:-0.7,z:0.5},s={x:2,y:3,z:4};
 const expected=B.Matrix.Compose(new B.Vector3(s.x,s.y,s.z),B.Quaternion.FromEulerAngles(r.x,r.y,r.z),new B.Vector3(p.x,p.y,p.z));
 const local=wasm.mat4.compose(p,r,s);close(local,Array.from(expected.m));
 const parent=wasm.mat4.translation({x:10,y:0,z:0});
 close(wasm.mat4.multiply(parent,local),js.mat4.multiply(parent,local));
 close(wasm.mat4.transformPoint(local,{x:1,y:2,z:3}),B.Vector3.TransformCoordinates(new B.Vector3(1,2,3),expected).asArray());
});
test('WASM quaternion facade uses shortest path and keeps slerp endpoints',()=>{
 const a={x:0,y:0,z:0,w:1},b=js.quat.fromEuler({x:0,y:0.2,z:0});
 const negative={x:-b.x,y:-b.y,z:-b.z,w:-b.w};
 close(wasm.quat.slerp(a,negative,0.5),js.quat.slerp(a,b,0.5));
 close(wasm.quat.slerp(a,b,0),a);close(wasm.quat.slerp(a,b,1),b);
 const near=js.quat.fromEuler({x:0,y:0.00001,z:0});
 close(wasm.quat.slerp(a,near,0.25),js.quat.slerp(a,near,0.25));
 close(wasm.quat.toMatrix(b),js.quat.toMatrix(b));
});
