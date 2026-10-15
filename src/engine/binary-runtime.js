// Versioned, dictionary-encoded binary records shared by the builder and player.
(function (root) {
  "use strict";
  const encoder = new TextEncoder(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  function encode(value) {
    const strings = [],
      ids = new Map();
    function intern(s) {
      if (!ids.has(s)) {
        ids.set(s, strings.length);
        strings.push(encoder.encode(s));
      }
      return ids.get(s);
    }
    function scan(v, depth = 0) {
      if (depth > 128) throw Error("Binary nesting limit");
      if (typeof v === "string") intern(v);
      else if (Array.isArray(v)) v.forEach((x) => scan(x, depth + 1));
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v))
          if (x !== undefined) {
            intern(k);
            scan(x, depth + 1);
          }
    }
    scan(value);
    let out = new Uint8Array(1024),
      offset = 0;
    function room(n) {
      if (offset + n > out.length) {
        const next = new Uint8Array(Math.max(out.length * 2, offset + n));
        next.set(out);
        out = next;
      }
    }
    function byte(n) {
      room(1);
      out[offset++] = n;
    }
    function uint(n) {
      do {
        const b = n % 128;
        n = Math.floor(n / 128);
        byte(b | (n ? 128 : 0));
      } while (n);
    }
    function raw(bytes) {
      room(bytes.length);
      out.set(bytes, offset);
      offset += bytes.length;
    }
    raw(new Uint8Array([65, 71, 66, 2]));
    uint(strings.length);
    for (const s of strings) {
      uint(s.length);
      raw(s);
    }
    function write(v) {
      if (v === null) {
        byte(0);
        return;
      }
      if (v === false || v === true) {
        byte(v ? 2 : 1);
        return;
      }
      if (typeof v === "number") {
        if (!Number.isFinite(v)) throw Error("Non-finite binary number");
        byte(3);
        room(8);
        new DataView(out.buffer).setFloat64(offset, v, true);
        offset += 8;
        return;
      }
      if (typeof v === "string") {
        byte(4);
        uint(ids.get(v));
        return;
      }
      if (Array.isArray(v)) {
        byte(5);
        uint(v.length);
        v.forEach(write);
        return;
      }
      if (v && typeof v === "object") {
        const entries = Object.entries(v).filter(([, x]) => x !== undefined);
        byte(6);
        uint(entries.length);
        for (const [k, x] of entries) {
          uint(ids.get(k));
          write(x);
        }
        return;
      }
      throw Error("Unsupported binary value");
    }
    write(value);
    return out.slice(0, offset);
  }
  function decode(input, limits = {}) {
    const raw = input instanceof Uint8Array ? input : new Uint8Array(input),
      view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    let offset = 0,
      items = 0;
    const maxItems = limits.maxItems ?? 2000000,
      maxBytes = limits.maxBytes ?? 64 * 1024 * 1024;
    if (
      raw.length > maxBytes ||
      raw[0] !== 65 ||
      raw[1] !== 71 ||
      raw[2] !== 66 ||
      raw[3] !== 2
    )
      throw Error("Invalid binary package header/size");
    offset = 4;
    function need(n) {
      if (n < 0 || offset + n > raw.length)
        throw Error("Truncated binary package");
    }
    function byte() {
      need(1);
      return raw[offset++];
    }
    function uint() {
      let n = 0,
        m = 1;
      for (let i = 0; i < 5; i++) {
        const b = byte();
        n += (b & 127) * m;
        if (!(b & 128)) return n;
        m *= 128;
      }
      throw Error("Invalid binary length");
    }
    function count(n) {
      items += n;
      if (items > maxItems) throw Error("Binary item budget exceeded");
      return n;
    }
    const strings = [];
    for (let n = count(uint()); n; n--) {
      const size = uint();
      need(size);
      strings.push(decoder.decode(raw.subarray(offset, offset + size)));
      offset += size;
    }
    function string() {
      const id = uint();
      if (id >= strings.length) throw Error("Invalid binary string reference");
      return strings[id];
    }
    function read(depth = 0) {
      if (depth > 128) throw Error("Binary nesting limit");
      count(1);
      switch (byte()) {
        case 0:
          return null;
        case 1:
          return false;
        case 2:
          return true;
        case 3: {
          need(8);
          const n = view.getFloat64(offset, true);
          offset += 8;
          if (!Number.isFinite(n)) throw Error("Invalid binary number");
          return n;
        }
        case 4:
          return string();
        case 5: {
          const n = count(uint()),
            a = [];
          for (let i = 0; i < n; i++) a.push(read(depth + 1));
          return a;
        }
        case 6: {
          const n = count(uint()),
            v = {};
          for (let i = 0; i < n; i++) {
            const key = string();
            if (Object.hasOwn(v, key)) throw Error("Duplicate binary key");
            Object.defineProperty(v, key, {
              value: read(depth + 1),
              enumerable: true,
              writable: true,
              configurable: true,
            });
          }
          return v;
        }
        default:
          throw Error("Invalid binary tag");
      }
    }
    const result = read();
    if (offset !== raw.length) throw Error("Trailing binary bytes");
    return result;
  }
  // SHA-256 also works on ordinary HTTP hosts without WebCrypto secure contexts.
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  function hash(input) {
    const raw = input instanceof Uint8Array ? input : new Uint8Array(input),
      length = Math.ceil((raw.length + 9) / 64) * 64,
      bytes = new Uint8Array(length);
    bytes.set(raw);
    bytes[raw.length] = 128;
    const v = new DataView(bytes.buffer);
    v.setUint32(length - 8, Math.floor(raw.length / 0x20000000));
    v.setUint32(length - 4, raw.length * 8);
    const h = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
        0x1f83d9ab, 0x5be0cd19,
      ]),
      w = new Uint32Array(64),
      r = (n, b) => (n >>> b) | (n << (32 - b));
    for (let o = 0; o < length; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = v.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15],
          b = w[i - 2];
        w[i] =
          w[i - 16] +
          (r(a, 7) ^ r(a, 18) ^ (a >>> 3)) +
          w[i - 7] +
          (r(b, 17) ^ r(b, 19) ^ (b >>> 10));
      }
      let [a, b, c, d, e, f, g, j] = h;
      for (let i = 0; i < 64; i++) {
        const t1 =
            (j +
              (r(e, 6) ^ r(e, 11) ^ r(e, 25)) +
              ((e & f) ^ (~e & g)) +
              K[i] +
              w[i]) >>>
            0,
          t2 =
            ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) +
              ((a & b) ^ (a & c) ^ (b & c))) >>>
            0;
        j = g;
        g = f;
        f = e;
        e = (d + t1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) >>> 0;
      }
      for (const [i, n] of [a, b, c, d, e, f, g, j].entries())
        h[i] = (h[i] + n) >>> 0;
    }
    return [...h].map((n) => n.toString(16).padStart(8, "0")).join("");
  }
  root.ArkGlideBinary = { encode, decode, hash };
})(globalThis);
