# Resource Projections and Dependency Authority

## Authority map

资源 authoring、组合与运行闭包是三个不同层次，不能互相替代：

| Fact | Authority owner | Halfcode projection |
|---|---|---|
| package、Catalog、KindDefinition、resource descriptor | XNL/Markdown authority | `AuthoredResourceTree` |
| reader selection、resolution path 与 effective spec | Host exact reader profile + admitted compiler/Kind registrations | `ResolvedResourceTree` + receipts |
| layer precedence | 调用方提供的有序 `ResourceLayerInput[]` | `EffectiveResourceRegistry.layers` |
| suppression | 调用方显式提供的 `ResourceTombstone` | effective/tombstone/shadow provenance |
| Kind-specific dependency semantics | 对应 Kind owner 或 consumer | `ResourceDependencyEdge[]` |
| authority bytes | canonical loader 的同一次 raw-byte read | `AuthoredResourceTree.contentIdentities` |
| Kind-specific material bytes | Kind owner 提供的显式 digest contribution | effective `ResourceContentIdentity` |
| roots 与 dependency closure | 调用方的显式 roots 加 typed edges | `ResourceDependencySnapshot` |

`AuthoredResourceTree` 是单个已验证 package 的 writer projection；`ResolvedResourceTree` 保留该 authored source，并为 manifest、KindDefinition 与业务 resource 记录 writer/reader/path receipt。`EffectiveResourceRegistry` 只是多个 authored tree 的确定性只读投影；它会 deep-clone/freeze record、metadata、node/value 与 KindDefinition facts，避免调用方之后修改输入而改变既有投影。`ResourceDependencySnapshot` 又是某组 roots 在一个 content-sensitive registry revision 上的冻结闭包。所有 projection 都可由 authority facts 和显式 registrations 重建，不得反写任一 package，也不得成为第二份 authoring 真源。

Snapshot builder 只接受同一 resource-core runtime 中由 `composeLayeredResourceRegistry()` 返回的 canonical immutable registry。手工构造、浅拷贝或改写 revision 字段的结构相似对象会 fail closed；需要跨进程恢复时，应从 XNL packages、ordered layers 与 tombstones 重新组合。Snapshot 会复制并冻结自己的 origin facts，不共享可变调用方引用。

## Ordered named layers

layer 只包含一个不透明、稳定的 `id` 和一个已验证 `AuthoredResourceTree`。数组从低 precedence 到高 precedence 排列，后一个 layer 优先。Halfcode 不保留特殊 layer 名称，不根据名称重排，也不拥有任何产品安装目录或机器路径策略；实际 roots 由 consumer 在调用 resource-core 之前绑定。

组合规则是：

1. 同一 `resourceId`、同一 kind 的高层资源成为 effective；低层 origin 留在 `shadowed`。
2. 同一 identity 跨 kind，或同一 resource kind 的规范化 KindDefinition contract 不兼容，组合失败并返回稳定 diagnostics。
3. 高层没有某个资源只表示“未提供”，绝不表示删除。
4. 删除语义必须通过 `ResourceTombstone { resourceId, expectedKind?, reason? }` 显式声明；tombstone origin 与历史保留在 projection 中。
5. `byKind` 只包含 effective resources；完整 effective、shadow 与 tombstone 证据由 `byId` 保存。
6. `documentUri` 必须是与安全相对 `logicalPath` 一致的 canonical `vfs://@/` URI；非 loader 来源的绝对机器路径或 traversal provenance 会 fail closed。

```ts
import {
  composeLayeredResourceRegistry,
  type ResourceLayerInput,
} from "halfcode-compiler.xnl/resource-core"

declare const lowerPackage: ResourceLayerInput["tree"]
declare const higherPackage: ResourceLayerInput["tree"]

const registry = composeLayeredResourceRegistry({
  layers: [
    { id: "base", tree: lowerPackage },
    {
      id: "override",
      tree: higherPackage,
      tombstones: [{ resourceId: "demo.retired", expectedKind: "Function" }],
    },
  ],
})
```

示例中的名字仅用于展示调用顺序，不携带预定义语义。consumer 可以选择任何稳定 id；改变数组顺序才会改变 precedence。

## Explicit content identity

canonical loader 对每个 XNL/Markdown authority 文件只读取一次 raw bytes：同一次读取同时用于 fatal UTF-8 decode、parse 和 SHA-256。成功加载后返回 `AuthoredResourceTree`；其 `contentIdentities` 精确覆盖 `registry.byKind` 的 KindDefinition 与业务 resources，不包含 package manifest。multi-root document 的 roots 共享同一文件级 `authorityDigest`，但各自的 `resourceId` 和 `contentDigest` 独立。

只有 canonical loader 返回并由当前 runtime 登记的 authentic `AuthoredResourceTree` 才能进入 `resolveEffectiveResourceContentIdentities()`。projector exact 核对 registry 的 layer id、顺序、package 与 effective origin，从每个 effective layer 选择 loader identity；shadowed non-effective resource 与 tombstone 不进入结果。Kind owner 再把 prompt、schema、instruction 等 material 作为带稳定 `key`、`digest` 和可选 `sourceUri` 的 contribution 显式提供。

