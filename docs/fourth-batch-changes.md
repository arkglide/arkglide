# 第四批中文变更说明

基于 `arkglide/arkglide` 最新 main `1f7bacd421f9ede86a46079e9cf47f84288f4b81`。没有提交或推送。

## 功能

1. 新增共享静态游戏打包器，与现有可编辑项目 ZIP 分离。完整包含本地运行时、内嵌数学/Jolt WASM、全部项目脚本、模型、材质贴图、音频、HUD 和所有预制体依赖。
2. 导出时检查脚本语法、相对模块/字面量动态导入、循环及缺失引用；检查资源存在与大小、模型自包含情况和压缩解码器边界。
3. 新增独立启动页：加载字节/文件进度、初始化状态、错误重试、暂停/继续确认、停止/重新开始、全屏、响应式或固定比例显示。显式游戏内音频解锁沿用共享运行时。
4. 独立宿主以 AbortController、会话代号及 boot token 取消下载/待启动项目、拒绝旧消息；停止完成后销毁 iframe realm，防止模块状态跨重启残留。页面隐藏自动暂停。
5. 编辑器菜单新增「导出独立游戏…」及设置/进度/错误/取消；工具栏原「导出」改名「导出项目」，保持原档案用途。
6. 增加 CLI 游戏导出、本地静态服务器、可编辑第四批示例和已经导出的完整游戏目录/ZIP。
7. 共享运行页改用相对路径，增加成功启动消息、bootstrap 错误提示；退出页时由浏览器释放运行 realm 的 WebGL 上下文，保留原编辑器通信与游戏逻辑。
8. 增加依赖许可分发、独立包模块/资源单测、静态服务器回归及编辑器真实下载验收；更新 F13 路线图与中文文档。

## 主要文件

| 文件 | 用途 |
| --- | --- |
| `src/export/static-game.mjs` | 共享打包器、依赖清单、模块与模型检查 |
| `src/utils/staticGameExport.ts` | 编辑器快照、运行时读取、ZIP 下载 |
| `src/components/panels/StaticExportDialog.tsx` | 游戏导出设置与进度 |
| `public/standalone.html`、`public/standalone-player.js` | 独立游戏页面与宿主 |
| `public/runtime.html` | 共享运行时启动/清理与相对路径 |
| `scripts/export-static-game.mjs` | .arkglide 到静态包的 CLI |
| `scripts/create-fourth-example.mjs` | 可重新生成的第四批示例 |
| `scripts/serve-static.mjs` | 普通静态服务器，本地演示与验收 |
| `tests/static-export.test.mjs` | 导出完整性及失败边界 |
| `tests/static/game.spec.ts` | 无编辑器静态部署回归 |
| `tests/browser/f13-export.spec.ts` | 编辑器真实游戏 ZIP 下载及缺失资源拒绝 |

## 保留与范围

贡献者音频参数校验、隐藏按钮释放输入和暂停期间新建按钮禁用的实现文件保持不变，相关回归继续执行。没有把场景/实体迁往 C++，没有扩展数学性能优化或联机功能。人工设备验收及不支持项见使用说明与实际验收记录。
