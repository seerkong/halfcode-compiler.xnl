# 变更：迁移统一 BusinessObject / PageObject operation API 到 XNL

## 背景和动机 (Context And Why)

参考实现的对象 operation API 已由用户声明稳定。PageObject 与 BusinessObject 现在共享 target、invocation、config 和 handler contract；现有 XNL workspace 仍保留 XML 专用 reader、缺少 BO/PO XNL authority，并且 compiler 尚未生成统一对象 registry/bundle。

## “要做”和“不做” (Goals / Non-Goals)

目标：

- 同步稳定的 object-operation public contracts、validators、assembly closure、compiler projection、demo handlers 与发布类型。
- 使用 XNL semantic channels 表达 BusinessObject、PageObject、BusinessAction、BusinessMutation 及它们的 KindDefinitions/catalogs。
- PageObject 与 BusinessObject 统一投影 `ObjectOperationDefinition` 与 target-kind catalog。
- handler 固定为 `fn(runtime, targets, invocation, config)`；action 消费 `invocation.input`，mutation 消费 `invocation.desired`。
- 生成独立 `objects/registry.json`、`objects/bundle.js` 与 `run_object_operation(call)`，消除 BusinessAction generic callable 双入口。

非目标：

- 不保留新的 XML authoring 变体；legacy XML 的删除与 `fast-xml-parser` 移除由后续 G7 完成。
- 不定义 DOM/CSS/XPath/platform locator。
- 不改变普通 Function / ComposedFunction callable ABI。

## 变更内容（What Changes）

- **BREAKING**：BusinessObject/PageObject operations 统一为 owner-owned target/definition catalog。
- **BREAKING**：BusinessAction 不再进入 generic callable registry；对象操作统一通过 `run_object_operation(call)`。
- **BREAKING**：BusinessAction 的 subject identity 从 input 移到 targets；BusinessMutation 从 desired 读取目标状态。
- 新增 XNL BO/PO aggregate authoring tree、XNL specialized readers 与 binding closure validation。

## 影响范围（Impact）

- behaviors：object-operation-contract、object-operation-compilation、application-assembly、authoring-trees、resource-authoring
- code：application assembly、compiler-skill、distribution、demo contracts/handlers/resources/tests
