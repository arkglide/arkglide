# C++ 逻辑内核与 UI 样式设计

## 迁移计划与本次边界

迁移保持现有 `scene`、`Entity`、`time`、生命周期钩子及所有权 API。先建立可运行、可对照验证的 C++ 逻辑内核，再扩展批量组件与数据同步，不将浏览器对象或 JavaScript 回调逐个搬进 WASM。

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 逻辑内核 | 本次完成 | C++ 实体注册、名称索引、失效句柄、父子关系、双精度矩阵缓存；原生时钟、固定步、所有者状态和定时器调度 |
| 渲染与脚本适配 | 本次完成 | 既有脚本 API 接入内核，编辑器预览与独立包默认使用同一 C++/WASM 路径；保留 JS 对照实现用于兼容和测试 |
| 数据同步与性能基线 | 已开始 | 跳过未变化的变换/父子关系写入；位置查询只复制三个数值；新增实体与独立包帧率基准。连续组件存储、批量查询继续依据分析数据扩展 |

Babylon 继续维护渲染节点、GPU 资源和骨骼，Jolt 继续负责物理，DOM/Web Audio/JavaScript 脚本钩子留在浏览器侧。编辑器的项目文档、撤销和恢复仍由 TypeScript 管理。F12 的首批逻辑运行时迁移已经落地，不代表整个 Babylon 场景图或所有引擎组件都已重写成 C++。

## Runtime 帧率优化顺序

目标是降低帧耗时，而不是以迁入 C++ 的代码量衡量进展。本轮先处理实际测到的问题：

1. **帧调度（已修复）**：旧限帧器每次从实际回调时间重新计算间隔，60 Hz 显示器上小于 16.67ms 的回调会被丢弃，造成约 30～40 FPS。新的调度器保留计划时刻，允许小幅计时抖动；长暂停会重设计划，不积攒追赶渲染。`settings.fpsCap` 继续控制上限，`0` 为不限帧。渲染上限不改变物理固定步设置。
2. **隐藏渲染（已修复）**：播放或暂停期间停止被运行 iframe 覆盖的编辑场景渲染循环；停止游戏后恢复同一编辑场景。浏览器回归检查实际绘制计数停止并恢复。
3. **WASM 边界与分配（本轮完成首批）**：逐次比较渲染/物理侧的最新 TRS，只有变化时才写入 native；父子关系仅在变化时提交。同一帧的物理变换、祖先变化和重新挂接仍立即可见。`getWorldPosition()` 从私有视图读取三个数值，避免先分配并复制完整矩阵；`getWorldMatrix()` 继续返回独立数组，不暴露 WASM 内存。
4. **连续数据与批量接口（下一步）**：用稀疏和密集移动实体的基准决定批量 TRS 输入、批量位置查询及连续组件布局的收益。保持双精度、失效句柄、同帧可见性和内存增长后的视图有效性；不以逐帧 JSON 或逐实体对象转换作为数据通道。
5. **按真实场景继续定位**：分别测量脚本/逻辑、固定步物理、动画和渲染提交；需要时再测 GPU 时间与多视图渲染开销。若主要耗时来自阴影、材质或多个离屏视图，就优化通用渲染预算、剔除和分辨率设置；只有逻辑计算占优时才继续迁移相应计算内核。

新基准无需构建编辑器：

```sh
# CPU 与 transform/setParent 边界调用；默认 1000 实体、60 帧、5 次取中位数
npm run benchmark:runtime
# 可用 BENCH_ENTITIES / BENCH_FRAMES / BENCH_SAMPLES 调整规模
# 可传旧版适配文件与同一 WASM 内核作对照
node scripts/benchmark-runtime.mjs /path/to/baseline-api.js

# 自动导出空场景独立包，按 30 / 60 / 不限帧分别采集实际渲染和 RAF 次数
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run benchmark:runtime:browser
# BENCH_RAF_FRAMES 调整每种设置的采样长度，默认 180 个 RAF
```

基准结果见 [runtime-performance.json](verification/runtime-performance.json)。空场景使用 Chromium 154 / SwiftShader、320×240 视口和约 60 Hz 回调：30 FPS 上限由约 23.7 恢复为 30.0，60 FPS 上限由约 38.0 恢复为 60.0；不限帧前后均约 60。它验证限帧逻辑，不代表复杂场景或目标硬件必然达到 60 FPS。实体基准不含 GPU、物理求解或游戏脚本；调用统计仅包含 `transform` 与 `setParent`，不等于所有 WASM 调用。

实体对照使用同一 WASM 内核，1000 实体按深度 10 分组；每帧更新指定比例的渲染侧位置，然后同步并读取所有世界位置。浏览器测试退出后先后运行旧版和新版适配层，调用次数在计时之外单独采集，5 次采样的每帧中位数如下：

| 每帧变化比例 | 原 CPU 耗时 | 现 CPU 耗时 | 原 transform / setParent 次数 | 现次数 |
| --- | --- | --- | --- | --- |
| 0% | 2.73 ms | 1.12 ms | 6500 / 6500 | 0 / 0 |
| 1% | 2.70 ms | 1.15 ms | 6500 / 6500 | 10 / 0 |
| 10% | 2.63 ms | 1.32 ms | 6500 / 6500 | 100 / 0 |
| 100% | 2.91 ms | 1.61 ms | 6500 / 6500 | 1000 / 0 |

## 冷启动导出回归

CI 中第一次导出曾在等待「打包完成」时刷新编辑器。根因是 Vite 首次加载打包 Worker 时才发现 `terser`，触发二次依赖预编译和整页重载。现在明确预编译 Worker 使用的 `terser` / `fflate`，并将依赖扫描入口限定为编辑器 `index.html`，避免扫描生成的游戏和测试报告。没有增加等待时间或重试次数。

