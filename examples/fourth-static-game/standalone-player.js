// Static host: no editor, framework, build service or IndexedDB dependency.
(function () {
  'use strict';
  const base = new URL('./', document.currentScript.src);
  const $ = id => document.getElementById(id);
  const startButton = $('start'), pauseButton = $('pause'), stopButton = $('stop');
  const stage = $('stage'), cover = $('cover'), status = $('status'), progress = $('progress');
  let generation = 0, controller = null, frame = null, token = '', state = 'idle';
  let manifest = null, payload = null, timer = null, cleanupTimer = null, lastStats = null;
  let hiddenPause = false, stopResolve = null;
  function setState(next, message) {
    state = next; document.body.dataset.state = next;
    if (message) status.textContent = message;
    startButton.disabled = !['idle', 'stopped', 'error'].includes(next);
    startButton.textContent = next === 'error' ? '重试' : next === 'stopped' ? '重新开始' : '开始游戏';
    pauseButton.disabled = !['playing', 'paused'].includes(next);
    pauseButton.textContent = next === 'paused' ? '继续' : '暂停';
    stopButton.disabled = ['idle', 'stopped', 'error', 'stopping'].includes(next);
    cover.hidden = ['playing', 'paused', 'pausing', 'resuming'].includes(next);
  }
  function relative(path) {
    if (typeof path !== 'string' || !path || /[\\?#\u0000]/.test(path) || path.split('/').includes('..')) throw Error('无效包路径: ' + path);
    const url = new URL(path, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw Error('依赖路径超出导出目录: ' + path);
    return url;
  }
  async function readFile(path, expected, signal, onBytes = () => {}) {
    const response = await fetch(relative(path), {signal});
    if (!response.ok) throw Error(path + ' 加载失败：HTTP ' + response.status);
    let raw;
    if (response.body?.getReader) {
      const reader = response.body.getReader(), chunks = []; let size = 0;
      for (;;) {
        const {done, value} = await reader.read(); if (done) break;
        chunks.push(value); size += value.byteLength; onBytes(value.byteLength);
        if (expected !== undefined && size > expected) { await reader.cancel(); throw Error(path + ' 文件大小不一致'); }
      }
      raw = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length; }
    } else { raw = new Uint8Array(await response.arrayBuffer()); onBytes(raw.byteLength); }
    if (expected !== undefined && raw.byteLength !== expected) throw Error(path + ' 文件缺失或大小不一致');
    return raw;
  }
  function post(message, transfer = []) { frame?.contentWindow?.postMessage({...message, runId:generation}, '*', transfer); }
  function removeFrame() {
    clearTimeout(timer); clearTimeout(cleanupTimer); timer = cleanupTimer = null;
    if (frame) { frame.remove(); frame = null; }
    payload = null;
  }
  function fail(error) {
    ++generation; controller?.abort(); controller = null;
    post({type:'stop'}); removeFrame();
    setState('error', '无法启动或继续游戏\n' + (error.message || String(error)));
    $('detail').textContent = '检查部署文件是否完整及服务器设置，然后点击“重试”。';
  }
  function resize() {
    if (!frame) return;
    const settings = manifest?.settings;
    if (settings?.fit === 'contain') {
      const rect = stage.getBoundingClientRect(), scale = Math.min(rect.width / settings.width, rect.height / settings.height);
      frame.style.width = settings.width * scale + 'px'; frame.style.height = settings.height * scale + 'px';
    } else { frame.style.width = '100%'; frame.style.height = '100%'; }
  }
  async function start() {
    if (!['idle', 'stopped', 'error'].includes(state)) return;
    const id = ++generation; token = crypto.randomUUID ? crypto.randomUUID() : String(id) + '-' + Math.random();
    removeFrame(); controller?.abort(); controller = new AbortController();
    const signal = controller.signal; lastStats = null; hiddenPause = false;
    $('diagnostic').textContent = ''; progress.value = 0;
    setState('loading', '读取游戏清单…');
    $('detail').textContent = '可点击“停止”取消加载。';
    // Covers network requests as well as WASM, model parsing and audio decoding.
    timer = setTimeout(() => { if (id === generation) fail(Error('加载超过 120 秒；可重试')); }, 120000);
    try {
      if (location.protocol === 'file:') throw Error('请使用 HTTP/HTTPS 静态服务器，不能直接双击 file:// 文件');
      manifest = JSON.parse(new TextDecoder().decode(await readFile('game-manifest.json', undefined, signal)));
      if (manifest.format !== 'arkglide-static-1' || !Array.isArray(manifest.files) || !Array.isArray(manifest.resources)) throw Error('不支持的游戏清单');
      document.title = manifest.settings.title; $('title').textContent = manifest.settings.title;
      const byPath = new Map(manifest.files.map(f => [f.path, f]));
      if (byPath.size !== manifest.files.length || manifest.files.some(f => !Number.isInteger(f.byteLength) || f.byteLength <= 0)) throw Error('无效依赖清单');
      let loaded = 0, complete = 0;
      const total = manifest.files.reduce((sum, f) => sum + f.byteLength, 0), data = new Map();
      const queue = [...manifest.files];
      // Bounded concurrency, with byte and file progress including runtime/WASM.
      await Promise.all(Array.from({length: Math.min(4, queue.length)}, async () => {
        while (queue.length && !signal.aborted) {
          const file = queue.shift();
          const raw = await readFile(file.path, file.byteLength, signal, n => {
            if (id !== generation) return;
            loaded += n; progress.value = total ? loaded / total : 0;
            status.textContent = '加载依赖 ' + complete + '/' + manifest.files.length + '（' + Math.round(progress.value * 100) + '%）';
          });
          // Only project resources remain in parent memory; cached runtime files
          // are loaded normally inside a disposable opaque-origin iframe.
          if (file.path === manifest.project || manifest.resources.some(r => r.path === file.path)) data.set(file.path, raw);
          complete++;
        }
      }));
      if (id !== generation || signal.aborted) return;
      const projectRaw = data.get(manifest.project);
      if (!projectRaw) throw Error('清单缺少项目文件');
      const project = JSON.parse(new TextDecoder().decode(projectRaw));
      const modelData = Object.create(null), textureData = Object.create(null), audioData = Object.create(null), transfer = [];
      for (const r of manifest.resources) {
        const map = {model:modelData, texture:textureData, audio:audioData}[r.kind];
        const raw = data.get(r.path);
        if (!map || !raw || raw.byteLength !== r.byteLength) throw Error('资源清单损坏: ' + r.id);
        if (Object.hasOwn(map, r.id)) throw Error('重复资源: ' + r.id);
        map[r.id] = raw.buffer; transfer.push(raw.buffer);
      }
      payload = {message:{type:'run', project, modelData, textureData, audioData, standalone:true}, transfer};
      setState('initializing', '初始化 WASM、场景、脚本与声音…'); progress.value = 1;
      frame = document.createElement('iframe'); frame.title = 'ArkGlide Game Runtime';
      frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('allow', 'gamepad *; fullscreen');
      frame.src = new URL('runtime.html?boot=' + encodeURIComponent(token), base).href;
      frame.addEventListener('error', () => { if (id === generation) fail(Error('游戏运行页加载失败')); });
      stage.prepend(frame); resize();
    } catch (error) { if (id === generation && error.name !== 'AbortError') fail(error); }
  }
  function stop() {
    if (['idle', 'stopped', 'stopping'].includes(state)) return Promise.resolve();
    controller?.abort(); controller = null; clearTimeout(timer); timer = null;
    payload = null; hiddenPause = false;
    if (!frame) { ++generation; setState('stopped', '已停止，可重新开始'); return Promise.resolve(); }
    setState('stopping', '正在停止并释放资源…');
    const promise = new Promise(resolve => { stopResolve = resolve; });
    post({type:'stop'});
    cleanupTimer = setTimeout(finishStop, 1000);
    return promise;
  }
  function finishStop() {
    ++generation; removeFrame();
    setState('stopped', '已停止，可重新开始'); progress.value = 0;
    stopResolve?.(); stopResolve = null;
  }
  function pause() {
    if (state === 'playing') { post({type:'pause'}); setState('pausing', '正在暂停…'); }
    else if (state === 'paused') { post({type:'resume'}); setState('resuming', '正在继续…'); frame?.focus(); }
  }
  window.addEventListener('message', event => {
    if (!frame || event.source !== frame.contentWindow) return;
    const msg = event.data;
    if (!msg || msg.bootToken !== token || (msg.runId != null && msg.runId !== generation)) return;
    if (msg.type === 'ready' && state === 'initializing' && payload) {
      post(payload.message, payload.transfer); payload = null;
    } else if (msg.type === 'started' && state === 'initializing') {
      clearTimeout(timer); timer = null; controller = null;
      setState('playing', '游戏运行中'); $('detail').textContent = '点击游戏画面获取键盘焦点和解锁声音。'; frame.focus();
      if (document.hidden) { pause(); hiddenPause = true; }
    } else if (msg.type === 'fatal') {
      if (state !== 'stopping') fail(Error(msg.message));
    } else if (msg.type === 'diagnostic') {
      const text = [msg.file, msg.line, msg.hook, msg.message].filter(Boolean).join(' · ');
      if (state === 'initializing') fail(Error(text));
      else $('diagnostic').textContent = text;
    } else if (msg.type === 'telemetry') {
      lastStats = msg.stats;
      if (state === 'pausing' && msg.stats.state === 'paused') setState('paused', '已暂停');
      if (state === 'resuming' && msg.stats.state === 'playing') setState('playing', '游戏运行中');
      if (state === 'stopping' && msg.stats.state === 'stopped') finishStop();
    }
  });
  startButton.addEventListener('click', start);
  stopButton.addEventListener('click', stop);
  pauseButton.addEventListener('click', () => { hiddenPause = false; pause(); });
  $('fullscreen').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch (error) { $('diagnostic').textContent = '全屏不可用: ' + error.message; }
  });
  new ResizeObserver(resize).observe(stage);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'playing') { pause(); hiddenPause = true; }
    // Require a deliberate continue gesture after returning to the page.
  });
  window.addEventListener('pagehide', () => { controller?.abort(); post({type:'stop'}); removeFrame(); });
  // Read-only observability for embedding and acceptance tests.
  window.ArkGlidePlayer = Object.freeze({start, stop, pause, get state(){return state;}, get stats(){return lastStats;}, get hiddenPause(){return hiddenPause;}});
  setState('idle', '点击“开始游戏”加载项目');
})();
