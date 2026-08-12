# Design

## 1. Authority boundary

XNL 文件的原始 UTF-8 bytes 是 authority digest 的唯一输入。loader 已经拥有文件 IO 与 containment，因此它必须在解析同一次读取的 bytes 时计算 SHA-256；consumer 不重复读取文件，也不从 normalized AST、`ResourceRecord` JSON 或绝对路径推导 digest。

每个成功进入 `registry.byKind` 的 resource 都得到一个 `ResourceContentIdentity`：

```ts
interface LoadedResourceTree extends ResourceTree {
  readonly contentIdentities: ReadonlyMap<string, ResourceContentIdentity>
}

declare function loadResourceTree(
  options: LoadResourceTreeOptions,
): Promise<LoadedResourceTree>
```

`ResourceTree` 本身不增加必填字段，保留手工 structural fixtures 和旧 consumer compatibility。loader 返回的 subtype 由 resource-core 在当前 runtime 内登记为 authentic；外部结构仿制不能进入 effective identity projector。

`contentIdentities` 精确覆盖 `registry.byKind` 的业务 resources，不包含 manifest、KindDefinition 或 tombstoned identity。一个 multi-root XNL forest 中的 roots 共享同一 `authorityDigest`，但 `resourceId` 不同，因此 canonical `contentDigest` 也不同。

## 2. Raw byte handling

loader 对每个 authority 文件只读取一次 bytes：

1. 读取 `Uint8Array`；
2. 用 fatal UTF-8 decoder 得到 parser 输入，非法 UTF-8 返回稳定 diagnostic；
3. 对原始 bytes 计算 `sha256Digest`；
4. 每个验证成功的 root 用 `createResourceContentIdentity({resourceId, authorityDigest})` 建立 identity；
5. 所有 diagnostics 为空时才返回 frozen/authentic `LoadedResourceTree`。

绝对路径不进入 digest/projection。`documentUri` 继续承担 canonical VFS provenance；digest 只绑定原始 authority bytes 和 resourceId。

## 3. Effective identity projection

新增纯确定性 API：

```ts
interface ResourceLayerContentIdentityInput {
  readonly id: string
  readonly tree: LoadedResourceTree
}

interface ResolveEffectiveResourceContentIdentitiesInput {
  readonly registry: EffectiveResourceRegistry
  readonly layers: readonly ResourceLayerContentIdentityInput[]
  readonly contributions?: ReadonlyMap<string, readonly ResourceDigestContribution[]>
}

declare function resolveEffectiveResourceContentIdentities(
  input: ResolveEffectiveResourceContentIdentitiesInput,
): ReadonlyMap<string, ResourceContentIdentity>
```

projector 必须：

- 只接受 canonical `composeLayeredResourceRegistry()` 产生的 authentic registry 与 authentic loaded trees；
- exact 校验 layer id、顺序、package id 和 effective origin；
- 为每个 present effective resource 从其 `effectiveLayerId` 对应 tree 选择同 resourceId identity；
- 对显式 contributions 调用现有 `createResourceContentIdentity`，不解释 contribution key 的领域含义；
- 拒绝 missing/extra identity、未知 contribution owner、重复 key、layer mismatch 或结构仿制输入；
- 返回按固定 UTF-16 code-unit 顺序排列、deep-frozen 的只读 Map。

snapshot builder 继续要求显式 `contentIdentities`。这样 loader/projector 是 bytes authority adapter，snapshot 仍是纯闭包验证器；两者不融合成隐藏 IO。

## 4. Compatibility and package version

- `loadResourceTree()` 的返回类型缩窄为 additive subtype；旧调用方只读取父接口字段时无需迁移。
- `validateResourceTree()` 的返回形态和 diagnostic contract 保持。
- `composeLayeredResourceRegistry()` 仍接受 structural `ResourceTree`，现有 fixtures 和 generic consumers 不被迫提供 identities。
- 新 projector 是 opt-in；它不在 depa-flows/Eidolon复制 layer selection 或 digest 逻辑。
- `packages/distribution/package.json` 是唯一公开 npm version authority，本 track 把它从 `0.2.1` 提升到 `0.2.2`；private workspace package versions 不表示公开发布物版本，保持不变。
- 十个现有 exports 完全保持；新 runtime/types 从既有 `./resource-core` 子路径 additive 暴露。

## 5. Release preparation boundary

本 track 只生成可复验的 candidate：

- build/typecheck/full tests；
- `npm pack` tarball consumer，验证 manifest version=`0.2.2`、全部十个 specifiers、legacy loader、真实 package loader identities、layer projector 与 dependency snapshot；
- `npm pack --dry-run --json` 的文件边界、shasum/integrity 和 candidate report；
- registry 查询证明开始时没有覆盖不可变 `0.2.1`。

实际 `npm publish`、registry readback 与 release receipt 属于 mission `HALFCODE_RELEASE-T3`。没有明确授权时必须停在 candidate 完成态。

## 6. TDD and verification

RED 先覆盖：

- real XNL bytes 的 digest 与修改后变化；
- forest roots 共享 authority digest、identity 按 resourceId 区分；
- loaded maps 的 immutability/authenticity；
- shadow/tombstone/exact layer origin；
- contribution merge、missing/extra facts、duplicate key 与输入顺序稳定性；
- old structural `ResourceTree` composition 与 0.2.1 public calls 保持；
- tarball runtime/types 从 `halfcode-compiler.xnl/resource-core` 执行完整链路。

GREEN 后运行 focused/full/typecheck/generate/verify/package、docs XNL、track XNL、behavior XML、diff 与静态边界扫描。终态使用 fresh `AttractorCheck(coding)`。
