# 变更：支持大型 CodePackage 入口模块

## 背景和动机 (Context And Why)

`halfcode-compiler.xnl@0.2.4` 把完整入口源码编码成 `data:` URL 后交给 Bun 动态导入。真实 Host 的 CodePackage bundle 较大时，Bun 会把该 URL 错误地进入 package resolution 并以 `NameTooLong` 失败；同一入口从文件 URL 导入则正常。这个限制阻断了 Mission 中复杂 Skill App 的 XNL-only 迁移。

## “要做”和“不做” (Goals / Non-Goals)

**目标:**

- 以已完成 realpath confinement 和 digest 验证的精确入口 bytes 物化私有短生命周期模块来源。
- 每次 revision 使用独立的短 file URL，保持同进程 reload 可观察新 exports。
- 导入前后都核对 entry bytes，继续拒绝 stale tree 和导入期间的修改。
- 用大型真实模块、Node builtin import 和隔离 tarball consumer 做回归验证。
- 发布并回读 `halfcode-compiler.xnl@0.2.5`，供 Host 精确采用。

**非目标:**

- 不增加相对模块依赖图或 TypeScript 现场编译。
- 不放宽 CodeBinding 的 package-local `.js`/`.mjs` 约束。
- 不引入任何 Host 专属 Kind、brand、schema 或 capability。

## 变更内容（What Changes）

- **BREAKING（仅隐藏 effect 测试契约）**：`CodePackageRuntime` 增加私有模块来源 prepare/dispose effect，`importModule` 不再接收内联 `data:` URL。
- 保留公开 `loadCodePackageModule`、binding、revision 和 export admission API。
- 更新 resource-core 测试、distribution isolated consumer、版本元数据和发布证据。

## 影响范围（Impact）

- 受影响的能力：`code-package-resource-shape`、`package-distribution`
- 受影响的代码：`packages/resource-core/src/code-package.ts`、对应测试、distribution verifier/package metadata、lockfile
