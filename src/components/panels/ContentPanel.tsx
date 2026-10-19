import { UIEditorPanel } from "./UIEditorPanel";
import { AudioMixerPanel } from "./AudioMixerPanel";
import { AnimationControllerPanel } from "./AnimationControllerPanel";
import { PhysicsProjectEditor } from "./AdvancedGameplayPanel";
import {
  AudioPanel,
  GameplayPanel,
  NodeGameplayInspector,
} from "./GameplayPanel";
import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useEditorStore, type SceneNode } from "../../store/useEditorStore";
import type { MaterialAsset, TextureAsset } from "../../types/content";
import { AdvancedMaterialEditor } from './AdvancedMaterialEditor';
import { instanceOverrides } from "../../engine/prefabs";
import { importTextureFile } from "../../utils/textureImport";
import { PanelHeading } from "./PanelHeading";

function useAction() {
  const [error, setError] = useState<string | null>(null);
  return {
    error,
    run: async (fn: () => unknown) => {
      try {
        await fn();
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    },
  };
}
export function MaterialEditor({ id }: { id: string }) {
  const content = useEditorStore((s) => s.content),
    m = content.materials[id],
    action = useAction();
  if (!m) return null;
  const update = (patch: Partial<MaterialAsset>) =>
    action.run(() => useEditorStore.getState().updateMaterial(id, patch));
  return (
    <Stack spacing={1} sx={{ minWidth: 0 }}>
      {action.error && <Alert severity="error">{action.error}</Alert>}
      <TextField
        key={id + m.name}
        label="材质名称"
        size="small"
        defaultValue={m.name}
        onBlur={(e) => {
          if (e.target.value.trim() !== m.name)
            void update({ name: e.target.value.trim() || m.name });
        }}
      />
      <Stack direction="row" spacing={1}>
        <TextField
          label="基础色"
          type="color"
          size="small"
          value={m.baseColor}
          onChange={(e) => void update({ baseColor: e.target.value })}
          sx={{ flex: 1 }}
        />
        <TextField
          label="自发光"
          type="color"
          size="small"
          value={m.emissiveColor}
          onChange={(e) => void update({ emissiveColor: e.target.value })}
          sx={{ flex: 1 }}
        />
      </Stack>
      <Stack direction="row" spacing={1}>
        {(["metallic", "roughness", "alpha"] as const).map((key, i) => (
          <TextField
            key={key}
            label={["金属度", "粗糙度", "透明度"][i]}
            size="small"
            type="number"
            value={m[key]}
            inputProps={{ min: 0, max: 1, step: 0.05 }}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 0 && v <= 1)
                void update({ [key]: v });
            }}
            sx={{ flex: 1, minWidth: 0 }}
          />
        ))}
      </Stack>
      <FormControlLabel
        label="双面渲染"
        control={
          <Switch
            checked={m.doubleSided}
            onChange={(e) => void update({ doubleSided: e.target.checked })}
          />
        }
      />
      {(
        [
          "albedoTextureId",
          "normalTextureId",
          "metallicRoughnessTextureId",
          "aoTextureId",
          "lightmapTextureId",
          "emissiveTextureId",
        ] as const
      ).map((slot, i) => (
        <TextField
          key={slot}
          select
          size="small"
          label={["颜色贴图", "法线贴图", "金属粗糙度贴图", "环境遮蔽贴图", "烘焙光照贴图", "自发光贴图"][i]}
          value={m[slot] || ""}
          onChange={(e) => void update({ [slot]: e.target.value || undefined, ...(slot === "emissiveTextureId" && e.target.value && m.emissiveColor === "#000000" ? { emissiveColor: "#FFFFFF" } : {}) })}
        >
          <MenuItem value="">无贴图</MenuItem>
          {content.textures.filter(t => t.mime.startsWith("image/") && t.mime !== "image/vnd.radiance").map((t) => (
            <MenuItem key={t.id} value={t.id}>
              {t.name}
            </MenuItem>
          ))}
        </TextField>
      ))}
      <Stack direction="row" spacing={1}>
        <TextField label="AO 贴图强度" type="number" size="small" value={m.aoStrength ?? 1} inputProps={{ min: 0, max: 20, step: 0.1 }} onChange={e => void update({ aoStrength: Number(e.target.value) })} />
        <TextField label="烘焙光照强度" type="number" size="small" value={m.lightmapIntensity ?? 1} inputProps={{ min: 0, max: 20, step: 0.1 }} onChange={e => void update({ lightmapIntensity: Number(e.target.value) })} />
      </Stack>
      <TextField label="烘焙光照 UV" select size="small" value={m.lightmapUV ?? 1} onChange={e => void update({ lightmapUV: Number(e.target.value) as 0 | 1 })}>
        <MenuItem value={0}>UV1（通道 0）</MenuItem><MenuItem value={1}>UV2（通道 1）</MenuItem>
      </TextField>
      <TextField label="自发光强度" type="number" size="small" value={m.emissiveIntensity ?? 1} inputProps={{ min: 0, max: 100, step: 0.1 }} onChange={e => void update({ emissiveIntensity: Number(e.target.value) })} />
      <AdvancedMaterialEditor material={m} textures={content.textures} onChange={update} />
      <PanelHeading
        title="贴图通道"
        help="金属粗糙度贴图的 G 通道存储粗糙度，B 通道存储金属度。"
      />
      <Stack direction="row" spacing={1}>
        {(["u", "v"] as const).map((axis) => (
          <TextField
            key={axis}
            label={"UV " + axis.toUpperCase()}
            size="small"
            type="number"
            value={m.uvScale[axis]}
            inputProps={{ step: 0.1 }}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && Math.abs(v) <= 10000)
                void update({ uvScale: { ...m.uvScale, [axis]: v } });
            }}
            sx={{ flex: 1 }}
          />
        ))}
      </Stack>
    </Stack>
  );
}
export function NodeContentInspector({ node }: { node: SceneNode }) {
  const content = useEditorStore((s) => s.content),
    nodes = useEditorStore((s) => s.nodes),
    action = useAction();
  const instance = node.prefab
      ? content.prefabInstances[node.prefab.instanceId]
      : undefined,
    prefab = instance ? content.prefabs[instance.prefabId] : undefined;
  const stats = instance ? instanceOverrides(instance, nodes) : null;
  const partCatalog = useEditorStore((s) => s.modelParts);
  const parts = partCatalog[node.id] || [];
  const state = () => useEditorStore.getState();
  return (
    <Stack data-testid="node-content" spacing={1} sx={{ my: 1 }}>
      {action.error && <Alert severity="warning">{action.error}</Alert>}
      {["mesh", "model"].includes(node.type) && (
        <>
          <TextField
            label="项目材质"
            select
            size="small"
            value={node.materialId || ""}
            onChange={(e) =>
              void action.run(() =>
                state().setNodeMaterial(node.id, e.target.value || undefined),
              )
            }
          >
            <MenuItem value="">
              {node.type === "model" ? "使用模型原始材质" : "使用节点颜色"}
            </MenuItem>
            {Object.values(content.materials).map((m) => (
              <MenuItem key={m.id} value={m.id}>
                {m.name}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={0.5}>
            <Button
              size="small"
              onClick={() =>
                void action.run(() => {
                  const id = state().createMaterial(node.name + " 材质");
                  state().setNodeMaterial(node.id, id);
                })
              }
            >
              新建并绑定材质
            </Button>
            {node.materialId && (
              <Button
                size="small"
                onClick={() =>
                  void action.run(() => {
                    const id = state().createMaterial(
                      content.materials[node.materialId!].name + " 副本",
                      node.materialId,
                    );
                    state().setNodeMaterial(node.id, id);
                  })
                }
              >
                材质独立副本
              </Button>
            )}
          </Stack>
          {node.materialId && (
            <>
              <PanelHeading
                title="共享材质"
                help="修改会应用到所有使用此材质的物体。需要单独修改时，先创建材质副本。"
              />
              <MaterialEditor id={node.materialId} />
            </>
          )}
        </>
      )}
      {node.type === "model" && (
        <Stack spacing={1} data-testid="model-material-slots">
          <PanelHeading
            title="部件材质"
            help="模型加载后显示材质槽。替换模型后，请检查部件编号是否对应。"
          />
          {!parts.length && (
            <Typography variant="caption">模型加载后显示材质槽。</Typography>
          )}
          {[
            ...parts,
            ...Object.keys(node.materialSlots || {})
              .filter((key) => !parts.some((p) => p.key === key))
              .map((key) => ({ key, name: "缺失部件：" + key })),
          ].map((part) => (
            <TextField
              key={part.key}
              label={part.name}
              select
              size="small"
              value={
                Object.hasOwn(node.materialSlots || {}, part.key)
                  ? (node.materialSlots![part.key] ?? "__original")
                  : "__inherit"
              }
              onChange={(e) =>
                void action.run(() =>
                  state().setModelSlotMaterial(
                    node.id,
                    part.key,
                    e.target.value === "__inherit"
                      ? undefined
                      : e.target.value === "__original"
                        ? null
                        : e.target.value,
                  ),
                )
              }
            >
              <MenuItem value="__inherit">跟随整体材质</MenuItem>
              <MenuItem value="__original">使用此部件原始材质</MenuItem>
              {Object.values(content.materials).map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.name}
                </MenuItem>
              ))}
            </TextField>
          ))}
        </Stack>
      )}
      <NodeGameplayInspector node={node} />
      <Divider />
      {prefab && instance && stats ? (
        <>
          {instance.parentInstanceId && (
            <Button
              size="small"
              onClick={() =>
                state().selectNode(
                  content.prefabInstances[instance.parentInstanceId!].rootId,
                )
              }
            >
              选择外层预制体：
              {
                content.prefabs[
                  content.prefabInstances[instance.parentInstanceId].prefabId
                ].name
              }
            </Button>
          )}
          <Typography variant="caption">
            预制体：{prefab.name}（v{instance.revision}）
          </Typography>
          <Typography variant="caption" data-testid="prefab-overrides">
            覆盖 {stats.changed} 个节点，删除 {stats.removed}，新增{" "}
            {stats.added}
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap">
            <Button
              size="small"
              onClick={() =>
                void action.run(() =>
                  state().updatePrefabFromInstance(instance.id),
                )
              }
            >
              应用到模板
            </Button>
            <Button
              size="small"
              onClick={() =>
                void action.run(() => state().resetPrefabInstance(instance.id))
              }
            >
              重置覆盖
            </Button>
            <Button
              size="small"
              onClick={() =>
                void action.run(() => state().unpackPrefabInstance(instance.id))
              }
            >
              解除关联
            </Button>
          </Stack>
        </>
      ) : (
        <Button
          size="small"
          onClick={() => void action.run(() => state().createPrefab(node.id))}
        >
          创建预制体
        </Button>
      )}
    </Stack>
  );
}
function TextureRow({ asset }: { asset: TextureAsset }) {
  const bytes = useEditorStore((s) => s.textureBuffers.get(asset.id)),
    [url, setUrl] = useState<string | null>(null),
    action = useAction();
  useEffect(() => {
    if (!bytes) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(new Blob([bytes], { type: asset.mime }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes, asset.mime]);
  return (
    <Box
      sx={{ border: "1px solid #444", borderRadius: 1, p: 1, minWidth: 200 }}
    >
      {url && ["application/x-babylon-env", "image/vnd.radiance"].includes(asset.mime) ? <Typography variant="caption">环境光照贴图</Typography> : url ? (
        <img
          src={url}
          alt={asset.name}
          style={{
            width: 56,
            height: 56,
            objectFit: "contain",
            float: "left",
            marginRight: 8,
          }}
        />
      ) : (
        <Typography color="warning.main" variant="caption">
          贴图丢失，请重新链接
        </Typography>
      )}
      <Typography variant="body2">{asset.name}</Typography>
      <Typography variant="caption">
        {(asset.byteLength / 1024).toFixed(1)} KiB
      </Typography>
      <Stack direction="row" spacing={1}>
        <Button component="label" size="small">
          {bytes ? "替换贴图" : "重新链接贴图"}
          <input
            aria-label={"替换贴图 " + asset.name}
            type="file"
            accept="image/png,image/jpeg,image/webp,.env,.hdr"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file)
                void action.run(() => importTextureFile(file, asset.id));
            }}
          />
        </Button>
        <Button
          size="small"
          onClick={() =>
            void action.run(() =>
              useEditorStore.getState().deleteTexture(asset.id),
            )
          }
        >
          删除贴图
        </Button>
      </Stack>
      {action.error && <Alert severity="warning">{action.error}</Alert>}
    </Box>
  );
}
export default function ContentPanel() {
  const [tab, setTab] = useState(0),
    [materialId, setMaterial] = useState<string>(""),
    content = useEditorStore((s) => s.content),
    selected = useEditorStore((s) => s.selectedNodeId),
    editing = useEditorStore((s) => s.playState === "stopped"),
    action = useAction();
  const materials = Object.values(content.materials),
    active = content.materials[materialId] ? materialId : materials[0]?.id;
  const state = () => useEditorStore.getState();
  return (
    <Box
      data-testid="content-panel"
      sx={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <Tabs
        variant="scrollable"
        scrollButtons="auto"
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ minHeight: 32 }}
      >
        <Tab label={"材质 (" + materials.length + ")"} />
        <Tab label={"贴图 (" + content.textures.length + ")"} />
        <Tab label={"预制体 (" + Object.keys(content.prefabs).length + ")"} />
        <Tab label={"音频 (" + (content.audio?.length || 0) + ")"} />
        <Tab label="输入与 HUD" />
        <Tab label="物理分组" />
        <Tab label="动画控制器" />
        <Tab label="音频混音" />
        <Tab label="UI 画布" />
      </Tabs>
      <Box
        component="fieldset"
        disabled={!editing}
        sx={{
          border: 0,
          m: 0,
          p: 1,
          minWidth: 0,
          overflow: "auto",
          flex: 1,
          opacity: editing ? 1 : 0.6,
        }}
      >
        {action.error && (
          <Alert severity="warning" onClose={() => void action.run(() => {})}>
            {action.error}
          </Alert>
        )}
        {tab === 3 && <AudioPanel />}
        {tab === 4 && <GameplayPanel />}
        {tab === 5 && <PhysicsProjectEditor />}
        {tab === 6 && <AnimationControllerPanel />}
        {tab === 7 && <AudioMixerPanel />}
        {tab === 8 && <UIEditorPanel />}
        {tab === 0 && (
          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            <Stack spacing={1} sx={{ width: 200 }}>
              <Button
                size="small"
                variant="outlined"
                onClick={() =>
                  void action.run(() => setMaterial(state().createMaterial()))
                }
              >
                新建材质
              </Button>
              {materials.map((m) => (
                <Button
                  key={m.id}
                  size="small"
                  variant={active === m.id ? "contained" : "outlined"}
                  onClick={() => setMaterial(m.id)}
                >
                  {m.name}
                </Button>
              ))}
              {active && (
                <>
                  <Button
                    size="small"
                    disabled={
                      !selected ||
                      !["mesh", "model"].includes(
                        state().nodes.find((n) => n.id === selected)?.type ||
                          "",
                      )
                    }
                    onClick={() =>
                      void action.run(() =>
                        state().setNodeMaterial(selected!, active),
                      )
                    }
                  >
                    绑定选中物体
                  </Button>
                  <Button
                    size="small"
                    onClick={() =>
                      void action.run(() =>
                        setMaterial(
                          state().createMaterial(
                            content.materials[active].name + " 副本",
                            active,
                          ),
                        ),
                      )
                    }
                  >
                    复制材质
                  </Button>
                  <Button
                    size="small"
                    onClick={() =>
                      void action.run(() => state().deleteMaterial(active))
                    }
                  >
                    删除材质
                  </Button>
                </>
              )}
            </Stack>
            <Box sx={{ flex: "1 1 320px", maxWidth: 600 }}>
              {active ? (
                <MaterialEditor id={active} />
              ) : (
                <Typography variant="caption">
                  创建材质后，可绑定到网格或模型。
                </Typography>
              )}
            </Box>
          </Box>
        )}
        {tab === 1 && (
          <Stack spacing={1}>
            <Button
              component="label"
              size="small"
              variant="outlined"
              sx={{ alignSelf: "flex-start" }}
            >
              导入贴图
              <input
                aria-label="导入贴图"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  e.target.value = "";
                  void action.run(async () => {
                    for (const file of files) await importTextureFile(file);
                  });
                }}
              />
            </Button>
            <PanelHeading
              title="贴图资源"
              help="支持 PNG、JPEG、WebP，以及场景设置中导入的 .env / .hdr 环境贴图，单张最大 64 MiB。贴图文件会保存在项目中。"
            />
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              {content.textures.map((t) => (
                <TextureRow key={t.id} asset={t} />
              ))}
            </Box>
          </Stack>
        )}
        {tab === 2 && (
          <Stack spacing={1}>
            <Button
              size="small"
              variant="outlined"
              disabled={!selected}
              sx={{ alignSelf: "flex-start" }}
              onClick={() =>
                void action.run(() => state().createPrefab(selected!))
              }
            >
              从选中子树创建预制体
            </Button>
            <PanelHeading
              title="预制体资源"
              help="可将预制体实例放到普通父节点下，再从父节点创建嵌套预制体。子模板更新时保留实例的本地覆盖。"
            />
            {Object.values(content.prefabs).map((p) => (
              <Box
                key={p.id}
                sx={{ p: 1, border: "1px solid #444", borderRadius: 1 }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  flexWrap="wrap"
                >
                  <TextField
                    key={p.name}
                    label="预制体名称"
                    defaultValue={p.name}
                    size="small"
                    onBlur={(e) => {
                      if (e.target.value.trim() !== p.name)
                        void action.run(() =>
                          state().renamePrefab(p.id, e.target.value),
                        );
                    }}
                  />
                  <Typography variant="caption">
                    v{p.revision}，{p.nodes.length} 个节点，{" "}
                    {
                      Object.values(content.prefabInstances).filter(
                        (i) => i.prefabId === p.id,
                      ).length
                    }{" "}
                    个实例
                  </Typography>
                  <Button
                    size="small"
                    onClick={() =>
                      void action.run(() => state().instantiatePrefab(p.id))
                    }
                  >
                    生成实例
                  </Button>
                  <Button
                    size="small"
                    onClick={() =>
                      void action.run(() => state().deletePrefab(p.id))
                    }
                  >
                    删除模板
                  </Button>
                </Stack>
                <Typography
                  variant="caption"
                  sx={{
                    display: "block",
                    userSelect: "text",
                    overflowWrap: "anywhere",
                  }}
                >
                  模板 ID：{p.id}
                </Typography>
                {!!Object.keys(p.nestedInstances || {}).length && (
                  <Typography variant="caption">
                    嵌套：
                    {Object.values(p.nestedInstances || {})
                      .map((i) => content.prefabs[i.prefabId]?.name)
                      .join("、")}
                  </Typography>
                )}
                {Object.values(p.modelKeys).some(
                  (key) => !state().modelBuffers.has(key),
                ) && (
                  <Alert severity="warning">
                    模板模型资源缺失：选择模型实例重新链接后，再应用到模板。
                  </Alert>
                )}
              </Box>
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
