import { useRef, useState } from "react";
import { Alert, Button, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from "@mui/material";
import { useEditorStore } from "../../store/useEditorStore";
import { importTextureFile } from "../../utils/textureImport";
import type { RenderingSettings, ReflectionProbeSettings } from "../../types/rendering";
import "../../engine/rendering-config.js";

export function RenderingSettingsPanel({ value, onChange }: { value?: RenderingSettings; onChange: (value: RenderingSettings) => void }) {
  const textures = useEditorStore(s => s.content.textures);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const defaults = (globalThis as any).ArkGlideRenderingConfig.settings();
  const c = {
    shadows: { ...defaults.shadows, ...value?.shadows },
    environment: { ...defaults.environment, ...value?.environment },
    color: { ...defaults.color, ...value?.color },
    ao: { ...defaults.ao, ...value?.ao },
    bloom: { ...defaults.bloom, ...value?.bloom },
  };
  const change = (section: keyof typeof c, patch: object) => onChange({ ...value, [section]: { ...c[section], ...patch } });
  const number = (section: keyof typeof c, field: string, label: string, min: number, max: number, step = 0.1) => (
    <TextField key={section + field} label={label} size="small" type="number" value={c[section][field]} inputProps={{ min, max, step }} onChange={e => change(section, { [field]: e.target.value.trim() ? Number(e.target.value) : NaN })} />
  );
  return <Stack spacing={1.5} sx={{ mt: 3 }} data-testid="rendering-settings">
    <Typography variant="subtitle2">画面与光照</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    <FormControlLabel label="实时软阴影" control={<Switch checked={c.shadows.enabled} onChange={e => change("shadows", { enabled: e.target.checked })} />} />
    <Stack direction="row" spacing={1}>
      <TextField label="阴影分辨率" size="small" select value={c.shadows.mapSize} onChange={e => change("shadows", { mapSize: Number(e.target.value) })} sx={{ flex: 1 }}>{[256, 512, 1024, 2048, 4096].map(n => <MenuItem key={n} value={n}>{n}</MenuItem>)}</TextField>
      <TextField label="软阴影方式" size="small" select value={c.shadows.filter} onChange={e => change("shadows", { filter: e.target.value })} sx={{ flex: 1 }}>{[["pcf", "柔和"], ["pcss", "接触渐变"], ["poisson", "兼容模式"]].map(([v, n]) => <MenuItem key={v} value={v}>{n}</MenuItem>)}</TextField>
    </Stack>
    <Stack direction="row" spacing={1}>{number("shadows", "maxDistance", "阴影距离", 1, 10000, 1)}{number("shadows", "maxLights", "阴影灯数量", 1, 8, 1)}</Stack>
    <Stack direction="row" spacing={1}>{number("shadows", "bias", "阴影深度偏移", 0, 0.1, 0.0001)}{number("shadows", "normalBias", "阴影法线偏移", 0, 1, 0.005)}</Stack>
    <TextField label="环境光照贴图" size="small" select value={c.environment.textureId || ""} onChange={e => change("environment", { textureId: e.target.value || null })}>
      <MenuItem value="">无</MenuItem>
      {textures.filter(t => ["application/x-babylon-env", "image/vnd.radiance"].includes(t.mime)).map(t => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
    </TextField>
    <Button size="small" onClick={() => input.current?.click()}>导入环境贴图（.env / .hdr）</Button>
    <input ref={input} type="file" accept=".env,.hdr" hidden onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
      try { const textureId = await importTextureFile(file); change("environment", { textureId }); setError(""); } catch (e) { setError(String(e)); }
    }} />
    <Stack direction="row" spacing={1}>{number("environment", "intensity", "环境亮度", 0, 20)}{number("environment", "rotation", "环境旋转（弧度）", -Math.PI * 2, Math.PI * 2)}</Stack>
    <FormControlLabel label="显示环境天空盒" control={<Switch checked={c.environment.skybox} onChange={e => change("environment", { skybox: e.target.checked })} />} />
    <TextField label="色调映射" select size="small" value={c.color.toneMapping} onChange={e => change("color", { toneMapping: e.target.value })}>{[["none", "关闭"], ["standard", "标准"], ["aces", "ACES 电影色调"]].map(([v, n]) => <MenuItem key={v} value={v}>{n}</MenuItem>)}</TextField>
    <Stack direction="row" spacing={1}>{number("color", "exposure", "曝光", 0.01, 20)}{number("color", "contrast", "对比度", 0, 4)}</Stack>
    <Stack direction="row" spacing={1}>{number("color", "saturation", "饱和度", -100, 100, 1)}{number("color", "hue", "染色色相（度）", 0, 360, 1)}{number("color", "tint", "染色强度", 0, 100, 1)}</Stack>
    <FormControlLabel label="高光泛光（Bloom）" control={<Switch checked={c.bloom.enabled} onChange={e => change("bloom", { enabled: e.target.checked })} />} />
    <Stack direction="row" spacing={1}>{number("bloom", "threshold", "泛光阈值", 0, 20)}{number("bloom", "weight", "泛光强度", 0, 1)}</Stack>
    <Stack direction="row" spacing={1}>{number("bloom", "kernel", "泛光范围", 8, 128, 1)}{number("bloom", "scale", "泛光分辨率比例", 0.25, 1, 0.05)}</Stack>
    <FormControlLabel label="屏幕空间环境遮蔽（AO）" control={<Switch checked={c.ao.enabled} onChange={e => change("ao", { enabled: e.target.checked })} />} />
    <Stack direction="row" spacing={1}>{number("ao", "radius", "AO 半径", 0.01, 10)}{number("ao", "strength", "AO 强度", 0, 5)}</Stack>
    <TextField label="AO 采样" size="small" select value={c.ao.samples} onChange={e => change("ao", { samples: Number(e.target.value) })}>{[4, 8, 16, 32].map(n => <MenuItem key={n} value={n}>{n}</MenuItem>)}</TextField>
    <Typography variant="subtitle2">局部反射探针</Typography>
    {(value?.probes || []).map(p => <ProbeEditor key={p.id} value={p} textures={textures.filter(t => t.mime === "application/x-babylon-env")} onChange={next => onChange({ ...value, probes: value!.probes!.map(old => old.id === p.id ? next : old) })} onDelete={() => onChange({ ...value, probes: value!.probes!.filter(old => old.id !== p.id) })} />)}
    <Button size="small" disabled={!(textures.some(t => t.mime === "application/x-babylon-env")) || (value?.probes?.length || 0) >= 32} onClick={() => onChange({ ...value, probes: [...(value?.probes || []), { id: crypto.randomUUID(), name: "房间反射", textureId: textures.find(t => t.mime === "application/x-babylon-env")!.id, position: { x: 0, y: 0, z: 0 }, size: { x: 10, y: 5, z: 10 }, priority: 0, intensity: 1 }] })}>添加局部反射探针</Button>
  </Stack>;
}

function ProbeEditor({ value: p, textures, onChange, onDelete }: { value: ReflectionProbeSettings; textures: { id: string; name: string }[]; onChange: (p: ReflectionProbeSettings) => void; onDelete: () => void }) {
  return <Stack spacing={1} sx={{ border: "1px solid", borderColor: "divider", p: 1 }}>
    <TextField label="探针名称" size="small" value={p.name} onChange={e => onChange({ ...p, name: e.target.value })} />
    <TextField label="探针环境贴图" size="small" select value={p.textureId} onChange={e => onChange({ ...p, textureId: e.target.value })}>{textures.map(t => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}</TextField>
    {(["position", "size"] as const).map(field => <Stack key={field} direction="row" spacing={1}>{(["x", "y", "z"] as const).map(axis => <TextField key={axis} label={(field === "position" ? "中心 " : "范围 ") + axis.toUpperCase()} size="small" type="number" value={p[field][axis]} inputProps={{ min: field === "size" ? 0.001 : -1000000, max: 1000000 }} onChange={e => onChange({ ...p, [field]: { ...p[field], [axis]: e.target.value.trim() ? Number(e.target.value) : NaN } })} />)}</Stack>)}
    <Stack direction="row" spacing={1}>
      <TextField label="探针优先级" size="small" type="number" value={p.priority ?? 0} onChange={e => onChange({ ...p, priority: Number(e.target.value) })} />
      <TextField label="探针亮度" size="small" type="number" value={p.intensity ?? 1} inputProps={{ min: 0, max: 20, step: 0.1 }} onChange={e => onChange({ ...p, intensity: Number(e.target.value) })} />
    </Stack>
    <Button color="error" size="small" onClick={onDelete}>删除探针</Button>
  </Stack>;
}
