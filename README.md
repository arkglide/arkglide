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
代码 Tab 支持双击重命名。项目保存、自动恢复和 ZIP 导出包含模型、贴图、材质、预制体与音频，复制及撤销也保留关联资源。

```sh
# 浏览器回归（首次需要下载 Chromium）
npx playwright install chromium
npm run test:browser
# 实际 WASM/JS 数学 API 基准，也可从编辑器菜单打开
npm run benchmark:math
```

`npm run dev/build/build:wasm` 会同步共享场景脚本及 iframe 使用的经典脚本 WASM 版本。
F11 已接入 Jolt WASM 基础物理；F12 C++ 场景图、F13 可玩项目导出、F14 联机仍待实现。

### 第一批可靠性功能

已加入固定步和销毁生命周期、时间缩放、脚本计时器/事件清理、自动恢复副本，以及运行诊断和错误定位。详见 [第一批说明](docs/first-batch.md)。生产构建后可运行 `npm run analyze:build` 查看体积报告。

### 第二批材质与预制体

底部新增「材质与预制体」，支持 PBR、三类贴图、实体子树模板、实例覆盖与模板更新。右侧属性可绑定材质、创建模板、应用到模板、重置覆盖和解除关联。保存、恢复和 ZIP 包含全部新增资源。详见 [第二批说明](docs/second-batch.md)。

第二批补齐：模型分部件材质、嵌套预制体关联与运行时生成 API，详见 [使用与兼容说明](docs/second-batch-completion.md)。

## 第三批可玩性

支持 Jolt WASM 基础物理、音频、动作输入/触屏 HUD 和模型动画。启动后导入 `examples/collect-gems.arkglide`，播放并点击启用音频即可测试移动、碰撞、收集与计分。详见 [第三批说明](docs/third-batch.md)。

当前项目格式为 0.5，兼容无版本标记及 0.1–0.4 的旧项目。`npm run build` 构建编辑器；可玩项目的独立静态导出仍属于 F13。

用户脚本采用 JavaScript；[项目内 import/export 使用方法](docs/javascript-modules.md)。第三批基础玩法已完成，进阶任务见 [完整任务单](docs/third-batch-full-tasklist.md)。
