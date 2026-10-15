# 独立游戏打包与部署

## 编辑器和命令行

停止编辑器运行，打开「菜单 → 导出独立游戏…」。设置标题、显示比例、代码保护、游戏内日志与额外预加载资源，点击「开始打包」，完成后点击「下载游戏 ZIP」。编译、二进制编码和 ZIP 压缩在专用 Worker 中执行，取消会终止 Worker；编辑器中的资源缓冲区不会被转移或清空。修改设置后需重新打包。

设置保存在项目的 `settings.build` 中，随 `.arkglide` 保存、恢复和重新导入。`.arkglide` 是可编辑项目档案，仍包含编辑数据；独立游戏包使用另一套运行格式，不包含完整 `project.json`。

```sh
npm run export:game -- examples/fourth-static.arkglide output/my-game
node scripts/serve-static.mjs output/my-game 8080
```

CLI 读取同一份 `settings.build`，生成静态目录和同名 ZIP，要求输出目录为空且 ZIP 不存在。导出只转换项目数据与脚本，不执行编辑器生产构建或 WASM 编译。CLI 使用 Vite SSR 加载项目校验器，部署包运行不需要 Vite。

将整个输出目录部署到 HTTP/HTTPS 静态服务器，打开 `index.html` 即自动进入游戏。支持网站根目录和 `/games/demo/` 等子目录；无需编辑器、Node、IndexedDB 或联网 CDN。服务器须为 JavaScript 返回正确 MIME，并提供目录首页。不要直接双击 `file://`。

## v2 包结构与加载

| 文件 | 内容与读取时机 |
| --- | --- |
| `game-manifest.json` | 小型启动入口：版本、启动块、显示/加载配置、统计、运行库校验信息；没有完整场景或全部资源索引 |
| `boot/<sha256>.agb` | 当前入口场景的块引用、分片索引范围、轻量预制体目录和全局运行配置 |
| `scenes/<sha256>.agb` | 字典编码的节点数组，入口场景分块解码并分批创建；预制体节点块延迟读取 |
| `index/<sha256>.agb` | 排序的资源索引分片，按键二分定位，限制缓存分片数量 |
| `prefabs/<sha256>.agb` | 模板描述、节点块与模型映射，在实例化/关卡加载时读取 |
| `definitions/<sha256>.agb` | 材质、动画控制器和重定向定义，随引用加载 |
| `modules/<sha256>.agb` | 构建期转换的脚本、静态引用位置与模块类型；动态导入在调用时加载 |
| `assets/<sha256>.bin` | 模型、贴图、音频原始字节，相同内容共用文件 |
| 本地运行库与许可 | Babylon、glTF loader、引擎模块、内嵌数学/Jolt WASM，以及依赖许可 |

`.agb` 使用有版本头的二进制类型编码和块内字符串字典，保留双精度数值；不是把完整 JSON 字符串换一个后缀。索引、场景、预制体和定义均独立编码。读取二进制/资源时核对长度与 SHA-256，Worker 执行校验和解码；不支持的版本、损坏数据及超出解码预算会报错。运行库直接由浏览器脚本加载，启动清单中的运行库哈希供部署工具校验，不代表浏览器对所有经典脚本执行了 SRI。

启动只读取入口场景及其声明依赖、HUD 贴图和额外预加载清单；不会先下载所有预制体模型、声音与脚本。模板与资源使用引用计数，最后一个实例/资源租约释放时回收对应原始缓存，停止时清空会话。原生 ES 模块在当前 iframe 会话中缓存，停止销毁 iframe 后释放。

当前入口场景仍需完整准备后才开始游戏。大型世界应通过 `levels.load()` 切换预制体关卡，以保持入口场景小；本版不自动按玩家位置进行世界流送，也不将所有物理/脚本初始化工作自动拆成帧预算。

## 脚本资源声明

节点绑定的模型、材质贴图、AudioSource、动画控制器及重定向会自动形成依赖。仅出现在脚本中的运行时 ID 无法静态推断：可以在导出对话框每行填写 `audio:music` 等键，或在使用前显式加载资源：

