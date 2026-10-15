// Production host: automatic boot, bounded streaming requests, no debug toolbar.
(function () {
  "use strict";
  const base = new URL("./", document.currentScript.src),
    $ = (id) => document.getElementById(id);
  let generation = 0,
    frame = null,
    token = "",
    state = "idle",
    manifest = null,
    controller = null,
    timer = null,
    storageHost = null,
    lastStats = null,
    hiddenPause = false;
  let bootLines = [],
    gameLines = [],
    activeReads = 0,
    queue = [],
    stopResolve = null,
    startPromise = null,
    stopPromise = null;
  function log(text) {
    if (["playing", "paused", "pausing", "resuming"].includes(state)) {
      gameLog(text);
      return;
    }
    bootLines.push("> " + String(text));
    if (bootLines.length > (manifest?.settings.logLimit || 200))
      bootLines.shift();
    $("loadingLog").textContent = bootLines.join("\n");
  }
  function gameLog(text) {
    if (!manifest?.settings.showLogs) return;
    gameLines.push(String(text));
    if (gameLines.length > manifest.settings.logLimit) gameLines.shift();
    $("logs").textContent = gameLines.join("\n");
  }
  function status(next, message) {
    state = next;
    document.body.dataset.state = next;
    if (message) $("status").textContent = message;
  }
  function relative(path) {
    if (
      typeof path !== "string" ||
      !path ||
      /[\\?#\u0000]/.test(path) ||
      path.split("/").includes("..")
    )
      throw Error("无效包路径");
    const url = new URL(path, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
      throw Error("依赖路径超出导出目录");
    return url;
  }
  async function read(path, expected, signal, max = 512 * 1024 * 1024) {
    if (
      expected !== undefined &&
      (!Number.isSafeInteger(expected) || expected < 1 || expected > max)
    )
      throw Error("无效文件大小: " + path);
    const response = await fetch(relative(path), { signal });
    if (!response.ok) throw Error(path + " HTTP " + response.status);
    const reader = response.body?.getReader();
    if (!reader) {
      const raw = new Uint8Array(await response.arrayBuffer());
      if (
        raw.length > max ||
        (expected !== undefined && raw.length !== expected)
      )
        throw Error("文件大小不一致: " + path);
      return raw;
    }
    const out = new Uint8Array(expected ?? Math.min(max, 1024 * 1024));
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.length > out.length) {
        await reader.cancel();
        throw Error("文件大小不一致: " + path);
      }
      out.set(value, size);
      size += value.length;
    }
    if (expected !== undefined && size !== expected)
      throw Error("文件大小不一致: " + path);
    return expected === undefined ? out.slice(0, size) : out;
  }
  function post(msg, transfer = []) {
    frame?.contentWindow?.postMessage(
      { ...msg, runId: generation },
      "*",
      transfer,
    );
  }
  function remove() {
    clearTimeout(timer);
    timer = null;
    frame?.remove();
    frame = null;
    controller?.abort();
    controller = null;
    storageHost?.dispose();
    storageHost = null;
    for (const task of queue.splice(0))
      task.reject(Object.assign(Error("加载已取消"), { name: "AbortError" }));
  }
  function fail(error) {
    remove();
    ++generation;
    status("error", "无法进入游戏");
    $("boot").hidden = false;
    $("retry").hidden = false;
    log(error.message || String(error));
  }
  function resize() {
    if (!frame) return;
    const s = manifest.settings;
    if (s.fit === "contain") {
      const rect = $("stage").getBoundingClientRect(),
        scale = Math.min(rect.width / s.width, rect.height / s.height);
      frame.style.width = s.width * scale + "px";
      frame.style.height = s.height * scale + "px";
    } else {
      frame.style.width = "100%";
      frame.style.height = "100%";
    }
  }
  function pump() {
    while (
      queue.length &&
      activeReads < (manifest?.settings.concurrency || 4)
    ) {
      const task = queue.shift();
      activeReads++;
      Promise.resolve()
        .then(task.run)
        .then(task.resolve, task.reject)
        .finally(() => {
          activeReads--;
          pump();
        });
    }
  }
  function scheduled(run) {
    return new Promise((resolve, reject) => {
      queue.push({ run, resolve, reject });
      pump();
    });
  }
  function start() {
    if (startPromise) return startPromise;
    const pending = beginStart();
    startPromise = pending;
    pending.finally(() => {
      if (startPromise === pending) startPromise = null;
    });
    return pending;
  }
  async function beginStart() {
    if (!["idle", "stopped", "error"].includes(state)) return;
    remove();
    const id = ++generation;
    token = crypto.randomUUID?.() || String(id) + "-" + Math.random();
    controller = new AbortController();
    const signal = controller.signal;
    bootLines = [];
    gameLines = [];
    $("loadingLog").textContent = "";
    $("logs").textContent = "";
    $("gameLog").hidden = true;
    $("boot").hidden = false;
    $("retry").hidden = true;
    status("loading", "ArkGlide / 正在加载");
    log("读取启动清单");
    timer = setTimeout(() => {
      if (id === generation) fail(Error("启动超时，请重试"));
    }, 120000);
    try {
      if (location.protocol === "file:")
        throw Error("请通过 HTTP/HTTPS 静态服务器运行游戏");
      const nextManifest = JSON.parse(
        new TextDecoder().decode(
          await read("game-manifest.json", undefined, signal, 1024 * 1024),
        ),
      );
      if (id !== generation || signal.aborted || state !== "loading") return;
      manifest = nextManifest;
      if (
        manifest.format !== "arkglide-static-2" ||
        !manifest.boot ||
        !Array.isArray(manifest.runtime)
      )
        throw Error("不支持的运行包格式");
      document.title = manifest.settings.title;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (id === generation) fail(Error("启动超时，请重试"));
      }, manifest.settings.loadTimeout);
      storageHost = ArkGlideStorageHost.create({
        namespace: manifest.gameId || base.href,
        getStorage: () => localStorage,
      });
      frame = document.createElement("iframe");
      frame.title = manifest.settings.title;
      frame.setAttribute("sandbox", "allow-scripts allow-pointer-lock");
      frame.setAttribute("allow", "gamepad *; fullscreen");
      frame.src = new URL(
        "runtime.html?boot=" + encodeURIComponent(token),
        base,
      ).href;
      frame.addEventListener("error", () => {
        if (id === generation) fail(Error("运行模块加载失败"));
      });
      $("stage").append(frame);
      resize();
      status("initializing");
    } catch (error) {
      if (id === generation && error.name !== "AbortError") fail(error);
    }
  }
  function stop() {
    if (stopPromise) return stopPromise;
    const pending = finishStop();
    stopPromise = pending;
    pending.finally(() => {
      if (stopPromise === pending) stopPromise = null;
    });
    return pending;
  }
  async function finishStop() {
    if (["idle", "stopped"].includes(state)) return;
    if (state === "stopping") return;
    status("stopping");
    controller?.abort();
    post({ type: "stop" });
    if (frame)
      await new Promise((resolve) => {
        stopResolve = resolve;
        setTimeout(resolve, 1000);
      });
    remove();
    ++generation;
    status("stopped");
    stopResolve = null;
  }
  function pause() {
    if (state === "playing") {
      post({ type: "pause" });
      status("pausing");
    } else if (state === "paused") {
      post({ type: "resume" });
      status("resuming");
    }
  }
  window.addEventListener("message", (event) => {
    if (!frame || event.source !== frame.contentWindow) return;
    const msg = event.data;
    if (
      !msg ||
      msg.bootToken !== token ||
      (msg.runId != null && msg.runId !== generation)
    )
      return;
    if (msg.type === "boot-log") {
      if (state !== "playing") log(msg.message);
      return;
    }
    if (msg.type === "ready" && state === "initializing") {
      post({
        type: "run-package",
        descriptor: manifest.boot,
        packageBase: base.href,
        config: manifest.settings,
      });
      return;
    }
    if (msg.type === "package-read") {
      const id = generation,
        targetFrame = frame,
        signal = controller.signal,
        d = msg.descriptor;
      scheduled(async () => {
        if (
          !d ||
          !/^((boot|scenes|prefabs|definitions|index|modules)\/[a-f0-9]{64}\.agb|assets\/[a-f0-9]{64}\.bin)$/.test(
            d.path,
          ) ||
          !d.path.includes("/" + d.hash + ".")
        )
          throw Error("无效资源请求");
        if (id !== generation) throw Error("加载已取消");
        return read(d.path, d.byteLength, signal);
      }).then(
        (raw) => {
          if (id === generation && frame === targetFrame)
            post({ type: "package-file", id: msg.id, raw: raw.buffer }, [
              raw.buffer,
            ]);
        },
        (error) => {
          if (id === generation && frame === targetFrame)
            post({ type: "package-file", id: msg.id, error: error.message });
        },
      );
      return;
    }
    if (msg.type === "storage") {
      storageHost?.receive(msg, (result) => post(result));
      return;
    }
    if (msg.type === "started" && state === "initializing") {
      clearTimeout(timer);
      timer = null;
      status("playing");
      bootLines = [];
      $("loadingLog").textContent = "";
      $("status").textContent = "";
      $("boot").hidden = true;
      $("gameLog").hidden = !manifest.settings.showLogs;
      frame.focus();
      if (document.hidden) {
        pause();
        hiddenPause = true;
      }
      return;
    }
    if (msg.type === "fatal") {
      if (state !== "stopping") fail(Error(msg.message));
      return;
    }
    if (msg.type === "diagnostic") {
      const text = [msg.file, msg.line, msg.hook, msg.message]
        .filter(Boolean)
        .join(" · ");
      if (state === "initializing") fail(Error(text));
      else gameLog(text);
      return;
    }
    if (msg.type === "log") {
      if (state === "initializing") log((msg.args || []).join(" "));
      else gameLog((msg.args || []).join(" "));
      return;
    }
    if (msg.type === "telemetry") {
      lastStats = msg.stats;
      if (state === "stopping" && msg.stats.state === "stopped")
        stopResolve?.();
      if (state === "pausing" && msg.stats.state === "paused") {
        status("paused");
        if (hiddenPause && !document.hidden) {
          hiddenPause = false;
          pause();
        }
      }
      if (state === "resuming" && msg.stats.state === "playing") {
        status("playing");
        if (document.hidden) {
          pause();
          hiddenPause = true;
        }
      }
    }
  });
  $("retry").addEventListener("click", start);
  new ResizeObserver(resize).observe($("stage"));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "playing") {
      pause();
      hiddenPause = true;
    } else if (!document.hidden && hiddenPause && state === "paused") {
      hiddenPause = false;
      pause();
    }
  });
  window.addEventListener("pagehide", () => {
    post({ type: "stop" });
    remove();
  });
  window.ArkGlidePlayer = Object.freeze({
    start,
    stop,
    pause,
    get state() {
      return state;
    },
    get stats() {
      return lastStats;
    },
    get hiddenPause() {
      return hiddenPause;
    },
  });
  start();
})();
