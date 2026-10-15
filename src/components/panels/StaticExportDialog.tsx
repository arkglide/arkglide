import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { useEditorStore } from "../../store/useEditorStore";
import { exportSettings } from "../../export/export-settings.mjs";
import {
  createEditorStaticGame,
  downloadStaticGame,
} from "../../utils/staticGameExport";
export default function StaticExportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const projectName = useEditorStore((s) => s.currentProjectName),
    playState = useEditorStore((s) => s.playState);
  const [title, setTitle] = useState(""),
    [fit, setFit] = useState<"responsive" | "contain">("responsive");
  const [width, setWidth] = useState("1280"),
    [height, setHeight] = useState("720");
  const [protectCode, setProtectCode] = useState(true),
    [showLogs, setShowLogs] = useState(false),
    [preload, setPreload] = useState("");
  const [busy, setBusy] = useState(false),
    [stage, setStage] = useState(""),
    [error, setError] = useState("");
  const [artifact, setArtifact] = useState<{
    manifest: any;
    zip: () => Uint8Array;
  } | null>(null);
  const documentId = useEditorStore((s) => s.documentId);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!open) return;
    const c = useEditorStore.getState().settings.build || {};
    setTitle(c.title || "");
    setFit(c.fit || "responsive");
    setWidth(String(c.width || 1280));
    setHeight(String(c.height || 720));
    setProtectCode(c.protectCode ?? true);
    setShowLogs(c.showLogs ?? false);
    setPreload((c.preload || []).join("\n"));
    setError("");
  }, [open, documentId]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    controller.current?.abort();
    setArtifact(null);
  }, [documentId]);
  useEffect(() => {
    setArtifact(null);
  }, [title, fit, width, height, protectCode, showLogs, preload]);
  const close = () => {
    controller.current?.abort();
    if (!busy) onClose();
  };
  const run = async () => {
    controller.current = new AbortController();
    setBusy(true);
    setArtifact(null);
    setError("");
    setStage("准备分块运行时");
    try {
      const build = exportSettings({
        ...useEditorStore.getState().settings.build,
        title: title || projectName,
        fit,
        width: Number(width),
        height: Number(height),
        protectCode,
        showLogs,
        preload: preload
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      useEditorStore.getState().updateSettings({ build });
      const game = await createEditorStaticGame(
        build,
        controller.current.signal,
        (done, total, stage) =>
          setStage(stage || `读取运行模块 ${done}/${total}`),
      );
      setArtifact(game);
      useEditorStore
        .getState()
        .addConsoleLog(
          "log",
          `游戏打包完成：${game.manifest.statistics.resources} 个资源，${game.manifest.statistics.files} 份文件。`,
        );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.name === "AbortError"
            ? "导出已取消"
            : error.message
          : String(error),
      );
    } finally {
      controller.current = null;
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle>导出独立游戏</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>
          生成自动进入游戏的 Web
          运行包。场景和预制体分块存储，资源按需加载；启动时显示模块加载记录，进入游戏后清除。
        </Typography>
        <TextField
          fullWidth
          label="游戏标题"
          value={title}
          placeholder={projectName}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
          sx={{ mt: 1 }}
        />
        <TextField
          fullWidth
          select
          label="运行尺寸"
          value={fit}
          onChange={(e) => setFit(e.target.value as typeof fit)}
          disabled={busy}
          sx={{ mt: 2 }}
        >
          <MenuItem value="responsive">适应窗口</MenuItem>
          <MenuItem value="contain">按设计比例缩放（留黑边）</MenuItem>
        </TextField>
        <Box sx={{ display: "flex", gap: 2, mt: 2 }}>
          <TextField
            type="number"
            label="设计宽度"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            disabled={busy}
          />
          <TextField
            type="number"
            label="设计高度"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            disabled={busy}
          />
        </Box>
        <FormControlLabel
          control={
            <Checkbox
              checked={protectCode}
              disabled={busy}
              onChange={(e) => setProtectCode(e.target.checked)}
            />
          }
          label="代码保护（压缩、变量改名、隐藏源文件名）"
        />
        <Typography variant="caption" sx={{ display: "block" }}>
          保护会提高阅读成本；浏览器端代码仍可被分析，不应包含密钥。
        </Typography>
        <FormControlLabel
          control={
            <Checkbox
              checked={showLogs}
              disabled={busy}
              onChange={(e) => setShowLogs(e.target.checked)}
            />
          }
          label="在游戏界面显示日志"
        />
        <TextField
          fullWidth
          multiline
          minRows={2}
          label="额外预加载资源"
          value={preload}
          disabled={busy}
          onChange={(e) => setPreload(e.target.value)}
          helperText="每行一个 kind:id，例如 audio:music。脚本动态使用资源也可先 await assets.load(kind,id)。"
          sx={{ mt: 1 }}
        />
        {playState !== "stopped" && (
          <Alert severity="warning">请先停止编辑器运行。</Alert>
        )}
        {busy && (
          <Typography role="status" sx={{ mt: 2, fontFamily: "monospace" }}>
            &gt; {stage}
          </Typography>
        )}
        {artifact && (
          <Alert severity="success" sx={{ mt: 2 }}>
            打包完成：{artifact.manifest.statistics.resources} 个资源，
            {artifact.manifest.statistics.files} 份文件，ZIP{" "}
            {(artifact.zip().byteLength / 1024 / 1024).toFixed(2)} MiB。
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{busy ? "取消导出" : "关闭"}</Button>
        <Button disabled={busy || playState !== "stopped"} onClick={run}>
          {artifact ? "重新打包" : "开始打包"}
        </Button>
        {artifact && (
          <Button
            variant="contained"
            onClick={() => downloadStaticGame(artifact)}
          >
            下载游戏 ZIP
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
