import { useRef, useState } from "react";
import { Alert, Button, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from "@mui/material";
import { useEditorStore } from "../../store/useEditorStore";
import { importTextureFile } from "../../utils/textureImport";
import type { RenderingSettings, ReflectionProbeSettings } from "../../types/rendering";
import "../../engine/rendering-config.js";
import {ScalarField} from '../ScalarField';

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
    views: { ...defaults.views, ...value?.views },
    fog: { ...defaults.fog, ...value?.fog },
    sky: { ...defaults.sky, ...value?.sky },
    dof: { ...defaults.dof, ...value?.dof },
    ssr: { ...defaults.reflections.ssr, ...value?.reflections?.ssr },
    planar: { ...defaults.reflections.planar, ...value?.reflections?.planar },
  };
  const change = (section: keyof typeof c, patch: object) => onChange(section === "ssr" || section === "planar"
    ? { ...value, quality:"custom",reflections:{...value?.reflections,[section]:{...c[section],...patch}} }
    : { ...value, quality: "custom", [section]: { ...c[section], ...patch } });
  const chooseQuality = (name: string) => {
    try {
      onChange((globalThis as any).ArkGlideRenderingConfig.preset(value, name));
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  const number = (section: keyof typeof c, field: string, label: string, min: number, max: number, step = 0.1) => (
    <ScalarField key={section + field} label={label} size="small" value={c[section][field]} inputProps={{ min, max, step }} onValueChange={value => change(section, { [field]: value })} />
  );
  return <Stack spacing={1.5} sx={{ mt: 3 }} data-testid="rendering-settings">
    <Typography variant="subtitle2">画面与光照</Typography>
    <TextField label="画质档位" select size="small" value={value?.quality || "custom"} onChange={e => chooseQuality(e.target.value)}>{[["low", "低"], ["medium", "中"], ["high", "高"], ["custom", "自定义"]].map(([v, n]) => <MenuItem key={v} value={v}>{n}</MenuItem>)}</TextField>
    <Stack direction="row" spacing={1}>
      <TextField label="渲染分辨率比例" type="number" size="small" value={value?.resolutionScale ?? 1} inputProps={{ min: 0.5, max: 1.5, step: 0.05 }} onChange={e => onChange({ ...value, quality: "custom", resolutionScale: Number(e.target.value) })} />
      <TextField label="抗锯齿" select size="small" value={value?.antialiasing || "none"} onChange={e => onChange({ ...value, quality: "custom", antialiasing: e.target.value as RenderingSettings["antialiasing"] })}>{[["none", "基础"], ["fxaa", "FXAA"], ["msaa", "MSAA"]].map(([v, n]) => <MenuItem key={v} value={v}>{n}</MenuItem>)}</TextField>
    </Stack>
    <FormControlLabel label="采集 GPU 帧时间" control={<Switch checked={value?.gpuProfiling || false} onChange={e => onChange({ ...value, gpuProfiling: e.target.checked })} />} />
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
    <Typography variant="subtitle2">多视图预算</Typography>
    <Stack direction="row" spacing={1}>{number("views", "maxViews", "离屏视图上限", 1, 64, 1)}{number("views", "depth", "传送门递归层数", 1, 5, 1)}</Stack>
    <TextField label="离屏总像素预算（MP）" type="number" size="small" value={c.views.maxPixels / 1048576} inputProps={{ min: 1 / 1024, max: 64, step: 0.5 }} onChange={e => change("views", { maxPixels: Math.round(Number(e.target.value) * 1048576) })} />
    <Stack direction="row" spacing={1}>{number("views", "scale", "门内分辨率比例", 0.1, 2, 0.05)}{number("views", "recursiveScale", "递归分辨率比例", 0.1, 1, 0.05)}</Stack>
    <FormControlLabel label="门内显示粒子" control={<Switch checked={c.views.particles} onChange={e => change("views", { particles: e.target.checked })} />} />
    <Typography variant="subtitle2">大气与景深</Typography>
    <TextField label="大气雾" select size="small" value={c.fog.mode} onChange={e => change("fog", {mode:e.target.value})}>{[["none","关闭"],["linear","线性距离雾"],["exp","指数雾"],["exp2","指数平方雾"]].map(([v,n])=><MenuItem key={v} value={v}>{n}</MenuItem>)}</TextField>
    <TextField label="雾颜色" type="color" size="small" value={c.fog.color} onChange={e=>change("fog",{color:e.target.value})} />
    <Stack direction="row" spacing={1}>{number("fog","density","雾密度",0,1,.001)}{number("fog","start","雾开始距离",0,100000,1)}{number("fog","end","雾结束距离",.001,1000000,1)}</Stack>
    <FormControlLabel label="程序大气天空" control={<Switch checked={c.sky.enabled} onChange={e=>change("sky",{enabled:e.target.checked})} />} />
    <Stack direction="row" spacing={1}>{number("sky","sunAzimuth","太阳方位（度）",-360,360,1)}{number("sky","sunElevation","太阳高度（度）",-90,90,1)}</Stack>
    <Stack direction="row" spacing={1}>{number("sky","turbidity","天空浑浊度",1,20,.1)}{number("sky","rayleigh","Rayleigh 散射",0,8,.1)}{number("sky","mie","Mie 散射",0,.1,.001)}</Stack>
    {number("sky","luminance","天空亮度",0,10,.1)}
    <FormControlLabel label="景深（主视图）" control={<Switch checked={c.dof.enabled} onChange={e=>change("dof",{enabled:e.target.checked})} />} />
    <Stack direction="row" spacing={1}>{number("dof","focusDistance","对焦距离（世界单位）",.01,100000,.1)}{number("dof","focalLength","焦距（mm）",1,300,1)}{number("dof","fStop","光圈 f-stop",.1,32,.1)}</Stack>
    <TextField label="景深质量" select size="small" value={c.dof.quality} onChange={e=>change("dof",{quality:Number(e.target.value)})}>{["低","中","高"].map((n,i)=><MenuItem key={i} value={i}>{n}</MenuItem>)}</TextField>
    <Typography variant="subtitle2">实时反射</Typography>
    <FormControlLabel label="屏幕空间反射（SSR，主视图）" control={<Switch checked={c.ssr.enabled} onChange={e=>change("ssr",{enabled:e.target.checked})} />} />
    <Stack direction="row" spacing={1}>{number("ssr","maxSteps","SSR 最大步数",8,256,8)}{number("ssr","step","SSR 步距（像素）",1,8,1)}{number("ssr","maxDistance","SSR 射线距离",.1,10000,1)}</Stack>
    <Stack direction="row" spacing={1}>{number("ssr","thickness","SSR 厚度容差",.001,10,.01)}{number("ssr","strength","SSR 强度",0,2,.1)}{number("ssr","blur","SSR 模糊",0,.2,.01)}</Stack>
    <TextField label="SSR 分辨率" select size="small" value={c.ssr.downsample} onChange={e=>change("ssr",{downsample:Number(e.target.value)})}>{["全分辨率","1/2","1/3","1/4"].map((n,i)=><MenuItem key={i} value={i}>{n}</MenuItem>)}</TextField>
    <FormControlLabel label="平面反射（在节点属性中指定反射面）" control={<Switch checked={c.planar.enabled} onChange={e=>change("planar",{enabled:e.target.checked})} />} />
    <Stack direction="row" spacing={1}>{number("planar","maxMirrors","平面反射数量上限",1,8,1)}{number("planar","scale","平面反射分辨率比例",.1,1,.1)}</Stack>
    <TextField label="平面反射总像素预算" type="number" size="small" value={c.planar.maxPixels} inputProps={{min:1024,max:67108864,step:65536}} onChange={e=>change("planar",{maxPixels:Number(e.target.value)})} />
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
