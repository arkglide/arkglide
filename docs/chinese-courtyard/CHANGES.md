# 中文变更总结

新增 `examples/chinese-courtyard-showcase.arkglide`，将既有 ArkGlide 渲染系统用于一座可编辑、可运行、可独立网页导出的竹林庭院。包含月洞门、石路、六角亭、青瓦回廊、池塘、苔石、72 株作者竹子、48 株扫描蕨类、雕花屏风与扶手椅、阶台和五个观景机位。

## 新增文件

| 文件或目录 | 用途 |
| --- | --- |
| `examples/chinese-courtyard-showcase.arkglide` | 225 节点的可导入示例，全部模型、贴图、控制脚本随包保存 |
| `examples/chinese-courtyard-scripts/main.js` | 原生脚本 API 实现自由浏览、巡游、画质／效果切换与诊断 HUD |
| `examples/chinese-courtyard-scripts/tour.js` | 五个镜头与巡游路径 |
| `examples/chinese-courtyard-assets/models/` | 16 个整理 GLB：六个扫描岩石、三个竹林分块、两个蕨丛、两种屏风、扶手椅、六角亭和辅助月洞门 |
| `examples/chinese-courtyard-assets/textures/` | 36 张本地纹理，保留完整 PBR 与植被透明遮罩 |
| `examples/chinese-courtyard-assets/ASSETS.md` | 来源、作者、许可、用途、转换与未成功候选 |
| `examples/chinese-courtyard-assets/sources.lock.json` | 实际下载 URL、固定版本和 SHA-256 |
| `examples/chinese-courtyard-assets/prepared.json` | 整理资源校验值与材质槽 |
| `examples/chinese-courtyard-assets/LONG-WIND-LICENSE.txt` | 复用开源几何的 MIT 全文；相关 GLB 也内嵌该文本 |
| `scripts/chinese-courtyard-project.mjs` | 可维护的场景生成器，分区与预算配置 |
| `scripts/create-chinese-courtyard-example.mjs` | 校验整理资源，离线生成 `.arkglide` |
| `scripts/prepare-courtyard-assets.mjs` | 锁定下载、复用已有几何并整理为无外部依赖的 GLB |
| `scripts/courtyard-textures.py` | Pillow 整理 PBR／水波，扫描岩石抽取及 UV 适配 |
| `scripts/courtyard-import-assets.mjs` | 读取锁定 glTF 的原始几何，去陈列位移、统一尺度、分块合并、内嵌署名 |
| `scripts/courtyard-glb.mjs` | 准备阶段的静态 GLB 写入，不进入网页运行时 |
| `scripts/export-chinese-courtyard.mjs` | 复用现有导出器，附带资产清单、许可证和使用说明 |
| `scripts/verify-chinese-courtyard.mjs` | 独立网页与真实编辑器浏览器验收 |
| `docs/chinese-courtyard/README.md` | 操作、结构、命令、预算与限制 |
| `docs/chinese-courtyard/VALIDATION.md` | 实际验收结果及性能统计的边界 |
| `docs/chinese-courtyard/ACCEPTANCE.json`、`SNAPSHOT.json` | 实际浏览器检查、渲染预算和运动向量读回的原始数据 |
| `docs/chinese-courtyard/CHANGES.md` | 本文件 |
| `docs/chinese-courtyard/preview-*.png` | 独立网页实际运行截图，960×540 High，未修饰 |
| `docs/chinese-courtyard/FILES.txt` | 仓库新增与修改的逐文件清单 |

## 通用引擎修改

- `src/engine/rendering-runtime.js`：增加经现有配置校验的 `rendering.setReflections()` 和 `rendering.setShadows()`，让示例独立对照效果并限制质量档位阴影成本；错误补丁不会半途修改状态。
- `src/engine/static-instances.js`：移除“场景中只要存在探针就全部退出实例化”的过宽条件。计算带父级旋转／缩放的保守范围，只让完全处于所有探针之外的静态基础网格合批；与探针相交的节点继续独立绑定。这是保守兼容修复，不宣称支持探针内部跨区域合批或导入模型原生实例。
- `src/types/arkglide.d.ts`：补充脚本类型。
- `public/arkglide-rendering.js`、`public/arkglide-static-instances.js`：同步共享运行库，使编辑器与独立包保持一致。
- `tests/rendering.test.mjs`、`tests/static-instances.test.mjs`、`tests/script-worker.test.mjs`：补充原子补丁、探针范围／父级变换与实际示例模块验证。
- `package.json`、`package-lock.json`：四条庭院命令与仅准备阶段使用的 three.js 开发依赖。
- `README.md`：示例与文档入口。

没有重写渲染管线、建立开放世界系统或引入桌面引擎依赖。后续最值得投入的是整座中式建筑和围墙的美术升级，以及真实显卡上固定场景的性能与美术验收。
