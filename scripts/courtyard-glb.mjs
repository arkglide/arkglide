// Minimal uncompressed glTF 2 writer for already-authored static geometries.
// No geometry decoder, renderer-specific attribute or external URI is required.
export function geometryGLB(parts, label, copyright) {
  const chunks = [], g = { asset: { version: '2.0', generator: 'ArkGlide courtyard asset preparation' },
    scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [] };
  let size = 0;
  if(copyright) g.asset.copyright = copyright;
  function attribute(array, itemSize, type, position = false) {
    const data = Buffer.from(array.buffer, array.byteOffset, array.byteLength), index = g.bufferViews.length;
    g.bufferViews.push({ buffer: 0, byteOffset: size, byteLength: data.byteLength });
    chunks.push(data, Buffer.alloc((-data.byteLength) & 3)); size += data.byteLength + ((-data.byteLength) & 3);
    const a = { bufferView: index, componentType: array instanceof Float32Array ? 5126 : array instanceof Uint32Array ? 5125 : 5123,
      count: array.length / itemSize, type };
    if (position) {
      a.min = [Infinity, Infinity, Infinity]; a.max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < array.length; i++) { const k = i % 3; a.min[k] = Math.min(a.min[k], array[i]); a.max[k] = Math.max(a.max[k], array[i]); }
    }
    g.accessors.push(a); return g.accessors.length - 1;
  }
  for (const [name, geo] of parts) {
    if (!geo?.attributes.position?.count) continue;
    const attrs = { POSITION: attribute(new Float32Array(geo.attributes.position.array), 3, 'VEC3', true),
      NORMAL: attribute(new Float32Array(geo.attributes.normal.array), 3, 'VEC3'),
      TEXCOORD_0: attribute(new Float32Array(geo.attributes.uv.array), 2, 'VEC2') };
    const p = { attributes: attrs };
    if (geo.index) p.indices = attribute(new Uint32Array(geo.index.array), 1, 'SCALAR');
    const id = g.meshes.length; g.scenes[0].nodes.push(id); g.nodes.push({ name, mesh: id }); g.meshes.push({ name, primitives: [p] });
  }
  g.buffers = [{ byteLength: size }]; g.scenes[0].name = label;
  let json = Buffer.from(JSON.stringify(g)); json = Buffer.concat([json, Buffer.alloc((-json.length) & 3, 32)]);
  const bin = Buffer.concat(chunks), header = Buffer.alloc(12), jhead = Buffer.alloc(8), bhead = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + bin.length, 8);
  jhead.writeUInt32LE(json.length); jhead.writeUInt32LE(0x4e4f534a, 4); bhead.writeUInt32LE(bin.length); bhead.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jhead, json, bhead, bin]);
}
