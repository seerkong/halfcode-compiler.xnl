## 上下文

通用 XNL normalization 当前混入了具体 Kind 字段策略。字段缺失被 loader 拒绝，且 TypeScript 类型让所有 consumer 假设字段必然存在。

## 方案概览

1. 将 `ResourceDescriptor.description`、`ResourceMetadata.lifecycle` 改为可选。
2. `loadXnlRecord` 仅对 `#id` 与 `apiVersion` 做共同必填校验；可选字段存在时原样投影，不存在时省略。
3. application-assembly 通过 `requiredDescription(record)` 在它已有的 description-bearing resource projection 边界收窄，避免空字符串默认值。
4. 以不含两个字段的 Note fixture 证明 generic registered Kind 可以加载。
5. 文档声明：属性可使用相应 XNL channel，但是否必填由 Kind/consumer contract 决定。

## 影响范围与修改点（Impact）

- `packages/resource-core/src/index.ts`
- `packages/resource-core/src/xnl-loader.ts`
- `packages/resource-core/src/index.test.ts` 与 fixtures
- `packages/application-assembly/src/index.ts`
- `docs/resource-dsl/`
- `skills/framework-resource-dsl/SKILL.md`

## 决策摘要

- 详见 `decisions.xnl`。
- 不为缺失字段生成占位字符串。
- 共同不变量与 Kind-specific contract 保持单向分层。

## 风险 / 权衡

- 公共类型变为 optional 会暴露既有 consumer 的隐含假设；通过 typecheck 找出并在具体边界收窄。
- 当前 KindDefinition 尚不能声明任意 required property；本变更不扩展 schema DSL，仅移除错误的通用约束。

## 兼容性设计

- 含两个字段的现有资源投影不变。
- assembly 对其当前支持的资源仍输出非空 `description: string`。

## 迁移计划

无需迁移已有资源；新 Kind 可按自身契约省略字段。

## 待解决问题

- 无。
