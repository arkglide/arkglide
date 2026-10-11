# 第三批：可玩性

本批按约定实现 F11 基础物理、F19 音频、F20 输入与游戏 HUD，并用 F18 模型动画完成可玩示例。不是对整个引擎路线图的完成声明。

## 启动与示例

Windows CMD，在源码根目录运行：

```cmd
npm ci
npm run dev
```

浏览器打开终端给出的地址，使用工具栏导入 `examples/collect-gems.arkglide`，点击播放，再在运行区域点击「启用音频」。WASD/方向键移动，空格跳跃，走向黄色宝石收集；分数会增加，播放空间音效。红色墙会阻挡玩家。底部方向与跳跃按钮也支持触屏。停止再播放可重置小游戏。

示例的 GLB 包含真正不同的 Idle（上下浮动）和 Move（旋转）动画，不需要外部模型。音效为程序生成的短 WAV。`npm run example:playable` 可重建这些资源。

## F11：Jolt WASM 刚体

Inspector 的「添加刚体」提供静态、动态、运动学三种类型，以及盒体、球体、胶囊碰撞体。可编辑质量、摩擦、弹性、触发器和旋转锁定。项目重力在运行中真正影响动态刚体。

采用 JoltPhysics.js 1.1.0 / Jolt 5.6.0 的官方预编译单线程 C++/WASM 包。嵌入式 WASM 随 `public/lib/jolt-physics.js` 提供，无运行时 CDN 下载，也不要求用户本机安装 Emscripten。MIT 许可证与来源记录在同目录。没有宣称在本次环境重新编译 Jolt。

固定步顺序为脚本 `onFixedUpdate` → Jolt Step → 写回实体 → 接触回调；回调在求解器返回后执行，允许安全销毁物体。每帧可以推进多次固定步。暂停与 timeScale=0 冻结物理。动态体暂不启用休眠，保持小游戏接触状态明确。

```js
return {
  onStart() {
    physics.onContact(this.entity, event => {
      console.log(event.phase, event.other.name, event.sensor);
    });
  },
  onFixedUpdate() {
    const v = physics.getVelocity(this.entity);
    physics.setVelocity(this.entity, {x:input.getAction('moveX')*3,y:v.y,z:0});
  }
};
```

`physics.add(entity, options)` 为动态创建的普通实体加刚体；`remove`、`has`、`getVelocity`、`setVelocity`、`addImpulse` 和 `teleport` 提供基础操作。`teleport` 接收世界坐标，保留速度；实体 position 仍是局部坐标。脚本通过实体变换移动已存在的刚体时，在下个固定步同步，运动学刚体使用 MoveKinematic。动态刚体通常应通过速度和冲量控制。

碰撞尺寸是局部单位，世界缩放只应用一次。球体 X 为直径；胶囊 X 为直径，Y 为总高；盒体为 XYZ 全尺寸。盒体支持非均匀缩放，球体/胶囊要求均匀缩放。负/零世界缩放、带剪切的父层级和运行时改变刚体缩放会报错，避免给 WASM 无效形状。需要改变尺寸时先 remove，再 add。实体销毁、预制体销毁、生成失败和停止会释放刚体；脚本接触订阅按实例清理。

当前不包含三角网格/凸包自动碰撞体、关节、车辆、完整角色控制器、碰撞层编辑器、物理调试线框或 C++ 场景图迁移。模型碰撞体仍是显式配置的基础形状。

## F19：音频

底部「材质与预制体」面板中的「音频」支持 WAV、MP3、OGG、M4A、WebM，单文件最多 32 MiB；可替换、重新链接和删除。实际格式解码依赖浏览器，错误会显示在诊断里。Inspector 可绑定音源，设置自动播放、循环、音量、空间音频和参考距离。被场景或预制体引用的音频不能直接删除。

```js
const sound = audio.play('音频资源ID', {volume:.8,loop:false,entity:this.entity,spatial:true});
sound.setVolume(.5);
sound.stop();
```

