# 变更：公开 loader content identities 并准备 0.2.2

## 背景和动机 (Context And Why)

Halfcode 源码已经提供 ordered layered registry 与 typed dependency snapshot，但不可变发布物 `halfcode-compiler.xnl@0.2.1` 尚不包含这些 API。snapshot 同时要求所有 effective resources 的 `ResourceContentIdentity`，当前 loader 虽读取 XNL authority bytes，却没有把相应 digest 投影给 consumer，导致 host 只能重复读文件或自行复制 digest 规则。

本 track 在 Halfcode authority 内补齐单次加载产生的 content identity 投影和 effective-layer 选择器，并把当前 additive API 准备为新的公开补丁版本 `0.2.2`。已发布的 `0.2.1` 不得被替换；registry publication 是 mission 中需要明确授权的后续动作，不属于本 track。

## “要做”和“不做” (Goals / Non-Goals)

**目标：**

- loader 对每个成功注册的业务 resource 使用实际 XNL authority bytes 产生 canonical SHA-256 content identity。
- 通过 additive `LoadedResourceTree` 返回只读、可验证的 identities，不把新字段变成旧 `ResourceTree` 手工构造者的必填项。
- 提供 Halfcode-owned effective identity projector，按 authentic effective registry 与 exact layer provenance 选择全部 effective resources 的 authority identity，并合并显式 typed material contributions。
- 保留 `loadResourceTree`、`validateResourceTree`、`ResourceTree.registry.byKind/kindDefinitions` 与现有十个 public specifiers。
- 把唯一公开 distribution package 准备为 `0.2.2`，以真实 tarball runtime/type consumer 验证 loader → layers → identities → snapshot 链路。

**非目标：**

- 不执行 `npm publish`，不写 registry 凭据，不替换任何已发布版本。
- 不把 global/workspace/Eidolon roots 或 layer precedence policy 放进 Halfcode。
- 不扫描 ResourceNode 任意字符串来发现 material/dependency；contribution 与 edge 继续由 Kind owner 显式提供。
- 不读取额外 material 文件，不让 depa-flows 或 Eidolon重写 authority digest 逻辑。
- 不改变 internal private workspace packages 的发布身份。

## 变更内容（What Changes）

- `resource-core`：新增 loaded-tree content identity contract、loader 一次读取/摘要与 effective identity projector。
- `resource-core` tests：覆盖 raw bytes、multi-root forest、layer shadow/tombstone、contributions、顺序稳定性、输入篡改隔离与 legacy compatibility。
- Resource DSL：记录 loader/projector/snapshot 的 authority 边界与调用方式。
- distribution：公开版本提升到 `0.2.2`，扩展 root/resource-core packed runtime/type smoke，生成 release-candidate evidence。

## 影响范围（Impact）

- 受影响的能力：`resource-loading`、`package-distribution`。
- 受影响的代码：`packages/resource-core/`、`packages/distribution/`、`docs/resource-dsl/` 与本 track 资产。
- 兼容性：旧 structural `ResourceTree` 与单树 consumer 保持有效；新 freeze consumer 使用 `LoadedResourceTree` 与新 projector。
