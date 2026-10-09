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
代码 Tab 支持双击重命名。项目保存和 ZIP 导出包含模型，复制及撤销也保留模型数据。

```sh
# 浏览器回归（首次需要下载 Chromium）
npx playwright install chromium
npm run test:browser
# 实际 WASM/JS 数学 API 基准，也可从编辑器菜单打开
npm run benchmark:math
```

`npm run dev/build/build:wasm` 会同步共享场景脚本及 iframe 使用的经典脚本 WASM 版本。
F11 物理、F12 C++ 场景图、F13 可玩项目导出、F14 联机仍待实现。
