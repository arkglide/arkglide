import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEditorStore, type SceneNode } from "../../store/useEditorStore";
import {
  defaultPhysics,
  defaultGameplay,
  type GameplayConfig,
  type HUDItem,
} from "../../types/gameplay";
import { importAudioFile } from "../../utils/audioImport";
function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 100000,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <TextField
      size="small"
      type="number"
      label={label}
      value={value}
      inputProps={{ min, max, step }}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
      }}
    />
  );
}
export function NodeGameplayInspector({ node }: { node: SceneNode }) {
  const editing = useEditorStore((s) => s.playState === "stopped");
  const content = useEditorStore((s) => s.content),
    clips = useEditorStore((s) => s.modelAnimations)[node.id] || [],
    [error, setError] = useState("");
  const patch = (p: Partial<SceneNode>) => {
    try {
      useEditorStore.getState().updateTransform(node.id, p);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  const p = node.physics,
    a = node.animation,
    s = node.audioSource;
  return (
    <Stack
      component="fieldset"
      disabled={!editing}
      sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}
      spacing={1}
      data-testid="gameplay-inspector"
    >
      <Divider />
      {error && <Alert severity="warning">{error}</Alert>}
      {["mesh", "model", "empty"].includes(node.type) && (
        <>
          <Typography variant="caption">刚体与碰撞体 · Jolt WASM</Typography>
          <Button
            size="small"
            onClick={() => patch({ physics: p ? undefined : defaultPhysics() })}
          >
            {p ? "移除刚体" : "添加刚体"}
          </Button>
          {p && (
            <>
              <Stack direction="row" spacing={1}>
                <TextField
                  select
                  size="small"
                  label="刚体类型"
                  value={p.motion}
                  onChange={(e) =>
                    patch({ physics: { ...p, motion: e.target.value as any } })
                  }
                >
                  {[
                    ["static", "静态"],
                    ["dynamic", "动态"],
                    ["kinematic", "运动学"],
                  ].map(([v, l]) => (
                    <MenuItem key={v} value={v}>
                      {l}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  size="small"
                  label="碰撞体形状"
                  value={p.shape}
                  onChange={(e) =>
                    patch({ physics: { ...p, shape: e.target.value as any } })
                  }
                >
                  {[
                    ["box", "盒体"],
                    ["sphere", "球体"],
                    ["capsule", "胶囊"],
                  ].map(([v, l]) => (
                    <MenuItem key={v} value={v}>
                      {l}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
              <Typography variant="caption">
                尺寸为局部单位；球体 X 为直径，胶囊 X 为直径、Y 为总高度。
              </Typography>
              <Stack direction="row" spacing={1}>
                {(["x", "y", "z"] as const).map((k) => (
                  <NumberField
                    key={k}
                    label={"碰撞尺寸 " + k.toUpperCase()}
                    value={p.size[k]}
                    min={0.001}
                    max={10000}
                    onChange={(v) =>
                      patch({ physics: { ...p, size: { ...p.size, [k]: v } } })
                    }
                  />
                ))}
              </Stack>
              <NumberField
                label="质量 kg"
                value={p.mass}
                min={0.001}
                onChange={(v) => patch({ physics: { ...p, mass: v } })}
              />
              <Stack direction="row" spacing={1}>
                <NumberField
                  label="摩擦系数"
                  value={p.friction}
                  max={1}
                  onChange={(v) => patch({ physics: { ...p, friction: v } })}
                />
                <NumberField
                  label="弹性系数"
                  value={p.restitution}
                  max={1}
                  onChange={(v) => patch({ physics: { ...p, restitution: v } })}
                />
              </Stack>
              <FormControlLabel
                label="触发器（不产生碰撞阻挡）"
                control={
                  <Checkbox
                    checked={p.sensor}
                    onChange={(e) =>
                      patch({ physics: { ...p, sensor: e.target.checked } })
                    }
                  />
                }
              />
              <FormControlLabel
                label="锁定旋转"
                control={
                  <Checkbox
                    checked={p.lockRotation}
                    onChange={(e) =>
                      patch({
                        physics: { ...p, lockRotation: e.target.checked },
                      })
                    }
                  />
                }
              />
            </>
          )}
        </>
      )}
      {node.type === "model" && (
        <>
          <Divider />
          <Typography variant="caption">模型动画</Typography>
          <Button
            size="small"
            onClick={() =>
              patch({
                animation: a
                  ? undefined
                  : {
                      clip: clips[0] || "",
                      autoplay: true,
                      loop: true,
                      speed: 1,
                    },
              })
            }
          >
            {a ? "移除动画配置" : "添加动画配置"}
          </Button>
          {a && (
            <>
              <TextField
                select
                size="small"
                label="动画片段"
                value={a.clip}
                onChange={(e) =>
                  patch({ animation: { ...a, clip: e.target.value } })
                }
              >
                {[...new Set(["", ...clips, a.clip])].map((c) => (
                  <MenuItem key={c} value={c}>
                    {c || "未选择动画"}
                  </MenuItem>
                ))}
              </TextField>
              {!clips.length && (
                <Typography variant="caption">
                  加载含动画的 GLB/glTF 后显示片段。
                </Typography>
              )}
              <NumberField
                label="动画速度"
                value={a.speed}
                max={100}
                onChange={(v) => patch({ animation: { ...a, speed: v } })}
              />
              {(["autoplay", "loop"] as const).map((k) => (
                <FormControlLabel
                  key={k}
                  label={k === "autoplay" ? "自动播放" : "循环"}
                  control={
                    <Checkbox
                      checked={a[k]}
                      onChange={(e) =>
                        patch({ animation: { ...a, [k]: e.target.checked } })
                      }
                    />
                  }
                />
              ))}
            </>
          )}
        </>
      )}
      <Divider />
      <Typography variant="caption">音源</Typography>
      <TextField
        select
        size="small"
        label="音源资源"
        value={s?.assetId || ""}
        onChange={(e) =>
          patch({
            audioSource: e.target.value
              ? {
                  autoplay: true,
                  loop: false,
                  volume: 1,
                  spatial: false,
                  refDistance: 1,
                  ...s,
                  ...{ assetId: e.target.value },
                }
              : undefined,
          })
        }
      >
        <MenuItem value="">无音源</MenuItem>
        {content.audio?.map((a) => (
          <MenuItem key={a.id} value={a.id}>
            {a.name}
          </MenuItem>
        ))}
      </TextField>
      {s && (
        <>
          <NumberField
            label="音源音量"
            value={s.volume}
            max={1}
            onChange={(v) => patch({ audioSource: { ...s, volume: v } })}
          />
          {(["autoplay", "loop", "spatial"] as const).map((k) => (
            <FormControlLabel
              key={k}
              label={
                { autoplay: "自动播放", loop: "循环播放", spatial: "空间音频" }[
                  k
                ]
              }
              control={
                <Checkbox
                  checked={s[k]}
                  onChange={(e) =>
                    patch({ audioSource: { ...s, [k]: e.target.checked } })
                  }
                />
              }
            />
          ))}
          {s.spatial && (
            <NumberField
              label="参考距离"
              value={s.refDistance}
              min={0.01}
              max={10000}
              onChange={(v) => patch({ audioSource: { ...s, refDistance: v } })}
            />
          )}
        </>
      )}
    </Stack>
  );
}
export function AudioPanel() {
  const assets = useEditorStore((s) => s.content.audio) || [],
    buffers = useEditorStore((s) => s.audioBuffers),
    [error, setError] = useState("");
  const run = async (fn: () => any) => {
    try {
      await fn();
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <Stack spacing={1} data-testid="audio-panel">
      {error && <Alert severity="warning">{error}</Alert>}
      <Button component="label">
        导入音频
        <input
          hidden
          type="file"
          aria-label="导入音频"
          accept=".wav,.mp3,.ogg,.m4a,.webm"
          multiple
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            void run(async () => {
              for (const f of files) await importAudioFile(f);
            });
          }}
        />
      </Button>
      <Typography variant="caption">
        单文件最大 32 MiB。播放预览后点击「启用音频」允许浏览器发声。
      </Typography>
      {assets.map((a) => (
        <Box
          key={a.id}
          sx={{ p: 1, border: "1px solid #444", borderRadius: 1 }}
        >
          <Typography>
            {a.name} · {(a.byteLength / 1024).toFixed(1)} KiB
          </Typography>
          <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
            资源 ID：{a.id}
          </Typography>
          {!buffers.has(a.id) && (
            <Alert severity="warning">音频丢失，请重新链接</Alert>
          )}
          <Stack direction="row">
            <Button component="label">
              {buffers.has(a.id) ? "替换音频" : "重新链接音频"}
              <input
                hidden
                type="file"
                aria-label={"替换音频 " + a.name}
                accept=".wav,.mp3,.ogg,.m4a,.webm"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void run(() => importAudioFile(f, a.id));
                }}
              />
            </Button>
            <Button
              onClick={() =>
                void run(() => useEditorStore.getState().deleteAudio(a.id))
              }
            >
              删除音频
            </Button>
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}
export function GameplayPanel() {
  const config = useEditorStore((s) => s.content.gameplay) || defaultGameplay(),
    [error, setError] = useState("");
  function save(next: GameplayConfig) {
    try {
      useEditorStore.getState().updateGameplay(next);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  function hud(id: string, p: Partial<HUDItem>) {
    save({
      ...config,
      hud: config.hud.map((h) => (h.id === id ? { ...h, ...p } : h)),
    });
  }
  return (
    <Stack spacing={1} data-testid="input-hud-panel">
      {error && <Alert severity="warning">{error}</Alert>}
      <Typography>动作映射</Typography>
      <Typography variant="caption">
        使用 KeyboardEvent.code，如
        KeyW、Space、ArrowLeft。逗号分隔多个按键；触屏按钮可绑定同一动作。
      </Typography>
      <FormControlLabel
        label="拦截映射按键的浏览器默认行为"
        control={
          <Checkbox
            checked={config.captureInput}
            onChange={(e) =>
              save({ ...config, captureInput: e.target.checked })
            }
          />
        }
      />
      {config.actions.map((a, i) => (
        <Stack key={i} direction="row" spacing={1}>
          <TextField
            key={a.name}
            size="small"
            label="动作名"
            defaultValue={a.name}
            onBlur={(e) =>
              save({
                ...config,
                actions: config.actions.map((v, j) =>
                  j === i ? { ...v, name: e.target.value.trim() } : v,
                ),
              })
            }
          />
          {(["positive", "negative"] as const).map((k) => (
            <TextField
              key={a[k].join(",")}
              size="small"
              label={k === "positive" ? "正向按键" : "反向按键"}
              defaultValue={a[k].join(",")}
              onBlur={(e) =>
                save({
                  ...config,
                  actions: config.actions.map((v, j) =>
                    j === i
                      ? {
                          ...v,
                          [k]: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        }
                      : v,
                  ),
                })
              }
            />
          ))}
          <Button
            onClick={() =>
              save({
                ...config,
                actions: config.actions.filter((_, j) => j !== i),
              })
            }
          >
            删除动作
          </Button>
        </Stack>
      ))}
      <Button
        onClick={() =>
          save({
            ...config,
            actions: [
              ...config.actions,
              {
                name: "action_" + crypto.randomUUID().slice(0, 8),
                positive: [],
                negative: [],
              },
            ],
          })
        }
      >
        添加动作
      </Button>
      <Divider />
      <Typography>游戏 HUD</Typography>
      <Typography variant="caption">
        位置按运行区域百分比排列。文本支持脚本
        ui.get(id).setText()；按钮支持键鼠与多点触屏。
      </Typography>
      <Stack direction="row">
        {(["text", "button"] as const).map((kind) => (
          <Button
            key={kind}
            onClick={() =>
              save({
                ...config,
                hud: [
                  ...config.hud,
                  {
                    id: "hud_" + crypto.randomUUID().slice(0, 8),
                    kind,
                    text: kind === "text" ? "分数：0" : "按钮",
                    x: 5,
                    y: 5,
                    color: "#FFFFFF",
                    background: "#222222",
                    fontSize: 20,
                  },
                ],
              })
            }
          >
            {kind === "text" ? "添加文本" : "添加按钮"}
          </Button>
        ))}
      </Stack>
      {config.hud.map((h) => (
        <Stack
          key={h.id}
          spacing={1}
          sx={{ p: 1, border: "1px solid #444", borderRadius: 1 }}
        >
          <Typography variant="caption">ID：{h.id}</Typography>
          <TextField
            size="small"
            label="HUD 文本"
            value={h.text}
            onChange={(e) => hud(h.id, { text: e.target.value })}
          />
          <Stack direction="row" spacing={1}>
            <NumberField
              label="X %"
              value={h.x}
              max={100}
              onChange={(v) => hud(h.id, { x: v })}
            />
            <NumberField
              label="Y %"
              value={h.y}
              max={100}
              onChange={(v) => hud(h.id, { y: v })}
            />
            <NumberField
              label="字号"
              value={h.fontSize}
              min={8}
              max={128}
              step={1}
              onChange={(v) => hud(h.id, { fontSize: v })}
            />
          </Stack>
          <Stack direction="row" spacing={1}>
            {(["color", "background"] as const).map((k) => (
              <TextField
                key={k}
                size="small"
                type="color"
                label={k === "color" ? "文字颜色" : "背景颜色"}
                value={h[k]}
                onChange={(e) => hud(h.id, { [k]: e.target.value })}
              />
            ))}
          </Stack>
          {h.kind === "button" && (
            <Stack direction="row" spacing={1}>
              <TextField
                select
                size="small"
                label="绑定输入动作"
                value={h.action || ""}
                onChange={(e) =>
                  hud(h.id, { action: e.target.value || undefined })
                }
              >
                <MenuItem value="">仅脚本点击事件</MenuItem>
                {config.actions.map((a) => (
                  <MenuItem key={a.name} value={a.name}>
                    {a.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                label="方向"
                value={h.direction || 1}
                onChange={(e) =>
                  hud(h.id, { direction: Number(e.target.value) as 1 | -1 })
                }
              >
                <MenuItem value={1}>正向</MenuItem>
                <MenuItem value={-1}>反向</MenuItem>
              </TextField>
            </Stack>
          )}
          <Button
            onClick={() =>
              save({ ...config, hud: config.hud.filter((v) => v.id !== h.id) })
            }
          >
            删除 HUD
          </Button>
        </Stack>
      ))}
    </Stack>
  );
}
