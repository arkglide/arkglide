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
} from "@mui/material";
import { useEditorStore } from "../../store/useEditorStore";
import {
  defaultMixer,
  type AudioMixerConfig,
} from "../../types/advancedGameplay";
import { ValueField } from "./AdvancedGameplayPanel";
import { PanelHeading } from "./PanelHeading";
export function AudioMixerPanel() {
  const m = useEditorStore((s) => s.content.mixer) || defaultMixer(),
    [error, setError] = useState("");
  function save(next: AudioMixerConfig) {
    try {
      useEditorStore.getState().updateAdvancedContent({ mixer: next });
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <Stack spacing={1} data-testid="audio-mixer-panel">
      {error && <Alert severity="warning">{error}</Alert>}
      <PanelHeading title="总线" help="暂停游戏时，UI 总线继续播放。" />
      <ValueField
        label="最大同时发声数"
        value={m.maxVoices}
        min={1}
        max={256}
        step={1}
        onChange={(v) => save({ ...m, maxVoices: v })}
      />
      {m.buses.map((b, i) => (
        <Stack key={b.id} spacing={1} sx={{ border: "1px solid #555", p: 1 }}>
          <Typography variant="caption">ID：{b.id}</Typography>
          <TextField
            label="总线名称"
            size="small"
            value={b.name}
            onChange={(e) =>
              save({
                ...m,
                buses: m.buses.map((v, j) =>
                  j === i ? { ...v, name: e.target.value } : v,
                ),
              })
            }
          />
          {b.id !== "Master" && (
            <TextField
              label="输出到总线"
              select
              size="small"
              value={b.parentId}
              onChange={(e) =>
                save({
                  ...m,
                  buses: m.buses.map((v, j) =>
                    j === i ? { ...v, parentId: e.target.value } : v,
                  ),
                })
              }
            >
              {m.buses
                .filter((v) => v.id !== b.id)
                .map((v) => (
                  <MenuItem key={v.id} value={v.id}>
                    {v.name}
                  </MenuItem>
                ))}
            </TextField>
          )}
          <ValueField
            label="总线音量"
            value={b.volume}
            max={1}
            onChange={(v) =>
              save({
                ...m,
                buses: m.buses.map((a, j) =>
                  j === i ? { ...a, volume: v } : a,
                ),
              })
            }
          />
          <FormControlLabel
            label="静音"
            control={
              <Checkbox
                checked={b.mute}
                onChange={(e) =>
                  save({
                    ...m,
                    buses: m.buses.map((v, j) =>
                      j === i ? { ...v, mute: e.target.checked } : v,
                    ),
                  })
                }
              />
            }
          />
          {!["Master", "Music", "SFX", "UI"].includes(b.id) && (
            <Button
              onClick={() =>
                save({ ...m, buses: m.buses.filter((v) => v.id !== b.id) })
              }
            >
              删除总线
            </Button>
          )}
        </Stack>
      ))}
      <Button
        onClick={() => {
          const id = "bus_" + crypto.randomUUID().slice(0, 8);
          save({
            ...m,
            buses: [
              ...m.buses,
              { id, name: id, parentId: "Master", volume: 1, mute: false },
            ],
          });
        }}
      >
        添加总线
      </Button>
      <Typography>混音快照</Typography>
      {m.snapshots.map((s, i) => (
        <Stack key={s.id} spacing={1} sx={{ border: "1px solid #555", p: 1 }}>
          <Typography variant="caption">ID：{s.id}</Typography>
          <TextField
            label="快照名称"
            size="small"
            value={s.name}
            onChange={(e) =>
              save({
                ...m,
                snapshots: m.snapshots.map((v, j) =>
                  j === i ? { ...v, name: e.target.value } : v,
                ),
              })
            }
          />
          {m.buses.map((b) => {
            const v = s.buses[b.id] || { volume: b.volume, mute: b.mute };
            const patch = (p: Partial<typeof v>) =>
              save({
                ...m,
                snapshots: m.snapshots.map((s, j) =>
                  j === i
                    ? { ...s, buses: { ...s.buses, [b.id]: { ...v, ...p } } }
                    : s,
                ),
              });
            return (
              <Stack key={b.id} direction="row">
                <ValueField
                  label={b.name + " 音量"}
                  value={v.volume}
                  max={1}
                  onChange={(volume) => patch({ volume })}
                />
                <FormControlLabel
                  label="静音"
                  control={
                    <Checkbox
                      checked={v.mute}
                      onChange={(e) => patch({ mute: e.target.checked })}
                    />
                  }
                />
              </Stack>
            );
          })}
          <Button
            onClick={() =>
              save({ ...m, snapshots: m.snapshots.filter((_, j) => j !== i) })
            }
          >
            删除快照
          </Button>
        </Stack>
      ))}
      <Button
        onClick={() =>
          save({
            ...m,
            snapshots: [
              ...m.snapshots,
              {
                id: "snapshot_" + crypto.randomUUID().slice(0, 8),
                name: "混音快照",
                buses: Object.fromEntries(
                  m.buses.map((b) => [
                    b.id,
                    { volume: b.volume, mute: b.mute },
                  ]),
                ),
              },
            ],
          })
        }
      >
        从当前总线创建快照
      </Button>
      <PanelHeading
        title="自动压低"
        help="源总线发声时，降低目标总线的音量。"
      />
      {m.ducking.map((d, i) => (
        <Stack key={i} spacing={1} sx={{ border: "1px solid #555", p: 1 }}>
          {(["sourceBus", "targetBus"] as const).map((k) => (
            <TextField
              key={k}
              select
              label={k === "sourceBus" ? "源总线" : "目标总线"}
              size="small"
              value={d[k]}
              onChange={(e) =>
                save({
                  ...m,
                  ducking: m.ducking.map((v, j) =>
                    j === i ? { ...v, [k]: e.target.value } : v,
                  ),
                })
              }
            >
              {m.buses.map((b) => (
                <MenuItem key={b.id} value={b.id}>
                  {b.name}
                </MenuItem>
              ))}
            </TextField>
          ))}
          {(["amount", "attack", "release"] as const).map((k) => (
            <ValueField
              key={k}
              label={
                {
                  amount: "压低后音量比例",
                  attack: "进入秒数",
                  release: "恢复秒数",
                }[k]
              }
              value={d[k]}
              min={k === "amount" ? 0 : 0.001}
              max={k === "amount" ? 1 : 60}
              onChange={(v) =>
                save({
                  ...m,
                  ducking: m.ducking.map((d, j) =>
                    j === i ? { ...d, [k]: v } : d,
                  ),
                })
              }
            />
          ))}
          <Button
            onClick={() =>
              save({ ...m, ducking: m.ducking.filter((_, j) => j !== i) })
            }
          >
            删除规则
          </Button>
        </Stack>
      ))}
      <Button
        onClick={() =>
          save({
            ...m,
            ducking: [
              ...m.ducking,
              {
                sourceBus: "SFX",
                targetBus: "Music",
                amount: 0.4,
                attack: 0.1,
                release: 0.3,
              },
            ],
          })
        }
      >
        添加压低规则
      </Button>
    </Stack>
  );
}
