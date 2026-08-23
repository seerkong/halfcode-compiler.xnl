# Design：Layered Registry 与 Dependency Snapshot

## 上下文

当前公共 `loadResourceTree({ rootDir, manifestPath? })` 一次加载一个 XNL ResourcePackage。成功结果包含 package manifest、`registry.byKind`、`registry.kindDefinitions` 与 diagnostics。该 API、结果形状和单包校验顺序是现有 consumer 的兼容基线。

目标能力分为两个正交问题：

1. 多个已经验证的 ResourceTree 如何按显式 precedence 形成 effective registry。
2. effective resources 如何通过显式 dependency edges 和内容贡献形成可冻结、可比较的 revision snapshot。

二者可以共享 identity/provenance 类型，但不能混成一个同时扫描文件、推断引用并决定 host 路径的“大加载器”。

## 不变量

- XNL ResourcePackage 仍是 authoring authority；effective registry 和 snapshot 都是可重建的只读投影。
- 现有 `loadResourceTree()`、`validateResourceTree()`、`ResourceTree.registry.byKind` 与 `kindDefinitions` 保持行为兼容。
- layer 只有稳定 `id` 和调用顺序。Halfcode 不认识 `global`、`workspace`、用户目录或产品安装路径。
- precedence 由输入数组明确表达：从低到高排列，后一个 layer 优先。禁止根据 layer 名称排序或赋予特殊含义。
- tombstone 必须是显式 typed fact。某个高层没有资源绝不等价于删除低层资源。
- dependency edge 必须由 Kind owner/consumer 以 typed input 提供。resource core 不遍历任意字符串、不猜字段、不解析自然语言。
- digest 输入必须有明确 provenance；canonicalization 和排序规则确定，不能依赖 Map 插入偶然性、绝对路径或文件系统枚举顺序。

## 方案概览

### 1. Ordered named layers

新增独立于 `ResourceTree` 的组合输入和结果，具体命名可在 RED 测试后做最小调整，但语义固定为：

```ts
interface ResourceLayerInput {
  id: string
  tree: ResourceTree
  tombstones?: readonly ResourceTombstone[]
}

interface ResourceTombstone {
  resourceId: string
  expectedKind?: string
  reason?: string
}

interface EffectiveResourceEntry {
  resourceId: string
  kind: string
  resource?: ResourceRecord
  effectiveLayerId?: string
  shadowed: readonly ResourceOrigin[]
  tombstone?: ResourceTombstoneOrigin
}

interface EffectiveResourceRegistry {
  byId: ReadonlyMap<string, EffectiveResourceEntry>
  byKind: ReadonlyMap<string, readonly ResourceRecord[]>
  kindDefinitions: ReadonlyMap<string, EffectiveKindDefinition>
  layers: readonly ResourceLayerDescriptor[]
  compositionRevision: string
  /** Deprecated-compatible alias of compositionRevision. */
  revision: string
}
```

组合器是纯逻辑：输入已经通过单包 loader 验证的 trees，输出 effective registry 或稳定 diagnostics。它不重新扫描磁盘。

组合结果具有不可伪造的 runtime provenance：dependency snapshot 只接受当前 resource-core 实例中由 `composeLayeredResourceRegistry()` 产生并登记的 immutable registry。结构相同但由调用方手工拼装、复制或篡改 revision alias 的对象必须 fail closed；跨进程持久化应保存原始 layer authority 并重新组合，不把结构化 JSON 当作已认证 registry。

处理规则：

1. 拒绝空 layer id 和重复 layer id。
2. 按输入顺序从低到高处理。
3. 同一 `resourceId` 且 kind 相同，高层资源成为 effective；低层来源进入 `shadowed`。
4. 同一 `resourceId` 的 kind 不同，返回 identity-kind conflict，不能静默 shadow。
5. 高层 tombstone 抑制低层 effective resource，并保留目标和 tombstone origin；若声明 `expectedKind`，必须匹配。
6. 同一 layer 内的重复 identity 仍由既有 loader 拒绝；组合器不修复非法 ResourceTree。
7. 相同 `resourceKind` 的 KindDefinition 只有 normalized contract 一致时才能合并 provenance；冲突必须 fail closed，不能按 precedence 偷换 schema authority。
8. `byKind` 只包含 effective resources，使用稳定 kind/resourceId 排序；完整 shadow/tombstone 证据留在 `byId`/entries。

