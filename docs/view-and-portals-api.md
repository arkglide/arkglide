# 通用视角、运动、交互与传送门 API

基线 `14f327d`。JavaScript 脚本使用这些系统，编辑器和独立静态包共用实现。声明在 `src/types/arkglide.d.ts`；新增 API 不是示例游戏的全局辅助函数。全部操作使用世界坐标、单位四元数、秒。相机 FOV 为度，角速度为弧度/秒。

## 运行验收场景

```sh
npm ci
npm run example:portals
npm run dev
```

导入 `examples/portal-lab.arkglide`，播放。WASD 移动，空格跳跃，点击画面锁定鼠标，Esc 释放；左/右键放置两扇门，E 拿放，F 切换第一人称/第三人称/观察者，R 复位。按钮可重建墙面门、地面门并从高处落下。先释放鼠标再点击 UI。

```sh
npm run export:game -- examples/portal-lab.arkglide portal-game
node scripts/serve-static.mjs portal-game 8080
```

导出输出目录必须为空。打开 HTTP/HTTPS 页面的 `index.html`。项目生成器和 `.arkglide` 均随源码提供，无外部模型、声音或 CDN 依赖。

## 输入

- `input.requestPointerLock(): Promise<boolean>` 必须从鼠标/触摸用户手势内调用。拒绝、不支持、超时或取消返回 false，不静默变成拖动控制。
- `isPointerLocked()`、`releasePointerLock()`、`onPointerLockChange(callback)`。
- `getMouseDelta()`：锁定时积累 `movementX/Y`；未锁定保留旧的按键拖动语义。读值不清空，渲染帧结束清空。
- `isMouseButtonDown/wasMouseButtonPressed/wasMouseButtonReleased(button=0)`；按钮 0/1/2 分别为左/中/右。
- 暂停、时间缩放为 0、失焦、页面隐藏和所属脚本销毁释放锁。被取消请求之后的迟到授予也会释放。

用 `events.listen()` 管理 DOM 手势监听，不要在销毁后保留监听器。锁的状态订阅自动随脚本销毁。

## 相机

`cameras.create(options)` 创建脚本拥有的相机，`get(entityIdOrRuntimeId)` 取得已有相机，`active()` 取得当前相机，`setActive(handleOrId)` 切换。取得的已有相机句柄不拥有它；`destroy()` 仅销毁创建者拥有的相机。

句柄提供 `getPose/setPose/lookAt/getLens/setLens/ray/destroy`。`ray(x=.5,y=.5,length=1000)` 的 x/y 为归一化屏幕坐标，direction 的长度是射程。它遵循相机镜头和朝向。

`createRig(options)` 支持：

| mode | 行为 |
| --- | --- |
| firstPerson | 跟随 target，使用 eyeOffset |
| thirdPerson | 跟随 target，以 followOffset 构成相机臂；球形扫掠限制穿墙 |
| observer | 从独立 viewpoint 观察 target；lookAtTarget=false 时使用 viewpoint 的朝向 |
| fixed | 固定世界位姿，通过 camera 句柄控制 |

第二人称观察与控制使用 observer：游戏仍控制自己的玩家实体，镜头可以属于另一个角色。不会把“被控制对象”和“镜头所在对象”绑定为同一个实体。

`target/viewpoint` 是 Entity。`offset` 是初始模式的简写；`eyeOffset/followOffset/observerOffset` 可分别设置模式偏移，`pivotOffset` 是跟随相机的世界支点偏移。firstPerson 的眼睛偏移使用世界直立坐标；observer 偏移使用观察者局部坐标。

句柄提供 `look(dx,dy)`、`direction(strafe,forward)`、`setRotation(quaternion)`、`setMode(mode)`、`update()`、`destroy()`。direction 返回世界 X/Z 上的单位移动意图；look 不自行读取输入。相机更新在渲染前自动执行；交互前可显式 update。`sensitivity` 为弧度/像素，`pitchLimit` 为度。

跨门时跟随该实体的 rig 自动接收完整旋转。`uprightSpeed=0` 保留旋转；正值让相机渐渐恢复水平线，适合直立角色。角色碰撞体的直立策略与相机旋转独立。

