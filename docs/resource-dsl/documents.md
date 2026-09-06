# Resource Document Families

## 语义根与 Catalogs

catalog-owning manifest 可以直接使用由同一包 KindDefinitions 注册的语义根，例如 `SkillApp`。loader 先加载 KindDefinition catalogs，再以 `manifest` shape 和版本契约校验根；语义根自身会进入资源 registry。旧的 `ResourcePackage` 根继续兼容，但只作为 bootstrap manifest，不进入业务 registry。

推荐使用具名 Catalog；tag 固定 source shape，`resourceKind` 是发现资源的期望 Kind：

```xnl
<SkillApp #demo.resource_workflow.authoring envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 (
  <Catalogs [
    <DirectoryResourceCatalog #kind_definitions {
      resourceKind = "KindDefinition"
      root = "vfs://./KindDefinitions/"
      entry = "manifest.xnl"
      scope = "children"
    }>
    <DirectoryResourceCatalog #functions {
      resourceKind = "FunctionBundle"
      root = "vfs://./Functions/"
      entry = "manifest.xnl"
      scope = "root"
    }>
  ]>
)>
```

具名 Catalog 包括 `FileResourceCatalog`、`DirectoryResourceCatalog`、`ManifestResourceCatalog`。File 缺省扫描 `root` 下全部 `.xnl` 与 `.md`，也可以用 `entry` 精确选择；Manifest 按子目录加载 `entry`；Directory 用 `scope="children"` 枚举子目录，或用 `scope="root"` 把 catalog root 自身作为一个目录资源。目录和 manifest Catalog 必须声明普通 XNL `entry`。

既有非 CodePackage `<Catalog kind="..." shape="single-file|directory|manifest" ...>` 输入继续规范化到同一内部发现计划。catalog 只描述组织，不复制 descriptor 内容；XNL 根 tag/`#id` 和 Markdown frontmatter 仍拥有资源 kind/identity。Catalog 的期望 Kind 与资源自述 Kind 不一致时加载失败。

## KindDefinition

`KindDefinition` 声明 source shape 与 descriptor contract：

```xnl
<KindDefinition #halfcode.resource_kind.Function envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 {
  lifecycle = "Stable"
  resourceKind = "Function"
  subjectFqn = "Halfcode.ResourceKind.Function"
  sourceShapes = ["single-file" "directory"]
} (
  <SpecRevisions [
    <SpecRevision #v1 {
      specVersion = 1
      schemaRef = "vfs://./spec-v1.schema.json"
      schemaFingerprint = "sha256:<exact-schema-digest>"
      contractFingerprint = "sha256:<exact-full-contract-digest>"
      semanticValidatorFingerprint = "sha256:<exact-validator-digest>"
      referenceProjectionFingerprint = "sha256:<exact-reference-projection-digest>"
      compilerInputFingerprint = "sha256:<exact-compiler-input-digest>"
      stability = "stable"
    }>
  ]>
  <DescriptorContract (
    <Identity { required = true form = "fqn" }>
    <CodeBinding { property = "src" scheme = "vfs" exportFragmentRequired = true }>
    <Instruction { required = false source = "inline-or-vfs" }>
  )>
)>
```

`SpecRevision.specVersion` 是 exact writer revision，不表示“当前”或范围。schema、semantic contract 和外层 `sourceShapes`/`documentCardinality`/`requiredFiles` 共同进入 contract identity；任何一项改变都要求新的 `specVersion`。reader compatibility 与 source migration 是两条独立链路：前者只生成 resolved projection 和 receipt，后者显式重写 authoring source。

`documentCardinality` 缺省为 `"one"`。只有 `sourceShapes = ["single-file"]` 的 Kind 可以声明 `documentCardinality = "many"`，表示一个 authority 文档允许包含多个并列的同 Kind 根；它不是对所有 XNL 文件放宽根约束。

Kind contract 可以按自身语义约束 lifecycle、description、instruction、code binding 与 includes；除 `#id`、`envelopeVersion` 和 writer `specVersion` 外，这些字段都不是通用 loader 强加给所有 Kind 的共同要求。

