import { Box, Typography } from "@mui/material";
import { useEditorStore } from "../../store/useEditorStore";
export default function DiagnosticsPanel() {
  const stats = useEditorStore((s) => s.runtimeStats),
    missing = useEditorStore((s) => s.missingModelIds),
    nodes = useEditorStore((s) => s.nodes);
  const rows = stats
    ? [
        ["状态 / 数学后端", `${stats.state} / ${stats.mathBackend}`],
        ["FPS", stats.fps.toFixed(1)],
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
      <Typography variant="body2" sx={{ mb: 1 }}>
        运行诊断（约每 0.5 秒更新）
      </Typography>
      {!stats && (
        <Typography color="text.secondary" variant="body2">
          播放后显示数据。停止后可检查实体、脚本和订阅是否已释放。
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
      <Typography variant="caption" color="text.secondary">
        CPU 数据表示本帧同步执行耗时，不是 GPU
        时间。灯光和相机计数包含运行器的基础对象；JS 堆内存不代表 WASM 或显存。
      </Typography>
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