```js
/** @param {ScriptContext} context */
export default function ({entity,input,physics,cameras,events}) {
  let character, rig;
  return {
    onStart() {
      character = physics.addCharacter(entity, {
        radius:.3,height:1.8,stepHeight:.3,maxSlope:45,speed:4,jumpSpeed:5,
        movementMode:'inertial',groundAcceleration:40,airAcceleration:6,groundFriction:8
      });
      rig = cameras.createRig({target:entity,mode:'firstPerson',fov:75,uprightSpeed:4});
      const canvas=document.getElementById('renderCanvas');
      if(canvas) events.listen(canvas,'pointerdown',()=>input.requestPointerLock());
    },
    onFixedUpdate() {
      character.move(rig.direction(input.getAction('moveX'),input.getAction('moveZ')));
      if(input.wasActionPressed('jump')) character.jump();
    },
    onUpdate() {
      if(input.isPointerLocked()) {const d=input.getMouseDelta();rig.look(d.x,d.y);}
    }
  };
}
```

动作须已在项目内配置；实体不能已有刚体/角色组件。组件已经存在时使用 `physics.character(entity)`。

## 世界位姿、速度与角色惯性

`physics.getState(entity)` 返回普通数据：kind、position、rotation、velocity、angularVelocity，以及相应的 mass/size/radius/height。`setState(entity,{position?,rotation?,velocity?,angularVelocity?})` 同步 native 物理与渲染，支持父子层级。角色没有角速度自由度。

刚体新增 `getAngularVelocity/setAngularVelocity`、`getPointVelocity`、`addImpulseAt(entity,impulse,worldPoint)` 和 `addAngularImpulse`，配置可选 `linearDamping/angularDamping`（0..100）。未指定保留 Jolt 原默认值；要比较无阻尼动量请显式设为 0。凸包尺寸来自实际模型几何。

角色质量可通过 `mass` 配置（默认沿用 Jolt），用于和动态刚体的接触。角色新增 `setVelocity(worldVelocity)` 与 `addImpulse(deltaVelocity)`。角色冲量是速度增量；刚体既有 addImpulse 是质量相关的物理冲量，两者不混用。

- direct 默认兼容原行为：直接驱动水平行走；通过 setVelocity 加入的额外动量在空中保留，地面用摩擦衰减。
- inertial 采用地面加速度/摩擦和空中加速。空中输入沿意图方向加速，但不把外部高速动量裁成行走 speed。
- `groundAcceleration/airAcceleration/groundFriction` 为可选非负配置。
- 根运动仍是单一运动写入者，不应同时用普通移动/速度接口驱动同一角色。

这些配置可以写在角色组件或 addCharacter 参数中。Inspector 沿用现有表单；本次交付以脚本 API 和格式兼容为目标，没有新增图形化控制器节点编辑器。

## 表面、门与放置

`portals.addSurface(entity,{faces?,margin?})` 注册**以原点为中心的盒形独立 mesh**（static / kinematic / dynamic），可旋转、作为墙/地面/天花板。faces 为 `+x/-x/+y/-y/+z/-z` 的子集，指实体局部面。可见尺寸与碰撞尺寸必须匹配；不接受骨骼或含子 mesh 的自动切孔宿主。

`portals.create({id?,position?,rotation?,width?,height?,shape?,color?,enabled?})` 创建门。门局部 +Z 是正面，+Y 是上；width/height 为世界尺寸，shape 为 ellipse 或 rectangle。默认 1.8×2.6、ellipse。

- `a.link(b)` 双向连接；`unlink()`、`setEnabled()`、`destroy()` 恢复实体墙体碰撞。
- `place(origin,direction,{up?,ignore?,throughPortals?})` 返回 `{placed,reason?,surface?,point?,normal?}`。默认沿穿门射线放置；throughPortals=false 使用直线物理射线。
- 拒绝面未注册、禁止面、非平面边缘、越界和重叠。失败不移动旧门。up 默认世界 +Y；地面退化时使用稳定切向方向。
- 两门连接且启用才切孔。宿主其他位置保留碰撞，不使用整墙禁用。椭圆孔使用 32 段轮廓，视图有同位置边框。
- `getPose/setPose` 是世界位姿；setPose 脱离原自动切孔宿主，可用于预先有洞的关卡/自由门。要在实体表面重定位用 place。
- `width/height/shape/enabled/linked` 可读取，`getDestination()` 取得连接对象。

```js
const surface = portals.addSurface(scene.find('Panel'));
const a = portals.create({id:'a',width:2.2,height:3});
const b = portals.create({id:'b',width:2.2,height:3});
a.place(cameraRay.origin,cameraRay.direction);
b.place(otherRay.origin,otherRay.direction);
a.link(b);
```

自动切孔不对任意曲面/glTF 模型做通用 CSG。关卡可用可放置的平板与复杂装饰模型组合；预制孔可搭配自由门。static 宿主保持固定；要移动的板使用 kinematic 或 dynamic。已注册板不能改变世界缩放，修改前解除注册并重建碰撞体。宿主与 traveler 不能是同一实体，以避免自身传送拓扑。

