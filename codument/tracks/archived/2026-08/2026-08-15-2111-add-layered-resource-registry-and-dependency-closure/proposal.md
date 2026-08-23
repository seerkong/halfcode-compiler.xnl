# 变更：增加分层资源注册表与依赖闭包快照

## 背景和动机 (Context And Why)

Halfcode 当前能够从一个 `ResourcePackage` 加载一个 `ResourceTree`，并公开按 Kind 分组的业务资源与已验证的 KindDefinition registry。这个边界足以支持单包 consumer，却不能在多个独立资源根之间形成一个可审计的有效资源视图，也不能冻结一次运行或分发实际依赖的资源内容。

后续 consumer 需要通用的 ordered named layers、显式 shadow/tombstone 事实、稳定 provenance、内容 revision 与 dependency snapshot。它们是 Halfcode 的通用资源职责，但不能把某个 host 的目录名称、安装策略或自然语言判断带进 resource core。

## “要做”和“不做” (Goals / Non-Goals)

**目标:**

- 在不改变 `loadResourceTree()` 和现有 `ResourceTree.registry.byKind/kindDefinitions` 行为的前提下，增加组合多个已验证 ResourceTree 的公共 API。
- 用调用方提供的有序 named layers 表达 precedence；后出现的高优先级 layer 可以 shadow 低优先级同身份资源，所有来源和被遮蔽事实均可观察。
- 使用显式、机器可读的 tombstone 抑制低层资源；资源缺席本身不代表删除。
- 通过 typed dependency edges 和显式 digest contributions 构建 deterministic content identity、dependency closure、registry revision 与 immutable snapshot。
- 在公共包中以 additive API 发布，并用旧 consumer characterization、公共类型/运行时 smoke 和完整包校验保护兼容性。

**非目标:**

- 不定义 `global`、`workspace`、`~/.eidolon` 或任何具体产品路径；这些名字和 root binding 属于 host。
- 不扫描任意字符串寻找 `resource://`，不根据字段名、文件名或自然语言猜测依赖。
- 不定义 AI Workflow、Agent、Skill dependency 或其他 Kind-specific 语义。
- 不改变 XNL authority、Catalog、KindDefinition、source shape、apiVersion 或现有单包加载规则。
- 不在本 track 实现多 Skill 分发、host 安装事务或发布到 npm registry。

## 变更内容（What Changes）

- 增加 ordered named layer、显式 tombstone、effective entry/registry 与稳定 diagnostics 的公共 contract。
- 增加纯确定性的 effective registry composition，保留 effective、shadowed、tombstoned 与 KindDefinition provenance。
- 增加显式 `ResourceDependencyEdge`、digest contribution/content identity、dependency closure 与 snapshot contract。
- 增加 canonical digest、缺失目标/identity-kind 冲突/依赖环诊断和 deterministic revision 计算。
- 增加 public distribution export、类型与运行时 consumer smoke、文档和回归测试。
- 增加领域建模 delta，登记 layered registry 和 dependency snapshot 两个相互独立的 component 与派生事实对象。

## 影响范围（Impact）

- 受影响的能力（behaviors）：`resource-loading`。
- 受影响的代码：`packages/resource-core/`、`packages/distribution/`、相应测试与 Resource DSL 文档。
- 兼容 consumer：现有 `halfcode-compiler.xnl@0.2.1` API 使用方继续使用原入口；新 consumer 显式选择新 API。
- 发布影响：需要一个由实现阶段决定并验证的后续公开包版本；本 track 不修改既有 package identity。
