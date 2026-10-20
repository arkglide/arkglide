import { Box, Typography } from "@mui/material";
import { useEditorStore } from "../../store/useEditorStore";
import { PanelHeading } from "./PanelHeading";
export default function DiagnosticsPanel() {
  const stats = useEditorStore((s) => s.runtimeStats),
    missing = useEditorStore((s) => s.missingModelIds),
    nodes = useEditorStore((s) => s.nodes);
  const rows = stats
    ? [
        ["状态 / 数学后端", `${stats.state} / ${stats.mathBackend}`],
        [
          "场景 / 生命周期后端",
          `${stats.sceneBackend || "—"} / ${stats.lifecycleBackend || "—"}`,
        ],
        [
          "原生实体 / 所有者 / 定时器",
          `${stats.nativeEntities || 0} / ${stats.nativeOwners || 0} / ${stats.nativeTimers || 0}`,
        ],
        [
          "原生矩阵更新 / 核心堆",
          `${stats.nativeMatrixUpdates || 0} / ${((stats.coreWasmHeapBytes || 0) / 1048576).toFixed(1)} MiB`,
        ],
        ["FPS", stats.fps.toFixed(1)],
        ["级联阴影灯", stats.cascadedShadowLights || 0],
        ["LOD 网格 / 层级 / 跳过", `${stats.lodMeshes||0} / ${stats.lodLevels||0} / ${stats.lodSkippedMeshes||0}`],
        ["LOD 构建 WASM / JS", `${stats.lodNativeBuilds||0} / ${stats.lodJSBuilds||0}`],
        ["画质 / 渲染比例", `${stats.renderQuality || "custom"} / ${stats.renderResolutionScale ?? 1}`],
        ["大气天空 / 景深 / SSR", `${stats.atmosphereSky ? "开" : "关"} / ${stats.dofEnabled ? "开" : "关"} / ${stats.ssrEnabled ? "开" : "关"}`],
        ["体积大气 / 采样 / 像素", `${stats.volumetricEnabled?'开':stats.volumetricSupported?'关':'设备不支持'} / ${stats.volumetricSteps||0} / ${stats.volumetricWidth||0} × ${stats.volumetricHeight||0}`],
        ["体积方向光 / 遮挡深度图", `${stats.volumetricLight||'无'} / ${stats.volumetricShadowSize||0}`],
        ["平面反射 / 离屏像素", `${stats.planarReflections || 0} / ${stats.planarRenderedPixels || 0}`],
        ["GPU / CPU 粒子系统", `${stats.gpuParticleSystems || 0} / ${stats.cpuParticleSystems || 0}`],
        ["绘制调用 / 主视图三角形", `${stats.renderDrawCalls || 0} / ${stats.renderMainTriangles || 0}`],
        ["含离屏绘制三角形", stats.renderSceneTriangles || 0],
        ["GPU 帧时间", stats.gpuTimeMs == null ? (stats.gpuTimerSupported ? "未采样（在画面设置中开启）" : "设备未提供计时扩展") : `${stats.gpuTimeMs.toFixed(2)} ms`],
        ["离屏视图 / 像素 / 预算", `${stats.portalRenderedViews || 0} / ${stats.portalRenderedPixels || 0} / ${stats.portalPixelBudget || 0}`],
        ["视图预算 WASM / JS 批次", `${stats.viewBudgetNativeBatches || 0} / ${stats.viewBudgetJSBatches || 0}`],
        ["渲染计算后端", stats.renderComputeBackend || "—"],
        [
          "变换提交批次 / 实体",
          `${stats.nativeTransformBatches || 0} / ${stats.nativeTransformWrites || 0}`,
        ],
        [
          "包围盒更新 / 查询批次",
          `${stats.nativeBoundsUpdates || 0} / ${stats.nativeBoundsBatches || 0}`,
        ],
        [
          "离屏包围盒原生 / 兼容",
          `${stats.renderNativeBounds || 0} / ${stats.renderBoundsFallbacks || 0}`,
        ],
        [
          "离屏筛选批次 / 剔除网格",
          `${stats.renderCullBatches || 0} / ${stats.renderCulledMeshes || 0}`,
        ],
        [
          "法线批次 / 顶点",
          `${stats.renderNormalBatches || 0} / ${stats.renderNormalVertices || 0}`,
        ],
        [
          "本帧 CPU / 峰值",
          `${stats.frameMs.toFixed(2)} / ${stats.peakFrameMs.toFixed(2)} ms`,
        ],
        [
          "脚本 / 渲染 CPU",
          `${stats.scriptMs.toFixed(2)} / ${stats.renderMs.toFixed(2)} ms`,
        ],
        ["实体 / 脚本实例", `${stats.entities} / ${stats.scripts}`],
        [
          "网格 / 材质 / 贴图",
          `${stats.meshes} / ${stats.materials} / ${stats.textures}`,
        ],
        [
          "灯光 / 相机 / 加载中模型",
          `${stats.lights} / ${stats.cameras} / ${stats.modelLoads}`,
        ],
        [
          "计时器 / 事件订阅 / 原生监听",
          `${stats.timers} / ${stats.subscriptions} / ${stats.listeners}`,
        ],
        [
          "物理后端 / 刚体 / 接触",
          `${stats.physicsBackend || "—"} / ${stats.physicsBodies || 0} / ${stats.physicsContacts || 0}`,
        ],
        [
          "音频状态 / 音源 / 已解码资源",
          `${stats.audioState || "—"} / ${stats.audioVoices || 0} / ${stats.audioBuffers || 0}`,
        ],
        [
          "动画 / HUD / 按住输入",
          `${stats.animationPlayers || 0} / ${stats.hudElements || 0} / ${stats.inputHeld || 0}`,
        ],
        [
          "角色 / 关节 / 活跃查询",
          `${stats.physicsCharacters || 0} / ${stats.physicsConstraints || 0} / ${stats.physicsQueriesActive || 0}`,
        ],
        [
          "碰撞缓存 / 调试网格",
          `${stats.physicsShapeCache || 0} (${((stats.physicsCacheBytes || 0) / 1048576).toFixed(1)} MiB) / ${stats.physicsDebugMeshes || 0}`,
        ],
        [
          "控制器 / 事件订阅 / 重定向组",
          `${stats.animationControllers || 0} / ${stats.animationEventSubscriptions || 0} / ${stats.animationRetargetGroups || 0}`,
        ],
        [
          "音频总线 / 流 / Worklet",
          `${stats.audioBuses || 0} / ${stats.audioStreams || 0} / ${stats.audioWorklets || 0}`,
        ],
        [
          "音频过渡 / Blob URL",
          `${stats.audioTransitions || 0} / ${stats.audioBlobURLs || 0}`,
        ],
        [
          "UI 订阅 / 图片 URL / 重绑捕获",
          `${stats.uiSubscriptions || 0} / ${stats.uiBlobURLs || 0} / ${stats.inputCaptures || 0}`,
        ],
        [
          "手柄设备 / Jolt WASM 堆",
          `${stats.inputGamepads || 0} / ${((stats.wasmHeapBytes || 0) / 1048576).toFixed(1)} MiB`,
        ],
        [
          "游戏时间 / 未缩放时间",
          `${stats.totalTime.toFixed(2)} / ${stats.unscaledTotalTime.toFixed(2)} s`,
        ],
        ["固定步累计 / 时间倍率", `${stats.fixedSteps} / ${stats.timeScale}`],
        ["丢弃的追赶时间", `${stats.droppedTime.toFixed(3)} s`],
        ["本次错误数", stats.errors],
        [
          "JS 堆内存",
          stats.heapBytes === null
            ? "浏览器未提供"
            : `${(stats.heapBytes / 1048576).toFixed(1)} MiB`,
        ],
      ]
    : [];
  return (
    <Box sx={{ height: "100%", overflow: "auto", p: 1 }}>
      <PanelHeading
        title="运行诊断"
        help="播放后显示数据，每 0.5 秒更新。停止后可检查资源是否释放。CPU 数据是同步执行耗时，不包含 GPU 时间；JS 堆不包含 WASM 内存或显存。"
      />
      {!stats && (
        <Typography color="text.secondary" variant="body2">
          暂无运行数据
        </Typography>
      )}
      {rows.map(([label, value]) => (
        <Box
          key={label}
          sx={{ display: "flex", gap: 2, py: 0.25, fontSize: 12 }}
        >
          <Box sx={{ width: 190, color: "text.secondary" }}>{label}</Box>
          <Box>{value}</Box>
        </Box>
      ))}
      {missing.size > 0 && (
        <Box sx={{ mt: 1 }}>
          <Typography color="warning.main" variant="body2">
            缺失模型资源
          </Typography>
          {[...missing].map((id) => (
            <Typography key={id} variant="caption" sx={{ display: "block" }}>
              {nodes.find((n) => n.id === id)?.modelUrl || id}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  );
}
