# 竹隐庭院资产清单

检索与整理日期：2026-10-23。`sources.lock.json` 记录每一个实际下载文件的 URL、固定版本、大小和 SHA-256；`prepared.json` 记录整理后文件的校验值。运行与导出不需要访问素材站点。

## 已实际使用

| 资产 | 作者 | 许可证与原始页面 | 场景用途与整理 |
| --- | --- | --- | --- |
| Rock Moss Set 01 | Kless Gyzen | [Poly Haven](https://polyhaven.com/a/rock_moss_set_01)，[CC0](https://creativecommons.org/publicdomain/zero/1.0/) | 六种扫描苔石，池岸与竹林边缘。保留原顶点、法线与 UV；去掉成套陈列位移，分成六个 GLB，三张 1K 地图集中绑定。粗糙度重打包为 ORM 的绿色通道，蓝色为 0。 |
| Weathered Planks | Dimitrios Savva（摄影）、Dario Barresi（处理） | [Poly Haven](https://polyhaven.com/a/weathered_planks)，CC0 | 亭柱、梁、廊架与扶手；完整 albedo、OpenGL normal、ARM，1024²。木漆颜色由 PBR 因子调整。 |
| Japanese Stone Wall | Charlotte Baglioni（摄影）、Dario Barresi（处理）、Rico Cilliers（平铺） | [Poly Haven](https://polyhaven.com/a/japanese_stone_wall)，CC0 | 石阶、园路、池岸与亭基；使用通用风化石面，不引入日本建筑造型。完整 1K PBR；湿石追加清漆层。 |
| Ceramic Roof 01 | Rob Tuytel | [Poly Haven](https://polyhaven.com/a/ceramic_roof_01)，CC0 | 亭顶、回廊、墙帽；仅将红陶 albedo 重映射为青灰色，保留扫描磨损、完整法线与 ARM。 |
| Rock Boulder Dry | Dimitrios Savva（摄影）、Rico Cilliers（处理） | [Poly Haven](https://polyhaven.com/a/rock_boulder_dry)，CC0 | 白墙微表面使用其法线，强度 0.12。只下载并打包用到的法线。 |
| Venice Sunset 1K HDRI | Greg Zaal | [Poly Haven](https://polyhaven.com/a/venice_sunset)，CC0 | 柔和暖色 IBL；不直接显示威尼斯背景。下载自 [three.js r180 的公开副本](https://github.com/mrdoob/three.js/blob/r180/examples/textures/equirectangular/venice_sunset_1k.hdr)。 |
| Long Wind 六角亭 | jbang2004 / Long Wind contributors（上游注明使用 AI 辅助编写） | [固定版本源码](https://github.com/jbang2004/long-wind/blob/1e9c4265ad2a7d06a174c8ac5f3ab64bc18252f3/src/world/props-pavilion.js)，[MIT 原文](LONG-WIND-LICENSE.txt) | 复用已有亭基、六柱、美人靠、梁、椽、飞檐和脊饰几何，离线转为普通 GLB；去掉依赖其专用绘制图集的牌匾，按木材部件拆分可编辑 PBR 绑定。它是开源生成资产，**不是扫描模型，也不是本轮下载到的 Sketchfab 亭子**。 |
| Free Bamboo Set | JonhGillessen / Jonh Gillessen | [Sketchfab 原始页面](https://sketchfab.com/3d-models/free-bamboo-set-e9f9fa5397814f81bf85ad06acf5bf30)，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 替换原生成竹林。选取三种绿色成竹，去掉原陈列平移、统一高度至 7.5–9.6 米，每块 6 株合并为枝／叶／杆三个网格；12 块共 72 株。保留枝、叶、杆三套完整 PBR，叶片改为 alpha test，全部 GLB 内嵌作者、原始链接、许可及改动说明。它是作者制作的游戏资产，不宣称为摄影扫描。 |
| Chinese Screen Panels | Kirill Sannikov | [Poly Haven](https://polyhaven.com/a/chinese_screen_panels)，CC0 | 青瓦回廊的 12 扇雕花屏风，替换 35 根简化格栅；保留两种折角构件、原 UV 和 1K albedo／normal／ARM，共享一个材质。 |
| Chinese Armchair | Kirill Sannikov | [Poly Haven](https://polyhaven.com/a/chinese_armchair)，CC0 | 听雨亭内两把雕花扶手椅；原模型 2,675 三角形，比例适配至庭院尺度。保留完整 1K PBR 与温润木漆，启用两级静态 LOD。与屏风来自同一作者系列。 |
| Fern 02 | Rico Cilliers / Rob Tuytel | [Poly Haven](https://polyhaven.com/a/fern_02)，CC0 | 池岸及竹根部 48 株蕨类，原四种植株组成两个六株分块；恢复独立透明遮罩，使用完整 1K PBR 与 alpha test。 |
| Moss002 | ambientCG | [原始资源页](https://ambientcg.com/view?id=Moss002)，[CC0](https://docs.ambientcg.com/license/) | 替换大面积单调落叶地面，保持青绿湿润林地。2K 图缩至 1K，保留 OpenGL normal；roughness 重打包为 ARM 绿色通道。 |

Rock Moss Set 01 以及木、石、瓦及白墙法线通过 [Long Wind 固定版本公开资源副本](https://github.com/jbang2004/long-wind/tree/1e9c4265ad2a7d06a174c8ac5f3ab64bc18252f3/public/assets/ph) 取得；其 [CREDITS.md](https://github.com/jbang2004/long-wind/blob/1e9c4265ad2a7d06a174c8ac5f3ab64bc18252f3/CREDITS.md) 明确列出这些 CC0 资产。**没有使用或再分发该项目受单独条款限制的 Tripo 角色或 Mixamo 动画。**所有实际下载链接逐文件列在 `sources.lock.json`，未依靠代理绕过站点限制。


新增素材的实际下载副本：

- 竹子：[half-a-day 固定提交](https://github.com/AngelaHan1129/half-a-day/blob/00256443f3f8ca8b4e814081f9e2b6883d89cf53/frontend/my-app/public/models/free_bamboo_set.glb)。GLB 自身 `asset.extras` 明确标注原作者、Sketchfab URL 与 CC-BY-4.0；本轮下载文件 5,719,236 字节。没有拿副本仓库的代码许可代替模型许可。
- 屏风／扶手椅：[ezEngine store-sample 固定提交](https://github.com/ezEngine/store-sample/tree/ee6100b38262bc945aaea2835e47139f16beaa30/PolyHaven)。取原 glTF、bin 与三张 PBR，而非该引擎编译格式。
- 蕨类／苔藓：[chinese-autumn-temple 固定提交](https://github.com/aicanbuild/chinese-autumn-temple/tree/22b13415fe938d3fd364a9e9b0e8353607df19c3/dist/assets)，[上游来源说明](https://github.com/aicanbuild/chinese-autumn-temple/blob/22b13415fe938d3fd364a9e9b0e8353607df19c3/ASSET_CREDITS.md)。只取其 CC0 原始植物与材质，不取寺院、雕像、彩绘或代码。

这些是公开托管的资源副本，未使用中转代理或修改环境策略。逐文件 URL、字节数与 SHA-256 全部见 `sources.lock.json`。

## 本场景辅助资源

- 月洞门开口、白墙、路径块、简洁廊架、阶台、灯笼：生成脚本中的辅助构件，遵循本仓库许可证，不声称来自素材站。
- 水波法线：256² 周期函数生成的补充贴图，不是外部扫描图。竹杆和竹叶已换为上表作者资产的原贴图。
- 竹叶与蕨叶 WebP 保留透明裁剪；PBR 色图使用 WebP quality=92；法线和 ARM 使用无损 WebP，不裁掉金属／粗糙度／法线通道。运行时生成 mipmap。
- 资产整理依赖 three.js（MIT）及 Pillow（HPND），仅用于离线准备，不进入网页运行时。

## 检索候选与下载情况

| 候选 | 用途与筛选结论 | 实际情况 |
| --- | --- | --- |
| [shineSUU Chinese pavilion](https://sketchfab.com/3d-models/chinese-pavilion-b0f6c1fb43e744ec876faecaba3d4925) | 约 62.7K 三角形，CC Attribution，适合作主景 | 检索结果可见；页面读取 403，未取得下载文件，未使用。 |
| [Tin Pui-yiu Chinese Pavilion](https://sketchfab.com/3d-models/chinese-pavilion-82b254fe1f5b4381959db8799181edbe) | 水墨 Grease Pencil，约 1.1M 三角形 | 风格和网页几何预算不合适，未使用。 |
| Chinese Screen Panels / Free Bamboo Set | 适合近景的人工制作 PBR 资产 | 官方下载仍受限；本轮已找到公开固定版本副本并成功导入，见上表。 |
| [3DAssets.dev Imperial China Palace and Garden](https://3dassets.dev/packs/imperial-china-palace-and-garden) | 同风格亭子、竹丛等备选 | 检索可见，页面/API 获取未成功，未使用，也未将网站声明当作已验证文件许可。 |

当前环境的 Poly Haven API／下载域名与 Sketchfab 直接下载仍返回 403。新增竹子、雕花木构、蕨类和苔藓已从上述固定公开副本实际取得。整座亭子仍为 MIT 开源生成资产，没有取得并替换成 Sketchfab 的高质量预制亭子；不把新细节资产称为整座建筑已完成美术升级。
