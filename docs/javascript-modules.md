# JavaScript 脚本与项目内模块

ArkGlide 的用户脚本语言是 JavaScript。`.d.ts` 和语言服务只帮助补全与检查，**不要求用户学习 TypeScript，也不编译 TypeScript 脚本**。编辑器自身使用 TypeScript 不改变这一设计。

本轮支持项目内的 ES `import/export`；运行时使用浏览器原生 ES 模块，保留 live binding，不把导入简单替换成变量快照。解析器、运行时和依赖都随项目本地提供，无需 CDN。

## 继续使用原来的脚本写法

在「场景树」工具栏新建 `utils.js`：

```js
export const speed = 3;
export function movement(input, dt) {
  return {
    x: input.getAction('moveX') * speed * dt,
    z: input.getAction('moveZ') * speed * dt
  };
}
```

`main.js` 保留顶层 `return` 和注入 API，只增加导入：

```js
import { movement } from './utils.js';

return defineScript({
  onUpdate() {
    const step = movement(input, time.deltaTime);
    this.entity.translate(step.x, 0, step.z);
  }
});
```

顶层 `return` 是 ArkGlide 的兼容工厂写法：运行前导入声明被移至模块层，其余代码放进实例工厂。导入绑定仍由浏览器处理，每个实体分别执行工厂。原来不使用模块的脚本无需修改。

## 显式 ES 模块脚本

需要标准模块组织时，挂载的脚本必须默认导出一个**同步工厂函数**：

```js
import { speed } from './utils.js';

/** @param {ScriptContext} context */
export default function(context) {
  const { entity, input, time, defineScript, events, timers } = context;
  let ticks = 0;
  return defineScript({
    onStart() {
      events.on('reset', () => { ticks = 0; });
      timers.every(1, () => { ticks++; });
    },
    onUpdate() {
      entity.translate(input.getAction('moveX') * speed * time.deltaTime, 0, 0);
    }
  });
}
```

JSDoc 注释是可选的补全提示，不是 TypeScript 语法。`context` 包含 `entity/input/scene/time/console/defineScript/math/events/timers/prefabs/physics/audio/ui/animation` 和受管理的 `setTimeout/clearTimeout/setInterval/clearInterval`。计时器与事件属于当前实例，实体销毁或停止时释放。

模块默认导出普通对象不能作为挂载脚本，因为共享对象会让多个实体共用实例状态。工具模块可以自由导出对象、函数和常量；工具模块本身无需挂载到实体。

## 支持的导入形式

```js
import defaultValue from './utils.js';
import { speed, movement as move } from './utils.js';
import * as utils from './utils.js';
import './setup.js';
export { speed as playerSpeed } from './utils.js';
export * from './utils.js';

// 字符串字面量动态导入。函数可异步，工厂本身须同步返回。
async function readSpeed() {
  const utils = await import('./utils.js');
  return utils.speed;
}
```

- 旧式工厂导入名称不得与 `entity/input/scene/time` 等注入 API 重名；使用 `as` 别名。
- 路径相对于导入文件，必须写完整 `.js` 后缀；支持子目录与根目录内的 `../`。
- 同一次播放中，同一个工具模块只初始化一次；其导出状态在调用者间共享。实例状态放在工厂内，或返回对象上。
- 启动前准备场景与预制体挂载脚本，预制体运行时生成可直接创建新实例。
- 停止释放 Blob URL 和适配器持有的命名空间；下一次播放使用新模块图，模块状态从初始值开始。浏览器内部 ES 模块记录不能单独卸载，在 iframe 卸载时释放，不宣称撤销 URL 会立即回收全部代码内存。
- 模块重命名同步更新静态导入、转导出和字面量动态导入，移动到不同目录时修正相对路径；撤销/重做恢复原内容。未写完的源码通过词法扫描更新已完整写出的这三类引用；扫描遇到无法继续解析的词法错误时，后续引用需自行修正。删除模块不自动删掉使用方代码，运行时明确报告缺失路径。
- Monaco 提供跨文件成员补全、类型推导、定义跳转与诊断，错误定位映射到保存的原始源码。
- IndexedDB、恢复副本、`.arkglide` ZIP 仍保存原始 JavaScript，无项目格式迁移。

## 当前边界

- 不提供 npm 包解析、远程 URL/CDN 导入、JSON/CSS 模块、隐式 `.js`/`index.js` 查找或 TS 编译。
- 循环依赖、顶层 `await`、变量路径 `import(path)` 会收到明确错误，当前不支持。
- 不允许导入旧式挂载脚本来共享其生命周期；请把公共逻辑抽成 `export` 工具模块。
- 模块顶层适合放常量和纯工具定义。实体、物理、UI、音频、受管理计时器等操作放在实例工厂/生命周期内，通过注入 API 或 `context` 执行。直接使用 `window`、DOM、原生计时器和异步请求仍不属于托管资源。
- 生命周期钩子继续同步调度，不等待 Promise；异步结果修改实体前应检查实体是否已销毁。

示例：`examples/collect-gems-modules.arkglide` 是第三批游戏的模块化版本。
