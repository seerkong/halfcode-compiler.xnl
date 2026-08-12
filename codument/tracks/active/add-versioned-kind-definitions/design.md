# Design: versioned KindDefinition

## 方案

1. KindDefinition 属性增加 `currentApiVersion` 与 `supportedApiVersions`，且 supported 必须包含 current。
2. resource-core 在加载普通 catalog resource 后，用对应 Kind contract 校验 `record.metadata.apiVersion`；未知版本返回稳定 diagnostic，不做猜测升级。
3. `halfcode-compiler.xnl/kind-definition` 暴露 `ResourceMigrationRegistry<T>`：迁移定义由稳定 ID、Kind、from/to 版本和纯转换函数组成。registry 只接受无歧义出边，plan 逐步解析到目标版本并检测缺口/环。
4. XNL 只保存声明式版本契约；可执行转换留在代码侧，Codument 可注册自己的 AST transform。

## 兼容性

现有资源统一使用 `halfcode.resources/v1`，为现有 KindDefinitions 补齐显式契约后规范化结果不变。ResourcePackage 与 KindDefinition 是 bootstrap 类型，不依赖用户声明的 KindDefinition 才能读取。

## 验证

- migration registry 单测覆盖单步、多步、缺失路径和歧义。
- resource-core 覆盖支持版本、未知版本和非法 KindDefinition 契约。
- 全仓 test/typecheck/verify/package check。
