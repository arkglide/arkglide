import { useState, useEffect, useRef } from "react";
import { Box, Tabs, Tab, Typography, IconButton, Tooltip } from "@mui/material";
import { DeleteSweep } from "@mui/icons-material";
import ContentPanel from "./ContentPanel";
import DiagnosticsPanel from "./DiagnosticsPanel";
import AssetBrowser from "./AssetBrowser";
import CodeEditor from "./CodeEditor";
import { useEditorStore } from "../../store/useEditorStore";

// 控制台面板：渲染 iframe 转发的 consoleLogs（远程调试台）
function ConsolePanel() {
  const consoleLogs = useEditorStore((s) => s.consoleLogs);
  const clearConsoleLogs = useEditorStore((s) => s.clearConsoleLogs);

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 1,
          py: 0.25,
          borderBottom: "1px solid #333333",
        }}
      >
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          控制台 ({consoleLogs.length})
        </Typography>
        <Tooltip title="清空">
          <IconButton size="small" onClick={clearConsoleLogs}>
            <DeleteSweep />
          </IconButton>
        </Tooltip>
      </Box>
      <Box
        sx={{
          flex: 1,
          overflow: "auto",
          p: 1,
          fontFamily: "monospace",
          fontSize: 12,
        }}
      >
        {consoleLogs.length === 0 && (
          <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
            {"> 暂无日志（点击播放运行脚本，console.log 会转发到这里）"}
          </Typography>
        )}
        {consoleLogs.map((log) => (
          <Box
            key={log.id}
            sx={{
              color:
                log.level === "error"
                  ? "#ff6b6b"
                  : log.level === "warn"
                    ? "#ffb74d"
                    : "#cccccc",
              mb: 0.25,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {log.location?.file && (
              <Box
                component="button"
                onClick={() =>
                  useEditorStore
                    .getState()
                    .navigateToScript(
                      log.location!.file!,
                      log.location?.line || 1,
                      log.location?.column || 1,
                    )
                }
                sx={{
                  color: "inherit",
                  background: "none",
                  border: 0,
                  p: 0,
                  mr: 1,
                  cursor: "pointer",
                  textDecoration: "underline",
                  font: "inherit",
                }}
              >
                {log.location.file}
                {log.location.line ? ":" + log.location.line : ""} ·{" "}
                {log.location.hook}
              </Box>
            )}
            {log.text}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// 底部 Tab 面板：控制台 / 代码编辑器 / 项目资源
export default function BottomPanel() {
  const [tab, setTab] = useState(0);
  const navigation = useEditorStore((s) => s.scriptNavigation);
  useEffect(() => {
    if (navigation) setTab(1);
  }, [navigation]);
  const editing = useEditorStore((s) => s.playState === "stopped");
  const resources = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (resources.current) resources.current.inert = !editing;
  }, [editing, tab]);

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ minHeight: 36, borderBottom: "1px solid #333" }}
      >
        <Tab label="控制台" />
        <Tab label="代码编辑器" />
        <Tab label="项目资源" />
        <Tab label="运行诊断" />
        <Tab label="材质与预制体" />
      </Tabs>
      <Box sx={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {tab === 0 && <ConsolePanel />}
        {tab === 1 && <CodeEditor />}
        {tab === 3 && <DiagnosticsPanel />}
        {tab === 4 && <ContentPanel />}
        {tab === 2 && (
          <Box
            ref={resources}
            sx={{ height: "100%", opacity: editing ? 1 : 0.6 }}
          >
            <AssetBrowser />
          </Box>
        )}
      </Box>
    </Box>
  );
}
