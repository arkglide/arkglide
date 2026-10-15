# 通用玩法基础 API

本批次在视角、角色、传送门和抓取接口之上补充物理、表现、表面、投射、力场、关卡和存档能力。所有接口均注入旧式脚本工厂和 ES 模块的 `ScriptContext`，并使用同一份运行时进行编辑器预览和静态导出。原 Portal Lab 项目和游戏脚本没有修改。

## 接口范围

| 能力 | 接口 | 使用约定 |
| --- | --- | --- |
| 接触详情 | `physics.onContact` | `enter/stay/exit`，接触点数组、朝向另一实体的法线、双方子形状 ID；退出保留最后一个已知接触流形 |
| 接触材质 | `physics.onContactMaterial` | 求解前返回摩擦、弹性或相对表面速度；回调必须保持纯函数，禁止销毁实体或修改物理状态 |
| 刚体配置 | `getProperties/configure/applyForce/applyTorque` | 质量、摩擦、弹性、重力倍率和阻尼可动态设置；力在下一次完整固定步内生效，覆盖传送门子步 |
| 碰撞体 | `physics.updateShape` | 保留 BodyID、原重心参考系、速度和关节；盒、球、胶囊、凸包及静态三角网格。改变缩放后应在下一个固定步前更新形状 |
| 角色 | `character.configure/getConfig/getGround/applyForce` | 速度、跳跃、惯性参数、重力和胶囊尺寸可更新；默认调整中心以保留脚底，受阻返回 `false` 且不提交配置 |
| 关节 | `JointHandle.setMotor/setLimits/getState` | 铰链/滑动电机支持关闭、速度目标、位置目标及弹簧参数；铰链使用弧度，滑动/距离使用世界单位 |
| 材质/贴图 | `visuals.createMaterial/createTexture` | 颜色、发光、透明度、双面、纹理；贴图引用已登记的项目资源，提供 `ready` Promise |
| 动态表现 | `visuals.createMesh/createBeam/createParticles/createDecal` | 动态顶点、分段光束、粒子及附着贴花。全部由脚本持有和清理，不向用户暴露 Babylon 对象 |
| 局部表面 | `surfaces.paint/query/covers` | 椭圆/矩形涂层跟随宿主；标签和属性由游戏定义。`covers` 要求一个涂层覆盖整个凸轮廓，采用保守判断 |
| 放门规则 | `PortalSurfaceOptions.canPlace` | 接收实体、完整门轮廓、命中点、法线和区域 ID；只有明确返回 `true` 才允许放置 |
| 模型平面 | `PortalSurfaceOptions.regions` | 静态、独立、单材质网格可登记宿主局部坐标下的矩形平面区域；注册检查前平面的三角形覆盖 |
| 有体积穿门 | `portals.shapeCast/projectVolume` | 有限形状扫描保留旋转并检查两端适配；凸截面投射会裁切门口并返回世界坐标网格、分段方向、路径和阻挡 |
| 力场 | `fields.create` | 任意盒/球/胶囊/凸包体积；按力或加速度作用于刚体和角色；重叠体积对同一实体只作用一次，各段可指定不同方向 |
| 区域触发器 | `triggers.create` | 原生体积重叠查询；可配置运动类型/传感器/碰撞组过滤，进入/停留/离开事件，不施加力或创建机关 |
| 信号连接 | `signals.create/gate/onChange` | 布尔源和 AND/OR/NOT/XOR 依赖图；固定步合并传播、所有权订阅、回调反馈预算 |
| 运动机构 | `motion.create` | 可逆世界位姿插值、运动学原生速度、暂停/恢复；不包含门/电梯的玩法规则 |
| 反射光路 | `optics.addReflector/trace` | 原生碰撞法线反射、衰减、跨门路径、总反射/跳转/段预算；不自动创建激光伤害或机关 |
| 关卡 | `levels.register/load/unload/find/onChange` | 预制体作为关卡；先加载资源，再清理旧关卡并启动新脚本。引导场景保留；加载失败保留原关卡 |
| 持久存储 | `storage.read/write/remove` | 通过父页面按项目/游戏隔离保存有限、无环 JSON；校验消息来源和运行 ID；停止时取消未完成请求 |
| 检查点 | `saves.register/capture/restore/save/load` | 内置世界/物理/关节/传送门状态，游戏状态由版本化 provider 补充；恢复期间冻结模拟并在失败时尝试回滚 |

