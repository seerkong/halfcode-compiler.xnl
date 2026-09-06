# 变更：删除 CodePackage 并通用化目录 material

## 背景和动机 (Context And Why)

旧 CodePackage 把结构资源发现、JavaScript runtime、module import 和叶子 definition admission 放进 Halfcode，越过了资源管理 authority。目录 Bundle 只需要 Halfcode 提供结构记录、受限 VFS material 与内容身份；执行策略属于 Host。

## “要做”和“不做” (Goals / Non-Goals)

目标：

- 不兼容地删除 CodePackage shape、binding/load/admission runtime 与公开 API。
- 提供 authentic directory resource 的通用 material reader 和 digest contribution。
- 保留其他模块合法使用的通用 CodeBinding 概念。
- 从 docs、behaviors、modeling、distribution verifier 清理旧协议。

非目标：

- 不执行 JavaScript/Bun/Python/Java。
- 不识别 Bundle Kind 或叶子 Kind。
- 不递归猜测目录内哪些文件是语言依赖。

## 变更内容（What Changes）

- **BREAKING**：`SourceShape` 删除 `code-package`，`LoadedResourceTree` 删除 `codePackageBindings`，删除全部 CodePackage exports。
- 新增 `readResourceMaterial`，只在 authentic directory resource boundary 内读取显式 `vfs://./` 普通文件。
- material 输出包含 bytes、digest、canonical source URI 和可合并的 typed contribution。

## 影响范围（Impact）

- 受影响能力：resource-loading、package-distribution
- 受影响代码：resource-core、distribution verifier、resource DSL docs、behavior/modeling registry
