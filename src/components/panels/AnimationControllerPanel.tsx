import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import { useState } from "react";
import {
  Alert,
  Button,
  Box,
  Checkbox,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEditorStore, type SceneNode } from "../../store/useEditorStore";
import type {
  AnimationControllerAsset,
  AnimationState,
  RetargetProfile,
} from "../../types/advancedGameplay";
import { ValueField } from "./AdvancedGameplayPanel";
const unique = (prefix: string, names: string[]) => {
  let i = 0;
  while (names.includes(prefix + i)) i++;
  return prefix + i;
};
const state = (name: string): AnimationState => ({
  name,
  clip: "",
  loop: true,
  speed: 1,
  events: [],
});
export function AnimationControllerPanel() {
  const content = useEditorStore((s) => s.content),
    [selected, setSelected] = useState(""),
    [error, setError] = useState("");
  const controllers = content.animationControllers || {},
    c = controllers[selected] || Object.values(controllers)[0];
  function save(next: AnimationControllerAsset) {
    try {
      useEditorStore
        .getState()
        .updateAdvancedContent({
          animationControllers: { ...controllers, [next.id]: next },
        });
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  const patchState = (name: string, p: Partial<AnimationState>) =>
    c &&
    save({
      ...c,
      states: c.states.map((s) => (s.name === name ? { ...s, ...p } : s)),
    });
  return (
    <Stack spacing={1} data-testid="animation-controller-editor">
      {error && <Alert severity="warning">{error}</Alert>}
      <Button
        onClick={() => {
          const id = crypto.randomUUID();
          save({
            id,
            name: "动画控制器",
            defaultState: "Idle",
            parameters: { speed: 0 },
            states: [state("Idle")],
            transitions: [],
          });
          setSelected(id);
        }}
      >
        新建动画控制器
      </Button>
      {c && (
        <>
          <TextField
            select
            size="small"
            label="控制器资源"
            value={c.id}
            onChange={(e) => setSelected(e.target.value)}
          >
            {Object.values(controllers).map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="资源名称"
            value={c.name}
            onChange={(e) => save({ ...c, name: e.target.value })}
          />
          <TextField
            select
            size="small"
            label="默认状态"
            value={c.defaultState}
            onChange={(e) => save({ ...c, defaultState: e.target.value })}
          >
            {c.states.map((s) => (
              <MenuItem key={s.name} value={s.name}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
          <Typography>实例参数</Typography>
          {Object.entries(c.parameters).map(([name, value]) => (
            <Stack key={name} direction="row" spacing={1}>
              <TextField
                size="small"
                label="参数名称"
                defaultValue={name}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next === name) return;
                  if (Object.hasOwn(c.parameters, next)) {
                    setError("参数名称重复");
                    return;
                  }
                  const parameters = { ...c.parameters };
                  delete parameters[name];
                  parameters[next] = value;
                  save({
                    ...c,
                    parameters,
                    states: c.states.map((s) => ({
                      ...s,
                      blend: s.blend
                        ? {
                            ...s.blend,
                            parameterX:
                              s.blend.parameterX === name
                                ? next
                                : s.blend.parameterX,
                            parameterY:
                              s.blend.parameterY === name
                                ? next
                                : s.blend.parameterY,
                          }
                        : undefined,
                    })),
                    transitions: c.transitions.map((t) => ({
                      ...t,
                      conditions: t.conditions.map((d) => ({
                        ...d,
                        parameter: d.parameter === name ? next : d.parameter,
                      })),
                    })),
                  });
                }}
              />
              {typeof value === "boolean" ? (
                <Checkbox
                  checked={value}
                  onChange={(e) =>
                    save({
                      ...c,
                      parameters: { ...c.parameters, [name]: e.target.checked },
                    })
                  }
                />
              ) : (
                <ValueField
                  label="初始值"
                  value={value}
                  onChange={(v) =>
                    save({ ...c, parameters: { ...c.parameters, [name]: v } })
                  }
                />
              )}
              <Button
                onClick={() => {
                  const p = { ...c.parameters };
                  delete p[name];
                  save({ ...c, parameters: p });
                }}
              >
                删除参数
              </Button>
            </Stack>
          ))}
          <Stack direction="row">
            <Button
              onClick={() =>
                save({
                  ...c,
                  parameters: {
                    ...c.parameters,
                    [unique("value", Object.keys(c.parameters))]: 0,
                  },
                })
              }
            >
              添加数值参数
            </Button>
            <Button
              onClick={() =>
                save({
                  ...c,
                  parameters: {
                    ...c.parameters,
                    [unique("flag", Object.keys(c.parameters))]: false,
                  },
                })
              }
            >
              添加布尔参数
            </Button>
          </Stack>
          <Divider />
          <Typography>状态与事件轨道</Typography>
          {c.states.map((s) => (
            <Stack
              key={s.name}
              spacing={1}
              sx={{ border: "1px solid #555", p: 1 }}
            >
              <TextField
                size="small"
                label="状态名称"
                defaultValue={s.name}
                onBlur={(e) => {
                  const name = e.target.value;
                  save({
                    ...c,
                    defaultState:
                      c.defaultState === s.name ? name : c.defaultState,
                    states: c.states.map((v) => (v === s ? { ...v, name } : v)),
                    transitions: c.transitions.map((t) => ({
                      ...t,
                      from: t.from === s.name ? name : t.from,
                      to: t.to === s.name ? name : t.to,
                    })),
                  });
                }}
              />
              <TextField
                size="small"
                label="动画片段名称"
                value={s.clip}
                onChange={(e) => patchState(s.name, { clip: e.target.value })}
              />
              <ValueField
                label="状态速度"
                value={s.speed}
                min={0}
                max={100}
                onChange={(v) => patchState(s.name, { speed: v })}
              />
              <FormControlLabel
                label="循环"
                control={
                  <Checkbox
                    checked={s.loop}
                    onChange={(e) =>
                      patchState(s.name, { loop: e.target.checked })
                    }
                  />
                }
              />
              <TextField
                select
                size="small"
                label="混合模式"
                value={s.blend?.kind || "clip"}
                onChange={(e) =>
                  patchState(s.name, {
                    blend:
                      e.target.value === "clip"
                        ? undefined
                        : {
                            kind: e.target.value as "1d" | "2d",
                            parameterX:
                              Object.keys(c.parameters).find(
                                (k) => typeof c.parameters[k] === "number",
                              ) || "speed",
                            parameterY:
                              Object.keys(c.parameters).find(
                                (k) => typeof c.parameters[k] === "number",
                              ) || "speed",
                            children: [
                              { clip: s.clip, threshold: 0, x: 0, y: 0 },
                              { clip: s.clip, threshold: 1, x: 1, y: 0 },
                            ],
                          },
                  })
                }
              >
                <MenuItem value="clip">单片段</MenuItem>
                <MenuItem value="1d">1D 混合树</MenuItem>
                <MenuItem value="2d">2D 方向混合</MenuItem>
              </TextField>
              {s.blend && (
                <>
                  <TextField
                    select
                    size="small"
                    label="X / 速度参数"
                    value={s.blend.parameterX}
                    onChange={(e) =>
                      patchState(s.name, {
                        blend: { ...s.blend!, parameterX: e.target.value },
                      })
                    }
                  >
                    {Object.entries(c.parameters)
                      .filter(([, v]) => typeof v === "number")
                      .map(([k]) => (
                        <MenuItem key={k} value={k}>
                          {k}
                        </MenuItem>
                      ))}
                  </TextField>
                  {s.blend.kind === "2d" && (
                    <TextField
                      select
                      size="small"
                      label="Y / 方向参数"
                      value={s.blend.parameterY || ""}
                      onChange={(e) =>
                        patchState(s.name, {
                          blend: { ...s.blend!, parameterY: e.target.value },
                        })
                      }
                    >
                      {Object.entries(c.parameters)
                        .filter(([, v]) => typeof v === "number")
                        .map(([k]) => (
                          <MenuItem key={k} value={k}>
                            {k}
                          </MenuItem>
                        ))}
                    </TextField>
                  )}
                  {s.blend.children.map((child, i) => (
                    <Stack key={i} direction="row" spacing={1}>
                      <TextField
                        size="small"
                        label="片段"
                        value={child.clip}
                        onChange={(e) =>
                          patchState(s.name, {
                            blend: {
                              ...s.blend!,
                              children: s.blend!.children.map((v, j) =>
                                j === i ? { ...v, clip: e.target.value } : v,
                              ),
                            },
                          })
                        }
                      />
                      {(s.blend!.kind === "1d"
                        ? ["threshold"]
                        : ["x", "y"]
                      ).map((k) => (
                        <ValueField
                          key={k}
                          label={k === "threshold" ? "阈值" : k.toUpperCase()}
                          value={(child as any)[k]}
                          onChange={(v) =>
                            patchState(s.name, {
                              blend: {
                                ...s.blend!,
                                children: s.blend!.children.map((n, j) =>
                                  j === i ? { ...n, [k]: v } : n,
                                ),
                              },
                            })
                          }
                        />
                      ))}
                      <Button
                        disabled={s.blend!.children.length === 1}
                        onClick={() =>
                          patchState(s.name, {
                            blend: {
                              ...s.blend!,
                              children: s.blend!.children.filter(
                                (_, j) => j !== i,
                              ),
                            },
                          })
                        }
                      >
                        删除
                      </Button>
                    </Stack>
                  ))}
                  <Button
                    onClick={() =>
                      patchState(s.name, {
                        blend: {
                          ...s.blend!,
                          children: [
                            ...s.blend!.children,
                            {
                              clip: s.clip,
                              threshold: s.blend!.children.length,
                              x: s.blend!.children.length,
                              y: 0,
                            },
                          ],
                        },
                      })
                    }
                  >
                    添加混合采样
                  </Button>
                </>
              )}
              {s.events.map((event, i) => (
                <Stack key={i} direction="row" spacing={1}>
                  <ValueField
                    label="事件时间（秒）"
                    value={event.time}
                    min={0}
                    max={3600}
                    onChange={(v) =>
                      patchState(s.name, {
                        events: s.events.map((e, j) =>
                          i === j ? { ...e, time: v } : e,
                        ),
                      })
                    }
                  />
                  <TextField
                    size="small"
                    label="事件名"
                    value={event.name}
                    onChange={(e) =>
                      patchState(s.name, {
                        events: s.events.map((v, j) =>
                          i === j ? { ...v, name: e.target.value } : v,
                        ),
                      })
                    }
                  />
                  <TextField
                    size="small"
                    label="事件参数"
                    value={event.data ?? ""}
                    onChange={(e) =>
                      patchState(s.name, {
                        events: s.events.map((v, j) =>
                          i === j ? { ...v, data: e.target.value } : v,
                        ),
                      })
                    }
                  />
                  <Button
                    onClick={() =>
                      patchState(s.name, {
                        events: s.events.filter((_, j) => i !== j),
                      })
                    }
                  >
                    删除事件
                  </Button>
                </Stack>
              ))}
              <Button
                onClick={() =>
                  patchState(s.name, {
                    events: [
                      ...s.events,
                      { time: 0, name: "event" + s.events.length },
                    ],
                  })
                }
              >
                添加动画事件
              </Button>
              <Button
                disabled={s.name === c.defaultState}
                onClick={() =>
                  save({
                    ...c,
                    states: c.states.filter((v) => v.name !== s.name),
                    transitions: c.transitions.filter(
                      (t) => t.from !== s.name && t.to !== s.name,
                    ),
                  })
                }
              >
                删除状态
              </Button>
            </Stack>
          ))}
          <Button
            onClick={() =>
              save({
                ...c,
                states: [
                  ...c.states,
                  state(
                    unique(
                      "State",
                      c.states.map((s) => s.name),
                    ),
                  ),
                ],
              })
            }
          >
            添加状态
          </Button>
          <Typography>过渡条件 · 同一固定步最多一次状态切换</Typography>
          {c.transitions.map((t, i) => (
            <Stack key={i} spacing={1} sx={{ border: "1px solid #555", p: 1 }}>
              {(["from", "to"] as const).map((k) => (
                <TextField
                  key={k}
                  select
                  size="small"
                  label={k === "from" ? "来源状态" : "目标状态"}
                  value={t[k]}
                  onChange={(e) =>
                    save({
                      ...c,
                      transitions: c.transitions.map((v, j) =>
                        j === i ? { ...v, [k]: e.target.value } : v,
                      ),
                    })
                  }
                >
                  {(k === "from"
                    ? ["*", ...c.states.map((s) => s.name)]
                    : c.states.map((s) => s.name)
                  ).map((name) => (
                    <MenuItem key={name} value={name}>
                      {name === "*" ? "任意状态" : name}
                    </MenuItem>
                  ))}
                </TextField>
              ))}
              <ValueField
                label="过渡时间（秒）"
                value={t.duration}
                min={0}
                max={60}
                onChange={(v) =>
                  save({
                    ...c,
                    transitions: c.transitions.map((n, j) =>
                      i === j ? { ...n, duration: v } : n,
                    ),
                  })
                }
              />
              <FormControlLabel
                label="等待退出时间"
                control={
                  <Checkbox
                    checked={t.exitTime !== undefined}
                    onChange={(e) =>
                      save({
                        ...c,
                        transitions: c.transitions.map((n, j) =>
                          i === j
                            ? {
                                ...n,
                                exitTime: e.target.checked ? 1 : undefined,
                              }
                            : n,
                        ),
                      })
                    }
                  />
                }
              />
              {t.exitTime !== undefined && (
                <ValueField
                  label="退出时间（标准化周期）"
                  value={t.exitTime}
                  min={0}
                  max={100}
                  onChange={(v) =>
                    save({
                      ...c,
                      transitions: c.transitions.map((n, j) =>
                        i === j ? { ...n, exitTime: v } : n,
                      ),
                    })
                  }
                />
              )}
              {t.conditions.map((d, k) => (
                <Stack key={k} direction="row" spacing={1}>
                  <TextField
                    select
                    size="small"
                    label="参数"
                    value={d.parameter}
                    onChange={(e) =>
                      save({
                        ...c,
                        transitions: c.transitions.map((n, j) =>
                          i === j
                            ? {
                                ...n,
                                conditions: n.conditions.map((v, l) =>
                                  l === k
                                    ? {
                                        ...v,
                                        parameter: e.target.value,
                                        value: c.parameters[e.target.value],
                                      }
                                    : v,
                                ),
                              }
                            : n,
                        ),
                      })
                    }
                  >
                    {Object.keys(c.parameters).map((name) => (
                      <MenuItem key={name} value={name}>
                        {name}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    size="small"
                    label="比较"
                    value={d.op}
                    onChange={(e) =>
                      save({
                        ...c,
                        transitions: c.transitions.map((n, j) =>
                          i === j
                            ? {
                                ...n,
                                conditions: n.conditions.map((v, l) =>
                                  l === k
                                    ? { ...v, op: e.target.value as any }
                                    : v,
                                ),
                              }
                            : n,
                        ),
                      })
                    }
                  >
                    {[">", "<", "==", "!="].map((op) => (
                      <MenuItem key={op} value={op}>
                        {op}
                      </MenuItem>
                    ))}
                  </TextField>
                  {typeof d.value === "boolean" ? (
                    <Checkbox
                      checked={d.value}
                      onChange={(e) =>
                        save({
                          ...c,
                          transitions: c.transitions.map((n, j) =>
                            i === j
                              ? {
                                  ...n,
                                  conditions: n.conditions.map((v, l) =>
                                    l === k
                                      ? { ...v, value: e.target.checked }
                                      : v,
                                  ),
                                }
                              : n,
                          ),
                        })
                      }
                    />
                  ) : (
                    <ValueField
                      label="比较值"
                      value={d.value}
                      onChange={(value) =>
                        save({
                          ...c,
                          transitions: c.transitions.map((n, j) =>
                            i === j
                              ? {
                                  ...n,
                                  conditions: n.conditions.map((v, l) =>
                                    l === k ? { ...v, value } : v,
                                  ),
                                }
                              : n,
                          ),
                        })
                      }
                    />
                  )}
                  <Button
                    onClick={() =>
                      save({
                        ...c,
                        transitions: c.transitions.map((n, j) =>
                          i === j
                            ? {
                                ...n,
                                conditions: n.conditions.filter(
                                  (_, l) => l !== k,
                                ),
                              }
                            : n,
                        ),
                      })
                    }
                  >
                    删除条件
                  </Button>
                </Stack>
              ))}
              <Button
                disabled={!Object.keys(c.parameters).length}
                onClick={() => {
                  const name = Object.keys(c.parameters)[0];
                  save({
                    ...c,
                    transitions: c.transitions.map((n, j) =>
                      i === j
                        ? {
                            ...n,
                            conditions: [
                              ...n.conditions,
                              {
                                parameter: name,
                                op: "==",
                                value: c.parameters[name],
                              },
                            ],
                          }
                        : n,
                    ),
                  });
                }}
              >
                添加条件
              </Button>
              <Button
                onClick={() =>
                  save({
                    ...c,
                    transitions: c.transitions.filter((_, j) => i !== j),
                  })
                }
              >
                删除过渡
              </Button>
            </Stack>
          ))}
          <Button
            onClick={() =>
              save({
                ...c,
                transitions: [
                  ...c.transitions,
                  {
                    from: c.defaultState,
                    to: c.states.at(-1)!.name,
                    duration: 0.2,
                    conditions: [],
                  },
                ],
              })
            }
          >
            添加过渡
          </Button>
          <Button
            onClick={() => {
              try {
                const next = { ...controllers };
                delete next[c.id];
                useEditorStore
                  .getState()
                  .updateAdvancedContent({ animationControllers: next });
                setError("");
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            删除控制器资源
          </Button>
        </>
      )}
      <RetargetEditor />
    </Stack>
  );
}
function RetargetEditor() {
  const profiles = useEditorStore((s) => s.content.retargetProfiles) || {},
    [error, setError] = useState("");
  const save = (p: RetargetProfile) => {
    try {
      useEditorStore
        .getState()
        .updateAdvancedContent({
          retargetProfiles: { ...profiles, [p.id]: p },
        });
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <Stack spacing={1}>
      <Divider />
      <Typography>显式骨骼 / 节点重定向</Typography>
      {error && <Alert severity="warning">{error}</Alert>}
      <Button
        onClick={() => {
          const id = crypto.randomUUID();
          save({
            id,
            name: "骨骼映射",
            mapping: { SourceBone: "TargetBone" },
            scale: 1,
            sourcePose: {},
            targetPose: {},
          });
        }}
      >
        新建重定向映射
      </Button>
      {Object.values(profiles).map((p) => (
        <Stack key={p.id} spacing={1} sx={{ border: "1px solid #555", p: 1 }}>
          <TextField
            size="small"
            label="映射名称"
            value={p.name}
            onChange={(e) => save({ ...p, name: e.target.value })}
          />
          <ValueField
            label="平移比例"
            value={p.scale}
            min={0.001}
            max={1000}
            onChange={(v) => save({ ...p, scale: v })}
          />
          {Object.entries(p.mapping).map(([src, dst]) => (
            <Stack key={src} direction="row" spacing={1}>
              <TextField
                size="small"
                label="源骨骼 / 节点"
                defaultValue={src}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name !== src && Object.hasOwn(p.mapping, name)) {
                    setError("源骨骼名称重复");
                    return;
                  }
                  const next = { ...p.mapping },
                    sourcePose = { ...p.sourcePose };
                  delete next[src];
                  next[name] = dst;
                  if (sourcePose[src]) {
                    sourcePose[name] = sourcePose[src];
                    delete sourcePose[src];
                  }
                  save({ ...p, mapping: next, sourcePose });
                }}
              />
              <TextField
                size="small"
                label="目标骨骼 / 节点"
                value={dst}
                onChange={(e) => {
                  const targetPose = { ...p.targetPose };
                  if (targetPose[dst]) {
                    targetPose[e.target.value] = targetPose[dst];
                    delete targetPose[dst];
                  }
                  save({
                    ...p,
                    mapping: { ...p.mapping, [src]: e.target.value },
                    targetPose,
                  });
                }}
              />
              <Button
                disabled={Object.keys(p.mapping).length === 1}
                onClick={() => {
                  const mapping = { ...p.mapping },
                    sourcePose = { ...p.sourcePose },
                    targetPose = { ...p.targetPose };
                  delete mapping[src];
                  delete sourcePose[src];
                  delete targetPose[dst];
                  save({ ...p, mapping, sourcePose, targetPose });
                }}
              >
                删除
              </Button>
            </Stack>
          ))}
          <Button
            onClick={() => {
              let i = 0;
              while (
                Object.hasOwn(p.mapping, "SourceBone" + i) ||
                Object.values(p.mapping).includes("TargetBone" + i)
              )
                i++;
              save({
                ...p,
                mapping: { ...p.mapping, ["SourceBone" + i]: "TargetBone" + i },
              });
            }}
          >
            添加骨骼映射
          </Button>
          <Button
            onClick={() => {
              try {
                const next = { ...profiles };
                delete next[p.id];
                useEditorStore
                  .getState()
                  .updateAdvancedContent({ retargetProfiles: next });
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            删除映射资源
          </Button>
          <Typography variant="caption">
            参考姿势按映射成对配置，旋转使用角度输入。缺少节点或不支持的动画通道会诊断拒绝。
          </Typography>
          {Object.entries(p.mapping).map(([src, dst]) => (
            <Stack key={src} spacing={1}>
              <Typography>
                {src} → {dst}
              </Typography>
              <Button
                onClick={() => {
                  const zero = {
                    position: { x: 0, y: 0, z: 0 },
                    rotation: { x: 0, y: 0, z: 0, w: 1 },
                  };
                  save({
                    ...p,
                    sourcePose: { ...p.sourcePose, [src]: zero },
                    targetPose: { ...p.targetPose, [dst]: zero },
                  });
                }}
              >
                配置参考姿势
              </Button>
              {p.sourcePose[src] && p.targetPose[dst] && (
                <>
                  <PoseFields
                    label="源参考姿势"
                    pose={p.sourcePose[src]}
                    onChange={(pose) =>
                      save({
                        ...p,
                        sourcePose: { ...p.sourcePose, [src]: pose },
                      })
                    }
                  />
                  <PoseFields
                    label="目标参考姿势"
                    pose={p.targetPose[dst]}
                    onChange={(pose) =>
                      save({
                        ...p,
                        targetPose: { ...p.targetPose, [dst]: pose },
                      })
                    }
                  />
                  <Button
                    onClick={() => {
                      const sourcePose = { ...p.sourcePose },
                        targetPose = { ...p.targetPose };
                      delete sourcePose[src];
                      delete targetPose[dst];
                      save({ ...p, sourcePose, targetPose });
                    }}
                  >
                    移除参考姿势
                  </Button>
                </>
              )}
            </Stack>
          ))}
        </Stack>
      ))}
    </Stack>
  );
}
export function AnimationAdvancedInspector({ node }: { node: SceneNode }) {
  const content = useEditorStore((s) => s.content),
    nodes = useEditorStore((s) => s.nodes),
    [error, setError] = useState("");
  if (!node.animation) return null;
  const a = node.animation;
  const patch = (p: Partial<typeof a>) => {
    try {
      useEditorStore
        .getState()
        .updateTransform(node.id, { animation: { ...a, ...p } });
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <Stack spacing={1}>
      {error && <Alert severity="warning">{error}</Alert>}
      <TextField
        select
        size="small"
        label="动画控制器"
        value={a.controllerId || ""}
        onChange={(e) =>
          patch({
            controllerId: e.target.value || undefined,
            rootMotion: e.target.value ? a.rootMotion : undefined,
          })
        }
      >
        <MenuItem value="">使用单片段</MenuItem>
        {Object.values(content.animationControllers || {}).map((c) => (
          <MenuItem key={c.id} value={c.id}>
            {c.name}
          </MenuItem>
        ))}
      </TextField>
      <FormControlLabel
        label="提取根运动"
        control={
          <Checkbox
            disabled={!a.controllerId}
            checked={!!a.rootMotion}
            onChange={(e) =>
              patch({
                rootMotion: e.target.checked
                  ? { target: "Root", translation: true, rotation: false }
                  : undefined,
              })
            }
          />
        }
      />
      {a.rootMotion && (
        <>
          <TextField
            size="small"
            label="根运动节点名"
            value={a.rootMotion.target}
            onChange={(e) =>
              patch({
                rootMotion: { ...a.rootMotion!, target: e.target.value },
              })
            }
          />
          {(["translation", "rotation"] as const).map((k) => (
            <FormControlLabel
              key={k}
              label={k === "translation" ? "提取平移" : "提取旋转"}
              control={
                <Checkbox
                  checked={a.rootMotion![k]}
                  onChange={(e) =>
                    patch({
                      rootMotion: { ...a.rootMotion!, [k]: e.target.checked },
                    })
                  }
                />
              }
            />
          ))}
        </>
      )}
      <TextField
        select
        size="small"
        label="重定向来源模型"
        value={a.retarget?.sourceId || ""}
        onChange={(e) =>
          patch({
            retarget: e.target.value
              ? {
                  sourceId: e.target.value,
                  profileId:
                    Object.keys(content.retargetProfiles || {})[0] || "",
                }
              : undefined,
          })
        }
      >
        <MenuItem value="">不重定向</MenuItem>
        {nodes
          .filter((n) => n.type === "model" && n.id !== node.id)
          .map((n) => (
            <MenuItem key={n.id} value={n.id}>
              {n.name}
            </MenuItem>
          ))}
      </TextField>
      {a.retarget && (
        <TextField
          select
          size="small"
          label="骨骼映射资源"
          value={a.retarget.profileId}
          onChange={(e) =>
            patch({ retarget: { ...a.retarget!, profileId: e.target.value } })
          }
        >
          {Object.values(content.retargetProfiles || {}).map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
            </MenuItem>
          ))}
        </TextField>
      )}
    </Stack>
  );
}

function PoseFields({
  label,
  pose,
  onChange,
}: {
  label: string;
  pose: RetargetProfile["sourcePose"][string];
  onChange: (pose: RetargetProfile["sourcePose"][string]) => void;
}) {
  const q = pose.rotation,
    euler = new Quaternion(q.x, q.y, q.z, q.w).toEulerAngles();
  return (
    <Stack spacing={1}>
      <Typography variant="caption">{label}</Typography>
      <Stack direction="row">
        {(["x", "y", "z"] as const).map((k) => (
          <ValueField
            key={k}
            label={"平移 " + k}
            value={pose.position[k]}
            onChange={(v) =>
              onChange({ ...pose, position: { ...pose.position, [k]: v } })
            }
          />
        ))}
      </Stack>
      <Stack direction="row">
        {(["x", "y", "z"] as const).map((k) => (
          <ValueField
            key={k}
            label={"旋转 " + k + "（度）"}
            value={Math.round(((euler[k] * 180) / Math.PI) * 100) / 100}
            onChange={(v) => {
              const e = euler.clone();
              e[k] = (v * Math.PI) / 180;
              const q = Quaternion.FromEulerAngles(e.x, e.y, e.z);
              onChange({
                ...pose,
                rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
              });
            }}
          />
        ))}
      </Stack>
    </Stack>
  );
}