## 凸体积投射与力场组合

`direction` 的长度代表最大射程。`profile` 是初始垂直截面内的凸多边形；它必须没有自交。`thickness` 是用于原生障碍检测的扫描厚度，`inset` 控制门口数值余量。宽度、厚度、射程、速度及力度均来自游戏配置。

```js
// tuning 和 emitter 由游戏提供。生成网格使用世界坐标，实体保持单位变换。
const projected = portals.projectVolume({
  origin: emitter.position,
  direction: math.vec3.scale(emitter.direction, tuning.range),
  profile: tuning.profile,
  thickness: tuning.queryThickness,
  inset: tuning.apertureInset,
  maxHops: tuning.maxHops,
});

const volumes = projected.segments.map(segment => {
  const points = [];
  for (let i = 0; i < segment.geometry.positions.length; i += 3) {
    points.push({
      x: segment.geometry.positions[i],
      y: segment.geometry.positions[i + 1],
      z: segment.geometry.positions[i + 2],
    });
  }
  return {
    shape: { kind: 'convex', points },
    position: { x: 0, y: 0, z: 0 },
    vector: math.vec3.scale(segment.direction, tuning.acceleration),
  };
});

const field = fields.create({
  mode: 'acceleration',
  vector: { x: 0, y: 0, z: 0 },
  volumes,
  filter: { sensors: false },
});
```

光桥可为每段 `segment.geometry` 创建视觉网格，再给其实体添加 `shape: 'convex'` 的静态碰撞体。投射 API 不会偷偷创建机关。移动或重放传送门后，游戏应重新投射，并更新/替换这些网格、碰撞体或力场。处理 `truncated`，不要把达到跳转预算误认为射程自然结束。

凸包查询的顶点相对于传入的形状原点。运行时会把原点变换转换成 Jolt 所需的重心变换；不要自行减去凸包重心，否则偏离实际位置。

## 区域触发器

`triggers` 与 `fields` 独立：检测区域占用，无需创建传感器刚体，也不会施加力。适用于区域开关、检查点、伤害区和 AI 感知；效果与游戏数值由脚本提供。旧式脚本、ES 模块、Monaco 和独立游戏使用相同接口。

```js
// regionConfig 和 gameplay 来自游戏配置，不由引擎指定伤害/尺寸/采样频率。
const region = triggers.create({
  volumes: regionConfig.volumes,
  motions: regionConfig.motions,
  interval: regionConfig.interval,
  filter: regionConfig.filter,
  filterEntity: entity => gameplay.accepts(entity),
  onEnter({ entity }) { gameplay.enterRegion(entity); },
  onStay({ entity, deltaTime }) { gameplay.updateRegion(entity, deltaTime); },
  onExit({ entity, reason }) { gameplay.leaveRegion(entity.id, reason); },
});
region.setEnabled(false);
region.update({ volumes: newWorldVolumes });
const currentlyOverlapping = region.query();
```

