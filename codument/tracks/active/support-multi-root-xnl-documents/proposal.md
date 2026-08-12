# 变更：支持 Kind 声明驱动的多根 XNL 文档

## 背景和动机

XNL 允许文件根包含多个并列元素，Codument `decisions.xnl` 以多个顶层 `<decision>` 表示 forest。Halfcode resource-core 当前强制每个文件恰好一个 data-element root，无法承载这种合法资源。

## 目标

- KindDefinition 可声明 `documentCardinality = "one" | "many"`。
- `many` 文档的每个顶层同 Kind 节点独立成为 ResourceRecord，共享 document provenance。
- 未声明或 `one` 保持严格单根；混合 Kind、缺失 ID、重复 ID 继续拒绝。

## 非目标

- 不允许 ResourcePackage、KindDefinition 或 manifest-shaped resource 多根。
- 不改变 XNL 的 `()`/`[]` 节点内部语义。
- 不定义 Codument Decision 的业务字段 schema。
