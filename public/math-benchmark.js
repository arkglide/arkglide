(function(root) {
  function runMathBenchmark(wasm, javascript, iterations = 2000) {
    const a={x:1,y:2,z:3},b={x:4,y:5,z:6},r={x:0.2,y:0.3,z:0.4},s={x:2,y:3,z:4};
    const matrix=javascript.mat4.compose(a,r,s);
    const qa=javascript.quat.fromEuler(r),qb=javascript.quat.fromEuler({x:0.6,y:-0.2,z:1});
    const cases=[
      ['Vector3.add', api=>api.vec3.add(a,b).x],
      ['Vector3.normalize', api=>api.vec3.normalize(a).x],
      ['Matrix4.multiply', api=>api.mat4.multiply(matrix,matrix)[0]],
      ['Matrix4.compose', api=>api.mat4.compose(a,r,s)[0]],
      ['Quaternion.slerp', api=>api.quat.slerp(qa,qb,0.35).x],
    ];
    let checksum=0;
    function measure(api,fn) {
      for(let i=0;i<Math.min(iterations,500);i++) checksum+=fn(api);
      const samples=[];
      for(let round=0;round<5;round++) {
        const start=performance.now();
        for(let i=0;i<iterations;i++)checksum+=fn(api);
        samples.push(performance.now()-start);
      }
      return samples.sort((a,b)=>a-b)[2];
    }
    const results=cases.map(([operation,fn])=>{
      const jsMs=measure(javascript,fn),wasmMs=measure(wasm,fn);
      return {operation,iterations,jsMs,wasmMs,wasmOverJs:wasmMs/jsMs};
    });
    return {results,checksum,method:'5 rounds; median; warmup; includes validation, JS/WASM crossings, allocations, copies and disposal'};
  }
  root.ArkGlideBenchmark={runMathBenchmark};
})(globalThis);
