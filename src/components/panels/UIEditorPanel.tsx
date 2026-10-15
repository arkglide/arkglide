import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEditorStore } from "../../store/useEditorStore";
import { defaultGameplay, type HUDItem } from "../../types/gameplay";
import {
  hudLayout,
  hudAppearance,
  crosshairPreset,
  validateUIStyle,
  validateUIStyleSheet,
} from "../../utils/uiStyles";
import type { UIState } from "../../types/gameplay";
import { ValueField } from "./AdvancedGameplayPanel";
const names: Record<HUDItem["kind"], string> = {
  shape: "图形",
  text: "文本",
  button: "按钮",
  container: "容器",
  image: "图片",
  richtext: "富文本",
  input: "输入框",
  joystick: "摇杆",
};
export function UIEditorPanel({
  expanded = false,
  onClose,
}: { expanded?: boolean; onClose?: () => void } = {}) {
  const [focusedDesigner, setFocusedDesigner] = useState(false);
  const g = useEditorStore((s) => s.content.gameplay) || defaultGameplay(),
    textures = useEditorStore((s) => s.content.textures),
    buffers = useEditorStore((s) => s.textureBuffers),
    locked = useEditorStore((s) => s.playState) !== "stopped";
  const canvasRef = useRef<HTMLDivElement>(null),
    viewportRef = useRef<HTMLDivElement>(null);
  const [designWidth, setDesignWidth] = useState(1280),
    [designHeight, setDesignHeight] = useState(720),
    [zoom, setZoom] = useState(1);
  const [previewState, setPreviewState] = useState<"base" | UIState>("base");
  const [sheetDraft, setSheetDraft] = useState(""),
    [styleDraft, setStyleDraft] = useState("");
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const resize = () => setZoom(el.clientWidth / designWidth);
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    return () => observer.disconnect();
  }, [designWidth]);
  useEffect(
    () => setSheetDraft(JSON.stringify(g.styles || {}, null, 2)),
    [g.styles],
  );
  const [selected, setSelected] = useState(""),
    [draft, setDraft] = useState<HUDItem[] | null>(null),
    [error, setError] = useState(""),
    [urls, setURLs] = useState<Record<string, string>>({});
  const gesture = useRef<{
    id: string;
    x: number;
    y: number;
    rect: DOMRect;
    def: HUDItem;
    resize: boolean;
    next: HUDItem[];
  } | null>(null);
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const t of textures) {
      const raw = buffers.get(t.id);
      if (raw)
        next[t.id] = URL.createObjectURL(new Blob([raw], { type: t.mime }));
    }
    setURLs(next);
    return () => Object.values(next).forEach((u) => URL.revokeObjectURL(u));
  }, [textures, buffers]);
  useEffect(() => {
    setDraft(null);
    gesture.current = null;
  }, [g, locked]);
  const hud = draft || g.hud,
    h = hud.find((d) => d.id === selected),
    children = (id?: string | null) =>
      hud.filter((d) => (d.parentId || null) === (id || null));
  useEffect(
    () => setStyleDraft(JSON.stringify(h?.style || {}, null, 2)),
    [selected, h?.style],
  );
  function save(next: HUDItem[]) {
    try {
      useEditorStore.getState().updateGameplay({ ...g, hud: next });
      setError("");
      setDraft(null);
    } catch (e) {
      setError(String(e));
      setDraft(null);
    }
  }
  const appearance = h ? hudAppearance(h, g.styles) : {};
  const patch = (p: Partial<HUDItem>) =>
    h && save(g.hud.map((d) => (d.id === h.id ? { ...d, ...p } : d)));
  function subtree(id: string) {
    const ids = new Set([id]);
    let change = true;
    while (change) {
      change = false;
      for (const d of g.hud)
        if (d.parentId && ids.has(d.parentId) && !ids.has(d.id)) {
          ids.add(d.id);
          change = true;
        }
    }
    return ids;
  }
  function copy() {
    if (!h) return;
    const ids = subtree(h.id),
      map = new Map(
        [...ids].map((id) => [id, "hud_" + crypto.randomUUID().slice(0, 8)]),
      );
    const clones = g.hud
      .filter((d) => ids.has(d.id))
      .map((d) => ({
        ...structuredClone(d),
        id: map.get(d.id)!,
        parentId:
          d.parentId && map.has(d.parentId) ? map.get(d.parentId) : d.parentId,
        x:
          d.id === h.id
            ? Math.min(
                (d.positionUnit || d.unit) === "px" ? 10000 : 100,
                d.x + 3,
              )
            : d.x,
      }));
    save([...g.hud, ...clones]);
    setSelected(map.get(h.id)!);
  }
  function start(e: React.PointerEvent, id: string, resize = false) {
    e.stopPropagation();
    setSelected(id);
    if (locked) return;
    const def = g.hud.find((d) => d.id === id)!;
    const parent = g.hud.find((d) => d.id === def.parentId);
    if (!resize && parent?.layout && parent.layout !== "absolute") {
      setError("流式布局的子节点由容器排列；可调整间距或改为绝对布局");
      return;
    }
    const el = (e.target as HTMLElement).closest(
      "[data-ui-node]",
    ) as HTMLElement;
    const rect = el.parentElement!.getBoundingClientRect();
    gesture.current = {
      id,
      x: e.clientX,
      y: e.clientY,
      rect,
      def,
      resize,
      next: g.hud,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    const t = gesture.current;
    if (!t) return;
    const unit = t.resize
      ? t.def.sizeUnit || t.def.unit
      : t.def.positionUnit || t.def.unit;
    const sx = unit === "px" ? 1 / zoom : 100 / t.rect.width,
      sy = unit === "px" ? 1 / zoom : 100 / t.rect.height,
      max = unit === "px" ? 10000 : 100;
    const p = t.resize
      ? {
          width: Math.max(
            1,
            Math.min(max, (t.def.width ?? 20) + (e.clientX - t.x) * sx),
          ),
          height: Math.max(
            1,
            Math.min(max, (t.def.height ?? 10) + (e.clientY - t.y) * sy),
          ),
        }
      : {
          x: Math.max(0, Math.min(max, t.def.x + (e.clientX - t.x) * sx)),
          y: Math.max(0, Math.min(max, t.def.y + (e.clientY - t.y) * sy)),
        };
    t.next = g.hud.map((d) => (d.id === t.id ? { ...d, ...p } : d));
    setDraft(t.next);
  }
  function finish(cancel = false) {
    const t = gesture.current;
    gesture.current = null;
    if (t && !cancel) save(t.next);
    else setDraft(null);
  }
  function render(d: HUDItem, parent?: HUDItem): React.ReactNode {
    const css = hudLayout(
      d,
      parent,
      g.styles,
      previewState === "base" ? {} : { [previewState]: true },
    );
    return (
      <Box
        key={d.id}
        data-ui-node={d.id}
        style={
          {
            ...css,
            pointerEvents: "auto",
            touchAction: "none",
            userSelect: "none",
            opacity: d.visible === false ? 0.3 : (css.opacity ?? 1),
          } as CSSProperties
        }
        sx={{
          outline: d.id === selected ? "2px solid #90caf9" : "1px dashed #888",
          cursor: locked ? "default" : "move",
        }}
        onPointerDown={(e) => start(e, d.id)}
        onPointerMove={move}
        onPointerUp={() => finish()}
        onPointerCancel={() => finish(true)}
      >
        {d.kind === "image" ? (
          <img
            src={urls[d.textureId || ""]}
            alt={d.text}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              pointerEvents: "none",
            }}
          />
        ) : d.kind === "joystick" ? (
          <Box
            sx={{
              border: "2px solid",
              borderRadius: "50%",
              width: "100%",
              height: "100%",
              display: "grid",
              placeItems: "center",
            }}
          >
            ●
          </Box>
        ) : d.kind === "container" ? null : d.kind === "richtext" ? (
          d.text.replace(/\[\/?(?:b|i|color(?:=#[0-9a-f]{6})?)\]/gi, "")
        ) : (
          d.text
        )}
        {children(d.id).map((c) => render(c, d))}
        {d.id === selected && !locked && (
          <Box
            aria-label="调整 UI 尺寸"
            sx={{
              position: "absolute",
              right: -5,
              bottom: -5,
              width: 12,
              height: 12,
              background: "#90caf9",
              cursor: "nwse-resize",
              zIndex: 10001,
            }}
            onPointerDown={(e) => start(e, d.id, true)}
          />
        )}
      </Box>
    );
  }
  return (
    <Stack
      spacing={1}
      data-testid="ui-editor-panel"
      sx={{ height: expanded ? "100%" : undefined, minHeight: 0 }}
    >
      {error && <Alert severity="warning">{error}</Alert>}
      {locked && (
        <Alert severity="info">运行期间布局只读，停止后可编辑。</Alert>
      )}
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="body2">
          拖动布局 · 右下角缩放 · 一次手势一次撤销
        </Typography>
        {expanded ? (
          <Button onClick={onClose}>返回编辑器</Button>
        ) : (
          <Button onClick={() => setFocusedDesigner(true)}>大画布编辑</Button>
        )}
      </Stack>
      <Box
        sx={{
          display: expanded ? "grid" : "block",
          gridTemplateColumns: "minmax(0,1fr) 360px",
          gap: 2,
          minHeight: 0,
          flex: expanded ? 1 : undefined,
        }}
      >
        <Stack
          spacing={1}
          sx={{ minWidth: 0, overflow: expanded ? "auto" : undefined, pt: 1 }}
        >
          <Stack direction="row" spacing={1}>
            <ValueField
              label="预览宽度"
              value={designWidth}
              min={240}
              max={7680}
              step={1}
              onChange={setDesignWidth}
            />
            <ValueField
              label="预览高度"
              value={designHeight}
              min={240}
              max={7680}
              step={1}
              onChange={setDesignHeight}
            />
            <TextField
              select
              size="small"
              label="样式状态预览"
              value={previewState}
              onChange={(e) =>
                setPreviewState(e.target.value as typeof previewState)
              }
              sx={{ minWidth: 130 }}
            >
              {Object.entries({
                base: "普通",
                hover: "悬停",
                pressed: "按下",
                focus: "焦点",
                disabled: "禁用",
              }).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <Box
            ref={viewportRef}
            sx={{
              position: "relative",
              width: "100%",
              aspectRatio: `${designWidth} / ${designHeight}`,
              overflow: "hidden",
              background: "#171b26",
            }}
          >
            <Box
              ref={canvasRef}
              data-testid="ui-design-canvas"
              sx={{
                position: "relative",
                width: designWidth,
                height: designHeight,
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
                background: "#171b26",
                overflow: "hidden",
                border: "1px solid #777",
              }}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) setSelected("");
              }}
            >
              {children().map((d) => render(d))}
            </Box>
          </Box>
          <Stack direction="row" flexWrap="wrap">
            <Button
              disabled={locked}
              onClick={() => {
                const id = "reticle_" + crypto.randomUUID().slice(0, 8);
                save([...g.hud, ...crosshairPreset(id)]);
                setSelected(id);
              }}
            >
              添加十字准心
            </Button>
            <Button
              disabled={locked}
              onClick={() => {
                const id = "ring_" + crypto.randomUUID().slice(0, 8);
                save([
                  ...g.hud,
                  {
                    id,
                    kind: "shape",
                    shape: "ellipse",
                    text: "",
                    x: 50,
                    y: 50,
                    width: 24,
                    height: 24,
                    positionUnit: "percent",
                    sizeUnit: "px",
                    anchorX: 0.5,
                    anchorY: 0.5,
                    color: "#FFFFFF",
                    background: "transparent",
                    fontSize: 20,
                    style: {
                      borderWidth: 2,
                      borderColor: "#FFFFFF",
                      padding: 0,
                    },
                  },
                ]);
                setSelected(id);
              }}
            >
              添加圆环
            </Button>
            {(Object.keys(names) as HUDItem["kind"][]).map((kind) => (
              <Button
                key={kind}
                disabled={
                  locked ||
                  (kind === "image" && !textures.length) ||
                  (kind === "joystick" && g.actions.length < 2)
                }
                onClick={() => {
                  const id = "hud_" + crypto.randomUUID().slice(0, 8);
                  save([
                    ...g.hud,
                    {
                      id,
                      kind,
                      text: names[kind],
                      x: 5,
                      y: 5,
                      width: kind === "container" ? 80 : 20,
                      height: kind === "container" ? 70 : 12,
                      fontSize: 20,
                      color: "#FFFFFF",
                      background: kind === "shape" ? "#FFFFFF" : "#222222",
                      layout: "absolute",
                      parentId: h?.kind === "container" ? h.id : null,
                      ...(kind === "image"
                        ? { textureId: textures[0].id }
                        : {}),
                      ...(kind === "joystick"
                        ? {
                            width: 25,
                            height: 40,
                            joystick: {
                              mode: "fixed",
                              radius: 60,
                              deadzone: 0.15,
                              actionX: g.actions[0].name,
                              actionY: g.actions[1].name,
                            },
                          }
                        : {}),
                    },
                  ]);
                  setSelected(id);
                }}
              >
                添加{names[kind]}
              </Button>
            ))}
          </Stack>
        </Stack>
        <Stack
          spacing={1}
          sx={{ minWidth: 0, overflow: expanded ? "auto" : undefined, pt: 1 }}
        >
          <Box
            component="fieldset"
            disabled={locked}
            sx={{ border: 0, p: 0, m: 0 }}
          >
            <TextField
              fullWidth
              multiline
              minRows={3}
              maxRows={12}
              label="共享样式定义（JSON）"
              value={sheetDraft}
              onChange={(e) => setSheetDraft(e.target.value)}
              helperText="命名样式支持 base、hover、focus、pressed、disabled；元素可组合多个样式类。"
            />
            <Button
              onClick={() => {
                try {
                  const styles = JSON.parse(sheetDraft);
                  validateUIStyleSheet(styles);
                  useEditorStore.getState().updateGameplay({ ...g, styles });
                  setError("");
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              应用样式表
            </Button>
          </Box>
          <TextField
            select
            size="small"
            label="UI 层级选择"
            value={h?.id || ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            <MenuItem value="">无选择</MenuItem>
            {hud.map((d) => (
              <MenuItem key={d.id} value={d.id}>
                {d.parentId ? "↳ " : ""}
                {names[d.kind]} · {d.text || d.id} ({d.id})
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row">
            <Button disabled={locked || !h} onClick={copy}>
              复制子树
            </Button>
            <Button
              disabled={locked || !h}
              onClick={() =>
                h && save(g.hud.filter((d) => !subtree(h.id).has(d.id)))
              }
            >
              删除子树
            </Button>
            <Button
              disabled={locked}
              onClick={() => useEditorStore.getState().undo()}
            >
              撤销
            </Button>
            <Button
              disabled={locked}
              onClick={() => useEditorStore.getState().redo()}
            >
              重做
            </Button>
          </Stack>
          {h && (
            <Box
              component="fieldset"
              disabled={locked}
              sx={{ border: 0, m: 0, p: 0 }}
            >
              <Stack spacing={1}>
                <Typography variant="caption">ID：{h.id}</Typography>
                <TextField
                  select
                  label="样式类"
                  size="small"
                  SelectProps={{ multiple: true }}
                  value={h.classes || []}
                  onChange={(e) =>
                    patch({
                      classes:
                        typeof e.target.value === "string"
                          ? e.target.value.split(",")
                          : e.target.value,
                    })
                  }
                >
                  {Object.keys(g.styles || {}).map((name) => (
                    <MenuItem key={name} value={name}>
                      {name}
                    </MenuItem>
                  ))}
                </TextField>
                {h.kind === "shape" && (
                  <TextField
                    select
                    size="small"
                    label="图形类型"
                    value={h.shape || "rect"}
                    onChange={(e) =>
                      patch({ shape: e.target.value as HUDItem["shape"] })
                    }
                  >
                    <MenuItem value="rect">矩形 / 线段</MenuItem>
                    <MenuItem value="ellipse">圆形 / 椭圆</MenuItem>
                  </TextField>
                )}
                <TextField
                  label="UI 文本"
                  size="small"
                  value={h.text}
                  onChange={(e) => patch({ text: e.target.value })}
                />
                <TextField
                  select
                  label="父容器"
                  size="small"
                  value={h.parentId || ""}
                  onChange={(e) => patch({ parentId: e.target.value || null })}
                >
                  <MenuItem value="">画布根节点</MenuItem>
                  {hud
                    .filter(
                      (d) => d.kind === "container" && !subtree(h.id).has(d.id),
                    )
                    .map((d) => (
                      <MenuItem key={d.id} value={d.id}>
                        {d.text || d.id}
                      </MenuItem>
                    ))}
                </TextField>
                <TextField
                  select
                  label="坐标单位"
                  size="small"
                  value={h.positionUnit || h.unit || "percent"}
                  onChange={(e) =>
                    patch({
                      positionUnit: e.target.value as "px" | "percent",
                      x: Math.min(h.x, 100),
                      y: Math.min(h.y, 100),
                    })
                  }
                >
                  <MenuItem value="percent">百分比</MenuItem>
                  <MenuItem value="px">像素</MenuItem>
                </TextField>
                <TextField
                  select
                  size="small"
                  label="尺寸单位"
                  value={h.sizeUnit || h.unit || "percent"}
                  onChange={(e) =>
                    patch({ sizeUnit: e.target.value as HUDItem["sizeUnit"] })
                  }
                >
                  <MenuItem value="percent">百分比</MenuItem>
                  <MenuItem value="px">像素</MenuItem>
                </TextField>
                <Stack direction="row">
                  {(["x", "y", "width", "height"] as const).map((k) => (
                    <ValueField
                      key={k}
                      label={
                        { x: "X", y: "Y", width: "宽度", height: "高度" }[k]
                      }
                      value={h[k] ?? (k === "height" ? 12 : 20)}
                      min={0}
                      max={
                        (["width", "height"].includes(k)
                          ? h.sizeUnit || h.unit
                          : h.positionUnit || h.unit) === "px"
                          ? 10000
                          : 100
                      }
                      onChange={(v) => patch({ [k]: v })}
                    />
                  ))}
                </Stack>
                <Stack direction="row">
                  {(["anchorX", "anchorY"] as const).map((k) => (
                    <ValueField
                      key={k}
                      label={k === "anchorX" ? "水平锚点" : "垂直锚点"}
                      value={h[k] || 0}
                      min={0}
                      max={1}
                      onChange={(v) => patch({ [k]: v })}
                    />
                  ))}
                </Stack>
                <Stack direction="row">
                  {["左", "水平居中", "右", "上", "垂直居中", "下"].map(
                    (name, i) => (
                      <Button
                        key={name}
                        onClick={() =>
                          patch(
                            i < 3
                              ? {
                                  x:
                                    (h.positionUnit || h.unit) === "px"
                                      ? (i / 2) *
                                        (Array.from(
                                          canvasRef.current?.querySelectorAll<HTMLElement>(
                                            "[data-ui-node]",
                                          ) || [],
                                        ).find(
                                          (el) =>
                                            el.dataset.uiNode === h.parentId,
                                        )?.clientWidth ||
                                          canvasRef.current?.clientWidth ||
                                          640)
                                      : (i / 2) * 100,
                                  anchorX: i / 2,
                                }
                              : {
                                  y:
                                    (h.positionUnit || h.unit) === "px"
                                      ? ((i - 3) / 2) *
                                        (Array.from(
                                          canvasRef.current?.querySelectorAll<HTMLElement>(
                                            "[data-ui-node]",
                                          ) || [],
                                        ).find(
                                          (el) =>
                                            el.dataset.uiNode === h.parentId,
                                        )?.clientHeight ||
                                          canvasRef.current?.clientHeight ||
                                          360)
                                      : ((i - 3) / 2) * 100,
                                  anchorY: (i - 3) / 2,
                                },
                          )
                        }
                      >
                        {name}
                      </Button>
                    ),
                  )}
                </Stack>
                {h.kind === "container" && (
                  <>
                    <TextField
                      select
                      label="容器布局"
                      size="small"
                      value={h.layout || "absolute"}
                      onChange={(e) =>
                        patch({ layout: e.target.value as HUDItem["layout"] })
                      }
                    >
                      {["absolute", "row", "column", "grid"].map((v) => (
                        <MenuItem key={v} value={v}>
                          {
                            {
                              absolute: "绝对定位",
                              row: "横排",
                              column: "竖排",
                              grid: "网格",
                            }[v]
                          }
                        </MenuItem>
                      ))}
                    </TextField>
                    <ValueField
                      label="网格列数"
                      value={h.columns || 2}
                      min={1}
                      max={64}
                      step={1}
                      onChange={(v) => patch({ columns: v })}
                    />
                  </>
                )}
                <Stack direction="row">
                  {(
                    ["gap", "margin", "zIndex", "tabIndex", "fontSize"] as const
                  ).map((k) => (
                    <ValueField
                      key={k}
                      label={
                        {
                          gap: "间距",
                          margin: "外边距",
                          zIndex: "层级",
                          tabIndex: "导航顺序",
                          fontSize: "字号",
                        }[k]
                      }
                      value={h[k] ?? (k === "fontSize" ? 20 : 0)}
                      min={k === "tabIndex" ? -1 : 0}
                      max={k === "fontSize" ? 128 : 10000}
                      step={1}
                      onChange={(v) => patch({ [k]: v })}
                    />
                  ))}
                </Stack>
                <Stack direction="row">
                  {(["color", "background"] as const).map((k) => (
                    <TextField
                      key={k}
                      type="color"
                      fullWidth
                      sx={{ minWidth: 100 }}
                      label={k === "color" ? "前景颜色" : "背景颜色"}
                      size="small"
                      value={h[k] === "transparent" ? "#222222" : h[k]}
                      onChange={(e) => patch({ [k]: e.target.value })}
                    />
                  ))}
                </Stack>
                <FormControlLabel
                  label="透明背景"
                  control={
                    <Checkbox
                      checked={
                        h.background === "transparent" ||
                        h.style?.backgroundColor === "transparent"
                      }
                      onChange={(e) =>
                        patch({
                          background: e.target.checked
                            ? "transparent"
                            : "#222222",
                          style: {
                            ...h.style,
                            backgroundColor: e.target.checked
                              ? "transparent"
                              : "#222222",
                          },
                        })
                      }
                    />
                  }
                />
                <Stack direction="row" flexWrap="wrap">
                  {(
                    [
                      "opacity",
                      "padding",
                      "borderWidth",
                      "borderRadius",
                      "rotation",
                    ] as const
                  ).map((key) => (
                    <ValueField
                      key={key}
                      label={
                        {
                          opacity: "透明度",
                          padding: "内边距",
                          borderWidth: "边框宽度",
                          borderRadius: "圆角（px）",
                          rotation: "旋转（度）",
                        }[key]
                      }
                      value={
                        typeof appearance[key] === "number"
                          ? (appearance[key] as number)
                          : key === "opacity"
                            ? 1
                            : 0
                      }
                      min={key === "rotation" ? -360 : 0}
                      max={
                        key === "opacity" ? 1 : key === "rotation" ? 360 : 10000
                      }
                      step={key === "opacity" ? 0.05 : 1}
                      onChange={(value) =>
                        patch({ style: { ...h.style, [key]: value } })
                      }
                    />
                  ))}
                </Stack>
                <TextField
                  fullWidth
                  multiline
                  minRows={3}
                  maxRows={10}
                  label="元素样式覆盖（JSON）"
                  value={styleDraft}
                  onChange={(e) => setStyleDraft(e.target.value)}
                  helperText="支持 borderColor、fontFamily、textAlign、mixBlendMode、boxShadow 等；空对象继承共享样式。"
                />
                <Stack direction="row">
                  <Button
                    onClick={() => {
                      try {
                        const style = JSON.parse(styleDraft);
                        validateUIStyle(style);
                        patch({ style });
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  >
                    应用元素样式
                  </Button>
                  <Button onClick={() => patch({ style: {} })}>
                    清除元素覆盖
                  </Button>
                </Stack>
                {(["disabled", "visible", "blockInput"] as const).map((k) => (
                  <FormControlLabel
                    key={k}
                    label={
                      {
                        disabled: "禁用",
                        visible: "显示",
                        blockInput: "阻止游戏输入",
                      }[k]
                    }
                    control={
                      <Checkbox
                        checked={h[k] ?? k === "visible"}
                        onChange={(e) => patch({ [k]: e.target.checked })}
                      />
                    }
                  />
                ))}
                {h.kind === "image" && (
                  <TextField
                    select
                    label="图片资源"
                    size="small"
                    value={h.textureId || ""}
                    onChange={(e) => patch({ textureId: e.target.value })}
                  >
                    {textures.map((t) => (
                      <MenuItem key={t.id} value={t.id}>
                        {t.name}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
                {h.kind === "richtext" && (
                  <Typography variant="caption">
                    仅支持 [b]、[i]、[color=#RRGGBB]
                    与对应闭合标签。画布预览文本，运行时显示样式。
                  </Typography>
                )}
                {h.kind === "button" && (
                  <TextField
                    select
                    label="按钮动作"
                    size="small"
                    value={h.action || ""}
                    onChange={(e) =>
                      patch({ action: e.target.value || undefined })
                    }
                  >
                    <MenuItem value="">仅 UI 事件</MenuItem>
                    {g.actions.map((a) => (
                      <MenuItem key={a.name} value={a.name}>
                        {a.name}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
                {h.joystick && (
                  <>
                    <TextField
                      select
                      label="摇杆模式"
                      size="small"
                      value={h.joystick.mode}
                      onChange={(e) =>
                        patch({
                          joystick: {
                            ...h.joystick!,
                            mode: e.target.value as "fixed" | "floating",
                          },
                        })
                      }
                    >
                      <MenuItem value="fixed">固定</MenuItem>
                      <MenuItem value="floating">触摸位置浮动</MenuItem>
                    </TextField>
                    {(["radius", "deadzone"] as const).map((k) => (
                      <ValueField
                        key={k}
                        label={k === "radius" ? "摇杆半径（px）" : "摇杆死区"}
                        value={h.joystick![k]}
                        min={k === "radius" ? 16 : 0}
                        max={k === "radius" ? 500 : 0.95}
                        onChange={(v) =>
                          patch({ joystick: { ...h.joystick!, [k]: v } })
                        }
                      />
                    ))}
                    {(["actionX", "actionY"] as const).map((k) => (
                      <TextField
                        key={k}
                        select
                        size="small"
                        label={k === "actionX" ? "水平动作" : "垂直动作"}
                        value={h.joystick![k]}
                        onChange={(e) =>
                          patch({
                            joystick: { ...h.joystick!, [k]: e.target.value },
                          })
                        }
                      >
                        {g.actions.map((a) => (
                          <MenuItem key={a.name} value={a.name}>
                            {a.name}
                          </MenuItem>
                        ))}
                      </TextField>
                    ))}
                  </>
                )}
              </Stack>
            </Box>
          )}
        </Stack>
      </Box>
      {!expanded && (
        <Dialog
          fullScreen
          open={focusedDesigner}
          onClose={() => setFocusedDesigner(false)}
          aria-labelledby="ui-designer-title"
        >
          <DialogTitle id="ui-designer-title">UI 设计器</DialogTitle>
          <DialogContent sx={{ minHeight: 0, overflow: "hidden" }}>
            <UIEditorPanel expanded onClose={() => setFocusedDesigner(false)} />
          </DialogContent>
        </Dialog>
      )}
    </Stack>
  );
}
