import fs from 'node:fs/promises';
import { tuning as c } from '../examples/composition-lab-scripts/config.js';

export async function compositionProject() {
  const body = motion => ({ motion, shape: 'box', size: { x: 1, y: 1, z: 1 }, mass: 2, friction: .6,
    restitution: 0, sensor: false, lockRotation: false, linearDamping: .05, angularDamping: .05 });
  const node = (id, position, scale, color, motion = 'static', extra = {}) => ({ id, name: id, type: 'mesh', primitive: 'box',
    transform: position, scale, rotation: { x: 0, y: 0, z: 0 }, visible: true, color, scripts: [], physics: body(motion), ...extra });
  const v = (x, y, z) => ({ x, y, z });
  const nodes = [
    node('WestFloor', v(-4, -.2, 1), v(16, .4, 18), '#7c899c'),
    node('EastFloor', v(10, -.2, 1), v(6, .4, 18), '#617e98'),
    node('Door', c.door.closed, v(.3, 3, 3), '#edbd67', 'kinematic'),
    node('CorridorNorth', v(10, 1.5, 1.7), v(6, 3, .3), '#607488'),
    node('CorridorSouth', v(10, 1.5, -1.7), v(6, 3, .3), '#607488'),
    node('EastBoundary', v(13.1, 2, 1), v(.2, 4, 18), '#607488'),
    node('PortalPanelA', v(3, 2, 2), v(3, 4, .2), '#f1f4fa'),
    node('PortalPanelB', v(10, 2, 6), v(.2, 4, 4), '#f1f4fa'),
    node('Crate', v(-4, .45, 0), v(.8, .8, .8), '#f2a34a', 'dynamic'),
    node('Plate', v(-2, .05, 0), v(2, .1, 2), '#5599cd'),
    node('Mirror', v(0, 1.3, 4), v(2, 2, .2), '#b6f9f2', 'static', { rotation: v(0, c.laser.mirrorYaw[0], 0) }),
    node('Receiver', v(5, 1.3, 3.86), v(.5, 1, 1), '#e56854'),
    node('GoalMarker', c.goal.position, v(.2, 2, .2), '#67e8a4'),
    { id: 'Player', name: 'Player', type: 'empty', transform: c.player.start, scale: v(1, 1, 1), rotation: v(0, 0, 0), visible: true,
      scripts: ['main.js'], character: { ...c.player, maxSlope: 45, movementMode: 'inertial' } },
  ];
  // Project schema contains only character configuration, not the game's spawn key.
  delete nodes.at(-1).character.start;
  const scripts = Object.fromEntries(await Promise.all(['main.js', 'config.js'].map(async name => [name,
    await fs.readFile(new URL('../examples/composition-lab-scripts/' + name, import.meta.url), 'utf8')])));
  const actions = [['moveX', ['KeyD'], ['KeyA']], ['moveZ', ['KeyW'], ['KeyS']], ['jump', ['Space'], []],
    ['interact', ['KeyE'], []], ['mirror', ['KeyQ'], []], ['save', ['KeyK'], []], ['retry', ['KeyR'], []]]
    .map(([name, positive, negative]) => ({ name, positive, negative }));
  const label = (id, text, y, extra = {}) => ({ id, kind: 'text', text, x: 2, y, width: 90, height: 5, fontSize: 16, color: '#ffffff', background: '#142439', ...extra });
  return { version: '0.6', name: 'ArkGlide · 通用玩法组合验证', projectId: 'arkglide-composition-lab-v1',
    scene: { nodes }, scripts, activeFileId: 'main.js', modelRefs: [],
    settings: { gravity: v(0, -9.8, 0), backgroundColor: '#142439', ambientIntensity: .8, fpsCap: 60, fixedTimeStep: 1 / 60, maxSubSteps: 8, timeScale: 1 },
    content: { materials: {}, textures: [], prefabs: {}, prefabInstances: {}, audio: [], physics: { groups: [{ name: 'Default', mask: 1 }], debug: false },
      gameplay: { captureInput: true, actions, hud: [label('title', '通用玩法组合：放箱压板 → 反射接收 → 穿门光桥 → 出口', 2),
        label('hint', 'WASD 移动 · 空格跳跃 · 点击锁鼠标 · E 抓取/释放 · Q 旋转反射面 · K 保存 · R 重试', 8),
        label('status', '加载中', 14), label('crosshair', '+', 50, { x: 50, width: 3, background: '#142439' }),
        label('saveCheckpoint', '保存检查点', 90, { kind: 'button', width: 18 }),
        label('retryCheckpoint', '重试检查点', 90, { kind: 'button', x: 22, width: 18 }),
        label('turnMirror', '切换反射面', 90, { kind: 'button', x: 42, width: 18 })] } } };
}
