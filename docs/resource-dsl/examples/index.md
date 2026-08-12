# Parseable Examples

> 目录职责 · holds: 由当前 xnl-core parser 机械验证的规范 resource DSL 样例 · excludes: demo 业务资源与运行态 fixtures · tier: stable · ⬆from: resource DSL 文档实例 · ⬇to: parser/loader contract tests

| 文件 | 文档族 |
|---|---|
| `resource-package.xnl` | package 与 catalogs |
| `kind-definition.xnl` | 通用 Function KindDefinition |
| `skill-capsule-kind-definition.xnl` | SkillCapsule exact dependency contract |
| `skill-capsule-devops.xnl` | 四 Skill 示例的 lifecycle root |
| `skill-capsule-authoring.xnl` | authoring -> shared resource DSL dependency |
| `skill-capsule-run.xnl` | 无 sibling dependency 的 run Skill |
| `skill-capsule-resource-dsl.xnl` | 被 authoring 复用的 shared resource DSL Skill |
| `function.xnl` | 带 instruction 与 code binding 的 descriptor |
| `resource-mappings.xnl` | reference/callable/source-root mappings |

这些文件由当前 `xnl-core` parser 做 parse/stringify/parse 验证。下游 resource-core track 会把相同检查变成持续测试。