```js
export default function ({assets, audio, console}) {
  let ready = false;
  return {
    onStart() {
      assets.load('audio', 'music').then(lease => {
        // 租约默认由所属脚本管理，销毁脚本会释放。
        audio.play('music', {loop: true});
        ready = true;
        // 不再使用时可 lease.release()；释放最后一个音频租约会停止相关声音。
      }).catch(error => console.error(error.message));
    },
    onUpdate() {
      if (!ready) return;
      // 资源就绪后执行依赖它的游戏逻辑。
    },
  };
}
```

支持的 `kind` 为 `model`、`texture`、`audio`、`prefab`、`materials`、`animationControllers`、`retargetProfiles`。`assets.load(kind,id)` 返回带有 `active` 和幂等 `release()` 的租约；加载失败会拒绝 Promise。编辑器已持有全部项目资源，调用同一接口会验证资源存在并返回受生命周期管理的租约。`prefabs.instantiate()` 和 `levels.load()` 自动获取所需模板资源，无需手动预加载；显式预加载的模板保留至会话结束。

不要把脚本工厂写成 `async`；工厂同步返回生命周期对象。在 `onStart` 中启动异步工作，并让更新逻辑等待就绪，或在打包时预加载。任意脚本 `fetch()`、远程服务或 DOM URL 不会被自动复制进包。

## 可配置预算

`settings.build` 的高级参数也可由导出器第四个参数覆盖。对话框保留已有高级参数，常用开关直接可见。

| 参数 | 默认值 | 用途 |
| --- | --- | --- |
| `protectCode` / `showLogs` | `true` / `false` | 保护用户脚本 / 显示游戏界面日志 |
| `nodesPerChunk` / `indexEntriesPerChunk` | `256` / `128` | 节点块与索引分片条目上限 |
| `batchNodes` / `concurrency` | `128` / `4` | 入口场景创建批次与并行资源读取数 |
| `maxIndexChunks` | `16` | 索引缓存分片数 |
| `maxChunkBytes` | `67108864` | 单个二进制记录字节预算 |
| `logLimit` / `loadTimeout` | `200` / `120000` | 日志行数上限 / 启动超时毫秒数 |
| `preload` | `[]` | `kind:id` 数组；构建时检查引用存在 |

标题、尺寸和预算在导出前校验。资源文件名由内容哈希生成，避免原始资源名成为部署路径；修改单个资源不会重写所有资源文件名。

## 游戏页面与代码保护

页面全屏显示游戏，无开始/停止/暂停调试工具栏，无进度条。启动时逐行显示运行模块、文件和初始化日志，成功进入游戏后清空。失败保留错误记录并提供重新加载按钮。开发者可选择显示有行数上限的游戏日志，默认关闭。第一次点击游戏画面解锁浏览器音频并获取输入焦点；页面隐藏自动暂停，返回自动恢复。

默认通过 Terser 压缩用户脚本、改写局部变量、移除注释和源码路径，不导出 source map；公共属性、生命周期钩子与资源 ID 保持兼容。关闭保护后仍使用相同分块格式和预编译模块机制。保护提高阅读成本，浏览器端逻辑仍可分析，不能用于保存密钥或替代服务端校验。

## 兼容与验证

- 源项目继续使用 0.6 格式并兼容旧项目，重新导出即可得到 v2；旧独立包保留自己的运行库，更新部署应整体替换运行库与入口，不能混用 v1 清单和 v2 播放器。
- 项目内相对静态导入、转导出和字符串字面量动态导入在构建期验证并编译；变量路径、远程/npm 导入、顶层 await 和循环依赖仍明确拒绝。
- 支持自包含 GLB/glTF，模型外部 URI 和未内置的 Draco/Meshopt/KTX2/Basis 解码器仍在构建期拒绝。流式音频当前使用本地字节生成媒体 Blob，不是 HTTP Range 音频流。
- `examples/fourth-static.arkglide` 与 `.json` 是可编辑源项目；该示例通过 `settings.build.preload` 声明脚本使用的声音。请从当前源码重新导出运行包；仓库旧 `fourth-static-game` 产物属于历史 v1 示例。
- 验证记录见 [fourth-batch-verification.md](fourth-batch-verification.md)。通用玩法接口见 [gameplay-foundations-api.md](gameplay-foundations-api.md)。
