# 玩法基础 API 完整性检查

本批次执行了真实 Jolt WASM 和 Babylon NullEngine 测试，没有生产构建、没有 C++/WASM 编译，也没有重新生成 Portal Lab 游戏逻辑。

## 实际结果

- `node --test --test-reporter=tap --test-concurrency=1 tests/*.test.mjs`：**460 通过，0 失败，0 跳过**。记录见 `docs/verification/gameplay-foundations-unit.tap`。已包含原 307 项玩法扩展、远端 15 个修复提交的新增测试，以及 Inspector 关节挂载回归。
- `node node_modules/typescript/bin/tsc --noEmit --pretty false`：**退出码 0，无诊断，不输出文件**。记录见 `docs/verification/gameplay-foundations-types.txt`。
- `git diff --check`：通过。
- 27 组共享运行时源文件与 `public` 副本逐字节一致；旧式工厂、ES 模块、Monaco 声明和静态导出清单均包含 `triggers/signals/motion/optics`。
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium node --test --test-reporter=tap tests/foundations/browser.mjs`：**1 通过，0 失败，0 跳过**。记录见 `docs/verification/gameplay-foundations-browser.tap`。实际覆盖独立游戏、opaque-origin iframe、贴图加载、粒子注册、穿门投射、关卡/检查点、触发器采样、停止清理及重启后持久化。
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium node --test --test-reporter=tap tests/composition/browser.mjs`：**1 通过，0 失败，0 跳过**。记录见 `docs/verification/composition-browser.tap`。覆盖真实输入抓取/释放、玩家实际穿门、压板→反射接收→门的 AND 信号、穿门光桥碰撞与刚体承载、力场加速、反射面改变导致关门、检查点同时恢复机关/物理、坠落重试、出口触发以及停止/重新运行清理。
- `examples/composition-lab.arkglide` 通过项目标准化和现有静态导出流程；独立关卡包含全部运行时清单。初始视角调整后重新执行了关卡浏览器和实际模块 Monaco 检查，均通过。独立包使用现有 JavaScript/WASM 产物，无生产编译。
- 原 Portal Lab JS/JSON/项目包、原生成器以及 `package-lock.json` 与用户上传的 ZIP 逐字节一致。只运行新增组合关卡的生成器，未运行原 Portal 示例生成器、生产构建或 WASM 编译，尚未推送。
- 之前交付包的 283 项结果和 Chromium 缺失记录是历史证据；本文件及上述日志记录本轮实际运行。重复的玩法/Portal 实施计划已合并到 API 文档，旧 Portal 测试日志保留在原交付 ZIP，不重复加入仓库。

## 功能闭环

| 能力 | 验证内容 | 结果 |
| --- | --- | --- |
| 真实接触 | 接触点、朝向、进入/保持/退出、子形状标识、求解前材质覆盖 | 通过 |
| 求解边界 | 禁止在材质规则中修改物理或销毁实体；拒绝发生在实体状态改变前 | 通过 |
| 运行时刚体 | 原生质量/重力/阻尼/力；力覆盖完整固定步内的多个子步 | 通过 |
| 角色 | 地面实体、动态参数、保留脚底、受阻站起、力与控制开关 | 通过 |
| 关节/形状 | 原生关节保留、COM 参考系、形状更新、两类电机的实测位置目标及限制 | 通过 |
| 凸包查询 | 非原点凸包的位置修正、原生重心变换、按投射世界坐标建立力场 | 通过 |
| 视觉资源 | 动态网格、光束分段、材质恢复链、贴花跟随、粒子、失败创建及销毁清理 | NullEngine 通过；浏览器 WebGL 启动/贴图 ready/粒子注册通过；全量视觉像素未验收 |
| 表面规则 | 涂层点查询、标签更新、宿主移动、完整放门轮廓覆盖与拒绝结果 | 通过 |
| 模型平面 | 静态单网格平面覆盖检查、原生孔洞及原几何恢复 | 通过 |
| 体积穿门 | 有限形状适配、方向映射、宽截面裁切、中心线之外障碍、生成真实凸碰撞体 | 通过 |
| 力场 | 刚体/角色、体积去重、进入/退出、独立分段方向与所有权清理 | 通过 |
| 区域触发器 | 旋转原生体积、凸包原点、角色/静态/运动学/传感器过滤、去重、模拟间隔、禁用/销毁、预算原子拒绝、同步/异步错误隔离、固定步顺序与暂停、静态包注入及清理 | 通过 |
| 信号逻辑 | 图结算/通知顺序、变更合并、AND/OR/NOT/XOR、跨所有者订阅、反馈预算、同步/异步异常与级联清理 | 通过 |
| 运动机构 | 反向、暂停、状态原子恢复、独占控制、真实原生速度、传送门子步下速度一致、角色平台承载 | 通过 |
| 反射查询 | 原生命中法线、衰减、距离预算、跨门后反射、终点接收、预算截断及反射面清理 | 通过 |
| 穿门/控制边界 | 竖直视线与竖直出口保持方位、direct 输入随门变换、清除输入保留外部动量、非法步长/射线预算拒绝、配置子步预算 | 通过 |
| 关卡 | 资源预加载、延后启动组件/脚本、失败和取消、保留引导场景、清理旧关卡 | 通过 |
| 检查点 | 稳定预制体内部 ID、世界位姿/速度、剧情 provider、孔洞/配对恢复、版本拒绝与回滚 | 通过 |
| 存储桥 | JSON/字节预算、项目隔离、脚本销毁取消、错误来源/错误运行 ID 拒绝 | 通过 |
| 传送门专项 | 45 项原生测试，含原有 41 项以及本轮 4 项控制/预算边界；双向往返、地面/出口接触、移动宿主、四类关节岛继续覆盖 | 通过 |