- `volumes` 必须非空。每段使用世界坐标 `position`、可选单位四元数 `rotation` 和 `physics.overlap` 相同的盒/球/胶囊/凸包形状。移动区域由游戏更新这些世界位姿；引擎不会猜测宿主、门路径或效果。
- 默认检测 `dynamic/kinematic/character`；通过 `motions` 可加入 `static`。默认忽略 sensor，`filter.sensors: true` 包含 sensor 和普通物体。`group/mask/ignore` 使用物理查询约定；每个体积独立指定旋转。一个实体重叠多个体积只计一次，`filterEntity` 对每个候选只调用一次，必须同步返回布尔值，建议保持纯函数。
- 在完整物理固定步（含传送门子步）结束后采样。首次在下一固定步采样；`interval: 0` 每固定步采样，非零为模拟秒数，暂停/时间缩放沿用模拟时钟。`deltaTime` 是本次距上次采样的累计模拟时间，超出间隔时只采样一次，不补发虚构事件。
- 每次先完整收集区域占用，再派发离开事件，最后按实体 ID 派发进入/停留事件。回调内 `update/setEnabled` 的更改在下一固定步采样生效；销毁触发器或所属脚本立即停止后续派发。配置/形状验证失败不改变原配置。
- 事件回调可发起异步存档等操作，物理步不等待 Promise；回调同步抛错或异步拒绝均隔离到所属触发器。销毁后迟到的 Promise 拒绝不再报告到新会话；异步游戏逻辑仍需自行检查生命周期，`filterEntity` 不支持异步。
- `setEnabled(false)` 在下一固定步清空占用并仅派发一次 `reason: 'disabled'` 的离开。普通离开为 `'left'`，实体销毁为 `'destroyed'`；销毁后的 Entity 只读取 `id/destroyed`，不要修改其位姿。销毁触发器、停止运行及所有权清理不派发游戏事件。
- `getEntities/contains` 返回最后一次采样的占用，排除已销毁实体。`query` 使用当前物理状态即时查询，不改变占用、不派发事件；禁用区域查询为空。查询结果是实体句柄，无 Babylon/Jolt 对象。
- `triggers.getLimits/setLimits` 管理整个运行会话预算，默认 `maxTriggers: 256`、`maxVolumesPerTrigger: 32`、`maxMembersPerTrigger: 4096`，集中在 `trigger-runtime.js`；可配置正整数，不可降到已占用额度以下。触发器创建超预算会拒绝；采样成员超预算或回调出错会报告 `triggers.step` 并销毁该触发器，不派发截断的占用集合，其他区域继续运行。
- 这是离散重叠采样，不是扫掠检测；高速物体或较大的采样间隔可能跳过区域。需要连续路径检测时使用 `physics.shapeCast` 或 `portals.shapeCast`。无碰撞体的纯视觉实体不参与。存档不保存触发器句柄/成员表，游戏 provider 可重建配置；恢复后的下一次采样重新决定占用。

## 信号、运动机构和反射

```js
const plate = signals.create(false);
const receiver = signals.create(false);
const enabled = signals.gate('and', [plate, receiver]);
const actuator = motion.create(platform, {
  to: configuredDestinationPose,
  duration: tuning.travelSeconds,
  easing: 'smoothstep',
});
signals.onChange(enabled, ({ value }) => actuator.setTarget(value ? 1 : 0));
// 由触发器/射线等游戏逻辑设置输入，不需要在引擎里新增按钮或门类型。
plate.set(region.getEntities().length > 0);
const reflector = optics.addReflector(mirrorEntity, { reflectivity: tuning.reflectivity });
const ray = optics.trace({ origin: emitterPosition, direction: configuredRangeVector,
  maxBounces: tuning.bounceBudget, maxPortalHops: tuning.hopBudget });
receiver.set(!ray.truncated && ray.hit?.entity === receiverEntity && ray.energy >= tuning.threshold);
```

信号约定：

- 源节点 `set(boolean)` 立即改变源值，派生值在 `flush` 时按创建顺序求值。派生边只指向已存在节点，不支持运行中重接边，因此依赖图无环。需要新的连线时重建派生节点。
- `onChange` 不立即派发初值；初始化时读取 `.value`。每轮先结算整个图再发送变化通知，重复设置合并，最终值回到原值时不发送。回调事件携带这一轮的 `value/previous` 快照，回调再次写入的值进入下一轮。
- 自动在每个固定步前后调用 `flush`，暂停时不自动传播；可显式 `signals.flush()` 用于初始化和存档恢复，回调中递归 flush 会拒绝。异步回调不阻塞模拟；同步或异步异常会移除该订阅并报告 `signals.flush`。
- 订阅属于调用 `signals.onChange` 的脚本，可消费其他存活脚本的源。销毁源会递归销毁依赖节点及其订阅，避免悬空引用；销毁派生节点不会销毁输入源。不同会话的句柄不能混用。
- 通过 `getLimits/setLimits` 配置 `maxNodes/maxListeners/maxPasses`，默认 `1024/4096/64`。回调造成振荡并超出传播轮次时，报告错误并断开本轮曾写信号的订阅，停止反馈，物理模拟继续。图状态不是自动存档，游戏 provider 保存源值并重建连线。

运动机构约定：