## 穿越、部分穿越与递归视图

`portals.watch(entity,{keepUpright=true})` 注册角色、dynamic 或 kinematic 运动实体。注册物体才能穿门；句柄 destroy 取消注册。物体销毁或运动组件移除会清理注册。角色通常保持世界直立，刚体旋转、线速度及角速度按门变换转换。

`onTraverse(callback)` 返回取消函数。事件包括 entity、source、destination、position、velocity、matrix。matrix 为列主序，供自己的系统同步坐标。

- 从正面跨到背面才触发，转换剩余位移；出口小偏移避免立即回传。
- 固定步内部细分处理高速/连锁穿越，最多 128 个 native 子步；超过预算明确诊断。
- 在边界处生成裁剪过的渲染副本，保留共享原材质，离开/关闭后恢复。
- 出口半物体用实际 native shape 扫掠检查，静态障碍阻止进入，dynamic 障碍接收接触点冲量与力矩，并使用世界惯量计算有效质量及库仑摩擦。该接触桥不是新增的 native 刚体约束；跨门多接触求解与接触事件不宣称与商用引擎逐帧等价。关节组合采用下述整组穿越策略。
- 关闭/换位时将注册的边界物体推出将恢复的墙体。

`setQuality({depth=2,scale=.75,maxViews=24})` 控制递归深度（1..5）、尺寸比例（.1..2）与总视图预算（1..64）。每个视图使用转换后的相机与出口裁剪；终端层采用门底色。调整质量会释放旧 RT。停止清理所有相机、RT、克隆、订阅和材质。

## 穿门射线与抓取

`portals.raycast(origin,direction,{...PhysicsQueryFilter,maxHops=8})` 返回 `{hit,segments,path,truncated}`。hit 是最后一段的世界命中，distance/fraction 相对全射程；segments 含每段 origin/end/portalId。超过跳数会停在门面并设置 truncated。忽略列表和碰撞分组适用于每段查询。

`mapPoint/mapVector/mapRotation` 按等距门变换映射，可用于激光、发射器、音源或其他逻辑；不凭射线实现刚体碰撞。

`interaction.grab(entity,{position?,rotation?,stiffness?,damping?,maxForce?,maxDistance?})` 对 dynamic 刚体施加受限弹簧力。句柄支持 active、setTarget(worldPoint,rotation?)、setRay(origin,direction,distance=2.5,{segment?,ignore?})、release。

setRay 沿穿门射线求目标，按物体离哪个射线段最近选择所在坐标空间，然后将目标逆映射到这一段。重叠空间/复杂拓扑可显式指定 segment；也可以用 setTarget 完全自行控制。射线忽略被抓物及所属脚本实体；extra ignore 用于独立控制器。物体穿越时目标和指定旋转也转换，避免中间固定步把物体拉回旧空间。应同时用 watch 注册可穿门的被抓物。

抓取没有箱子/武器/剧情类型判断，不依赖 firstPerson 相机。超出最大距离、释放、实体销毁或脚本停止结束抓取。

## 验收与边界

```sh
npm test
npm run build
npx playwright install chromium
npm run test:portals:browser
npm run test:browser
npm run test:static
```

Windows CMD 需要较大构建堆时先运行 `set NODE_OPTIONS=--max-old-space-size=6144`。

本轮提供完整的**传送门机制 API 与验收场景**，不包含 Portal 2 游戏内容或关卡。静态平板开孔、递归视图、跨门射线、角色/刚体动量及抓取均有运行测试；不能据此声称已复刻所有 Portal 2 的极端物理技巧或任意几何布尔功能。详细通过项见交付验收记录；实机鼠标/手柄和目标设备的人工验收仍需进行。

## 第二轮：可移动宿主与原生关节组合

### 可移动平板

`addSurface` 支持 kinematic/dynamic BOX mesh，沿用原有 API，不增加游戏专属标志。dynamic 宿主会受原生力与冲量驱动；kinematic 宿主在 onFixedUpdate 中设置实体 position/rotation。传送门保存相对于宿主的局部位置和方向，随宿主更新；孔洞保持宿主局部形状，无需每帧重新切割。

static 宿主使用三角碰撞，移动宿主使用相同孔轮廓所划分的凸实体组合。保持原有质心坐标框架，保留 BodyID、碰撞分组、关节锚点和配置质量；关闭、解除注册后恢复原有 BOX 形状并释放替代形状。椭圆为 32 边轮廓。

引擎对运动宿主使用点速度（包含角速度与质心位置）换算：