### 2. Content identity 与 typed dependency edges

dependency snapshot 使用显式输入，不从 `ResourceNode` 任意字符串中猜引用：

```ts
interface ResourceDigestContribution {
  key: string
  digest: string
  sourceUri?: string
}

interface ResourceContentIdentity {
  resourceId: string
  authorityDigest: string
  contributions: readonly ResourceDigestContribution[]
  contentDigest: string
}

interface ResourceDependencyEdge {
  fromResourceId: string
  toResourceId: string
  relation: string
  declaredBy: string
}

interface ResourceDependencySnapshot {
  roots: readonly string[]
  closure: readonly SnapshotResource[]
  edges: readonly ResourceDependencyEdge[]
  registryRevision: string
  snapshotRevision: string
}
```

Kind owner 或 domain consumer 负责从自己的 descriptor contract 产生 typed edges 和 material digest contributions。Halfcode 只负责：

- 重新规范化并校验每一个 effective resource 的 content identity，按显式 authority/contribution facts 重算 `contentDigest`，不得信任调用方声称的 digest；
- 校验 edge endpoints 存在于 effective registry；
- 从显式 roots 遍历 typed edges；
- 对缺失 endpoint、重复矛盾 edge 和 dependency cycle 返回稳定 diagnostics；
- 以 canonical key/order 计算每个 resource content digest、content-sensitive registry revision 和 snapshot revision；
- 输出不可变、稳定排序且携带 origin/provenance 的 snapshot。

`authorityDigest` 的具体字节来源必须由 loader 或明确的 digest adapter 提供。不得通过重新 stringify parser-private AST、扫描目录或读取 undeclared material 来构造隐藏输入。

### 3. Digest 与 revision 规则

- digest 字符串采用带算法前缀的稳定形式，例如 `sha256:<hex>`。
- 同一 resource 的 contributions 按 UTF-16 code-unit 顺序的 `key` 排序，并拒绝重复 key、不规范输入、非法 digest 和调用方伪造的 `contentDigest`。
- `compositionRevision` 覆盖 layer 顺序、effective identity/presence、shadow/tombstone facts、选定 KindDefinition 的 authority `resourceId` 与 normalized contract，以及 canonical `documentUri/logicalPath` provenance；`revision` 仅作为它的精确兼容别名。ResourceRecord descriptor/node/metadata bytes 和 material digests 属于 content identity，MUST NOT 进入 composition 摘要。兼容 Kind contracts 仍可跨 layer 合并，是否兼容不由 definition resourceId 决定。
- snapshot 的 `registryRevision` 覆盖 `compositionRevision` 以及全部 effective resources 经重新校验的 content digests，包括当前 roots 不可达的资源。因此任何有效资源内容变化都会改变 `registryRevision`，而不会伪装成 layer composition 变化。
- snapshot revision 覆盖 roots、闭包资源 revisions 和参与闭包的 typed edges。
- snapshot 必须复制并冻结自己携带的 origin facts，不得把调用方或 registry 的对象引用直接当作 snapshot-owned state。
- 任意输入排列差异若语义集合相同，除明确有序的 layer precedence 与 roots 外，不应造成 revision 漂移。
- 所有 canonical key、resource、kind、edge 和 contribution 排序使用 ECMAScript UTF-16 code-unit 顺序，不依赖 locale/ICU 或文件枚举顺序。

### 4. Public API 与 package 边界

新能力优先从既有 `halfcode-compiler.xnl/resource-core` 子路径 additive export；若实现证据表明需要内部文件拆分，仍保持一个公开 resource-core authority。根入口是否重导出由 public surface 测试决定，但不能删除、重命名或改变既有十个 exports。

公共 contract 使用 readonly facts，不泄露 mutable implementation Map、parser-private node 或 host filesystem handle。新 API 的运行时与 `.d.ts` 必须通过 packed tarball consumer 验证。

## TDD 与任务映射

### RED：兼容与新行为

- characterization test 锁住单树 loader、`byKind` 和 `kindDefinitions` 现有结果。
- layered registry tests 先覆盖 precedence、shadow provenance、explicit tombstone、kind/schema conflict 与稳定排序。
- snapshot tests 先覆盖 explicit edges、material contribution、missing endpoint、cycle、digest determinism，并加入一个含 `resource://` 普通字符串但没有 typed edge 的反例，证明不会被隐式纳入闭包。

