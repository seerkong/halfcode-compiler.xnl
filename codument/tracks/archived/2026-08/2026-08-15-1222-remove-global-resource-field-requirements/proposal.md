# 变更：取消 lifecycle/description 的全局资源要求

## 背景和动机 (Context And Why)

resource-core 当前在读取任何 XNL resource 时都要求 `lifecycle` 与 `description`。这把部分 Kind 的业务字段错误提升成了所有资源的共同结构约束，使不需要这两个概念的合法 Kind 无法注册。

## “要做”和“不做” (Goals / Non-Goals)

目标：

- 通用 loader 只统一要求 `#id` 与 `apiVersion`。
- normalized record 如实表达可选的 `description` 与 `metadata.lifecycle`。
- 具体 assembly projection 若承诺 description，则在其 consumer 边界明确校验。
- 更新 DSL guidance，明确字段约束归具体 Kind 所有。

非目标：

- 不从现有资源批量删除仍有意义的 lifecycle/description。
- 不在本次引入完整的声明式属性 schema 引擎。
- 不放宽 `#id`、`apiVersion`、catalog、kind match、source shape、required files、identity uniqueness 或 containment 规则。

## 变更内容（What Changes）

- **BREAKING**：`ResourceDescriptor.description` 与 `ResourceMetadata.lifecycle` 从必填改为可选。
- 删除 resource-core 的全局缺失诊断。
- 为无 lifecycle/description 的已注册 Kind 增加 loader 行为测试。
- 在 application assembly 中对其现有 description-bearing projections做 Kind-specific narrowing。

## 影响范围（Impact）

- 行为：`resource-authoring/xnl-resource-language`
- 代码：resource-core、application-assembly
- 文档：resource DSL docs 与 framework resource DSL skill
