import { useEffect, useRef, useState } from 'react';
import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material';
import {
  Engine,
  Scene,
  MeshBuilder,
  HemisphericLight,
  ArcRotateCamera,
  Vector3,
  Color3,
  Color4,
  HighlightLayer,
  Mesh,
  PointerEventTypes,
  GizmoManager,
  TransformNode,
  Matrix,
  Quaternion,
  GizmoCoordinatesMode,
} from '@babylonjs/core';
import * as Babylon from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { createSceneAdapter, type SceneAdapter } from '../../engine/sceneAdapter';
import { readModelAsset } from '../../engine/modelImport';
import { applySelectionDelta, selectionRoots } from '../../engine/selectionTransform';
import { GridMaterial } from '@babylonjs/materials';
import { useEditorStore } from '../../store/useEditorStore';
import RuntimeFrame from './RuntimeFrame';

// 中央 3D 视口：编辑 canvas（常驻）+ 运行时 iframe（常驻，display 切换）
export default function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const highlightRef = useRef<HighlightLayer | null>(null);
  const meshMapRef = useRef<Map<string, TransformNode>>(new Map());
  const gizmoManagerRef = useRef<GizmoManager | null>(null);
  // 模型 ArrayBuffer 缓存：nodeId → ArrayBuffer（供播放时 Transferable 传递）
  const adapterRef = useRef<SceneAdapter | null>(null);
  const loadingCountRef = useRef(0);
  const modelBuffers = useEditorStore((s) => s.modelBuffers);
  const settings = useEditorStore((s) => s.settings);
  const [sceneRevision, setSceneRevision] = useState(0);
  const pivotRef = useRef<TransformNode | null>(null);
  const initialWorldRef = useRef<Map<TransformNode, Matrix>>(new Map());
  const initialPivotRef = useRef(Matrix.Identity());
  const [modelLoading, setModelLoading] = useState(false);
  // 相机引用：供键盘/鼠标事件处理中访问 ArcRotateCamera
  const cameraRef = useRef<ArcRotateCamera | null>(null);
  // 飞行模式状态：右键按下时进入飞行模式，WASD/QE 移动相机 target
  const flyModeRef = useRef(false);
  const flyStateRef = useRef({ w: false, a: false, s: false, d: false, q: false, e: false });
  // flyModeDisplay：触发浮层重渲染（ref 变化不触发 React 重渲染）
  const [flyModeDisplay, setFlyModeDisplay] = useState(false);

  const nodes = useEditorStore((s) => s.nodes);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const selectedNodeIds = useEditorStore((s) => s.selectedNodeIds);
  const playState = useEditorStore((s) => s.playState);
  const selectNode = useEditorStore((s) => s.selectNode);
  const gizmoMode = useEditorStore((s) => s.gizmoMode);
  const gizmoSpace = useEditorStore((s) => s.gizmoSpace);
  const setGizmoSpace = useEditorStore((s) => s.setGizmoSpace);
  const selectNodeRef = useRef(selectNode);
  selectNodeRef.current = selectNode;
  const updateTransform = useEditorStore((s) => s.updateTransform);
  const updateTransformRef = useRef(updateTransform);
  updateTransformRef.current = updateTransform;
  // beginTransform：Gizmo 拖拽开始时保存拖拽前快照（用于撤销）
  const beginTransform = useEditorStore((s) => s.beginTransform);
  const beginTransformRef = useRef(beginTransform);
  beginTransformRef.current = beginTransform;
  // 多选批量拖拽：ref 跟踪最新值（避免 observer 闭包过期）
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  selectedNodeIdsRef.current = selectedNodeIds;
  const gizmoModeRef = useRef(gizmoMode);
  gizmoModeRef.current = gizmoMode;
  // 拖拽中状态 + 各选中节点初始位置（供增量同步）
  const isDraggingRef = useRef(false);
  const draggedIdRef = useRef<string | null>(null);


  // 初始化编辑引擎 / 场景 / 环境光 / 网格地面
  useEffect(() => {
    const canvas = canvasRef.current!;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.05, 0.05, 0.05, 1);
    sceneRef.current = scene;

    const camera = new ArcRotateCamera(
      '__editor_camera',
      -Math.PI / 2,
      Math.PI / 3,
      8,
      new Vector3(0, 0.5, 0),
      scene,
    );
    camera.attachControl(canvas, true);
    camera.wheelDeltaPercentage = 0.01;
    cameraRef.current = camera;

    const hemi = new HemisphericLight('__ambient', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.8;

    const ground = MeshBuilder.CreateGround('ground', { width: 12, height: 12 }, scene);
    const gridMat = new GridMaterial('gridMat', scene);
    gridMat.mainColor = new Color3(0.12, 0.12, 0.12);
    gridMat.lineColor = new Color3(0.35, 0.35, 0.35);
    gridMat.gridRatio = 1;
    ground.material = gridMat;
    ground.isPickable = false;
    adapterRef.current = createSceneAdapter(Babylon, scene, {
      editor: true,
      onLoading: (delta) => { loadingCountRef.current += delta; setModelLoading(loadingCountRef.current > 0); },
      onLoaded: () => setSceneRevision(v => v + 1),
      onError: (node, error) => useEditorStore.getState().addConsoleLog('error', `模型加载失败: ${node.name} - ${String(error)}`),
    });
    meshMapRef.current = adapterRef.current.nodes;
    pivotRef.current = new TransformNode('__selection_pivot', scene);

    const hl = new HighlightLayer('hl', scene);
    highlightRef.current = hl;

    // Gizmo 管理器（初始只启用 positionGizmo，由 gizmoMode/selectedNodeId useEffect 控制切换）
    const gizmoManager = new GizmoManager(scene);
    gizmoManager.usePointerToAttachGizmos = false;
    gizmoManager.positionGizmoEnabled = true;
    gizmoManager.gizmos.positionGizmo!.snapDistance = 0.1;
    gizmoManagerRef.current = gizmoManager;

    scene.onPointerObservable.add((pi) => {
      if (pi.type !== PointerEventTypes.POINTERDOWN || gizmoManager.isHovered) return;
      const event = pi.event as PointerEvent;
      if (event.button !== 0 || useEditorStore.getState().playState !== 'stopped') return;
      let picked = pi.pickInfo?.pickedMesh;
      let id: string | undefined;
      while (picked && !id) { id = picked.metadata?.arkglideId; picked = picked.parent as Mesh; }
      const store = useEditorStore.getState();
      if (id) {
        if (event.ctrlKey || event.metaKey || event.shiftKey) store.toggleNodeSelection(id);
        else store.selectNode(id);
      } else if (!event.ctrlKey && !event.metaKey && !event.shiftKey) store.clearSelection();
    });

    // 飞行模式移动逻辑：每帧渲染前根据 WASD/QE 按键状态移动相机 target
    const upAxis = Vector3.Up();
    const flyObserver = scene.onBeforeRenderObservable.add(() => {
      if (!flyModeRef.current) return;
      const fly = flyStateRef.current;
      const speed = 6 * Math.min(engine.getDeltaTime() / 1000, 0.1);
      // ArcRotateCamera.getForwardRay 获取前向方向
      const forward = camera.getForwardRay().direction;
      const right = Vector3.Cross(upAxis, forward).normalize();

      const move = Vector3.Zero();
      if (fly.w) move.addInPlace(forward);
      if (fly.s) move.subtractInPlace(forward);
      if (fly.d) move.addInPlace(right);
      if (fly.a) move.subtractInPlace(right);
      if (fly.e) move.addInPlace(upAxis);
      if (fly.q) move.subtractInPlace(upAxis);

      move.scaleInPlace(speed);
      camera.target.addInPlace(move);
    });

    engine.runRenderLoop(() => scene.render());

    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(canvas);

    return () => {
      ro.disconnect();
      engine.stopRenderLoop();
      scene.onBeforeRenderObservable.remove(flyObserver);
      adapterRef.current?.dispose();
      adapterRef.current = null;
      meshMapRef.current.clear();
      gizmoManagerRef.current = null;
      cameraRef.current = null;
      scene.dispose();
      engine.dispose();
      sceneRef.current = null;
      highlightRef.current = null;
    };
  }, []);

  useEffect(() => {
    void adapterRef.current?.sync(nodes, modelBuffers);
  }, [nodes, modelBuffers]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.clearColor = Color4.FromColor3(Color3.FromHexString(settings.backgroundColor));
    const ambient = scene.getLightByName('__ambient') as HemisphericLight;
    ambient.intensity = settings.ambientIntensity;
    ambient.diffuse = Color3.FromHexString(settings.ambientColor);
  }, [settings]);

  useEffect(() => {
    const manager = gizmoManagerRef.current, scene = sceneRef.current, pivot = pivotRef.current;
    if (!manager || !scene || !pivot) return;
    manager.positionGizmoEnabled = gizmoMode === 'move';
    manager.rotationGizmoEnabled = gizmoMode === 'rotate';
    manager.scaleGizmoEnabled = gizmoMode === 'scale';
    manager.coordinatesMode = gizmoSpace === 'local' ? GizmoCoordinatesMode.Local : GizmoCoordinatesMode.World;
    const selected = selectedNodeIds.map(id => meshMapRef.current.get(id)).filter((n): n is TransformNode => !!n);
    const roots = selectionRoots(selected);
    const multiple = roots.length > 1;
    if (multiple) {
      const center = Vector3.Zero();
      roots.forEach(node => { node.computeWorldMatrix(true); center.addInPlace(node.getAbsolutePosition()); });
      pivot.position.copyFrom(center.scale(1 / roots.length));
      pivot.scaling.setAll(1);
      pivot.rotationQuaternion = gizmoSpace === 'local' ? roots[0].absoluteRotationQuaternion.clone() : Quaternion.Identity();
    }
    manager.attachToNode(playState === 'stopped' ? (multiple ? pivot : roots[0] || null) : null);
    const onStart = () => {
      if (isDraggingRef.current) return;
      beginTransformRef.current();
      isDraggingRef.current = true;
      initialWorldRef.current = new Map(roots.map(node => [node, node.computeWorldMatrix(true).clone()]));
      initialPivotRef.current = pivot.computeWorldMatrix(true).clone();
    };
    const applyGroup = () => {
      if (multiple && isDraggingRef.current) applySelectionDelta(initialWorldRef.current, initialPivotRef.current, pivot.computeWorldMatrix(true));
    };
    const onEnd = () => {
      if (!isDraggingRef.current) return;
      applyGroup();
      isDraggingRef.current = false;
      selected.forEach(node => {
        const rotation = node.rotationQuaternion?.toEulerAngles() || node.rotation;
        node.rotation.copyFrom(rotation); node.rotationQuaternion = null;
        updateTransformRef.current(node.name, {
          transform: { x: node.position.x, y: node.position.y, z: node.position.z },
          rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
          scale: { x: node.scaling.x, y: node.scaling.y, z: node.scaling.z },
        }, false);
      });
    };
    const gizmos = [manager.gizmos.positionGizmo, manager.gizmos.rotationGizmo, manager.gizmos.scaleGizmo].filter(g => !!g);
    const observers = gizmos.map(g => ({ g: g!, start: g!.onDragStartObservable.add(onStart), end: g!.onDragEndObservable.add(onEnd) }));
    const frame = scene.onBeforeRenderObservable.add(applyGroup);
    return () => {
      observers.forEach(({g, start, end}) => { g.onDragStartObservable.remove(start); g.onDragEndObservable.remove(end); });
      scene.onBeforeRenderObservable.remove(frame);
    };
  }, [selectedNodeIds, gizmoMode, gizmoSpace, playState, nodes]);

  useEffect(() => {
    const hl = highlightRef.current;
    if (!hl) return;
    hl.removeAllMeshes();
    const color = Color3.FromHexString('#7C9CFF');
    selectedNodeIds.forEach(id => {
      const node = meshMapRef.current.get(id);
      if (!node) return;
      const meshes = [...(node instanceof Mesh ? [node] : []), ...node.getChildMeshes()];
      meshes.forEach(mesh => { if (mesh instanceof Mesh && mesh.getTotalVertices() > 0) hl.addMesh(mesh, color); });
    });
  }, [selectedNodeIds, nodes, sceneRevision]);

  // 停止时编辑 canvas 恢复显示，触发 resize
  useEffect(() => {
    if (playState === 'stopped') {
      sceneRef.current?.getEngine().resize();
    }
  }, [playState]);

  const editing = playState === 'stopped';
  const [focusHintDismissed, setFocusHintDismissed] = useState(false);

  // 编辑模式：键盘快捷键（F聚焦/W/E/R切换Gizmo）+ 右键WASD飞行模式
  useEffect(() => {
    if (!editing) return;
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    if (!canvas || !camera) return;

    // 禁止 canvas 右键菜单（飞行模式用右键）
    const onContextMenu = (e: Event) => e.preventDefault();
    canvas.addEventListener('contextmenu', onContextMenu);

    // 右键按下 → 进入飞行模式，脱离轨道控制
    const onMouseDown = (e: MouseEvent) => {
      canvas.focus();
      if (e.button === 2) {
        flyModeRef.current = true;
        setFlyModeDisplay(true);
        camera.detachControl();
      }
    };
    canvas.addEventListener('mousedown', onMouseDown);

    // 右键抬起 → 退出飞行模式，恢复轨道控制
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) {
        flyModeRef.current = false;
        setFlyModeDisplay(false);
        flyStateRef.current = { w: false, a: false, s: false, d: false, q: false, e: false };
        camera.attachControl(canvas, true);
      }
    };
    window.addEventListener('mouseup', onMouseUp);
    const onBlur = () => { flyStateRef.current = { w:false,a:false,s:false,d:false,q:false,e:false }; onMouseUp({ button:2 } as MouseEvent); };
    window.addEventListener('blur', onBlur);

    // 飞行模式下鼠标移动控制视角（旋转 alpha/beta）
    const onMouseMove = (e: MouseEvent) => {
      if (flyModeRef.current && e.buttons === 2) {
        camera.alpha -= e.movementX * 0.005;
        camera.beta -= e.movementY * 0.005;
        // 限制 beta 范围避免翻转
        camera.beta = Math.max(0.1, Math.min(Math.PI - 0.1, camera.beta));
      }
    };
    canvas.addEventListener('mousemove', onMouseMove);

    // 键盘按下：监听 window（过滤输入元素，避免在 Inspector/CodeEditor 中触发）
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      const key = e.key.toLowerCase();

      // 飞行模式下：WASD/QE 控制移动，不触发 Gizmo 切换
      if (flyModeRef.current) {
        if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'q' || key === 'e') {
          flyStateRef.current[key as 'w' | 'a' | 's' | 'd' | 'q' | 'e'] = true;
        }
        return;
      }

      // 非飞行模式快捷键
      if (key === 'f') {
        // F键聚焦选中节点
        const selectedId = useEditorStore.getState().selectedNodeId;
        if (selectedId) {
          const mesh = meshMapRef.current.get(selectedId);
          if (mesh) {
            mesh.computeWorldMatrix(true);
            const bounds = mesh.getHierarchyBoundingVectors(true);
            const validBounds = Number.isFinite(bounds.min.x) && Number.isFinite(bounds.max.x);
            camera.setTarget(validBounds ? bounds.min.add(bounds.max).scale(0.5) : mesh.getAbsolutePosition());
            // 调整 radius 使物体在视口中合适大小
            const radius = validBounds ? bounds.max.subtract(bounds.min).length() * 2 : 3;
            camera.radius = Math.max(radius, 3);
          }
        }
      } else if (key === 'w') {
        useEditorStore.getState().setGizmoMode('move');
      } else if (key === 'e') {
        useEditorStore.getState().setGizmoMode('rotate');
      } else if (key === 'r') {
        useEditorStore.getState().setGizmoMode('scale');
      }
    };
    window.addEventListener('keydown', onKeyDown);

    // 键盘抬起：更新飞行按键状态
    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'q' || key === 'e') {
        flyStateRef.current[key as 'w' | 'a' | 's' | 'd' | 'q' | 'e'] = false;
      }
    };
    window.addEventListener('keyup', onKeyUp);

    return () => {
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      camera.attachControl(canvas,true);
    };
  }, [editing]);

  // 退出编辑模式时重置飞行状态（避免播放时仍处于飞行模式）
  useEffect(() => {
    if (!editing) {
      flyModeRef.current = false;
      setFlyModeDisplay(false);
      flyStateRef.current = { w: false, a: false, s: false, d: false, q: false, e: false };
    }
  }, [editing]);

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* 编辑 canvas（常驻，stopped 时显示） */}
      <canvas
        id="viewport"
        tabIndex={0}
        ref={canvasRef}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={async (e) => {
          e.preventDefault();
          const data = e.dataTransfer.getData('application/json');
          if (!data) return;
          let info: { assetId: string; name: string; path: string };
          try {
            info = JSON.parse(data);
          } catch {
            return;
          }

          // 从 store 获取 AssetEntry（fileHandle 不可序列化，不能通过 dataTransfer 传递）
          const assets = useEditorStore.getState().assets;
          const asset = assets.find((a) => a.id === info.assetId);
          if (!asset) {
            useEditorStore.getState().addConsoleLog('error', `未找到资源: ${info.name}`);
            return;
          }

          try {
            const buffer = await readModelAsset(asset, assets);
            const store = useEditorStore.getState();
            const nodeId = store.addNode('model', info.name.replace(/\.(glb|gltf)$/i, ''));
            store.updateTransform(nodeId, { modelUrl: info.name }, false);
            store.setModelBuffer(nodeId, buffer);
          } catch (error) {
            useEditorStore.getState().addConsoleLog('error', `模型导入失败: ${info.name} - ${String(error)}`);
          }
        }}
        style={{
          width: '100%',
          height: '100%',
          display: editing ? 'block' : 'none',
          outline: 'none',
        }}
      />
      {/* 状态浮层：显示当前 Gizmo 模式/坐标系/飞行状态 */}
      {editing && (
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            left: 8,
            bgcolor: 'rgba(0,0,0,0.6)',
            borderRadius: 1,
            px: 1,
            py: 0.5,
            fontSize: 11,
            color: 'rgba(255,255,255,0.8)',
            pointerEvents: 'none',
            userSelect: 'none',
            display: 'flex',
            gap: 1,
            zIndex: 10,
          }}
        >
          <span>
            模式: {gizmoMode === 'move' ? '移动(W)' : gizmoMode === 'rotate' ? '旋转(E)' : '缩放(R)'}
          </span>
          <span>坐标: {gizmoSpace === 'global' ? '全局' : '局部'}</span>
          {flyModeDisplay && <span style={{ color: '#7C9CFF' }}>飞行中</span>}
        </Box>
      )}
      {/* Babylon GizmoManager.coordinatesMode controls world/local axes. */}
      {editing && (
        <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }}>
          <ToggleButtonGroup
            size="small"
            value={gizmoSpace}
            exclusive
            onChange={(_, v) => {
              if (v) setGizmoSpace(v);
            }}
          >
            <ToggleButton value="global">Global</ToggleButton>
            <ToggleButton value="local">Local</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      )}
      {/* 模型加载 Loading 指示器 */}
      {editing && modelLoading && (
        <Box
          sx={{
            position: 'absolute',
            top: 36,
            left: 8,
            bgcolor: 'rgba(0,0,0,0.7)',
            color: 'white',
            fontSize: 12,
            px: 1.5,
            py: 0.5,
            borderRadius: 1,
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          模型加载中...
        </Box>
      )}
      {/* 运行时 iframe（常驻，playing/paused 时显示覆盖） */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: editing ? 'none' : 'block',
        }}
        onClick={() => setFocusHintDismissed(true)}
      >
        <RuntimeFrame />
        {/* 焦点提示（点击后隐藏） */}
        {!focusHintDismissed && (
          <Box
            sx={{
              position: 'absolute',
              bottom: 8,
              right: 8,
              bgcolor: 'rgba(0,0,0,0.6)',
              color: 'rgba(255,255,255,0.7)',
              fontSize: 11,
              px: 1,
              py: 0.5,
              borderRadius: 1,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          >
            点击此处激活运行窗口 (Click to focus)
          </Box>
        )}
      </Box>
    </Box>
  );
}