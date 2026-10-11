# 第三批完整实现交付

这是完整源码包，不是补丁；未包含 `.git`、依赖目录或构建输出。合并到现有项目时保留原来的 `.git`。

在 Windows CMD 进入项目根目录，逐条执行：

```cmd
npm ci
npm run dev
```

在编辑器中导入 `examples/third-full.arkglide`，即可试用完整组合示例。用户脚本使用 JavaScript，支持项目内 ES 模块；不要求编写 TypeScript。随包包含运行所需 WASM，不必为了启动重新编译 C++。

- [本轮更新说明](docs/third-full-changes.md)
- [JavaScript API 与配置](docs/third-full-api.md)
- [测试与内存/音频测量记录](docs/third-full-verification.md)
- [逐项任务单](docs/third-batch-full-tasklist.md)
- [完整路线图](docs/roadmap.md)

137 项单元测试、7 项全量浏览器回归和生产构建通过；最后生成的示例再次通过第三批完整集成回归。实现和自动化验收完成，真实手柄验收待人工完成；不把模拟设备测试当作硬件测试。

没有执行 git commit 或 push。F10 性能优化、F12 C++ 场景图、F13 独立发布、F14 联机不在本轮交付范围。
