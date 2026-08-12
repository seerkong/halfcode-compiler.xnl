# Proposal: close-xnl-only-product-surface

## Goal

将产品运行面收敛为 XNL-only：删除 XML authoring trees、legacy parser/consumer adapters、XML fixtures 与 `fast-xml-parser`，并保持完整 BO/PO、generic resources、Skill build 与发布行为。

## Non-goals

- 不删除 Codument 控制面 XML。
- 不改变已稳定的 object-operation public contract。
- 不改写 XNL DSL 的语义分配。

## Success

- `apps/`、`packages/`、`skills/` 无 `.xml` 文件。
- 产品代码、manifests、lockfile 无 `fast-xml-parser`、`xml-legacy`、`XmlObject` 或 XML descriptor reader。
- 完整测试、typecheck、verify、generate、demo build、package consumer 与 XNL round-trip 全通过。
