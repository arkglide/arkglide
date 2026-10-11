import { useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
  Divider,
  Box,
} from "@mui/material";
import { useEditorStore, type SceneNode } from "../../store/useEditorStore";
import {
  defaultPhysicsConfig,
  defaultCharacter,
  type JointComponent,
} from "../../types/advancedGameplay";
export function ValueField({
  label,
  value,
  min = -1e6,
  max = 1e6,
  step = 0.1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
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
function useEdit() {
  const [error, setError] = useState("");
  return {
    error,
    run(fn: () => unknown) {
      try {
        fn();
        setError("");
      } catch (e) {
        setError(String(e));
      }
    },
  };
}
export function PhysicsProjectEditor() {
  const config =
      useEditorStore((s) => s.content.physics) || defaultPhysicsConfig(),
    action = useEdit();
  const save = (physics: typeof config) =>
    action.run(() =>
      useEditorStore.getState().updateAdvancedContent({ physics }),
    );
  return (
    <Stack spacing={1} data-testid="physics-project-editor">
      <Typography>碰撞分组与查询过滤</Typography>
      {action.error && <Alert severity="warning">{action.error}</Alert>}
      <FormControlLabel
        label="预览中显示碰撞体、速度和接触点"
        control={
          <Checkbox
            checked={config.debug}
            onChange={(e) => save({ ...config, debug: e.target.checked })}
          />
        }
      />
      {config.groups.map((g, i) => (
        <Box key={i} sx={{ border: "1px solid #555", p: 1 }}>
          <TextField
            size="small"
            label="分组名称"
            value={g.name}
            disabled={g.name === "Default"}
            onChange={(e) =>
              save({
                ...config,
                groups: config.groups.map((v, j) =>
                  i === j ? { ...v, name: e.target.value } : v,
                ),
              })
            }
          />
          <Stack direction="row" flexWrap="wrap">
            {config.groups.map((other, j) => (
              <FormControlLabel
                key={j}
                label={other.name}
                control={
                  <Checkbox
                    checked={!!(g.mask & (1 << j))}
                    onChange={(e) =>
                      save({
                        ...config,
                        groups: config.groups.map((v, k) =>
                          k === i
                            ? {
                                ...v,
                                mask: e.target.checked
                                  ? v.mask | (1 << j)
                                  : v.mask & ~(1 << j),
                              }
                            : v,
                        ),
                      })
                    }
                  />
                }
              />
            ))}
          </Stack>
          {g.name !== "Default" && (
            <Button
              onClick={() =>
                save({
                  ...config,
                  groups: config.groups
                    .filter((_, j) => j !== i)
                    .map((v) => ({
                      ...v,
                      mask:
                        (v.mask & ((1 << i) - 1)) | ((v.mask >> (i + 1)) << i),
                    })),
                })
              }
            >
              删除分组
            </Button>
          )}
        </Box>
      ))}
      <Button
        disabled={config.groups.length >= 16}
        onClick={() => {
          const count = config.groups.length;
          save({
            ...config,
            groups: [
              ...config.groups.map((g) => ({
                ...g,
                mask: g.mask | (1 << count),
              })),
              { name: "Group" + count, mask: (1 << (count + 1)) - 1 },
            ],
          });
        }}
      >
        添加碰撞分组
      </Button>
      <Typography variant="caption">
        两个组都允许对方时才碰撞。引用中的分组不能直接删除；先修改对应实体和预制体。射线和形状查询使用同一组名称。
      </Typography>
    </Stack>
  );
}
export function AdvancedNodeInspector({ node }: { node: SceneNode }) {
  const nodes = useEditorStore((s) => s.nodes),
    physics =
      useEditorStore((s) => s.content.physics) || defaultPhysicsConfig(),
    action = useEdit();
  const patch = (p: Partial<SceneNode>) =>
    action.run(() => useEditorStore.getState().updateTransform(node.id, p));
  const group = (value: string | undefined, change: (name: string) => void) => (
    <TextField
      select
      size="small"
      label="碰撞分组"
      value={value || "Default"}
      onChange={(e) => change(e.target.value)}
    >
      {physics.groups.map((g) => (
        <MenuItem key={g.name} value={g.name}>
          {g.name}
        </MenuItem>
      ))}
    </TextField>
  );
  const joint = (id: string, p: Partial<JointComponent>) =>
    patch({
      joints: node.joints?.map((j) => (j.id === id ? { ...j, ...p } : j)),
    });
  return (
    <Stack spacing={1} data-testid="advanced-node-inspector">
      {action.error && <Alert severity="warning">{action.error}</Alert>}
      {node.physics && (
        <>
          {group(node.physics.group, (name) =>
            patch({ physics: { ...node.physics!, group: name } }),
          )}
          {["convex", "mesh"].includes(node.physics.shape) && (
            <TextField
              size="small"
              label="模型部件名称（逗号分隔，空为全部）"
              value={node.physics.parts?.join(",") || ""}
              onChange={(e) =>
                patch({
                  physics: {
                    ...node.physics!,
                    parts: e.target.value
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean),
                  },
                })
              }
            />
          )}
        </>
      )}
      {["mesh", "model", "empty"].includes(node.type) && (
        <>
          <Divider />
          <Button
            onClick={() =>
              patch({
                character: node.character ? undefined : defaultCharacter(),
                physics: undefined,
                joints: undefined,
              })
            }
          >
            {node.character ? "移除角色控制器" : "添加胶囊角色控制器"}
          </Button>
          {node.character && (
            <>
              {group(node.character.group, (name) =>
                patch({ character: { ...node.character!, group: name } }),
              )}
              {(
                [
                  "radius",
                  "height",
                  "stepHeight",
                  "maxSlope",
                  "speed",
                  "jumpSpeed",
                ] as const
              ).map((k) => (
                <ValueField
                  key={k}
                  label={
                    {
                      radius: "胶囊半径",
                      height: "总高度",
                      stepHeight: "台阶高度",
                      maxSlope: "最大坡度（度）",
                      speed: "移动速度",
                      jumpSpeed: "跳跃速度",
                    }[k]
                  }
                  value={node.character![k]}
                  min={0}
                  onChange={(v) =>
                    patch({ character: { ...node.character!, [k]: v } })
                  }
                />
              ))}
            </>
          )}
        </>
      )}
      {node.physics && (
        <>
          <Typography>关节 · 锚点为各刚体局部坐标</Typography>
          {node.joints?.map((j) => (
            <Stack
              key={j.id}
              spacing={1}
              sx={{ border: "1px solid #555", p: 1 }}
            >
              <TextField
                select
                size="small"
                label="关节类型"
                value={j.kind}
                onChange={(e) =>
                  joint(j.id, { kind: e.target.value as any, motor: undefined })
                }
              >
                {[
                  ["fixed", "固定"],
                  ["hinge", "铰链"],
                  ["slider", "滑动"],
                  ["distance", "距离"],
                ].map(([v, l]) => (
                  <MenuItem key={v} value={v}>
                    {l}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                label="目标刚体"
                value={j.targetId}
                onChange={(e) => joint(j.id, { targetId: e.target.value })}
              >
                {nodes
                  .filter((n) => n.id !== node.id && n.physics)
                  .map((n) => (
                    <MenuItem key={n.id} value={n.id}>
                      {n.name}
                    </MenuItem>
                  ))}
              </TextField>
              {(["anchor", "anchor2", "axis"] as const).map((k) => (
                <Stack key={k} direction="row" spacing={1}>
                  {(["x", "y", "z"] as const).map((a) => (
                    <ValueField
                      key={a}
                      label={
                        {
                          anchor: "本体锚点",
                          anchor2: "目标锚点",
                          axis: "本体关节轴",
                        }[k] +
                        " " +
                        a
                      }
                      value={j[k][a]}
                      onChange={(v) =>
                        joint(j.id, { [k]: { ...j[k], [a]: v } })
                      }
                    />
                  ))}
                </Stack>
              ))}
              {j.kind !== "fixed" && (
                <Stack direction="row" spacing={1}>
                  <ValueField
                    label={j.kind === "hinge" ? "最小角度（弧度）" : "最小距离"}
                    value={j.min}
                    onChange={(v) => joint(j.id, { min: v })}
                  />
                  <ValueField
                    label={j.kind === "hinge" ? "最大角度（弧度）" : "最大距离"}
                    value={j.max}
                    onChange={(v) => joint(j.id, { max: v })}
                  />
                </Stack>
              )}
              {["hinge", "slider"].includes(j.kind) && (
                <>
                  <FormControlLabel
                    label="速度电机"
                    control={
                      <Checkbox
                        checked={!!j.motor}
                        onChange={(e) =>
                          joint(j.id, {
                            motor: e.target.checked
                              ? { velocity: 1, force: 100 }
                              : undefined,
                          })
                        }
                      />
                    }
                  />
                  {j.motor && (
                    <>
                      <ValueField
                        label="目标速度"
                        value={j.motor.velocity}
                        onChange={(v) =>
                          joint(j.id, { motor: { ...j.motor!, velocity: v } })
                        }
                      />
                      <ValueField
                        label="最大力 / 扭矩"
                        value={j.motor.force}
                        min={0}
                        onChange={(v) =>
                          joint(j.id, { motor: { ...j.motor!, force: v } })
                        }
                      />
                    </>
                  )}
                </>
              )}
              <Button
                onClick={() =>
                  patch({ joints: node.joints?.filter((v) => v.id !== j.id) })
                }
              >
                删除关节
              </Button>
            </Stack>
          ))}
          <Button
            disabled={!nodes.some((n) => n.id !== node.id && n.physics)}
            onClick={() =>
              patch({
                joints: [
                  ...(node.joints || []),
                  {
                    id: crypto.randomUUID(),
                    kind: "fixed",
                    targetId: nodes.find((n) => n.id !== node.id && n.physics)!
                      .id,
                    anchor: { x: 0, y: 0, z: 0 },
                    anchor2: { x: 0, y: 0, z: 0 },
                    axis: { x: 0, y: 1, z: 0 },
                    min: 0,
                    max: 1,
                  },
                ],
              })
            }
          >
            添加关节
          </Button>
        </>
      )}
    </Stack>
  );
}