### GREEN：两条独立支线

- Layer branch 只实现 named layers/effective registry。
- Snapshot branch 只实现 canonical digest/typed dependency graph。
- 两条支线在公共包验收阶段汇合，不通过共享 host policy耦合。

### REFACTOR：统一不可变 facts 与 diagnostics

在全部 RED tests 转绿后，统一 UTF-16 code-unit stable sort、deep-clone/freeze、diagnostic codes 和 provenance helper；不得为减少代码而重新引入任意字符串扫描。组合器不得把调用方可变的 `ResourceRecord`、metadata/node/value 或 KindDefinition 数组直接暴露到投影中；旧单树输入本身仍保持兼容且不被原地冻结。

## 影响范围与修改点（Impact）

- `packages/resource-core/src/`：新 contracts、pure composition、canonical digest 与 dependency snapshot。
- `packages/resource-core/src/*.test.ts`：旧行为 characterization 和新行为 RED/GREEN tests。
- `packages/distribution/src/resource-core.ts` 及 distribution contract tests：additive exports。
- `packages/distribution/tools/verify-package.ts`：packed consumer runtime/type smoke。
- `docs/resource-dsl/`：说明 projection、layer 和 dependency authority 边界；不定义 host 路径。

## 决策摘要

- 采用一个 track、两个独立实现 phase；共享 compatibility/publication 收口，不在代码中合并职责。
- layer 是 ordered named input，不是 `global|workspace` 枚举。
- dependency 只接受 typed edges 和显式 digest contributions。
- 新能力通过独立 additive API 暴露，旧单树 API 不改语义。
- 关键决策记录在本 track 的 `decisions.xnl`；规划拓扑摘要记录在 `analysis/decision-tree.xnl`。

## Dirty-base 保护

目标工作区在建轨时包含其他 completed-but-unarchived track 的改动。实现者必须：

1. 将 `analysis/findings.md` 中的初始 dirty inventory 当作保护清单，不清理、不回退、不格式化无关文件。
2. 每个任务仅审查自己实际触碰的 diff；禁止 `git restore`、`git checkout`、`git stash` 或等价破坏性操作。
3. 若目标文件已被其他活动工作修改，先读取并在当前 actual state 上做最小合并；无法无歧义合并时阻塞该任务。
4. 最终验收同时证明新行为和现有未提交成果仍在，而不是用 clean tree 作为完成前提。

## 风险 / 权衡

- **一个 track 内有两个 contract，范围偏大。** 通过 P2/P3 独立 phase、独立测试和 DAG 汇合控制；若共享类型无法稳定，先回写 findings 再由 mission 受控拆轨。
- **KindDefinition 跨层冲突会产生隐式 schema 替换。** 只允许 normalized contract 一致的合并，冲突 fail closed。
- **digest 隐藏读取会破坏可复现性。** 所有 material/content contribution 显式传入并记录 provenance。
- **新 public types 破坏旧 consumer。** 不修改现有函数签名/字段必需性；packed old-style consumer 与新 API consumer一起验证。
- **partial implementation 被误用。** 只有 public distribution smoke、全量 tests/typecheck/verify/package check 与终态 coding AttractorCheck 都通过后才完成。

## 兼容性设计

- `loadResourceTree()` 和 `validateResourceTree()` 保持原签名。
- `ResourceTree.registry.byKind`、`kindDefinitions` 与原 ResourceRecord 字段继续可用。
- 新 effective registry 使用独立类型；不把 layer 字段强制加入旧 ResourceRecord。
- 既有十个 package export specifier 不删除、不重命名。
- consumer 可继续固定使用 `0.2.1`；采用新 API 的 consumer 显式升级到实现阶段发布的版本。

## 迁移计划

1. 用 characterization test 固定旧公共行为。
2. 先加入新类型和纯逻辑 API，不迁移既有 consumer。
3. 完成 packed package 的旧/新双 consumer smoke。
4. 由后续 host track 显式采用 layered registry；Halfcode 不自动切换任何 consumer。
5. 出现回归时回退新 API 的发布，不改写或迁移 ResourcePackage authority。

## 待解决问题

- 无阻塞性产品决策。具体导出函数命名、内部文件拆分和发布版本号由实现阶段在公共表面 tests 约束下选择，并记录到 findings。