`audio.list()` 返回成功解码的资源 ID，`audio.unlock()` 在用户手势中解锁，`setMasterVolume(0..1)` 控制主音量。脚本创建的声音随脚本销毁停止；实体音源随实体销毁释放。空间位置随实体更新，监听位置跟随运行相机。暂停和零倍率挂起 AudioContext；倍率改变声音播放速率，也会改变音高。停止关闭上下文、移除音源和解码缓存。延迟完成的解码不会重新激活旧运行。

浏览器自动播放限制仍需要真实点击，不能通过脚本绕过。当前没有音频总线/混音面板、流式长音乐、音高保持的时间拉伸或麦克风录音。

## F20：动作输入与 HUD

同一面板中的「输入与 HUD」提供动作映射和 HUD 配置。动作使用 KeyboardEvent.code（如 KeyW、ArrowUp、Space），支持多组正/反向键。脚本已有 isKeyDown/getAxis 等旧 API 保持可用，新 API 为 getAction/isActionDown/wasActionPressed/wasActionReleased。正反方向同时按下会抵消；边沿持续一个渲染帧，多次固定步可观察同一帧输入。

HUD 文本与按钮按运行区域百分比定位，可设置文字、颜色、背景和字号。按钮可绑定动作以及正/反方向，键盘和多点触屏输入合并。按钮释放、触摸取消、失焦和暂停清理按住状态；暂停时按钮禁用。映射按键可拦截浏览器默认行为，HUD 点击不会穿透到视口相机。

```js
ui.get('score')?.setText('分数：' + score);
const label = ui.createText({id:'status',text:'就绪',x:5,y:5});
ui.createButton({id:'restart',text:'重开',x:70,y:10}, () => console.log('clicked'));
```

脚本创建的 HUD 随脚本销毁释放，项目配置的 HUD 随停止释放。文字使用 textContent，不注入 HTML。句柄支持 setText/setVisible/destroy；隐藏动作按钮会释放该按钮持有的触摸输入，重新显示时须再次按下，其他按钮与键盘输入不受影响。暂停期间新建的按钮也保持禁用，恢复后启用。当前没有拖拽式 UI 画布编辑器、布局容器、富文本/图片 HUD、游戏手柄或摇杆控件；触屏采用动作按钮。

## F18：模型动画

含动画的 GLB/glTF 加载后，Inspector 显示片段列表，可保存默认片段、自动播放、循环和速度。编辑视口不自动播放导入的动画；运行时按游戏时间推进，暂停/零倍率冻结。

```js
const clips = animation.list(this.entity);
animation.play(this.entity, 'Idle', {loop:true,speed:1});
animation.play(this.entity, 'Move', {loop:true,fade:.2});
animation.stop(this.entity);
```

切换可在指定秒数内混合两个片段权重。每个模型一个受管理的动画播放器，脚本创建的播放器随所属脚本销毁释放；自动播放器随模型销毁/停止释放。播放对象限制在导入的模型动画组。

当前没有状态机编辑器、BlendTree、动画重定向、根运动、事件轨道或骨骼编辑器。播放动画和物理同时修改同一个物理根节点可能竞争，应让模型内部子节点/骨骼播放动画，刚体控制模型实体根节点。

## 项目与诊断

格式升级到 0.5，兼容未声明版本及 0.1–0.4。组件、动作、HUD 进入场景与预制体快照；音频元数据与二进制分别保存。IndexedDB 元数据/模型/贴图/音频共用原子事务；ZIP 包含 audio/*.bin；恢复副本、撤销、复制粘贴与资源隔离包含音频。

错误配置、损坏的音频大小、不存在的动作引用或未知未来版本，在替换当前项目之前拒绝。丢失音频保留元数据并提示重新链接，不覆盖旧项目。恢复仍是最后一次成功保存的副本，不是逐次编辑历史。

运行诊断新增物理后端与刚体/接触计数、音频状态/声音/缓存计数、动画播放器、HUD 和按住输入计数，用于检查停止是否释放。F21 高级性能分析仍未完成。