## 不把哪些能力算作完成

这些测试证明本批通用接口接到了实际运行时，不代表完整 Portal 2 游戏或全部物理保真度已经验收。当前边界包括：静态模型面要求独立单网格；角色仍沿世界 Y 朝上；接触求解后的逐接触冲量未由现有绑定暴露；体积局部阻挡采用保守截断；任意动态生成/销毁和视觉/音频/涂层状态需要游戏 provider；合作网络和连续跨门关节未新增。详细契约见 `gameplay-foundations-api.md`。

触发器是离散区域占用查询，不保证高速物体在两次采样之间短暂穿过区域时也产生事件；移动区域由游戏更新世界位姿。无碰撞体的纯视觉对象不参与。触发器配置与占用不属于内置检查点状态，需要游戏 provider 自行重建。

已重跑 editor 项目的 23 项浏览器用例、7 项静态部署用例、玩法基础和组合关卡两项集成及全部原生单元测试；未重跑其他编辑器项目或 Portal 专项像素浏览器回归。组合自动化对部分位置使用受控位姿设置，真实输入抓取、穿门、碰撞承载、力场与机关连接均有单独行为断言；不宣称代替人工全流程通关或全部目标设备手感验收。

## 与远端修复适配

以 `9d336024edaa84ebec356efba1dc1627144409dc` 为最新基线，保留此前 15 个贡献者提交的生命周期、实体旋转/清理、资源导入、编辑器与静态导出修复。关卡 scope 与停止后的 owner 状态共同保留；实体销毁继续保护共享材质并保证异常时完成剩余清理。输入同时保留单指针归属、多鼠标按键及 Pointer Lock 相对位移，追加了多键/外来指针/丢失捕获的组合断言。

Inspector 关节的内部 Babylon 向量必须转为普通 Vec3 后再进入会克隆配置的 joint API，避免失去原型访问器导致旧静态示例无法启动；回归验证了真实铰链电机位移。系统 Chromium 使用正常多进程模式，移除了仅自定义路径分支的 single-process 等参数，避免关闭测试上下文后浏览器退出。

- 全量 Node 单元测试：460 通过，0 失败，0 跳过，记录 `verification/gameplay-foundations-unit.tap`。
- 实际 `tsc --noEmit --pretty false`：退出 0，无诊断。
- 输入适配专项：25 通过，关节/高级物理专项：22 通过；均包含在全量用例中。
- `test:browser -- --project=editor --reporter=list`：23 通过，记录 `verification/upstream-editor-browser.txt`。
- `test:static -- --reporter=list`：7 通过，覆盖根路径/子路径、重启清理、下载与初始化取消、失败诊断；记录 `verification/upstream-static-browser.txt`。
- `node --test --test-reporter=tap tests/foundations/browser.mjs tests/composition/browser.mjs`：2 通过，记录 `verification/upstream-gameplay-browser.tap`。

本次未运行生产构建或 WASM 编译。首次浏览器启动配置失败、关节边界失败均已定位并修正；以上为修正后结果。