`createResourceContentIdentity()` 按 UTF-16 code-unit key 顺序 canonicalize contributions，并拒绝任何重复 key；即使 digest 相同，重复或不同 provenance 也不是可静默折叠的合法事实。snapshot builder 会对全部 effective resources 重新规范化 authority/contribution facts、重算 `contentDigest` 并核对 claim；它不会只验证 roots 可达的 identity，也不会信任调用方构造的对象。`sourceUri` 是 provenance，不允许机器绝对路径进入 content revision；调用方应使用 Resource DSL 定义的逻辑 URI。

```ts
import {
  composeLayeredResourceRegistry,
  loadResourceTree,
  resolveEffectiveResourceContentIdentities,
} from "halfcode-compiler.xnl/resource-core"

declare const lowerPackageRoot: string
declare const higherPackageRoot: string
declare const contributions: Parameters<typeof resolveEffectiveResourceContentIdentities>[0]["contributions"]

const lowerPackage = await loadResourceTree({ rootDir: lowerPackageRoot })
const higherPackage = await loadResourceTree({ rootDir: higherPackageRoot })
const registry = composeLayeredResourceRegistry({
  layers: [
    { id: "lower", tree: lowerPackage },
    { id: "higher", tree: higherPackage },
  ],
})

const identities = resolveEffectiveResourceContentIdentities({
  registry,
  layers: [
    { id: "lower", tree: lowerPackage },
    { id: "higher", tree: higherPackage },
  ],
  contributions,
})
```

示例中的 `lowerPackageRoot`、`higherPackageRoot` 与 `contributions` 由 consumer 在调用边界绑定。Halfcode 不定义机器安装目录或 layer precedence policy，也不会重复读取 XNL authority。projector 的结果可直接传给 snapshot builder；snapshot builder 仍不执行隐藏 IO。

## Typed dependency closure

依赖的字段语义属于 Kind owner。它负责把自己的 descriptor contract 转成 `ResourceDependencyEdge { fromResourceId, toResourceId, relation, declaredBy }`。resource-core 只校验 endpoint、从显式 roots 沿这些边遍历、拒绝可达 cycle，并生成稳定排序的 snapshot。

```ts
import {
  buildResourceDependencySnapshot,
  type EffectiveResourceRegistry,
  type ResourceDependencyEdge,
  type ResourceContentIdentity,
} from "halfcode-compiler.xnl/resource-core"

declare const registry: EffectiveResourceRegistry
declare const workflowIdentity: ResourceContentIdentity
declare const schemaIdentity: ResourceContentIdentity

const edges: readonly ResourceDependencyEdge[] = [{
  fromResourceId: workflowIdentity.resourceId,
  toResourceId: schemaIdentity.resourceId,
  relation: "uses-schema",
  declaredBy: "WorkflowKindDefinition",
}]

const snapshot = buildResourceDependencySnapshot({
  registry,
  roots: [workflowIdentity.resourceId],
  edges,
  contentIdentities: new Map([
    [workflowIdentity.resourceId, workflowIdentity],
    [schemaIdentity.resourceId, schemaIdentity],
  ]),
})
```

普通文本、instruction 或 `ResourceNode` property 即使看起来像资源 URI，只要 Kind owner 没有提供 typed edge，就不会进入 closure。resource-core 不遍历任意字符串、不匹配自然语言关键词，也不猜测引用字段。

## Deterministic revisions

- content revision 覆盖 resource identity、authority digest 与按 key 排序的 material digests。
- `compositionRevision` 覆盖显式 layer 顺序、effective identity/presence、shadow/tombstone facts、选定 KindDefinition 的 authority `resourceId`/兼容 contract 与 canonical `documentUri/logicalPath` provenance；`EffectiveResourceRegistry.revision` 是它的精确兼容别名。ResourceRecord descriptor/node/metadata bytes 不进入该摘要，而由显式 content identity 负责。不同 definition identity 不会自行把相同 normalized Kind contract 变成冲突。
- snapshot 的 `registryRevision` 覆盖 `compositionRevision` 与全部 effective resource 的已验证 content revisions，包括当前 roots 不可达的资源。
- `snapshotRevision` 覆盖显式 root 顺序、可达资源 content revisions、参与闭包的 typed edges 与 `registryRevision`。
- revisions 使用带算法前缀的 SHA-256 形式；逻辑 provenance 在 projection 中保留，机器绝对路径不得进入摘要。
- canonical object key、resource、kind、edge 与 contribution 排序固定使用 ECMAScript UTF-16 code-unit 顺序，不依赖 locale、ICU、文件枚举或 Map 插入顺序。

缺失 endpoint、缺失 content identity、identity-kind/KindDefinition conflict、矛盾 digest 或 dependency cycle 都会 fail closed；调用方不会收到看似完整的 partial snapshot。
