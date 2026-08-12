# 变更：新增 halfcode-compiler.xml 统一发布包

## 背景和动机 (Context And Why)
仓库通过多个私有 workspace 包维护清晰的源码职责，但将它们分别发布会增加版本、安装和维护成本。此前 scoped 包方案已被取消，公开产品名称确定为 `halfcode-compiler.xml`，并为未来独立的 `halfcode-compiler.xnl` 留出产品族命名空间。

## "要做"和"不做" (Goals / Non-Goals)
**目标:**
- 新增唯一公开 npm 包 `halfcode-compiler.xml`。
- 通过根入口和显式子路径暴露稳定 API。
- 构建时内联全部私有 workspace 包的 JavaScript 与类型声明。
- 提供可重复的 build、pack 和临时消费者 smoke 验证。
- 将生成 Skill capsule 的 runtime import 改为公开子路径。

**非目标:**
- 不发布任何 `halfcode-compiler-*` 内部包。
- 不合并或重命名现有 `packages/*` 目录。
- 不改变 assembly、resource、runtime 或 compiler 的业务行为。
- 不执行真实的 `npm publish`，也不配置 npm 账号凭据。
- 不实现未来的 XNL 编译器。

## 变更内容（What Changes）
- 新增 `packages/distribution`，其 npm identity 为 `halfcode-compiler.xml`。
- 增加显式 ESM exports、类型声明、README、files 与 publish metadata。
- 引入发布构建配置，将内部 workspace 依赖同时内联进 JavaScript 和 `.d.ts`。
- 增加发布制品守卫和 tarball consumer smoke test。
- 更新根 workspace 构建命令以及生成 callable bundle 的 runtime specifier。

## 影响范围（Impact）
- 受影响的能力（behaviors）：`package-distribution`
- 受影响的代码：根 `package.json`、`bun.lock`、`tsconfig.json`、`packages/distribution/**`、`packages/compiler-skill/src/index.ts` 及相关测试和文档。

