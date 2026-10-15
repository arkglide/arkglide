# C++ 逻辑内核与 UI 样式设计

## 迁移计划与本次边界

迁移保持现有 `scene`、`Entity`、`time`、生命周期钩子及所有权 API。先建立可运行、可对照验证的 C++ 逻辑内核，再扩展批量组件与数据同步，不将浏览器对象或 JavaScript 回调逐个搬进 WASM。

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 逻辑内核 | 本次完成 | C++ 实体注册、名称索引、失效句柄、父子关系、双精度矩阵缓存；原生时钟、固定步、所有者状态和定时器调度 |
| 渲染与脚本适配 | 本次完成 | 既有脚本 API 接入内核，编辑器预览与独立包默认使用同一 C++/WASM 路径；保留 JS 对照实现用于兼容和测试 |
| 数据批处理 | 后续 | 进一步减少变换同步的边界调用，建立组件存储、批量查询及性能基准，依据分析数据选择下一批迁移目标 |

Babylon 继续维护渲染节点、GPU 资源和骨骼，Jolt 继续负责物理，DOM/Web Audio/JavaScript 脚本钩子留在浏览器侧。编辑器的项目文档、撤销和恢复仍由 TypeScript 管理。F12 的首批逻辑运行时迁移已经落地，不代表整个 Babylon 场景图或所有引擎组件都已重写成 C++。

## 内核如何运行

`cpp/runtime/core.cpp` 与现有数学代码一起编译到 `arkglide_math.js` 单文件库，不新增一次 WASM 网络下载。

- `RuntimeWorld` 使用可复用槽位和不重用的递增句柄。销毁、同 ID 重建或清空场景后，旧句柄始终失效；达到计数上限时拒绝分配，不回绕复用。
- C++ 拥有逻辑实体的 ID、名称索引和父子关系。循环父子引用被拒绝。世界矩阵按本地版本与父矩阵版本更新，使用双精度；深层树采用迭代遍历。
- 渲染和物理侧变换经适配层同步到逻辑内核；普通实体的世界矩阵读取由 C++ 计算、缓存，再复制为脚本可用的普通数组。含有非引擎注册渲染祖先的兼容路径保留原计算方式。
- `RuntimeClock` 推进游戏时间、固定步、插值和丢弃时间，维护所有者状态和所属定时器。JS 只保存回调/浏览器资源，并按原有顺序执行钩子和物理步骤。暂停、零时间缩放、销毁和停止继续遵守原来的清理约定。
- 时钟通过数值视图读取；WASM 内存增长后重新获取视图，停止时保存最终快照并释放原生时钟。渲染对象和 native 对象均在销毁路径中注销。
- `fixedTimeStep`、`maxSubSteps`、`timeScale` 沿用原设置；可选 `settings.maxFrameDelta` 控制单帧模拟增量上限，默认 `0.25` 秒，允许 `(0,10]`。

「运行诊断」新增场景/生命周期后端、原生实体/所有者/定时器数量、矩阵更新次数及核心 WASM 堆。正常运行应显示两个 `cpp-wasm` 后端。停止后原生实体、所有者和定时器归零；WASM 堆容量不等于活对象内存，不要求回到零字节。

## UI 设计器

打开「材质与预制体 → UI 画布」，可以继续在底部面板编辑，也可以点击「大画布编辑」进入左右分栏：左侧预览、右侧属性和样式。布局修改支持原有撤销、重做与子树复制；运行期间只读。

新增功能：

- 预览宽高、普通/悬停/按下/焦点/禁用状态预览；画布按预览尺寸缩放，拖动和调整大小正确换算坐标。
- `positionUnit` 与 `sizeUnit` 独立设置，均兼容原 `unit`。例如百分比定位配合像素尺寸，窗口变宽时准心保持居中和固定大小。
- 通用 `shape` 元素支持矩形和椭圆。矩形可做细线，椭圆配合透明背景和边框可做圆环。
- 「添加十字准心」创建一个容器和四条普通矩形；「添加圆环」创建普通椭圆。全部可以在层级中独立修改，没有专用 Portal 玩法逻辑。
- 共享样式定义、多个样式类、元素覆盖、透明背景、边框/圆角、内边距、透明度、旋转、字体和布局对齐。高级属性可在样式 JSON 中编辑。

准心容器示例：