`core-ui` 回归记录主文档导航和 `performance.timeOrigin`，保证打包保留当前编辑器文档；完整浏览器套件需至少一次从空 `node_modules/.vite` 缓存运行。CI 的全新检出天然覆盖这个条件。

依赖 Resource Timing 查找已加载 Babylon/Monaco 实例的浏览器测试使用共享 fixture，在导航前扩大记录缓冲区。开发页面约 850 个资源超过 Chromium 默认的 250 条记录，旧测试可能因模块记录缺失而一直等待；此设置仅用于测试，不改变游戏的运行参数。

## 渲染计算迁移

本轮新增 `cpp/render/batch.cpp`，随现有单文件 WASM 发布。迁移的是渲染前的 CPU 数据计算；Babylon 继续管理 GPU 资源、材质、着色器和绘制。

| 工作 | 本轮状态 | 边界与后续顺序 |
| --- | --- | --- |
| 程序化网格法线 | 已接入 | `visuals.createMesh()` 和 `updateGeometry()` 未提供法线时，超过配置阈值后使用 C++。保持 Babylon 的逐面等权平均和顶点归一化规则 |
| 离屏视图可见性 | 已接入 | C++ 对整批世界 AABB 测试六个视锥平面，输出保序的可见索引。通用适配器已用于成对视口的 RTT，也可用于普通离屏相机 |
| 批量世界变换与包围盒更新 | 下一步 | 先统一变换版本与渲染数据更新，再按视图复用；避免重复调用 Babylon 和 C++ 计算同一批矩阵 |
| 动画采样与姿态混合 | 后续评估 | 迁移关键帧采样和数值混合；脚本事件、资源所有权和 GPU 蒙皮继续使用现有流程 |
| LOD 与批次组织 | 后续评估 | 按距离、屏幕尺寸选择 LOD 和实例批次；先确认它们在实际场景中的 CPU 占比 |

法线输入是连续的双精度位置和 32 位索引，输出为独立的 `Float32Array`。批量可见性使用复用的 AABB、平面及索引缓冲区；不逐顶点创建 Embind 对象，也不经过 JSON。WASM 内存增长后会刷新视图，停止会话时释放内核及工作缓冲区。

筛选对未知包围盒、骨骼、morph、实例批次、相机相关变换及其子物体、自定义 LOD、动作和绘制回调、自定义着色器与活动材质插件采取保守路径。主视图保留 Babylon 的候选、交叉事件和动画处理；本轮只对离屏提交列表做预筛选。无法证明安全的对象继续保留，像素裁剪与材质逻辑仍由渲染器决定。

项目可选设置随保存、恢复和独立包导出保留：

```js
settings.renderCompute = {
  enabled: true,
  normalsMinVertices: 256, // 更小的几何体沿用 JS 路径
  cullMinMeshes: 32,      // 更小的离屏列表直接提交
  maxBatchMeshes: 65536,  // 超过预算时使用原列表
  epsilon: 1e-7,         // 平面距离的保守余量
};
```

阈值和预算在项目校验时检查。调试时可设 `enabled: false` 与旧路径对照；运行诊断显示计算后端、原生法线批次和离屏剔除数量。GPU 绘制耗时仍需单独测量。

`npm run benchmark:render` 可复现 CPU 基准，包含输入传输和独立输出拷贝；`BENCH_GRID_SIZES`、`BENCH_MESHES`、`BENCH_ITERATIONS`、`BENCH_SAMPLES` 可调整规模。结果与浏览器像素、draw call 对照存于 [render-compute-performance.json](verification/render-compute-performance.json)。预打包 AABB 基准不包含 Babylon 包围盒收集；这类内核耗时不能直接换算成复杂游戏的 FPS。

本机 16,641 顶点、32,768 三角形的法线计算中位数从 1.16 ms 降到 0.83 ms，输出与 Babylon 一致。通用离屏相机测试放置一个可见物体和 40 个视锥外物体，实际绘制从 41 次降到 1 次，读取的渲染像素完全相同。

本轮验证：550 项单元测试、冷 Vite 缓存下的 34 项编辑器浏览器测试、7 项静态部署测试及 10 项独立玩法浏览器测试全部通过，TypeScript 类型检查通过。新增回归覆盖法线绕序与退化面、批量边界校验、WASM 内存增长、同帧变换、保守筛选、真实 RTT 像素与绘制次数，以及编辑器和独立包中的原生计算。传送门回归在测试项目中降低筛选阈值，确保实际执行 C++ 路径。编译了 C++/WASM 库，未运行完整前端生产构建。

## 编辑器提示

底栏和属性面板使用简短标题，操作说明放在标题旁或输入框内的帮助按钮。提示支持鼠标悬停和键盘聚焦，按 Esc 关闭；播放期间表单只读时仍可查看帮助。输入错误、缺失资源、运行时只读状态以及恢复替换当前内容的提醒继续直接显示。原来用「·」串联的标题和元数据已改写，不再把后端名称、操作说明塞进标题。

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

后续帧率与冷启动导出修复验收：543 项单测、类型检查、从空 Vite 缓存运行的完整 33 项编辑器浏览器测试、7 项静态部署与 10 项玩法/分块浏览器回归全部通过。另完成上文的独立包帧调度和真实 WASM 实体基准。本轮未改 C++/WASM 二进制，优化渲染调度和适配层的数据通道；无需重编内核，未运行完整前端构建。
