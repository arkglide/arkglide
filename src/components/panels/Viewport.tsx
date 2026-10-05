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
  StandardMaterial,
  SceneLoader,
} from '@babylonjs/core';
import { GridMaterial } from '@babylonjs/materials';
import { useEditorStore } from '../../store/useEditorStore';
import RuntimeFrame from './RuntimeFrame';

// 中央 3D 视口：编辑 canvas（常驻）+ 运行时 iframe（常驻，display 切换）
export default function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const highlightRef = useRef<HighlightLayer | null>(null);
  const meshMapRef = useRef<Map<string, Mesh>>(new Map());
  const gizmoManagerRef = useRef<GizmoManager | null>(null);
  // 模型 ArrayBuffer 缓存：nodeId → ArrayBuffer（供播放时 Transferable 传递）
  const modelBuffersRef = useRef<Map<string, ArrayBuffer>>(new Map());
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
  const initialPositionsRef = useRef<Map<string, Vector3>>(new Map());

  // 初始化编辑引擎 / 场景 / 环境光 / 网格地面
  useEffect(() => {
    const canvas = canvasRef.current!;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.05, 0.05, 0.05, 1);
    sceneRef.current = scene;

    const camera = new ArcRotateCamera(
      'camera',
      -Math.PI / 2,
      Math.PI / 3,
      8,
      new Vector3(0, 0.5, 0),
      scene,
    );
    camera.attachControl(canvas, true);
    camera.wheelDeltaPercentage = 0.01;
    cameraRef.current = camera;

    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.8;

    const ground = MeshBuilder.CreateGround('ground', { width: 12, height: 12 }, scene);
    const gridMat = new GridMaterial('gridMat', scene);
    gridMat.mainColor = new Color3(0.12, 0.12, 0.12);
    gridMat.lineColor = new Color3(0.35, 0.35, 0.35);
    gridMat.gridRatio = 1;
    ground.material = gridMat;

    const hl = new HighlightLayer('hl', scene);
    highlightRef.current = hl;

    // Gizmo 管理器（初始只启用 positionGizmo，由 gizmoMode/selectedNodeId useEffect 控制切换）
    const gizmoManager = new GizmoManager(scene);
    gizmoManager.positionGizmoEnabled = true;
    gizmoManager.gizmos.positionGizmo!.snapDistance = 0.1;
    gizmoManagerRef.current = gizmoManager;

    scene.onPointerObservable.add((pi) => {
      if (pi.type === PointerEventTypes.POINTERDOWN) {
        const pick = pi.pickInfo;
        if (pick?.hit && pick.pickedMesh && pick.pickedMesh.name !== 'ground') {
          selectNodeRef.current(pick.pickedMesh.name);
        }
      }
    });

    // 飞行模式移动逻辑：每帧渲染前根据 WASD/QE 按键状态移动相机 target
    const upAxis = Vector3.Up();
    const flyObserver = scene.onBeforeRenderObservable.add(() => {
      if (!flyModeRef.current) return;
      const fly = flyStateRef.current;
      const speed = 0.1;
      // ArcRotateCamera.getForwardRay 获取前向方向
      const forward = camera.getForwardRay().direction;
      const right = Vector3.Cross(forward, upAxis).normalize();

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
      meshMapRef.current.clear();
      gizmoManagerRef.current = null;
      cameraRef.current = null;
      scene.dispose();
      engine.dispose();
      sceneRef.current = null;
      highlightRef.current = null;
    };
  }, []);

  // 同步 nodes → 编辑 mesh（增删改 + 层级）
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const meshMap = meshMapRef.current;
    const nodeIds = new Set(nodes.map((n) => n.id));

    // 删除：meshMap 中有但 nodes 中没有的（dispose 会级联清理 Babylon 子 mesh）
    for (const [id, mesh] of meshMap) {
      if (!nodeIds.has(id)) {
        mesh.dispose();
        meshMap.delete(id);
      }
    }

    // 新增/更新
    nodes.forEach((n) => {
      if (n.type !== 'mesh' && n.type !== 'model') return;
      let mesh = meshMap.get(n.id);
      if (!mesh) {
        if (n.type === 'mesh') {
          mesh = n.name.toLowerCase().includes('sphere')
            ? MeshBuilder.CreateSphere(n.id, { diameter: 1 }, scene)
            : MeshBuilder.CreateBox(n.id, { size: 1 }, scene);
        } else {
          mesh = MeshBuilder.CreateBox(n.id, { size: 1 }, scene); // model 占位
        }
        meshMap.set(n.id, mesh);
      }
      mesh.position.set(n.transform.x, n.transform.y, n.transform.z);
      mesh.rotation.set(n.rotation.x, n.rotation.y, n.rotation.z);
      mesh.scaling.set(n.scale.x, n.scale.y, n.scale.z);
      mesh.setEnabled(n.visible);

      // 父子层级同步
      if (n.parentId) {
        const parentMesh = meshMap.get(n.parentId);
        if (parentMesh) mesh.parent = parentMesh;
      } else {
        mesh.parent = null;
      }

      // 颜色 material
      if (n.color) {
        let mat = mesh.material as StandardMaterial;
        if (!mat || mat.name !== n.id + '_mat') {
          mat = new StandardMaterial(n.id + '_mat', scene);
          mesh.material = mat;
        }
        mat.diffuseColor = Color3.FromHexString(n.color);
        mat.emissiveColor = Color3.FromHexString(n.color).scale(0.1);
      }
    });
  }, [nodes]);

  // Gizmo 选中同步 + gizmoMode 切换 + 多选批量拖拽：
  // 选中节点时 attachToMesh（多选时挂到第一个选中节点），W/E/R 切换时更新启用状态
  useEffect(() => {
    const gizmoManager = gizmoManagerRef.current;
    if (!gizmoManager) return;

    // 根据 gizmoMode 启用对应 gizmo（W/E/R 切换时重新启用对应 gizmo）
    gizmoManager.positionGizmoEnabled = gizmoMode === 'move';
    gizmoManager.rotationGizmoEnabled = gizmoMode === 'rotate';
    gizmoManager.scaleGizmoEnabled = gizmoMode === 'scale';

    if (selectedNodeId) {
      const mesh = meshMapRef.current.get(selectedNodeId);
      if (mesh) {
        gizmoManager.attachToMesh(mesh);

        // onDragStart：拖拽开始时保存拖拽前快照（供撤销使用）+ 记录所有选中节点初始位置
        const onDragStart = () => {
          if (isDraggingRef.current) return; // 防止 observer 累积导致重复触发
          beginTransformRef.current();
          // 记录所有选中节点初始位置（供多选批量拖拽增量同步）
          const initialPositions = new Map<string, Vector3>();
          selectedNodeIdsRef.current.forEach((id) => {
            const m = meshMapRef.current.get(id);
            if (m) initialPositions.set(id, m.position.clone());
          });
          initialPositionsRef.current = initialPositions;
          draggedIdRef.current = selectedNodeId;
          isDraggingRef.current = true;
        };
        gizmoManager.gizmos.positionGizmo?.onDragStartObservable.add(onDragStart);
        gizmoManager.gizmos.rotationGizmo?.onDragStartObservable.add(onDragStart);
        gizmoManager.gizmos.scaleGizmo?.onDragStartObservable.add(onDragStart);

        // onDragEnd 节流：松开鼠标时才一次性提交到 Zustand
        // recordHistory=false：beginTransform 已保存拖拽前快照，此处仅同步最终值
        // 多选时：一次性提交所有选中节点（单选时 selectedNodeIds=[selectedNodeId] 兼容）
        const updateFromGizmo = () => {
          isDraggingRef.current = false;
          const ids = selectedNodeIdsRef.current;
          ids.forEach((id) => {
            const m = meshMapRef.current.get(id);
            if (!m) return;
            updateTransformRef.current(
              id,
              {
                transform: { x: m.position.x, y: m.position.y, z: m.position.z },
                rotation: { x: m.rotation.x, y: m.rotation.y, z: m.rotation.z },
                scale: { x: m.scaling.x, y: m.scaling.y, z: m.scaling.z },
              },
              false,
            );
          });
        };

        // 监听三种 Gizmo 的 dragEnd
        gizmoManager.gizmos.positionGizmo?.onDragEndObservable.add(updateFromGizmo);
        gizmoManager.gizmos.rotationGizmo?.onDragEndObservable.add(updateFromGizmo);
        gizmoManager.gizmos.scaleGizmo?.onDragEndObservable.add(updateFromGizmo);
      }
    } else {
      gizmoManager.attachToMesh(null);
    }
  }, [selectedNodeId, selectedNodeIds, gizmoMode]);

  // 多选批量拖拽实时同步：拖拽中根据第一个节点的位移增量同步到其他选中节点
  // 仅 position gizmo 模式生效（rotation/scale 作用于第一个节点）
  // 用 onBeforeRenderObservable 替代 onDragObservable（Babylon 9 Gizmo 无 onDragObservable）
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const syncObserver = scene.onBeforeRenderObservable.add(() => {
      if (!isDraggingRef.current) return;
      // 仅 move 模式同步位移增量
      if (gizmoModeRef.current !== 'move') return;

      const ids = selectedNodeIdsRef.current;
      if (ids.length <= 1) return;

      const draggedId = draggedIdRef.current;
      if (!draggedId) return;

      const draggedMesh = meshMapRef.current.get(draggedId);
      if (!draggedMesh) return;

      const initialPositions = initialPositionsRef.current;
      const draggedInitial = initialPositions.get(draggedId);
      if (!draggedInitial) return;

      // 计算位移增量 delta = 当前位置 - 初始位置
      const delta = draggedMesh.position.subtract(draggedInitial);

      // 同步到其他选中节点：新位置 = 各自初始位置 + delta
      ids.forEach((id) => {
        if (id === draggedId) return;
        const m = meshMapRef.current.get(id);
        const initial = initialPositions.get(id);
        if (m && initial) {
          m.position = initial.add(delta);
        }
      });
    });

    return () => {
      scene.onBeforeRenderObservable.remove(syncObserver);
    };
  }, []);

  // 高亮选中节点（多选时高亮所有选中节点）
  useEffect(() => {
    const hl = highlightRef.current;
    if (!hl) return;
    hl.removeAllMeshes();
    const highlightColor = Color3.FromHexString('#7C9CFF');
    selectedNodeIds.forEach((id) => {
      const mesh = meshMapRef.current.get(id);
      if (mesh) {
        hl.addMesh(mesh, highlightColor);
      }
    });
  }, [selectedNodeIds, nodes]);

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
    canvas.addEventListener('mouseup', onMouseUp);

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
            camera.setTarget(mesh.position);
            // 调整 radius 使物体在视口中合适大小
            const meshBounds = mesh.getBoundingInfo().boundingBox;
            const radius = meshBounds.minimum.subtract(meshBounds.maximum).length() * 2;
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
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
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

          setModelLoading(true);
          try {
            // 读取文件为 ArrayBuffer（不用 Base64，避免体积膨胀 33%）
            let file: File;
            if (asset.fileHandle) {
              file = await asset.fileHandle.getFile();
            } else if (asset.file) {
              file = asset.file;
            } else {
              throw new Error('无法获取文件（缺少 fileHandle 和 file）');
            }
            const buffer = await file.arrayBuffer();

            const scene = sceneRef.current;
            if (!scene) throw new Error('场景未初始化');

            // 用 Blob URL 加载模型（ArrayBuffer → Blob → URL，零 Base64）
            const blobUrl = URL.createObjectURL(new Blob([buffer]));
            // 从文件名推断扩展名，显式指定 loader
            // （Blob URL 无扩展名，Babylon 无法自动推断格式）
            const ext = '.' + (info.name.split('.').pop()?.toLowerCase() || 'glb');
            const result = await SceneLoader.ImportMeshAsync('', '', blobUrl, scene, undefined, ext);
            URL.revokeObjectURL(blobUrl);

            // 创建 SceneNode（type: 'model'），去掉文件扩展名作为节点名
            const nodeId = useEditorStore.getState().addNode(
              'model',
              info.name.replace(/\.(glb|gltf)$/i, ''),
            );
            // 保存原始文件名到 modelUrl，供 runtime.html 推断 loader 扩展名
            useEditorStore.getState().updateTransform(nodeId, { modelUrl: info.name });

            // 存储 ArrayBuffer 供播放时 Transferable 传递
            modelBuffersRef.current.set(nodeId, buffer);
            // 同步到 store，供 RuntimeFrame 播放时读取
            useEditorStore.getState().setModelBuffer(nodeId, buffer);

            // 将加载的根 mesh 存入 meshMapRef（供选中/Gizmo/高亮使用）
            const loadedMeshes = result.meshes;
            if (loadedMeshes.length > 0) {
              const rootMesh = loadedMeshes[0] as Mesh;
              rootMesh.name = nodeId;
              meshMapRef.current.set(nodeId, rootMesh);
            }

            console.log(`[ArkGlide] 模型加载成功: ${info.name}`);
          } catch (err) {
            console.error(`[ArkGlide] 模型加载失败: ${info.name} - ${String(err)}`);
            useEditorStore
              .getState()
              .addConsoleLog('error', `模型加载失败: ${info.name} - ${String(err)}`);
          } finally {
            setModelLoading(false);
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
      {/* Global/Local 坐标系切换按钮
          TODO: Local 模式下需设置 gizmo.customRotationMatrix 为 mesh 旋转矩阵，
                Babylon 9 GizmoManager 不直接支持 Local 切换，当前仅 UI 状态切换 */}
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