import { useRef } from 'react';
import {
  Box,
  TextField,
  Slider,
  Switch,
  FormControlLabel,
  Typography,
  Stack,
  Divider,
  MenuItem,
  Alert,
  Button,
  IconButton,
} from '@mui/material';
import { Warning, Close } from '@mui/icons-material';
import { useEditorStore, type SceneNode } from '../../store/useEditorStore';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

// 多选时单值可能为 'mixed'（表示各选中节点该属性值不同）
type Mixed<T> = T | 'mixed';
// 三轴向量，每轴可为具体值或 'mixed'
type Vec3Mixed = { x: Mixed<number>; y: Mixed<number>; z: Mixed<number> };

// 三轴数值输入组（支持 'mixed' 显示，按轴回调修改）
// isAngle=true 时 value 是弧度，显示角度；'mixed' 显示空 + placeholder "—"
function Vec3Input({ label, value, onAxisChange, isAngle = false }: {
  label: string;
  value: Vec3Mixed;
  onAxisChange: (axis: 'x' | 'y' | 'z', v: number) => void;
  isAngle?: boolean;
}) {
  const toDisplay = (v: Mixed<number>): string => {
    if (v === 'mixed') return '';
    const display = isAngle ? v * RAD2DEG : v;
    return display.toFixed(2);
  };
  const handleChange = (axis: 'x' | 'y' | 'z', v: number) => {
    const converted = isAngle ? v * DEG2RAD : v;
    onAxisChange(axis, converted);
  };
  return (
    <Stack direction="row" spacing={0.5}>
      {(['x', 'y', 'z'] as const).map((axis) => {
        const isMixed = value[axis] === 'mixed';
        return (
          <TextField
            key={axis}
            label={`${label} ${axis.toUpperCase()}`}
            type="number"
            size="small"
            fullWidth
            value={toDisplay(value[axis])}
            placeholder={isMixed ? '—' : undefined}
            onChange={(e) => handleChange(axis, Number(e.target.value))}
            sx={{ '& .MuiInputBase-input': { fontSize: 12 } }}
          />
        );
      })}
    </Stack>
  );
}

