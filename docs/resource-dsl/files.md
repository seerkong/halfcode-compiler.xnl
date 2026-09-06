# Files And Bundles

## 内容为真源

kind 与 identity 来自文件根 tag 和 `#id`。目录名、文件名和 catalog 路径只是布局；扫描器不得通过后缀或目录名补写资源语义。

## 两种定义形态

- 单文件 definition：任意描述性 `.xnl` 或 `.md` 文件名；XNL 文件内有一个语义根，Markdown 由 frontmatter 声明 Kind/FQN 并由正文承载文本内容。
- 目录 bundle：入口固定为 `manifest.xnl`，域文件使用描述性 `.xnl` 文件名。

目录 bundle 示例：

```text
Functions/
  PrepareData/
    manifest.xnl       # <Function #demo.resource_workflow.prepare_data ...>
    instruction.md     # CodeBinding/Instruction 引用的 material
```

`manifest.xnl` 的根决定 bundle kind 与 identity。独立子域可以从 manifest 的 `()` 原样外提为同型域文件；外提不改变 logical refs。

## 单文件 forest

单文件默认只有一个语义根。仅当对应 `KindDefinition` 同时声明 `sourceShapes = ["single-file"]` 与 `documentCardinality = "many"` 时，同一个 `.xnl` authority 文件才可以包含多个并列根。

forest 的每个根是独立资源，必须使用同一 Kind，具有独立 `#id`，并通过该 Kind 的版本契约。`ResourcePackage`、catalog、KindDefinition 与目录 bundle 入口始终保持单根。

## Provenance 与 logical path

loader 为每个 normalized descriptor 附加只读 provenance：

- `documentUri`：加载 authority 文档的 canonical VFS URI；
- `logicalPath`：相对 package catalog root 的逻辑路径；
- `packageId`：从 `ResourcePackage #id` 派生；
- `resourceId`：来自 descriptor 根 `#id`。

这些字段由 loader 拥有，author 不在 descriptor 中重复配置。consumer 可以记录 provenance 用于诊断，但不得修改后反写 XNL。

## 扫描边界

- 默认目录入口仅为 `manifest.xnl`。
- `DirectoryResourceCatalog scope="root"` 加载 catalog root 自身的入口；`scope="children"` 按稳定顺序扫描直接子目录入口。root 入口必须是普通非符号链接 XNL 文件。
- `FileResourceCatalog`、`DirectoryResourceCatalog`、`ManifestResourceCatalog` 的 tag 固定 source shape；冲突的 `shape` 属性不会覆盖 tag，而会 fail closed。
- `single-file` catalog 缺省扫描 root 下全部 `.xnl` 与 `.md`；声明 `entry = "name.xnl|name.md"` 时只加载该文件，便于多个不同 Kind 共用一个物理目录。
- 非入口 `.xnl` 文件只能作为显式域/物料被入口引用，不能被重复注册为第二资源。
- 多根文档必须由 KindDefinition 显式授权；loader 不根据文件名或根数量猜测 forest 语义。
- catalog root 必须是 `vfs://` URI。
- resource-core 负责 URI 解析、边界检查和重复 identity 诊断；consumer 不自行扫描磁盘。
