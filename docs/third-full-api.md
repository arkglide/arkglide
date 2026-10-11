# 第三批 JavaScript API 与配置

这些 API 可从脚本工厂参数取得，也可在旧脚本工厂中使用同名注入变量。声明位于 `src/types/arkglide.d.ts`，Monaco 用声明提供补全，不编译用户 TypeScript。

```js
export default function ({ entity, input, physics, animation, audio, ui }) {
  let character, controller;
  return {
    onStart() {
      character = physics.character(entity);
      controller = animation.controller(entity);
    },
    onFixedUpdate() {
      const x = input.getAction("moveX"),
        z = input.getAction("moveZ");
      // 使用根运动的控制器更新动画参数，由根运动驱动角色。
      if (controller) {
        controller.setParameter("moveX", x);
        controller.setParameter("moveZ", z);
      } else {
        character.move({ x, y: 0, z });
      }
      if (input.wasActionPressed("jump")) character.jump();
    },
  };
}
```

示例需要实体已有角色组件，控制器存在同名数值参数。没有控制器时采用显式移动；启用根运动时不要再调用 `character.move()`。

## 物理与查询

- `physics.raycast(origin, direction, filter?)`：方向向量的长度就是射线范围；默认返回最近的 `PhysicsHit|null`，`all:true` 返回数组。
- `physics.shapeCast(shape, position, direction, filter?)`：盒、球、胶囊扫掠，与射线相同的返回规则。
- `physics.overlap(shape, position, filter?)`：重叠列表，附带穿透量。
- 命中包含 `entity/point/normal/fraction/distance`，点和法线为世界空间；销毁实体不返回旧句柄。
- shape 为 `{kind:"box",size:{x,y,z}}`、`{kind:"sphere",radius}`、`{kind:"capsule",radius,height}`。
- filter 可含 `group/mask/sensors/ignore/all`；扫掠和重叠可设单位四元数 `rotation`。组列表的位置对应掩码位，实际碰撞遵循双方掩码。
- `physics.setDebug(true/false)` 开关原生形状、速度和接触点显示。

```js
const hit = physics.raycast(
  entity.getWorldPosition(),
  { x: 0, y: -3, z: 0 },
  { ignore: [entity], sensors: false },
);
if (hit) console.log(hit.entity.name, hit.point, hit.normal);
```

凸包与静态网格从模型实际几何生成；`parts` 使用精确部件名称。三角网格限静态物体，骨骼变形几何不作为动态碰撞网格。禁止不支持的缩放、剪切和形状组合；角色采用正的统一世界缩放，运行时改变其缩放需要重建组件。生成缓存用几何数据作签名，停止后释放；不能把视觉模型简化显示当作真实碰撞形状。

### 角色与关节

`physics.addCharacter(entity,{radius,height,stepHeight,maxSlope,speed,jumpSpeed,group?})`，或从组件取得 `physics.character(entity)`。坡度为度数。角色提供 `move(direction)/jump()/teleport(worldPosition)` 与 `grounded/velocity/groundNormal`。X/Z 方向长度限制到 1，再乘 speed；重力、地面、台阶、墙和平台由原生 CharacterVirtual 在固定步处理。

`physics.createJoint(a,b,options)` 返回 `id/active/destroy()`。kind 为 fixed/hinge/slider/distance；anchor/anchor2 为世界点，axis 为世界轴，min/max 为限制，motor 为 `{velocity,force}`。铰链角度使用弧度且限 -π..π；滑动/距离用世界长度。Inspector 的两个锚点各自相对端点实体，是局部坐标，运行时转换为世界坐标。端点须为两个不同有效刚体，端点销毁自动拆除约束。

## 动画控制器

资源包含 `parameters/defaultState/states/transitions`。状态可设置 clip/speed/loop/events；blend 可为 1d（threshold）或 2d（x/y），引用数值参数。过渡含 from/to/duration/可选 exitTime/conditions；条件是参数与值的 >、<、==、!= 比较。

- `animation.createController(entity,id,{rootMotion?})` 或 `animation.controller(entity)`。
- 控制器提供 `state/setParameter/getParameter/setState(name,fade?)/inspect()/destroy()`。参数按实体隔离，inspect 返回参数、权重和时间。
- `animation.onEvent(entity,callback)` 返回取消订阅函数；事件包括 name/data/state/time/loop/entity。
- 事件按跨过的时间区间触发，进入状态可触发时间 0；淡出的旧状态不补发事件。每个固定步最多派发 128 个，跳过数量计入诊断，避免长停顿后的事件风暴。
- rootMotion 为 `{target,translation,rotation}`，target 是动画目标名称。平移/四元数循环增量在固定步只交给一个物理写入者；角色/刚体/普通实体走各自路径，根通道不再视觉重复位移。
- 未贡献权重的通道回到参考姿势，不保留上一个状态的残影。
- 2D 使用当前实现的连续权重算法，不宣称是完整商用编辑器的所有混合空间模式；控制器使用表单，未实现节点图动画制作工具。

