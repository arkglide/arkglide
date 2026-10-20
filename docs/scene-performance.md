# 场景性能测量

打开「菜单 → 场景性能基准」，选择分辨率后开始对照测试。默认 500 个球体、1920×1080，每种状态先预热 120 帧，再采样 300 帧。原始几何和静态 LOD 使用相同的帧索引相机轨迹、材质、基础灯光及几何共享设置。

报告可下载为 JSON，包含浏览器与渲染器、分辨率、DPR、软件/硬件报告分类、总帧间隔、渲染 CPU、有效 GPU 查询、中位数/P95、实际绘制三角形、绘制调用及 LOD 构建次数。总帧、CPU 和 GPU 分开记录；缺失 GPU 数据保留 null，不用 CPU 时间或 FPS 倒推。停止、页面隐藏/失焦或 WebGL 上下文丢失会中止采样并释放场景。

选择「体积关闭 / 开启」时，两组均启用相同静态 LOD 和 ACES 调色，只对照体积开关。开启组包含高度雾、32 步半分辨率积分及 512² 方向光遮挡；报告记录实际体积设置、像素尺寸和光深度图。CLI 使用 `BENCH_VOLUMETRIC=1`，页面查询参数使用 `volumetric=1`。保留无效 GPU 查询为空和软件渲染不能认证硬件预算的约定。

选择「普通网格 / 实例批次」时，两组使用相同原始几何，不启用静态 LOD，比较实际绘制调用和实例分组数。CLI 使用 `BENCH_INSTANCING=1`，页面使用 `instancing=1`；体积和实例对照不能同时选择。报告区分主画面三角形与包含深度、阴影等离屏绘制的总三角形。

这是静态几何与基础 PBR 光照的对照，不包含完整游戏的阴影、SSR、景深、粒子、脚本或物理负载。设备报告为硬件也不等于完整游戏已通过预算审核。60 FPS 对应约 16.67 ms，正式预算需要在目标机器、目标分辨率和代表性关卡分别检查 CPU/GPU 的 P95，并保留加载、脚本和特效余量。

## CLI

```sh
# CPU 简化核，包含 WASM 输入输出拷贝，自动核对 JS/native 结果
npm run benchmark:scene:optimization
# 使用本机 Chromium（需先安装 Playwright 浏览器或指定执行路径）
npm run benchmark:scene:browser
```

CLI 默认不强制软件渲染。可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 选择本机 Chrome/Chromium，`BENCH_HEADFUL=1` 显示窗口，`BENCH_OUTPUT` 选择报告路径。`BENCH_MESHES/WIDTH/HEIGHT/WARMUP/SAMPLES` 覆盖规模与采样配置；`BENCH_SOFTWARE=1` 仅用于软件渲染流程回归。浏览器页面也支持同名小写查询参数，例如 `?meshes=36&width=256&height=192&warmup=10&samples=30`。

本轮云环境没有 DRM/NVIDIA 显卡设备，WebGL 使用 SwiftShader。记录 [scene-scale-performance.json](verification/scene-scale-performance.json) 明确保留 `renderMode: software`、`hardwareBudgetVerified: false`，不能据此宣称目标显卡达到 60 FPS。相同入口已准备好供真实设备采集。

[scene-optimization-performance.json](verification/scene-optimization-performance.json) 是 CPU 核的独立记录。当前 8,911 顶点输入的 JS/native 结果一致；WASM 含拷贝的中位数约 0.67 ms，JS 约 5.74 ms。这不包含对象创建、上传和像素着色，也不代表整帧有相同比例的提升。

## 组合示例

导入 `examples/lighting-scale-lab.arkglide`，其中地面由真实 WASM/BVH 烘焙生成，并组合方向光级联阴影与 60 个 LOD 球体。点击画面后按 1/2/3 切换画质、4/5 切换近/远视点。用它检查光照保存、独立导出、相机选级和停止清理；它是程序资产技术样例，不替代游戏美术与完整性能验收。

```sh
npm run example:lighting-scale
npm run test:lighting-scale:browser
```
