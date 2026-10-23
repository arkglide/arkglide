import { views, route, angles } from './tour.js';

export default function ({ scene, input, rendering, ui, time, console, defineScript }) {
  let camera, yaw = 0, pitch = 0, touring = false, elapsed = 0, label = views[0].name;
  let hud, help, elapsedStats = 0, hidden = false, probeEconomy = false;
  const controls = [];
  const setView = (index) => {
    const view = views[index];
    camera.setPosition(...view.position);
    const r = angles(view.position, view.target); pitch = r.x; yaw = r.y;
    camera.setRotation(r); label = view.name; rendering.resetHistory();
  };
  const quality = (name) => {
    rendering.setQuality(name);
    const low = name === 'low', high = name === 'high';
    rendering.setShadows({ mapSize: low ? 256 : high ? 1024 : 512, maxLights: 1, filter: 'pcf' });
    // Keep the scene's one reflector and one probe bounded even on High.
    rendering.setReflections({
      ssr: { enabled: high, maxSteps: high ? 64 : 32, downsample: 2, maxDistance: 45, thickness: .18 },
      planar: { enabled: !low, maxMirrors: 1, maxPixels: high ? 262144 : 131072, scale: .5 },
    });
    rendering.setVolumetric({ enabled: !low, steps: high ? 48 : 24, maxPixels: high ? 262144 : 131072, scale: .5, shadowMapSize: 512 });
    rendering.setRefraction({ enabled: !low, maxLayers: 1, maxPixels: 65536, scale: .25 });
    rendering.setRealtimeProbeBudget({ maxActive: 1, facesPerFrame: low ? 1 : 2, maxPixels: low ? 4096 : 32768 });
    rendering.setVolumeLighting({ maxLocalLights: low ? 0 : 1 });
    rendering.setTransparency({ enabled: false }); // No intersecting glass stacks in this garden.
    probeEconomy = low;
  };
  const toggle = (effect) => {
    const s = rendering.getSettings();
    if (effect === 'taa') rendering.setAntialiasing(s.antialiasing === 'taa' ? 'fxaa' : 'taa');
    if (effect === 'ssr') rendering.setReflections({ ssr: { enabled: !s.reflections.ssr.enabled } });
    if (effect === 'planar') rendering.setReflections({ planar: { enabled: !s.reflections.planar.enabled } });
    if (effect === 'volume') rendering.setVolumetric({ enabled: !s.volumetric.enabled });
    if (effect === 'probes') {
      probeEconomy = !probeEconomy;
      rendering.setRealtimeProbeBudget({ maxActive: 1, facesPerFrame: probeEconomy ? 1 : 2, maxPixels: probeEconomy ? 4096 : 32768 });
    }
  };
  const diagnostics = () => {
    const s = rendering.getStats(), c = rendering.getSettings();
    const pixels = s.planarRenderedPixels + s.probeCapturedPixels + s.sceneRefractionPixels;
    const views = s.planarRenderedViews + s.probeCapturedFaces + s.sceneRefractionViews;
    const gpu = s.gpuTimeMs == null ? 'N/A' : s.gpuTimeMs.toFixed(2) + ' ms';
    return `${touring ? '巡游' : '自由浏览'} · ${label} · ${c.quality.toUpperCase()}\n` +
      `Draw ${s.renderDrawCalls}  |  主场景 ${Math.round(s.renderMainTriangles).toLocaleString()} tris\n` +
      `离屏 ${views} views / ${pixels.toLocaleString()} px · 体积 ${s.volumetricPixels.toLocaleString()} px\n` +
      `CPU 提交 ${s.renderSubmitMs.toFixed(2)} ms · GPU ${gpu}\n` +
      `实例 ${s.instancedMeshes}/${s.instanceBatches} 批 · LOD ${s.lodMeshes || 0}/${s.lodLevels || 0}\n` +
      `TAA ${s.taaEnabled ? 'ON' : 'OFF'} · SSR ${s.ssrEnabled ? 'ON' : 'OFF'} · 水面 ${c.reflections.planar.enabled ? 'ON' : 'OFF'} · 雾 ${s.volumetricEnabled ? 'ON' : 'OFF'}\n` +
      `探针 ${s.probeCompletedUpdates} 次 · ${c.realtimeProbes.facesPerFrame} 面/帧 · 上限 ${c.realtimeProbes.maxPixels.toLocaleString()} px`;
  };
  const button = (id, text, x, onClick) => controls.push(ui.createButton({
    id, text, x, y: 94, width: 13, height: 5, fontSize: 13,
    color: '#F4EADB', background: '#203630', style: { borderRadius: 4, borderColor: '#849986', borderWidth: 1 },
  }, onClick));

  return defineScript({
    onStart() {
      camera = scene.find('Camera');
      setView(0);
      hud = ui.createText({ id: 'courtyard-stats', text: '渲染统计准备中…', x: 2, y: 3, width: 43, height: 32, fontSize: 12,
        color: '#F4EADB', background: '#162B25', style: { padding: 10, borderRadius: 5 } });
      help = ui.createText({ id: 'courtyard-help', text: '竹隐 · ARKGLIDE\nWASD 移动 · 拖动鼠标查看 · Q/E 升降 · Shift 加速\n1/2/3 画质 · 4–8 机位 · M 巡游 · H 隐藏界面\nT 抗锯齿 · R SSR · P 水面反射 · V 晨雾 · B 探针预算',
        x: 2, y: 72, width: 80, height: 18, fontSize: 12, color: '#F4EADB', background: '#162B25', style: { padding: 8, borderRadius: 5 } });
      button('quality-low', '1 · Low', 2, () => quality('low'));
      button('quality-medium', '2 · Medium', 17, () => quality('medium'));
      button('quality-high', '3 · High', 32, () => quality('high'));
      button('tour', 'M · 巡游', 47, () => { touring = !touring; elapsed = 0; rendering.resetHistory(); });
      button('view', '下一机位', 62, () => { touring = false; setView((views.findIndex(v => v.name === label) + 1) % views.length); });
      button('look', '鼠标锁定', 77, () => { void input.requestPointerLock(); });
      console.log('竹隐庭院：WASD/拖动鼠标；M 巡游；1/2/3 画质；T/R/P/V/B 效果。全部资产随项目离线打包。');
    },
    onUpdate() {
      const dt = Math.min(time.deltaTime, .05);
      ['low', 'medium', 'high'].forEach((name, i) => { if (input.wasKeyPressed(String(i + 1))) quality(name); });
      ['taa', 'ssr', 'planar', 'volume', 'probes'].forEach((name, i) => { if (input.wasKeyPressed(['t', 'r', 'p', 'v', 'b'][i])) toggle(name); });
      views.forEach((_, i) => { if (input.wasKeyPressed(String(i + 4))) { touring = false; setView(i); } });
      if (input.wasKeyPressed('m')) { touring = !touring; elapsed = 0; rendering.resetHistory(); }
      if (input.wasKeyPressed('h')) { hidden = !hidden; [hud, help, ...controls].forEach(h => h.setVisible(!hidden)); }
      if (touring) {
        elapsed += dt;
        const segment = Math.floor(elapsed / 9) % (route.length - 1), t = (elapsed % 9) / 9, k = t * t * (3 - 2 * t);
        const a = route[segment], b = route[segment + 1];
        const p = a.position.map((v, i) => v + (b.position[i] - v) * k), target = a.target.map((v, i) => v + (b.target[i] - v) * k);
        camera.setPosition(...p); const r = angles(p, target); camera.setRotation(r); pitch = r.x; yaw = r.y; label = a.name;
      } else {
        const mouse = input.getMouseDelta();
        if (input.isMouseDown() || input.isPointerLocked()) { yaw += mouse.x * .002; pitch = Math.max(-1.3, Math.min(1.3, pitch + mouse.y * .002)); }
        const forward = input.getAxis('s', 'w'), side = input.getAxis('a', 'd'), vertical = input.getAxis('q', 'e');
        const speed = (input.isKeyDown('Shift') ? 9 : 3.3) * dt / Math.max(1, Math.hypot(forward, side, vertical));
        const p = camera.position;
        camera.setPosition(Math.max(-20, Math.min(20, p.x + (Math.sin(yaw) * forward + Math.cos(yaw) * side) * speed)),
          Math.max(1.2, Math.min(17, p.y + vertical * speed)), Math.max(-23, Math.min(23, p.z + (Math.cos(yaw) * forward - Math.sin(yaw) * side) * speed)));
        camera.setRotation(pitch, yaw, 0);
      }
      elapsedStats += dt;
      if (elapsedStats > .1) { elapsedStats = 0; hud.setText(diagnostics()); }
    },
    onDestroy() { input.releasePointerLock(); },
  });
}