```js
{
  id: 'reticle', kind: 'container', text: '',
  x: 50, y: 50, positionUnit: 'percent',
  width: 28, height: 28, sizeUnit: 'px',
  anchorX: 0.5, anchorY: 0.5,
  color: '#FFFFFF', background: 'transparent', fontSize: 20,
  style: {padding: 0, borderRadius: 0},
  blockInput: false,
}
```

其子矩形使用 `parentId: 'reticle'` 和像素单位定义线宽、长度与间隙。装饰元素默认不捕获指针，点击准心会交给游戏画布。

## 样式定义与优先级

样式表保存在 `content.gameplay.styles`，随项目保存、恢复、导入及独立导出。编辑器和游戏使用同一份样式解析器。它是有类型和校验的声明式样式表，不执行任意 CSS 文本或外部样式资源。

```json
{
  "control": {
    "base": {
      "backgroundColor": "transparent",
      "borderWidth": 2,
      "borderColor": "#FFFFFF",
      "borderRadius": 4,
      "padding": 8,
      "fontFamily": "system-ui, sans-serif",
      "textAlign": "center"
    },
    "hover": {"opacity": 0.8},
    "focus": {"outlineColor": "#20FF90", "outlineWidth": 2},
    "pressed": {"opacity": 0.5},
    "disabled": {"opacity": 0.25}
  }
}
```

元素使用 `classes: ['control']`，并可添加 `style` 与 `stateStyles`。应用顺序为：旧字段默认外观 → 按类顺序应用 `base` → 元素 `stateStyles.base`/`style` → 激活状态。状态依次为 `hover`、`focus`、`pressed`、`disabled`，元素对应状态覆盖共享状态。后者优先。清空元素覆盖会重新显示继承值。

支持颜色/透明背景、边框与圆角、内边距、字号/字体/粗细/斜体、行高、字距、对齐、换行、溢出、图片适应方式、文字/盒子阴影、混合模式和旋转/缩放。长度数字使用 CSS 像素，圆角也支持百分比，行高为无单位倍数。布局位置、尺寸和输入捕获通过专门字段控制；未知属性、资源 URL 和非法数值会被拒绝。

旋转和缩放会与锚点平移组合。拖动位置按画布单位计算；旋转后的缩放手柄仍按画布坐标轴改变尺寸，不提供专用旋转轴拖拽。

## 脚本接口

```js
export default function ({ui}) {
  return {
    onStart() {
      const ring = ui.create({
        id: 'aim-ring', kind: 'shape', shape: 'ellipse', text: '',
        x: 50, y: 50, positionUnit: 'percent', sizeUnit: 'px',
        width: 24, height: 24, anchorX: .5, anchorY: .5,
        background: 'transparent',
        style: {borderWidth: 2, borderColor: '#FFFFFF', padding: 0},
      });
      ring.setStyle({opacity: .8, rotation: 15}); // 合并元素覆盖
      ring.setLayout({width: 32, height: 32});
      const copy = ring.getStyle(); // 返回独立的元素覆盖副本
      ring.setStyle(null); // 清除元素覆盖，恢复声明/共享默认值
      // ring.setClasses(['control']); // 绑定项目中已定义的样式类
    },
  };
}
```

`setLayout()` 接收 `x/y/width/height/unit/positionUnit/sizeUnit/anchorX/anchorY/zIndex/gap/margin`。所有新接口沿用脚本所有权，失效后拒绝修改；动态创建的 UI 随所属脚本销毁。

## 编译和验证

普通前端修改无需构建编辑器或重编 WASM。更改 C++ 后执行：

```sh
npm run build:wasm
npm test
node node_modules/typescript/bin/tsc --noEmit --pretty false
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser -- --project=core-ui --reporter=list
```

默认构建脚本继续使用固定 emsdk 6.0.11；受管理环境可显式设置 `EMXX=/可信工具链/em++`。本次因官方下载域名不在环境白名单，使用 Debian 官方仓库的 Emscripten 3.1.69、LLVM 19 完成真实编译，保留包签名、校验与 TLS 验证。环境已准备可复用本地工具链，无需 root；未运行完整 `npm run build`。

2026-10-16 本轮检查包括：519 项单测、类型检查、7 项静态部署与 10 项玩法/分块浏览器回归、第三批真实模型/音频/HUD 与 20 会话启停测试，以及编辑器创建样式、导出独立包、双宽度准心布局和原生资源清理。静态部署的根目录/子目录、失败重试、取消及完整性检查使用同一新内核回归。浏览器使用 Chromium/SwiftShader，未将软件渲染结果声明为目标硬件性能提升。