// 右侧属性面板：根据 node.type 分支渲染（Mesh/Light/Camera/Model）
// Store 存弧度，Inspector 显示角度
// 多选时：显示共有属性，值不同显示 "—"（placeholder），修改批量应用到所有选中节点
export default function Inspector() {
  const nodes = useEditorStore((s) => s.nodes);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const selectedNodeIds = useEditorStore((s) => s.selectedNodeIds);
  const updateTransform = useEditorStore((s) => s.updateTransform);
  const beginTransform = useEditorStore((s) => s.beginTransform);
  // 资源丢失标记 + 重新链接方法
  const missingModelIds = useEditorStore((s) => s.missingModelIds);
  const relinkModel = useEditorStore((s) => s.relinkModel);
  // 脚本组件：所有脚本文件 + 挂载/卸载方法
  const scripts = useEditorStore((s) => s.scripts);
  const attachScript = useEditorStore((s) => s.attachScript);
  const detachScript = useEditorStore((s) => s.detachScript);
  // 隐藏的 file input 引用：点击"重新链接"按钮时触发选择文件
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 多选模式：selectedNodeIds.length > 1
  const isMultiSelect = selectedNodeIds.length > 1;

  // 获取所有选中节点（多选时使用）
  const selectedNodes: SceneNode[] = selectedNodeIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is SceneNode => !!n);

  // 多选时的共有值获取：所有选中节点值相同则返回该值，否则返回 'mixed'
  const getSharedValue = <T,>(getter: (n: SceneNode) => T): Mixed<T> => {
    if (selectedNodes.length === 0) return 'mixed';
    const first = getter(selectedNodes[0]);
    return selectedNodes.every((n) => getter(n) === first) ? first : 'mixed';
  };

  // 单选时的节点（多选时为 null）
  const node = isMultiSelect ? null : nodes.find((n) => n.id === selectedNodeId);

  // 未选中任何节点
  if (!node && !isMultiSelect) {
    return (
      <Box sx={{ height: '100%', p: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          未选中节点
        </Typography>
      </Box>
    );
  }

  // 单选时的 update 辅助函数
  const update = (partial: Partial<Pick<SceneNode, 'transform' | 'rotation' | 'scale' | 'visible' | 'color' | 'intensity' | 'fov' | 'modelUrl' | 'lightType' | 'activeCamera' | 'primitive'>>) =>
    node ? updateTransform(node.id, partial) : undefined;

  // 多选时批量更新某个 Vec3 字段的单个轴（保留每个节点其他轴的当前值）
  // 先 beginTransform 保存快照（1 条历史），再所有 updateTransform 传 recordHistory=false
  const updateBatchAxis = (
    field: 'transform' | 'rotation' | 'scale',
    axis: 'x' | 'y' | 'z',
    newVal: number,
  ) => {
    beginTransform();
    selectedNodes.forEach((n) => {
      updateTransform(
        n.id,
        { [field]: { x: n[field].x, y: n[field].y, z: n[field].z, [axis]: newVal } },
        false,
      );
    });
  };

  // 多选时批量更新标量属性（visible/color 等）
  // 同样先 beginTransform 一次，后续 recordHistory=false
  const updateBatchScalar = (partial: Partial<Pick<SceneNode, 'visible' | 'color' | 'intensity' | 'fov'>>) => {
    beginTransform();
    selectedNodeIds.forEach((id) => updateTransform(id, partial, false));
  };

  // === 多选模式渲染 ===
  // 简化方案：只显示 Position/Rotation/Scale + Visible 面板（批量应用）
  // 其他面板（Light/Camera/Model/脚本组件）在多选时隐藏
  if (isMultiSelect) {
    const sharedType = getSharedValue((n) => n.type);
    // 所有选中节点都有 rotation/scale 字段（mesh/model），决定是否显示 Rotation/Scale 面板
    const allHaveRotationScale = selectedNodes.every((n) => n.type === 'mesh' || n.type === 'model');

    return (
      <Box sx={{ height: '100%', overflow: 'auto', p: 1 }}>
        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)' }}>
          属性 — 多选
        </Typography>
        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', mb: 1, display: 'block' }}>
          已选中 {selectedNodeIds.length} 个节点{sharedType !== 'mixed' ? ` (${sharedType})` : ' (混合类型)'}
        </Typography>
        <Divider sx={{ my: 0.5 }} />

        <Stack spacing={1} sx={{ mt: 1 }}>
          <Typography variant="caption">Position</Typography>
          <Vec3Input
            label="Pos"
            value={{
              x: getSharedValue((n) => n.transform.x),
              y: getSharedValue((n) => n.transform.y),
              z: getSharedValue((n) => n.transform.z),
            }}
            onAxisChange={(axis, v) => updateBatchAxis('transform', axis, v)}
          />

          {allHaveRotationScale && (
            <>
              <Typography variant="caption">Rotation (°)</Typography>
              <Vec3Input
                label="Rot"
                value={{
                  x: getSharedValue((n) => n.rotation.x),
                  y: getSharedValue((n) => n.rotation.y),
                  z: getSharedValue((n) => n.rotation.z),
                }}
                onAxisChange={(axis, v) => updateBatchAxis('rotation', axis, v)}
                isAngle
              />

              <Typography variant="caption">Scale</Typography>
              <Vec3Input
                label="Scl"
                value={{
                  x: getSharedValue((n) => n.scale.x),
                  y: getSharedValue((n) => n.scale.y),
                  z: getSharedValue((n) => n.scale.z),
                }}
                onAxisChange={(axis, v) => updateBatchAxis('scale', axis, v)}
              />
            </>
          )}

          <Divider sx={{ my: 0.5 }} />
          {/* Visible 开关：共有状态显示具体值，混合状态显示为 unchecked */}
          <FormControlLabel
            control={
              <Switch
                checked={getSharedValue((n) => n.visible) === true}
                onChange={(e) => updateBatchScalar({ visible: e.target.checked })}
              />
            }
            label="Visible"
            labelPlacement="start"
            sx={{ width: '100%', justifyContent: 'space-between', mr: 0 }}
          />
        </Stack>
      </Box>
    );
  }

  // === 单选模式渲染（保持原有行为） ===
  // 此时 node 一定存在（前面已处理 !node && !isMultiSelect 的情况）
  const currentNode = node!;

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 1 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        属性 — {currentNode.name} ({currentNode.type})
      </Typography>
      <Divider sx={{ my: 0.5 }} />

      {/* === 资源丢失提示（仅 model 节点且 blob 缺失时显示） === */}
      {currentNode.type === 'model' && missingModelIds.has(currentNode.id) && (
        <Alert severity="warning" sx={{ mt: 1, fontSize: 12 }} icon={<Warning />}>
          资源丢失：模型文件未找到
          <Button size="small" sx={{ ml: 1 }} onClick={() => fileInputRef.current?.click()}>
            重新链接
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".glb,.gltf"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                const buffer = await file.arrayBuffer();
                relinkModel(currentNode.id, buffer);
                // 同时更新 modelUrl 为新文件名
                updateTransform(currentNode.id, { modelUrl: file.name });
                // 重置 input value 以便相同文件可再次选择
                e.target.value = '';
              }
            }}
          />
        </Alert>
      )}

      {/* === Mesh 面板 === */}
      {currentNode.type === 'mesh' && (
        <Stack spacing={1} sx={{ mt: 1 }}>
          <Typography variant="caption">Position</Typography>
          <Vec3Input
            label="Pos"
            value={currentNode.transform}
            onAxisChange={(axis, v) => update({ transform: { ...currentNode.transform, [axis]: v } })}
          />

          <Typography variant="caption">Rotation (°)</Typography>
          <Vec3Input
            label="Rot"
            value={currentNode.rotation}
            onAxisChange={(axis, v) => update({ rotation: { ...currentNode.rotation, [axis]: v } })}
            isAngle
          />

          <Typography variant="caption">Scale</Typography>
          <Vec3Input
            label="Scl"
            value={currentNode.scale}
            onAxisChange={(axis, v) => update({ scale: { ...currentNode.scale, [axis]: v } })}
          />

          <Divider sx={{ my: 0.5 }} />
          <FormControlLabel
            control={<Switch checked={currentNode.visible} onChange={(e) => update({ visible: e.target.checked })} />}
            label="Visible"
            labelPlacement="start"
            sx={{ width: '100%', justifyContent: 'space-between', mr: 0 }}
          />

          <Typography variant="caption">Color</Typography>
          <TextField
            type="color"
            size="small"
            fullWidth
            value={currentNode.color || '#FFFFFF'}
            onChange={(e) => update({ color: e.target.value })}
            sx={{ '& input': { height: 24, p: 0 } }}
          />
        </Stack>
      )}

      {/* === Light 面板 === */}
      {currentNode.type === 'light' && (
        <Stack spacing={1} sx={{ mt: 1 }}>
          <Typography variant="caption">Type</Typography>
          <TextField select size="small" fullWidth value={currentNode.lightType ?? 'directional'} onChange={(e) => update({ lightType: e.target.value as SceneNode['lightType'] })}>
            <MenuItem value="hemispheric">Hemispheric</MenuItem>
            <MenuItem value="directional">Directional</MenuItem>
            <MenuItem value="point">Point</MenuItem>
          </TextField>

          <Typography variant="caption">Intensity</Typography>
          <Slider
            value={currentNode.intensity ?? 1}
            min={0} max={3} step={0.1} size="small"
            onChange={(_, v) => update({ intensity: v as number })}
          />
          <Typography variant="caption" sx={{ fontSize: 11 }}>{(currentNode.intensity ?? 1).toFixed(2)}</Typography>

          <Typography variant="caption">Color</Typography>
          <TextField
            type="color" size="small" fullWidth
            value={currentNode.color || '#FFFFFF'}
            onChange={(e) => update({ color: e.target.value })}
            sx={{ '& input': { height: 24, p: 0 } }}
          />

          <Typography variant="caption">Position</Typography>
          <Vec3Input
            label="Pos"
            value={currentNode.transform}
            onAxisChange={(axis, v) => update({ transform: { ...currentNode.transform, [axis]: v } })}
          />
        </Stack>
      )}

      {/* === Camera 面板 === */}
      {currentNode.type === 'camera' && (
        <Stack spacing={1} sx={{ mt: 1 }}>
          <Typography variant="caption">FOV (°)</Typography>
          <Slider
            value={currentNode.fov || 60}
            min={10} max={170} step={1} size="small"
            onChange={(_, v) => update({ fov: v as number })}
          />
          <Typography variant="caption" sx={{ fontSize: 11 }}>{(currentNode.fov || 60).toFixed(0)}°</Typography>

          <Typography variant="caption">Position</Typography>
          <Vec3Input
            label="Pos"
            value={currentNode.transform}
            onAxisChange={(axis, v) => update({ transform: { ...currentNode.transform, [axis]: v } })}
          />
        </Stack>
      )}

      {/* === Model 面板 === */}
      {currentNode.type === 'model' && (
        <Stack spacing={1} sx={{ mt: 1 }}>
          <Typography variant="caption">模型文件</Typography>
          <TextField
            size="small"
            fullWidth
            value={currentNode.modelUrl || ''}
            InputProps={{ readOnly: true }}
            sx={{ '& .MuiInputBase-input': { fontSize: 12 } }}
          />

          <Typography variant="caption">Position</Typography>
          <Vec3Input
            label="Pos"
            value={currentNode.transform}
            onAxisChange={(axis, v) => update({ transform: { ...currentNode.transform, [axis]: v } })}
          />

          <Typography variant="caption">Rotation (°)</Typography>
          <Vec3Input
            label="Rot"
            value={currentNode.rotation}
            onAxisChange={(axis, v) => update({ rotation: { ...currentNode.rotation, [axis]: v } })}
            isAngle
          />

          <Typography variant="caption">Scale</Typography>
          <Vec3Input
            label="Scl"
            value={currentNode.scale}
            onAxisChange={(axis, v) => update({ scale: { ...currentNode.scale, [axis]: v } })}
          />

          <Divider sx={{ my: 0.5 }} />
          <FormControlLabel
            control={<Switch checked={currentNode.visible} onChange={(e) => update({ visible: e.target.checked })} />}
            label="Visible"
            labelPlacement="start"
            sx={{ width: '100%', justifyContent: 'space-between', mr: 0 }}
          />
        </Stack>
      )}

      {['light', 'camera', 'empty'].includes(currentNode.type) && (
        <Stack spacing={1}>
          {currentNode.type === 'empty' && <Vec3Input label="Pos" value={currentNode.transform} onAxisChange={(axis,v) => update({transform:{...currentNode.transform,[axis]:v}})} />}
          <Vec3Input label="Rot" value={currentNode.rotation} isAngle onAxisChange={(axis,v) => update({rotation:{...currentNode.rotation,[axis]:v}})} />
          <Vec3Input label="Scl" value={currentNode.scale} onAxisChange={(axis,v) => update({scale:{...currentNode.scale,[axis]:v}})} />
          <FormControlLabel control={<Switch checked={currentNode.visible} onChange={e => update({visible:e.target.checked})} />} label="Visible" />
        </Stack>
      )}
      {currentNode.type === 'camera' && <FormControlLabel control={<Switch checked={!!currentNode.activeCamera} onChange={e => update({activeCamera:e.target.checked})} />} label="运行相机" />}
      {/* === 脚本组件区域（所有节点类型通用） === */}
      <Divider sx={{ my: 0.5 }} />
      <Typography variant="caption">脚本组件</Typography>
      <Stack spacing={0.5} sx={{ mt: 0.5 }}>
        {/* 已挂载脚本列表：文件名 + 删除按钮 */}
        {(currentNode.scripts || []).map((scriptFile) => (
          <Box
            key={scriptFile}
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Typography variant="caption" sx={{ fontSize: 12 }}>{scriptFile}</Typography>
            <IconButton size="small" onClick={() => detachScript(currentNode.id, scriptFile)}>
              <Close sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
        ))}
        {/* 下拉选择框：仅列出未挂载的脚本，选中后挂载并重置选择 */}
        <TextField
          select
          size="small"
          fullWidth
          defaultValue=""
          label="添加脚本"
          onChange={(e) => {
            if (e.target.value) {
              attachScript(currentNode.id, e.target.value);
              e.target.value = ''; // 重置选择，允许再次选择同一项
            }
          }}
          sx={{ '& .MuiInputBase-input': { fontSize: 12 } }}
        >
          <MenuItem value="">
            <em>选择脚本...</em>
          </MenuItem>
          {Object.keys(scripts)
            .filter((name) => !(currentNode.scripts || []).includes(name))
            .map((name) => (
              <MenuItem key={name} value={name}>{name}</MenuItem>
            ))}
        </TextField>
      </Stack>
    </Box>
  );
}