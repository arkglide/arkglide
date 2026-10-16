# ArkGlide

浏览器中的 3D 游戏编辑器：React、Dockview、Monaco、Babylon.js 与 C++/WASM。

```sh
npm ci
npm run dev
npm test
npm run build
```

脚本的实体、场景、输入与生命周期 API 见 [脚本 API 文档](docs/scripting-api.md)。
WASM 编译使用 `npm run build:wasm`，需要脚本所下载的 Emscripten 工具链。


本轮实现范围和验收边界见 [前端路线图](docs/roadmap.md)。

模型从「项目资源」拖入视口；灯光、相机与空节点可配置、挂脚本和组成父子层级。
新建脚本后可直接命名；已有脚本可在代码 Tab 或项目资源中双击、按 F2 重命名，使用编辑器内对话框并提示重名与路径错误。项目保存、自动恢复和 ZIP 导出包含模型、贴图、材质、预制体与音频，复制及撤销也保留关联资源。

```sh
# 浏览器回归（首次需要下载 Chromium）
npx playwright install chromium
npm run test:browser
# 实际 WASM/JS 数学 API 基准，也可从编辑器菜单打开
npm run benchmark:math
```

`npm run dev/build/build:wasm` 会同步共享场景脚本及 iframe 使用的经典脚本 WASM 版本。
F11 已接入 Jolt WASM 进阶物理；F13 已支持独立静态游戏导出。F12 已完成首批 C++ 逻辑场景、实体与生命周期内核迁移，后续继续组件与批量同步；F14 联机仍待实现。

### 第一批可靠性功能

已加入固定步和销毁生命周期、时间缩放、脚本计时器/事件清理、自动恢复副本，以及运行诊断和错误定位。详见 [第一批说明](docs/first-batch.md)。生产构建后可运行 `npm run analyze:build` 查看体积报告。

### 第二批材质与预制体

底部新增「材质与预制体」，支持 PBR、三类贴图、实体子树模板、实例覆盖与模板更新。右侧属性可绑定材质、创建模板、应用到模板、重置覆盖和解除关联。保存、恢复和 ZIP 包含全部新增资源。详见 [第二批说明](docs/second-batch.md)。

第二批补齐：模型分部件材质、嵌套预制体关联与运行时生成 API，详见 [使用与兼容说明](docs/second-batch-completion.md)。

## 第三批可玩性

支持 Jolt WASM 基础物理、音频、动作输入/触屏 HUD 和模型动画。启动后导入 `examples/collect-gems.arkglide`，播放并点击启用音频即可测试移动、碰撞、收集与计分。详见 [第三批说明](docs/third-batch.md)。

当前项目格式为 0.6，兼容无版本标记及 0.1–0.5 的旧项目。`npm run build` 构建编辑器；游戏静态包使用独立导出入口。

用户脚本采用 JavaScript；[项目内 import/export 使用方法](docs/javascript-modules.md)。第三批基础玩法已完成，进阶任务见 [完整任务单](docs/third-batch-full-tasklist.md)。

## 第四批独立静态导出

停止运行后打开「菜单 → 导出独立游戏…」，先打包再下载。运行包使用内容寻址的二进制场景块、资源索引与按需预制体加载，不再输出完整项目 JSON；打开部署页自动进入游戏，启动终端日志随后清空，游戏日志可选。默认压缩脚本、变量改名并隐藏源文件名。详细配置和资源加载约定见 [打包与部署](docs/fourth-batch.md)。

CLI：`npm run export:game -- examples/fourth-static.arkglide 空输出目录`，随后用 `node scripts/serve-static.mjs 输出目录 8080` 运行。[变更记录](docs/fourth-batch-changes.md)与[验收记录](docs/fourth-batch-verification.md)提供交付详情。`npm run test:static` 验证无编辑器运行，`npm run test:package:browser` 验证分块按需加载与释放；`npm run verify:fourth` 串行执行单测、静态部署、生产构建和编辑器回归。真实手柄与实体目标设备人工验收仍待完成。

## 通用视角与传送门 API

新增鼠标锁定、多模式相机 rig、惯性角色、世界位姿/角速度、物理抓取和配对传送门。自动开孔适用于注册静态盒形平板，递归视图、跨门射线与动量转换共用于编辑器和独立包。导入 `examples/portal-lab.arkglide` 进行验收；完整接口、运行方法和物理边界见 [通用视角与传送门 API](docs/view-and-portals-api.md)。

## 通用玩法基础 API

新增接触材质规则、运行时物理/角色配置、稳定 ID 碰撞体更新、关节电机控制、动态视觉资源、表面涂层、有限体积穿门投射、力场、区域触发器、预制体关卡与检查点存档。接口和参数均保持通用；游戏脚本负责具体机关规则。使用方法和边界见 [玩法基础 API](docs/gameplay-foundations-api.md)，实际验证范围见 [完整性检查](docs/gameplay-foundations-verification.md)。

日常接口修改优先使用轻量验证，无需生产构建：

```sh
npm run sync:runtime
node --test --test-reporter=tap --test-concurrency=1 tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit --pretty false
# 系统 Chromium 可通过 PLAYWRIGHT_CHROMIUM_EXECUTABLE 指定
npm run test:foundations:browser
npm run test:composition:browser
```

通用信号逻辑、可逆运动机构和原生反射查询已加入。可导入 `examples/composition-lab.arkglide` 体验压板、反射接收、运动门、穿门光桥/牵引场和检查点重试的组合；游戏参数位于 `examples/composition-lab-scripts/config.js`。穿门控制与接口边界统一见上述 API 文档。

代表游戏《折径》（暂定）已进入规划：六个连贯房间、约 20～30 分钟的第一人称空间解谜短篇，先制作两关的完整可玩体验。定位、关卡设计、实现边界和验收见 [代表游戏规划](docs/roadmap.md#代表游戏折径暂定名-foldline)。规划中的游戏内容尚未实现。

## C++ 逻辑内核与 UI 样式

编辑器预览和独立包默认使用 C++/WASM 管理逻辑实体、父子矩阵缓存、模拟时钟和定时器；脚本 API 保持兼容，运行诊断可以检查后端。Babylon 渲染、Jolt 物理和浏览器资源继续通过适配层协作。

UI 画布新增大画布编辑模式、共享/状态样式、元素覆盖、独立定位与尺寸单位、矩形/椭圆及可编辑准心预设。接口、迁移边界和使用示例见 [C++ 内核与 UI 设计](docs/runtime-core-and-ui.md)。