```text
v_out = R * (v_in - source.pointVelocity(x_in)) + destination.pointVelocity(x_out)
w_out = R * (w_in - source.angularVelocity) + destination.angularVelocity
```

位置射线映射 `mapPoint/mapVector/mapRotation` 保持纯几何语义；mapVector 不自动叠加宿主速度。穿越与出口接触桥使用相对速度。移动入口扫过静止 traveler 也能触发穿越。kinematic 整个固定帧的目标在传送门细分中插值，避免把一帧位移集中在第一个小步；运动碰撞仍交给 Jolt。

### 关节连接查询与整组传送

```js
const members = physics.getConnectedBodies(crate);
const group = portals.watchAssembly(crate, { maxBodies: 32 });
const off = portals.onBlocked(event => {
  console.log(event.reason, event.entities);
});
// group.destroy() 撤销本组注册，不销毁实体或原生关节。
```

`getConnectedBodies` 返回原生关节图的当前连接分量，包含查询刚体。返回数组是新副本；不包含普通碰撞接触或抓取弹簧的关联。支持 fixed、hinge、slider、distance，销毁关节/刚体后查询会更新；不是预制体或场景父子分组。

`watchAssembly` 自动注册当前连接分量，默认上限 32、可设 1..64。成员须全部是 dynamic，不能连接 static/kinematic 固定世界锚点，也不能重复注册或包含传送门宿主。整体检查在注册前完成，失败不会残留部分注册。新增连接成员需要销毁旧组并重新注册，否则阻止穿越；移除关节会自动按当前连接分量分别穿越。

采用**原子整组穿越**：首个成员中心穿过时，验证所有成员在入口/出口的投影尺寸，映射整组，再沿出口法线平移，直到整组完全位于出口正面。原生关节及局部锚点、电机、限制保持有效。为避免跳过出口障碍，检查各成员到完整退出位置的形状扫掠；目标空间被占据则整组退回入口，不只传送一端。关闭门时也以整组共同平移方式退让，保持成员相对位置。

这不是两端长期分处两个空间的跨门关节求解器；长链会随整组提前退出，不呈现每个链节独立穿门。默认 `watch` 的关节物体也受到保护：连接分量未以同组注册时阻止穿越。

`onBlocked` 的 reason 为：

| reason | 条件 |
| --- | --- |
| joint-policy | 未注册的连接端点、跨注册组或固定世界锚点 |
| assembly-too-large | 任意成员超出入口/出口孔径 |
| assembly-exit-obstructed | 完整退出路径有实体阻挡 |

阻挡移除朝向门内的相对线速度，保留侧向速度及原有关节。单个整组穿越会为每个成员发出 onTraverse；附带只读 `entities` 列表。所有物理状态和相机在首个回调之前更新，matrix 包含整组出口退让平移，抓取目标也使用该完整变换。

示例新增“移动平板门”和“关节组穿越”按钮。后者发射两块原生固定关节连接的方块，验证整组转换。

本轮未执行 npm run build、WASM 编译、浏览器下载或生产构建。采用原生 Jolt 与脚本/类型/运行时专项回归；更新导出仅打包现有运行时文件。实际设备浏览器下的新增动态表面渲染仍需手动验收。

## 第三轮：孔径与接触修复

孔径判定使用与物理切孔相同的凸轮廓边平面，验证实际形状在各边法线上的支持距离。胶囊使用圆弧与中段，球体使用半径，盒体使用原生圆角盒的方向支持距离。旋转物体不会再因为不存在的二维包围矩形角点被拒绝；模型/网格继续使用保守的包围范围。

检测到中心穿过孔口后，若入口形状不适合，实体共同退回入口，并移除向门内的相对速度。出口还检查传送后的实际朝向（包括角色 keepUpright）与孔径。不会因判定失败直接放任注册实体穿到宿主墙后。非常浅的跨平面运动也会触发穿越，不以旧 epsilon 作为进入阈值。

`onBlocked` 新增原因：

| reason | 条件 |
| --- | --- |
| traveler-does-not-fit | 单体在实际穿越点不适合入口孔径 |
| exit-does-not-fit | 单体转换后的形状/朝向不适合出口孔径 |

出口静态接触只消除朝实际接触法线进入障碍的速度；地面或斜面不会无条件清除朝传送门的速度。边缘接触仍可能通过物理冲量造成减速和旋转。

本轮保持示例位置、尺寸、脚本及控制方式不变。原生测试使用重力与地面支撑，并包含玩家反复返回、旋转箱子返回、抓取物体返回和四类原生关节组合返回。验证结果见验收记录。
