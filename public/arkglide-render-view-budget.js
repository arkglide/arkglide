// Same homogeneous clipping and allocation rules as cpp/render/batch.cpp.
(function (root) {
  "use strict";
  const distance = (p, plane) => plane & 1 ? p[3] - p[plane >> 1] : p[3] + p[plane >> 1];
  function plan(input, camera, budget) {
    const candidates = [], count = input.length / 10;
    for (let i = 0; i < count; i++) {
      const at = i * 10, px = input[at], py = input[at + 1], pz = input[at + 2], x = input[at + 3], y = input[at + 4], z = input[at + 5], w = input[at + 6];
      const nx = 2 * (x * z + y * w), ny = 2 * (y * z - x * w), nz = 1 - 2 * (x * x + y * y);
      if ((camera[16] - px) * nx + (camera[17] - py) * ny + (camera[18] - pz) * nz <= 0) continue;
      if (!input.subarray(at, at + 10).every(Number.isFinite) || input[at + 7] <= 0 || input[at + 8] <= 0 || input[at + 9] <= 0) continue;
      let polygon = [];
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const u = sx * input[at + 7] / 2, v = sy * input[at + 8] / 2;
        const vx = px + (1 - 2 * (y * y + z * z)) * u + 2 * (x * y - z * w) * v;
        const vy = py + 2 * (x * y + z * w) * u + (1 - 2 * (x * x + z * z)) * v;
        const vz = pz + 2 * (x * z - y * w) * u + 2 * (y * z + x * w) * v;
        const point = [vx * camera[0] + vy * camera[4] + vz * camera[8] + camera[12], vx * camera[1] + vy * camera[5] + vz * camera[9] + camera[13], vx * camera[2] + vy * camera[6] + vz * camera[10] + camera[14], vx * camera[3] + vy * camera[7] + vz * camera[11] + camera[15]];
        // The aperture shader biases depth to retain portals inside camera.minZ.
        if (point[3] > 0) point[2] = Math.max(point[2], -point[3]);
        polygon.push(point);
      }
      for (let plane = 0; plane < 6 && polygon.length; plane++) {
        const next = [];
        for (let j = 0; j < polygon.length; j++) {
          const a = polygon[j], b = polygon[(j + 1) % polygon.length], da = distance(a, plane), db = distance(b, plane);
          if (da >= 0) next.push(a);
          if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); next.push(a.map((v, axis) => v + (b[axis] - v) * t)); }
        }
        polygon = next;
      }
      if (!polygon.length) continue;
      let minX = 1, minY = 1, maxX = -1, maxY = -1;
      for (const p of polygon) {
        if (p[3] <= 1e-10) continue;
        minX = Math.min(minX, p[0] / p[3]); maxX = Math.max(maxX, p[0] / p[3]);
        minY = Math.min(minY, p[1] / p[3]); maxY = Math.max(maxY, p[1] / p[3]);
      }
      const area = Math.max(0, (maxX - minX) * (maxY - minY) / 4);
      if (area <= budget.minArea || area <= 0) continue;
      candidates.push({ index: i, area, scale: input[at + 9] });
    }
    candidates.sort((a, b) => b.area - a.area || a.index - b.index);
    let pixels = budget.maxPixels;
    const output = [];
    for (const c of candidates) {
      if (output.length >= budget.maxViews || pixels < 1) break;
      const scale = Math.min(c.scale, budget.maxSize / budget.width, budget.maxSize / budget.height);
      let width = Math.max(1, Math.floor(budget.width * scale)), height = Math.max(1, Math.floor(budget.height * scale));
      const minSide = Math.min(budget.minResolution, width, height);
      if (width * height > pixels) {
        const factor = Math.sqrt(pixels / (width * height));
        width = Math.max(1, Math.floor(width * factor)); height = Math.max(1, Math.floor(height * factor));
      }
      if (Math.min(width, height) < minSide || width * height > pixels) continue;
      pixels -= width * height;
      output.push({ index: c.index, area: c.area, width, height });
    }
    return output;
  }
  function valid(input, camera, b) {
    if (!(input instanceof Float64Array) || input.length % 10 || input.length / 10 > 65536 || !(camera instanceof Float64Array) || camera.length !== 19 || !camera.every(Number.isFinite) ||
        ![b.width, b.height, b.maxSize, b.maxViews, b.maxPixels, b.minResolution].every(Number.isSafeInteger) || b.width < 1 || b.width > 65536 || b.height < 1 || b.height > 65536 || b.maxSize < 1 || b.maxSize > 65536 || b.maxViews < 0 || b.maxViews > 64 || b.maxPixels < 0 || b.maxPixels > 67108864 || b.minResolution < 1 || !Number.isFinite(b.minArea) || b.minArea < 0 || b.minArea > 1) throw Error("Invalid view budget batch");
  }
  function create(native, minCandidates = 8) {
    let capacity = 0, dead = false, nativeBatches = 0, jsBatches = 0, inputView, cameraView, outputView;
    return {
      plan(input, camera, budget) {
        if (dead) throw Error("View budget disposed"); valid(input, camera, budget);
        const count = input.length / 10;
        if (!native?.planViews || count < minCandidates) { jsBatches++; return plan(input, camera, budget); }
        if (count > capacity) { capacity = Math.min(65536, Math.max(count, capacity * 2)); native.reserveViews(capacity); inputView = cameraView = outputView = null; }
        if (!inputView?.buffer.byteLength) inputView = native.viewInput();
        if (!cameraView?.buffer.byteLength) cameraView = native.viewCamera();
        inputView.set(input); cameraView.set(camera);
        const n = native.planViews(count, budget.width, budget.height, budget.maxSize, budget.minArea, budget.maxViews, budget.maxPixels, budget.minResolution);
        if (n < 0) throw Error("Invalid native view budget");
        if (!outputView?.buffer.byteLength) outputView = native.viewOutput();
        nativeBatches++;
        return Array.from({ length: n }, (_, i) => ({ index: outputView[i * 4], width: outputView[i * 4 + 1], height: outputView[i * 4 + 2], area: outputView[i * 4 + 3] }));
      },
      stats: () => ({ viewBudgetNativeBatches: nativeBatches, viewBudgetJSBatches: jsBatches }),
      dispose() { dead = true; inputView = cameraView = outputView = null; },
    };
  }
  root.ArkGlideViewBudget = { plan, valid, create };
})(globalThis);