- 只控制已有 `kinematic` 刚体；`from/to` 是世界位姿（position + 单位四元数），`from` 默认当前刚体位姿。整个会话同一实体最多一个 motion 控制器。位置线性插值，旋转采用最短路径四元数插值；`smoothstep` 同时缓入缓出，`duration` 是完整 0→1 的模拟秒数。
- `setTarget(0..1)` 可随时反向，不重置当前进度。`setPaused` 冻结进度；`getState/restore` 用于游戏检查点。`restore` 完整校验后传送到保存的进度，正常步进通过已有原生运动学目标机制移动，保留速度、平台承载与传送门子步插值。
- `motion.setLimit` 配置控制器总预算，默认 256。销毁控制器只停止后续控制，保留实体；实体被移除后在下一固定步清理。它不自动规划路径、停止挤压或判断机关安全距离，游戏应按需要增加形状扫描/接触规则。

反射约定：

- 反射面必须是已有物理实体，反射使用真实碰撞命中的法线与该段入射方向。`reflectivity` 在 0–1 内；`twoSided` 默认 true，false 时拒绝相对原生命中法线的背向反射。它不是材质标签自动识别、折射或波动光学模拟。
- `direction` 的长度为总射程。每次反射扣除已经走过的距离及数值余量，跨门后使用映射后的最后一段方向。返回分段 `energy`、反射记录、门路径、终点碰撞、总距离和 `reason`（`range/hit/energy/budget`）。遇到未登记为反射面的碰撞体立即停止，不会自动忽略接收器或角色；过滤规则由调用方提供。
- `energy/minEnergy/epsilon/maxBounces/maxPortalHops` 可在每次查询时设置。默认能量 1、阈值 .001、余量 .0005、反射/门预算各 8。`setLimits/getLimits` 管理会话上限，默认反射面 512、反射次数 64、总门次数 64、段数 1024；单次底层门射线仍受既有 32 次限制。预算耗尽返回 `truncated: true`，游戏不可把它当作接收成功。
- 没有自动的伤害、开门、视觉或音效；游戏可把 `segments` 交给 `visuals.createBeam`。登记随脚本停止清理；销毁实体的登记在固定步清理，也可主动销毁 reflector 句柄。

固定步顺序：游戏 `onFixedUpdate` → signals.flush → motion → animation/fields/interaction → 完整物理/传送门子步 → triggers → signals.flush。因触发器变化设置的运动目标在下一个固定步移动，不会在碰撞求解中直接改变物理状态。

## 穿门和角色控制边界补强

- 视线恰好朝上/下时，相机行走方向从变换后的右轴推导水平朝向，不再回到世界 +Z；保持直立的角色也沿用这一规则。
- 角色穿门时同步映射尚未消费的世界移动输入，避免 direct 模式下一次控制更新把旧坐标系的 carry 再叠加到出口速度。惯性模式继续保留外部动量。
- `character.clearInput()` 清空移动愿望和待跳跃输入，保留外部速度/冲量；用于暂停、重试或切换控制权。
- `portals.getTraversalLimits/setTraversalLimits` 配置 `maxSubSteps/maxStepTime/maxTravelDistance`，默认 `128 / (1/240秒) / .15世界单位`。更细的时间/距离步长通常需要更高子步预算。非法步长和射线预算会在推进前拒绝；运动中超出子步预算仍可能已执行部分子步，不能当作自动回滚。增加步长可能降低碰撞精度，应结合目标速度验证。
- 这些修正没有加入任意重力下的角色上方向，也未实现两个关节端点长期分处门两侧的持续约束求解。

## 通用玩法组合验证关卡

导入 `examples/composition-lab.arkglide`。关卡源码位于 `examples/composition-lab-scripts/`，游戏数值集中在 `config.js`；`npm run example:composition` 重生成项目。原 Portal Lab 保持不变。

玩法链：E 抓取箱子，放入蓝色压力区 → 生成穿门光桥与牵引场 → 镜面将激光投向接收器 → 压板和接收器的 AND 信号打开出口门 → 沿光桥跨越缺口、走入出口。Q 或 HUD 按钮切换反射面；K 保存检查点，R 重试，坠落自动重试。门、光路、派生碰撞体和力场均由关卡脚本组合。

`npm run test:composition:browser` 验证实际输入抓取、角色穿门、压力区事件、反射接收、门的原生运动、生成光桥碰撞与承载、力场加速、存档机关恢复、坠落重试、出口及重复运行清理。自动化对部分位置使用受控位姿设置，以稳定检查接口组合；不等于完整人工通关或全部设备手感验收。

## 表面和放置规则

