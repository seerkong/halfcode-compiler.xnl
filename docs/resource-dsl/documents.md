# Resource Document Families

## ResourcePackage 与 Catalogs

一个 package 有且只有一个 `ResourcePackage` authority root。它拥有唯一 `Catalogs` 子域；每个 `Catalog` 声明一种资源的逻辑根与目录入口：

```xnl
<ResourcePackage #demo.resource_workflow.authoring apiVersion="halfcode.resources/v1" version="1.0.0" {
  lifecycle = "Active"
  description = "Demo authoring resource package"
} (
  <Catalogs [
    <Catalog #kind_definitions {
      kind = "KindDefinition"
      shape = "directory"
      root = "vfs://./KindDefinitions/"
      entry = "manifest.xnl"
    }>
    <Catalog #functions {
      kind = "Function"
      shape = "directory"
      root = "vfs://./Functions/"
      entry = "manifest.xnl"
    }>
  ]>
)>
```

catalog 只描述组织，不复制每个 descriptor 的内容。`shape` 取 `single-file|directory|manifest`；后两者必须声明目录入口 `entry`。`single-file` 缺省扫描 `root` 下全部 `.xnl` 文件，也可以用可选 `entry = "<name>.xnl"` 精确选择同目录中的一个 authority 文件；该 entry 必须是无路径片段的 XNL 文件名。loader 用根 tag/`#id` 确认 kind/identity。

## KindDefinition

`KindDefinition` 声明 source shape 与 descriptor contract：

```xnl
<KindDefinition #halfcode.resource_kind.Function apiVersion="halfcode.resources/v1" version="1.0.0" {
  lifecycle = "Stable"
  sourceShapes = ["single-file" "directory"]
  currentApiVersion = "halfcode.resources/v1"
  supportedApiVersions = ["halfcode.resources/v1"]
} (
  <DescriptorContract (
    <Identity { required = true form = "fqn" }>
    <CodeBinding { property = "src" scheme = "vfs" exportFragmentRequired = true }>
    <Instruction { required = false source = "inline-or-vfs" }>
  )>
)>
```

`currentApiVersion` 是新资源和迁移目标版本，`supportedApiVersions` 是 loader 可直接读取的兼容集合，且必须包含 current。未知版本必须先经过调用方在代码侧注册的确定性 migration，再交给 loader；可执行转换不写入 XNL。

`documentCardinality` 缺省为 `"one"`。只有 `sourceShapes = ["single-file"]` 的 Kind 可以声明 `documentCardinality = "many"`，表示一个 authority 文档允许包含多个并列的同 Kind 根；它不是对所有 XNL 文件放宽根约束。

Kind contract 可以按自身语义约束 lifecycle、description、instruction、code binding 与 includes；除 `#id` 和 `apiVersion` 外，这些字段都不是通用 loader 强加给所有 Kind 的共同要求。

加载成功后，consumer 从 `ResourceTree.registry.kindDefinitions` 按 `resourceKind` 取得规范化 contract。该 projection 包含 version、source shape、cardinality、required files 以及 KindDefinition 自身的 `resourceId`/`documentUri` provenance；KindDefinition 不混入业务资源的 `registry.byKind`。

## Resource descriptor

descriptor 根 tag 直接使用 kind，`#id` 是资源 FQN。唯一概念进入 `()`；重复成员进入 `[]`：

```xnl
<Function #demo.resource_workflow.prepare_data apiVersion="halfcode.resources/v1" version="1.0.0" {
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

允许 forest 的 Kind 仍逐根执行同样的 kind、identity 与 `apiVersion` 校验。例如 Decision Kind 可以显式声明：

```xnl
<KindDefinition #codument.resource_kind.Decision apiVersion="halfcode.resources/v1" version="1.0.0" {
  lifecycle = "Stable"
  sourceShapes = ["single-file"]
  currentApiVersion = "codument.tech/v1alpha1"
  supportedApiVersions = ["codument.tech/v1alpha1"]
  documentCardinality = "many"
}>
```

对应 authority 文件可以有多个并列 `<Decision ...>` 根。每个根归一化为独立 resource record，并共享该文件的 `documentUri` provenance；重复 `#id`、混合根 kind 或不受支持的版本仍是错误。

## ResourceMappings

mapping 根拥有多个唯一 collection subdomain；collection 的 `[]` 承载重复条目：

```xnl
<ResourceMappings #demo.resource_workflow.mappings apiVersion="halfcode.resources/v1" version="1.0.0" (
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
