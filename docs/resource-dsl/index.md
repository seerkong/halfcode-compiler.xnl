# Halfcode XNL Resource DSL

## 目录职责

- **holds**：halfcode resource package、catalog、KindDefinition、descriptor、mapping、URI 与文件组织的 XNL authoring 真源。
- **excludes**：parser/registry 实现（→`packages/resource-core/`）、consumer 归一化逻辑（→各 consumer package）、运行态数据与 BusinessObject/PageObject 尚未稳定的专用 API。
- **tier**：`stable`
- **promotes_from**：Codument track `define-xnl-resource-dsl` 的 proposal、design、behavior 与 modeling delta。
- **promotes_to**：资源 authoring 文件、loader/validator、consumer contract tests 与公开文档。

本目录定义 halfcode 资源的 XNL-native 语言。XNL 文档是可持久化语义真源；normalized descriptors、application assembly、发布制品和运行快照都是可重建投影，不得反向成为第二份 authoring 定义。

## 核心公理

一个节点的完整形态是：

```xnl
<Tag #id envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 { properties } ( unique-subdomains ) [ repeated-or-ordered-members ]>
```

| 通道 | 唯一职责 | 资源 DSL 用法 |
|---|---|---|
| `Tag` | 节点类别 | `ResourcePackage`、`KindDefinition`、`Function`、`ResourceMappings` 等资源 kind |
| `#id` | 节点身份 | 可跨容器引用的 FQN；不从文件名推断 |
| metadata 位 | 容器协议与 Kind writer revision | `envelopeVersion`、正整数 `specVersion` |
| `{}` | 无序业务属性 | lifecycle、description、kind、src、root 等标量或内联结构 |
| `()` | 每父节点唯一的命名子域 | `Catalogs`、`DescriptorContract`、`Instruction`、`CodeBinding` 等 |
| `[]` | 直接、有序或可重复事实 | catalog 条目、mapping 条目、includes 等 |

规则的重点是语义分配，不是把 XML tag/attribute 机械换一种括号。consumer 不得读取 parser-private 字段，也不得重建 `@_attribute` 一类 XML 对象形状。

## 权威文档

| 文档 | 回答的问题 |
|---|---|
| [language.md](language.md) | XNL 通道、身份、引用、声明式边界与 normalized projection。 |
| [documents.md](documents.md) | package、catalog、KindDefinition、descriptor、mapping 各自长什么样。 |
| [files.md](files.md) | 单文件/目录 bundle、`manifest.xnl`、logical path 与 provenance。 |
| [projections.md](projections.md) | 单包 tree、ordered layers、tombstone、typed dependency 与 revision 的 authority 边界。 |
| [skill-capsules.md](skill-capsules.md) | SkillCapsule version authority、sibling dependency、closure plan/apply 与 host 边界。 |
| [migration.md](migration.md) | XML authority 如何迁移，哪些做法被明确拒绝。 |
| [examples/](examples/) | 由当前 `xnl-core` parser 验证的规范实例。 |

KindDefinition 同时拥有精确资源契约：每个 `SpecRevision` 声明一个正整数 writer `specVersion` 及 schema、semantic、source-contract fingerprints；`sourceShapes`、cardinality 与 required files 也绑定进该 revision 的 contract identity。Host 选择 exact reader revision 和 compatibility policy，resolution 只沿显式登记、唯一的 writer→reader 路径运行并生成 receipt。成功加载的规范化 contract 可从 `AuthoredResourceTree.registry.kindDefinitions` 读取，consumer 无需再次解析 Kind XNL。

多个 package 的组合不产生新的 authoring authority。canonical loader 在同一次 raw-byte read 中产生 `AuthoredResourceTree.contentIdentities`；Host 通过 exact reader profile 将 authored tree 解析为带 receipts 的 `ResolvedResourceTree`。`resolveEffectiveResourceContentIdentities()` 再从 exact effective authored layer 选择 authority identity 并合并 Kind owner 的显式 digest contributions。`EffectiveResourceRegistry` 和 `ResourceDependencySnapshot` 都是由已验证 authority、显式 tombstone、typed edge 与 digest contribution 重建的只读投影；它们不得被序列化回 XNL 作为第二份事实源。完整规则见 [projections.md](projections.md)。

本目录自身也是 `Halfcode.ResourceDsl.Package@1.0.0`：XNL descriptors 只登记 canonical Markdown/XNL materials，不复制正文。`Halfcode.ResourceDsl.Skill.System` 编译为 `sys-halfcode-resource-dsl@1.0.0`，供离线消费者按需加载这些文档；每个 capsule 的 `references/.halfcode/provenance.json` 绑定 source FQN、`envelopeVersion`、writer `specVersion`、独立 Skill version、生成协议和 payload digests。

## 暂缓边界

BusinessObject 与 PageObject 的通用外壳仍服从本目录的 `Tag/#id/metadata/{}/()/[]` 公理，但以下内容在当前版本中**刻意不定义**：

- 专用字段与 operation/mutation/action 模型；
- application assembly 的二者专用 public types；
- 参考实现正在重构的 PageObject API 映射；
- 二者最终 KindDefinition descriptor contract。

这些内容由 mission `halfcode-compiler-xnl-migration` 的 `LATE-BO-PO` group 在重新观察参考实现后补充。