### 显式重定向

`animation.retarget(source,target,profileIdOrOptions)` 返回生成的片段名称。profile/options 包含 `mapping/scale/sourcePose/targetPose`。mapping 为源动画目标名称到目标名称；成对参考姿势含 position 和单位四元数 rotation。编辑器可用角度表单输入参考旋转。

目标名称必须唯一且可解析；缺目标、无效姿势、不支持轨道有明确诊断。当前适用于可映射的 glTF 骨骼关联 TransformNode 及标量/向量/四元数动画，不含任意骨架自动匹配、IK、骨骼编辑、原始矩阵轨道混合或完整人体自动重定向。

## 音频

`audio.play(assetId,{bus,loop,volume,rate,priority,stream,preservePitch,spatial,entity,refDistance})` 返回 voice：
`playing/position/duration/reason/stop/setVolume/fadeTo(volume,seconds,stopAfter)/setRate/pause/resume`。仅流式媒体支持 `seek(seconds)`；duration 未就绪可为 null。播放可能因优先级限制返回未播放句柄，检查 playing/reason。

- `audio.buses()/setBusVolume(id,value)/setBusMuted(id,boolean)`。
- `audio.applySnapshot(id,seconds)` 返回 `transitioning/release()`。快照在项目混音器中编辑。
- 总线树以 Master 为根，Music/SFX/UI 可编辑；ducking 按 sourceBus/targetBus/amount/attack/release 定义。达到全局 maxVoices 时按优先级、同优先级时间顺序淘汰；低优先级新声可拒绝。
- UI 总线及后代在游戏暂停/时间缩放为 0 时保留菜单声音；其余音源遵循游戏时间。
- 本地流式媒体使用 Blob 和媒体元素，不完整解码整首歌；媒体解码格式取决于浏览器，需要用户手势解锁。结束、停止、失败均释放关联 URL/节点。
- stream+preservePitch 使用浏览器原生 preservesPitch，缺能力明确报错；有效媒体速率支持 0.0625..16，超出诊断并停止。
- 缓冲音效 preservePitch 使用本地 AudioWorklet WSOLA，有效速率含游戏时间缩放，范围 0.5..2，约 46ms 算法窗口（44.1kHz，实际设备总延迟另计）；超范围或不支持工作线程明确报错，不静默改成变调。
- 普通缓冲音效默认 rate 会变调。Worklet 节点独立持有声音 PCM，长音乐优先 stream，避免大量高并发缓冲长音频。

```js
const music = audio.play("music", {
  bus: "Music",
  stream: true,
  preservePitch: true,
  loop: true,
  rate: 1,
});
music.setRate(0.5);
const snapshot = audio.applySnapshot("pause", 0.25);
// 退出菜单时 snapshot.release();
```

## UI 与输入

`ui.create({id,kind,...options})` 支持 text/button/container/image/richtext/input/joystick；已有 `createText/createButton/get` 继续可用。句柄提供 setText/setVisible/setDisabled/focus/on/destroy；on 支持 click/press/release/change/focus/blur。

parentId 构成节点树；unit 为 px 或 percent，percent 相对父容器。x/y/width/height、anchorX/anchorY、margin/gap/columns/layout/zIndex 可配置；layout 为 absolute/row/column/grid。image 的 textureId 复用项目贴图。richtext 仅支持 [b]、[i]、[color=#...] 标记，不执行 HTML。blockInput 阻挡游戏动作；隐藏/禁用/删除父节点会释放后代输入。

摇杆配置为 `{mode:"fixed"|"floating",radius,deadzone,actionX,actionY}`；radius 为像素，deadzone 为归一化比例。不同指针可同时操控移动与按钮，取消、失焦、暂停、窗口改变均清零。

- `input.getAction/isActionDown/wasActionPressed/wasActionReleased` 统一键盘、手柄、触摸。
- `input.gamepads()` 返回设备 index/id/mapping；轴/按钮绑定含 kind/index/direction/deadzone。
- 正向输入取各设备最强值，减去负向最强值；同方向不累加，反方向可以抵消。
- `input.bindings()/rebind(name,partialBinding,acceptConflicts?)/resetBindings(name?)`；结果含 applied/conflicts。
- `input.captureBinding(name,direction?)` 捕获一个键盘 KeyboardEvent.code，Escape 取消。脚本销毁会取消其捕获；Promise 回调应先检查 cancelled，再访问实例 API。
- 编辑器改绑、默认映射可保存并撤销；脚本运行时改绑仅在本次会话生效。键盘 Tab/方向键与手柄方向键导航，Enter/Space/手柄 A 激活，焦点可见。

```js
ui.get("rebind")?.on("click", async () => {
  const result = await input.captureBinding("jump");
  if (result.cancelled) return;
  ui.get("status")?.setText(result.applied ? "已改绑" : "存在冲突");
});
```

实例拥有的订阅、音源、控制器与捕获随销毁释放；保存句柄不延长其生命周期，停止后不得继续使用旧实例 API。
