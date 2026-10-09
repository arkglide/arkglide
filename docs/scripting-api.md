# ArkGlide 脚本 API

脚本是 JavaScript **函数体**，由运行时工厂执行；不是 ES module。
在属性面板把脚本挂到实体，每个「实体 × 脚本」有独立实例。
`onStart` 在启动时调用一次，`onUpdate` 在播放期间每帧调用；暂停时不执行。
运行时注入 `entity`、`input`、`scene`、`time`、`console`、`defineScript`。

## 推荐写法

```js
return defineScript({
  speed: 3,
  onStart() {
    console.log('启动', this.entity.name);
  },
  onUpdate() {
    const step = this.speed * time.deltaTime;
    this.entity.translate(
      input.getAxis('a', 'd') * step,
      0,
      input.getAxis('s', 'w') * step
    );
  }
});
```

`defineScript` 是可选的恒等函数；帮助 Monaco 推导自定义状态字段。
原来的 `return { onStart() {}, onUpdate() {} }` 继续可用，也能补全 `this.entity`。
若先用变量保存生命周期对象，再返回它，请用 `defineScript(...)` 创建该对象。
普通方法中的 `this` 是返回的实例；工厂顶层 `this.entity` 也可用。
箭头函数捕获工厂的 `this`，因此访问自定义实例状态时应使用普通方法。
不要自行修改注入的 `entity` 字段。

## Entity

| API | 行为 |
| --- | --- |
| `id` / `getId()` | 稳定 ID，改名不会改变 ID |
| `name` / `getName()` / `setName(name)` | 显示名称，初始值来自编辑器的节点名称 |
| `position` / `transform` | 同一个 live 位置视图；`transform` 保留旧脚本兼容 |
| `rotation` | live 欧拉角，单位为弧度 |
| `scale` | live 缩放 |
| `visible` / `isVisible()` / `setVisible(value)` | 可见性，支持重新显示初始隐藏的实体 |
| `getPosition()` / `getRotation()` / `getScale()` | 普通 `{x,y,z}` 副本；修改副本不影响实体 |
| `setPosition(...)` / `setRotation(...)` / `setScale(...)` | 接受三个数或一个 `{x,y,z}` |
| `translate(...)` / `rotate(...)` | 叠加位置偏移 / 欧拉角；接受三个数或一个 `{x,y,z}` |
| `destroyed` / `destroy()` | 销毁可重复调用；销毁后其他读写会抛出明确错误 |

位置和偏移是局部坐标；`translate` 不会根据物体朝向旋转偏移，也不执行碰撞检测。

```js
this.entity.position.x += 1;
this.entity.setPosition({ x: 0, y: 1, z: 0 });
this.entity.rotate(0, Math.PI * time.deltaTime, 0);
```

句柄使用 WeakMap 保存渲染器引用，不提供 Babylon mesh/vector 对象。
这是一层可替换的渲染适配器；当前实现仍由 Babylon 执行，不代表 F10/F12 的 WASM 迁移已经完成。

## Scene

- `scene.find(id)`：按 ID 查找，缺失时返回 `null`。
- `scene.findByName(name)`：按显示名查找第一个实体，缺失时返回 `null`。
- `scene.findAllByName(name)`：同名实体数组，名称允许重复。
- `scene.findAll()`、`scene.getEntityCount()`：实体列表 / 数量。
- `scene.create(type, id?)`：创建 `box | sphere | plane | cylinder | capsule | torus`；省略 ID 自动生成。显式重复 ID 或未知类型抛错，避免覆盖已有句柄并泄漏网格。
- `scene.destroy(id)`、`scene.destroyAll()`：销毁实体；被销毁实体的生命周期不再执行。

```js
const player = scene.findByName('Player');
if (player) player.translate(0, 1, 0);
```

当前运行时只登记 mesh 和成功加载的 model 节点；查询不涵盖编辑器中的 light/camera/empty。

## Input 和 Time

键名使用 `KeyboardEvent.key`，忽略大小写：`w`、`ArrowUp`，空格用 `' '`。
保留 `isKeyDown`、`wasKeyPressed`、`wasKeyReleased` 和鼠标 API。
`input.getAxis(negativeKey, positiveKey)` 返回 -1 / 0 / 1，两键同时按下抵消。
`input.getMouseDelta()` 返回本帧鼠标按住时累计位移。

`time.deltaTime` / `time.totalTime` 单位为秒；`frameCount` 为运行帧数。
暂停不累积模拟时间，启动及恢复后的第一帧 `deltaTime` 为 0，避免恢复时物体跳跃。
把速度乘以 `deltaTime`，不要使用每帧固定距离。

## 补全实现与验证

- `src/types/arkglide.d.ts` 是脚本 API 契约，注入 JS 和 TS 两个语言服务。
- `src/editor/script.worker.js` 使用 Monaco 0.57 的本地 TypeScript worker；当前固定为 0.57.0，升级时需回归 worker 适配测试。
- `scriptWorkerAdapter.js` 只在 worker 内包裹脚本，隔离变量、给生命周期提供类型，并将补全、悬浮、签名、诊断、重命名等位置映射回原始代码。格式化使用未包裹的源码。
- 编辑器使用有文件名的 URI，逐模型监听改动；加载/导入/新项目/撤销同步回 Monaco，卸载时释放模型。
- 更新 API 时同步运行实现与声明，运行 `npm test` 和 `npm run build`。
- 完整构建包含 Monaco/Babylon 大包；若 Node 报 heap out of memory，可设置 `NODE_OPTIONS=--max-old-space-size=6144` 后构建，本次生产构建使用此配置验证。

`.ts` 文件可获得类型提示；当前 runtime 的 `new Function` **不支持执行 TypeScript 类型语法或 import/export**。本次没有新增 TypeScript 转译链路。
旧版只含 `project.script` 的单脚本项目继续执行，其空场景下 `entity` 可能为 `null`；绑定实体脚本始终接收有效实体。