```js
// paintOptions 的尺寸、深度、标签和属性来自关卡/玩法配置。
surfaces.paint(wall, paintOptions);
const surface = portals.addSurface(wall, {
  canPlace(candidate) {
    return surfaces.covers(candidate.entity, candidate.footprint, 'portalable');
  },
});
```

涂层深度决定命中/接触点与涂层平面的距离容差。多个涂层按优先级、绘制顺序返回；`covers` 不把有缝隙的多个涂层误判成一个完整可放门区域。矩形平面区域的坐标和深度由模型提供；复杂模型应拆出独立可穿门网格或使用配套面板。盒形移动/动态宿主继续使用原来的凸实体开孔实现。注册期间拒绝直接修改其碰撞体，先销毁 surface 注册再更新。

## 关卡和检查点

在持续存在的引导脚本中登记关卡，关卡脚本负责自身机关。关卡由独立生命周期作用域持有，发起切换的旧关卡脚本销毁不会取消新关卡。

```js
levels.register('chapter-one', { prefabId: chapterOnePrefabId });
saves.register('story', {
  version: storySchemaVersion,
  capture: () => ({ chapter: story.chapter, flags: { ...story.flags } }),
  validate: state => typeof state.chapter === 'string',
  restore(state) {
    story.chapter = state.chapter;
    story.flags = { ...state.flags };
  },
});
await levels.load('chapter-one');
await saves.save('checkpoint');
// 返回 false 表示该槽位不存在；错误会拒绝 Promise。
await saves.load('checkpoint');
```

Provider 的 `capture` 和 `validate` 必须同步，`restore` 可异步。注册 ID 不得使用保留前缀 `engine.`。关卡切换期间拒绝抓取检查点，以免保存部分加载的场景。

保存的关卡会重新加载，并按预制体内部节点 ID 恢复，不依赖本次生成的随机场景 ID。内置状态要求实体、运动组件、关节和传送门结构兼容；任意动态生成/销毁、复杂 AI、视觉资源、涂层、音频进度及机关状态应由游戏 provider 保存并重建。它不是任意 JS 堆或整个游戏进程的序列化。Provider 版本不符、缺失或拓扑不符会报错，避免静默丢失状态；自定义恢复回调失败可能使回滚也失败，这时会返回包含两次错误的 `AggregateError`。

编辑器使用项目 ID（无项目 ID 时使用文档 ID）；独立游戏使用项目 ID（否则使用部署路径）隔离存储。存档依赖父页面的浏览器存储权限和配额，失败会传回脚本。默认 JSON 预算和超时集中定义在 `state-runtime.js`，不读运行 iframe 的 `localStorage`。

## 所有权、预算与限制

- 视觉、涂层、力场、触发器、规则和检查点 provider 会随所属脚本销毁。关卡作用域不会被计作额外的游戏脚本实例。
- 材质应用会记录原材质；销毁覆盖层时修复恢复链。销毁实体不会误销毁其他实体共用的材质或贴图。
- 可通过 `visuals.setLimits`、`surfaces.setLimit`、`physics.setQueryLimits`、`portals.setProjectionLimits` 调整安全预算。初始默认预算集中在相应服务入口；游戏规则和数值不写进这些服务。
- 角色沿用世界 Y 朝上的控制模型；此批未实现任意重力方向下的角色上方向与移动平面切换。
- 接触事件保留最近的原生流形。当前 Jolt 绑定没有提供每对接触的求解后冲量，因此未伪造冲量读数。
- 体积投射使用凸截面/凸体积障碍检测。遇到局部障碍会保守地截断该段，不是逐体素流体、任意体积 CSG 或自动机关模拟。
- 传送门边缘、分身接触和连续跨门约束仍使用既有实现；新接口不能保证所有任意模型/高速/复杂多接触组合都达到 Portal 2 的物理保真度。
- 合作联网、门间连续跨房间关节、凝胶流体模拟和自动剧情编辑器不在本批范围。

开发时以 `src/engine` 为源，通过 `npm run sync:runtime` 同步编辑器和静态游戏副本，不编译 WASM。旧式工厂与 ES 模块注入、环境声明、Monaco 包装和静态导出清单必须一起更新。优先运行真实 Jolt/Babylon 测试、`tsc --noEmit` 和相关浏览器用例；通常无需生产构建。实施计划已合并到本说明，不另维护重复的计划文档。
