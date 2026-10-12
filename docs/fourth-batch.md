# 第四批：F13 独立静态游戏导出

## 使用方法

在编辑器停止运行后，打开「菜单 → 导出独立游戏…」，设置标题、显示方式与设计比例，点击「下载游戏 ZIP」。原工具栏的「导出项目」仍生成可重新编辑的 `.arkglide`；两者用途不同。

解压游戏 ZIP，将**整个目录**部署到 HTTP/HTTPS 静态服务器，打开 `index.html`。可部署在网站根目录或 `/games/demo/` 这样的子目录，不需要编辑器、Vite、Node、IndexedDB 项目数据库或联网 CDN。服务器需正确返回 `.js` 的 JavaScript MIME；目录访问应指向 `index.html`，或显式打开该文件。不要用 `file://` 直接双击。

本地可使用 Python：

```sh
cd 解压后的游戏目录
python -m http.server 8080
```

打开 `http://localhost:8080/`。也可以在源码仓库使用：

```sh
node scripts/serve-static.mjs examples/fourth-static-game 8080
```

脚本仅用于测试/本地查看；部署本身可用任何普通静态服务器。

## 命令行导出

```sh
npm ci
npm run export:game -- examples/fourth-static.arkglide output/my-game
```

输出静态目录及同名 `.zip`。输出目录必须为空，避免把旧部署文件混入新包。CLI 用 Vite 的 SSR 转换加载现有 TypeScript 项目校验器，但游戏包及其运行**不依赖 Vite 服务**，也没有执行编辑器 `vite build`。

## 打包与加载规则

| 内容 | 规则 |
| --- | --- |
| 场景、材质、UI、动画、重定向、物理、音频混音设置 | 保留规范化后的完整 `project.json` |
| 用户脚本 | 保留全部项目 JavaScript 源码；导出前解析语法并检查模块图，不执行用户脚本、不编译 TS |
| 项目内模块 | 相对路径、明确 `.js` 后缀；静态 import/export、转导出、字符串字面量 `import()` 均打包 |
| 动态路径 | `import(variable)`、远程/npm 导入、顶层 await、循环依赖仍不支持，导出前报错 |
| 预制体 | 打包所有模板及模板专用模型，即使初始场景未使用；允许运行时计算模板 ID，再调用 `prefabs.instantiate()` |
| 模型 | 自包含 GLB，或关联 bin/贴图已内嵌 data URI 的 glTF；模型内外部 URI 明确拒绝 |
| 模型压缩 | 本批未内置 Draco、Meshopt、KTX2/Basis 解码器，导出遇到对应扩展明确拒绝 |
| 独立贴图、声音 | 打包已登记的二进制资源，检查存在与声明大小；流式声音仍使用本地字节生成媒体 Blob，不依赖外链 |
| WASM | 数学和 Jolt 采用 SINGLE_FILE，WASM 内嵌在 `lib/arkglide_math.js`、`lib/jolt-physics.js` |
| 运行时 | 本地 Babylon、glTF loader、Acorn、ArkGlide 运行模块及许可随包；无 React/MUI/Monaco/Dockview bundle |
| 未登记资源 | 任意用户脚本的 `fetch()`、DOM URL、远程服务、未导入文件不会自动爬取/复制；需要用户显式管理，不能宣称离线完整 |

`game-manifest.json` 记录全部文件路径、大小、资源 ID 映射、模块依赖图和显示设置。资源文件使用导出器分配的安全文件名，不把资源 ID 或原始文件名拼成部署路径。启动先检查全部清单文件存在及大小，再传递模型/贴图/声音 ArrayBuffer 给共享运行页。大小校验用于发现缺失/截断文件，不是密码学完整性校验；同大小坏数据由解析/解码时的启动诊断继续检查。

## 启动、声音、输入与清理

- 点击「开始游戏」显示按字节和文件计数的进度，下载完成后显示 WASM/场景/声音初始化阶段。
- 支持启动失败、HTTP 错误、文件大小不符、解析/脚本错误和超时提示；失败可重试。
- 启动采用用户点击入口。声音保留游戏内「启用音频」按钮，并支持点击画面解锁 Web Audio；浏览器的声音策略由真正用户手势处理。
- 「适应窗口」填充运行区；「按设计比例缩放」保持所选宽高比并留黑边。设计尺寸用于显示比例，不强制低分辨率渲染。运行画布、HUD 和触摸输入仍使用共享运行时。
- 点击运行画面获取键盘焦点；失焦由现有输入适配器释放按键。页面隐藏时暂停，返回后需要手动继续。
- 暂停/继续通过运行时确认；停止先发送 `stop`，收到已停止的资源统计后移除 iframe。异常情况下最多等待 1 秒后强制移除运行 realm。
- 每次重新开始创建独立 iframe realm，原生模块缓存及全局工具模块变量不跨会话保留。源码示例的模块计数器每次均从 1 开始。
- 停止取消 `AbortController` 下载、待发项目以及超时；boot token、source 和会话代号拒绝旧消息。iframe 销毁终止其异步任务；共享运行时的生命周期、预制体、模型加载、音频解码原有取消/清理逻辑继续使用。
- 包含引擎及依赖许可。引擎源码以 GPLv3 提供，完整对应源码在本次源码 ZIP 中。

## 示例

- `examples/fourth-static.arkglide`：可以导入编辑器的源项目。
- `examples/fourth-static.json`：源项目文本。
- `examples/fourth-static-game/`：已经导出的可直接运行目录。
- `examples/fourth-static-game.zip`：同一目录的独立部署包。

示例在第三批真实模型/物理/音频/动画/HUD 项目基础上，加入共享工具模块、字面量动态导入以及贴图 PBR 材质。沿用第三批每 5 个游戏秒自动生成组合补给箱的逻辑；暂停游戏时间时计时器不推进。各操作提示见游戏内 HUD；测试还直接调用运行时预制体 API，证明模板专用模型在独立包中可加载。

## 验证与边界

任务单见 [fourth-batch-tasklist.md](fourth-batch-tasklist.md)，实际记录见 [fourth-batch-verification.md](fourth-batch-verification.md)。不把软件渲染、模拟输入或浏览器自动化称为目标硬件验收。

本批不扩展 F10 性能优化、F12 C++ 场景图迁移和 F14 联机。真实手柄、实体手机/平板、目标浏览器与实际生产域名人工验收仍待完成。直接文件打开、变量动态模块、外部模型依赖、未内置的压缩解码器也没有声称支持。
