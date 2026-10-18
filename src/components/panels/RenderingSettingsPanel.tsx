import { useRef, useState } from "react";
import { Alert, Button, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from "@mui/material";
import { useEditorStore } from "../../store/useEditorStore";
import { importTextureFile } from "../../utils/textureImport";
import type { RenderingSettings } from "../../types/rendering";
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
  };
  const change = (section: keyof RenderingSettings, patch: object) => onChange({ ...value, [section]: { ...c[section], ...patch } });
  const number = (section: keyof RenderingSettings, field: string, label: string, min: number, max: number, step = 0.1) => (
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
  </Stack>;
}