加载成功后，consumer 从 `AuthoredResourceTree.registry.kindDefinitions` 按 `resourceKind` 取得规范化 contract。KindDefinition authority 本身也作为 authored record 进入 `registry.byKind`；resolution 使用 compiler-owned exact core reader 为它生成普通 receipt，不存在无审计的 bootstrap 分支。

## Resource descriptor

descriptor 根 tag 直接使用 kind，`#id` 是资源 FQN。唯一概念进入 `()`；重复成员进入 `[]`：

```xnl
<Function #demo.resource_workflow.prepare_data envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 {
  lifecycle = "Active"
  title = "Prepare workflow data"
} (
  <Instruction ?instruction>
  接收输入并产生下游 procedure 所需的规范数据。
  </?instruction>
  <CodeBinding {
    src = "vfs://@/apps/demo-resource-workflow-authoring/src/procedures.ts#prepareProcedure"
  }>
)>
```

通用资源外壳只规定 identity、metadata channel、members/subdomains 和 provenance。各 Kind 的稳定领域字段及其 requiredness 由对应 `KindDefinition` 或 consumer contract 收窄；缺失的可选字段不会被填成空字符串。

文本资源可以直接使用 Markdown 单文件 authority，无需配对 XNL descriptor：

```markdown
---
envelopeVersion: halfcode.resource-envelope/v1
specVersion: 1
kind: ApplicationSOP
metadata:
  fqn: Demo.ApplicationSOP.Search
spec:
  description: 执行搜索并返回结构化结果
---

这里是 SOP 正文。
```

frontmatter 只规范化 identity、envelope、writer revision 与 JSON-compatible `spec`；正文不会被解释为 dependency 或额外 metadata。关闭 frontmatter 的 `---` 之后恰好一个分隔换行被移除，其余正文 code units（包括 LF/CRLF 与末尾换行）原样成为 `ResourceNode.text`/`AuthoredResourceSpec.text`，并由 resolution 携带到 resolved node。

目录资源可以通过 `readResourceMaterial` 读取显式 `vfs://./` material。该 API 只接受 canonical loader 产生的 authentic tree，重复校验 authority provenance、directory owner boundary、symlink 与 regular-file 约束，并返回 bytes、SHA-256 digest、canonical source URI 和 typed contribution。它不解释 material 内容，也不执行代码；语言 runtime 和叶子资源接纳由 consumer 拥有。

允许 forest 的 Kind 仍逐根执行同样的 kind、identity、envelope 与 writer revision 校验。例如 Decision Kind 可以显式声明：

```xnl
<KindDefinition #codument.resource_kind.Decision envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 {
  lifecycle = "Stable"
  resourceKind = "Decision"
  subjectFqn = "Codument.ResourceKind.Decision"
  sourceShapes = ["single-file"]
  documentCardinality = "many"
} (
  <SpecRevisions [
    <SpecRevision #v1 { specVersion = 1 schemaRef = "vfs://./spec-v1.schema.json" /* exact fingerprints omitted */ }>
  ]>
)>
```

对应 authority 文件可以有多个并列 `<Decision ...>` 根。每个根归一化为独立 resource record，并共享该文件的 `documentUri` provenance；重复 `#id`、混合根 kind 或不受支持的版本仍是错误。

## ResourceMappings

mapping 根拥有多个唯一 collection subdomain；collection 的 `[]` 承载重复条目：

```xnl
<ResourceMappings #demo.resource_workflow.mappings envelopeVersion="halfcode.resource-envelope/v1" specVersion=1 (
  <ReferenceTargets [
    <ReferenceTarget #function_dependency {
      fromKind = "Function"
      field = "dependsOn"
      targetKind = "Function"
    }>
  ]>
  <CallableArtifacts [
    <CallableArtifact #function_callable {
      kind = "Function"
      binding = "CodeBinding.src"
    }>
  ]>
  <SourceRoots [
    <SourceRoot #authoring {
      uri = "vfs://@/apps/demo-resource-workflow-authoring/resources/"
    }>
  ]>
)>
```

mapping key 是显式属性或 `#id`，不得把用户数据动态拼进 tag 名。
