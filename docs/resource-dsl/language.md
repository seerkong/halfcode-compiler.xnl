# Language Axioms

## 身份与分类

- 根 tag 是资源 kind；PascalCase 保留给 DSL 结构节点。
- 可跨容器复用的资源在 `#id` 使用点分 FQN，例如 `#demo.resource_workflow.prepare_data`。
- 文件路径只负责物理布局，不决定 kind 或 identity。移动文件不改变 `#id`。
- `apiVersion` 与 `version` 写在 metadata 位；title、lifecycle、description 等业务数据若属于该 Kind，则写入 `{}`。
- 通用资源边界只要求根 `#id` 与 `apiVersion`。`lifecycle`、`description` 的存在性和语义由具体 Kind 或 consumer contract 决定，resource-core 不提供虚假默认值。
- 每个 KindDefinition 显式声明 `currentApiVersion` 与 `supportedApiVersions`；loader 不猜测未知版本，也不自动执行迁移。具体系统通过公开 `ResourceMigrationRegistry` 注册纯转换函数，得到唯一版本链后再加载目标文档。
- XNL authority 默认单根。只有 source shape 严格为 `single-file` 的 Kind 可以通过 `documentCardinality = "many"` 授权同 Kind forest；每个顶层根仍是独立资源，`[]` 继续只表达节点内部的重复子项。
- 静态描述数据由所属节点自持，不寄存在另一域再引用回来。

## 子域与重复事实

`()` 表示父节点拥有的唯一子域概念。同一父节点的 `()` 中，同名 tag 只能出现一次。重复条目由复数子域的 `[]` 承载：

```xnl
<ResourcePackage #demo.package (
  <Catalogs [
    <Catalog #functions { kind = "Function" root = "vfs://./Functions/" entry = "manifest.xnl" }>
    <Catalog #skills { kind = "SkillCapsule" root = "vfs://./Skills/" entry = "manifest.xnl" }>
  ]>
)>
```

直接、有序或可重复的事实进入 `[]`。禁止为了凑层级增加没有领域语义的 `Nodes`、`Items` 或 `Block` 包装；复数容器必须确实代表一个唯一子域概念。

## URI 与代码引用

所有跨节点/文件引用都是引号字符串 URI：

| 目标 | canonical 形态 | 示例 |
|---|---|---|
| 当前 bundle 相对文件 | `vfs://./<path>` | `vfs://./instruction.md` |
| workspace 文件 | `vfs://@/<path>` | `vfs://@/apps/demo/src/procedures.ts` |
| TypeScript 导出 | `vfs://...#<ExportName>` | `vfs://@/apps/demo/src/procedures.ts#prepareProcedure` |
| 规范资源 identity | `resource://<FQN>` | `resource://demo.resource_workflow.prepare_data` |
| 当前容器 id | `<domain>://#<id>` | `catalog://#functions` |

代码引用必须包含 export fragment。XNL 只保存声明式 binding；函数、闭包、表达式字符串和 handler object 不得内嵌到 XNL。执行代码的协议和副作用由 runtime/component contract 定义，不属于 parser。

## Authoring 与 projection

```text
XNL authority document
  -> xnl-core node tree
  -> validated normalized resource descriptor + provenance
  -> registry / mapping / application assembly projections
```

- authority：磁盘上的 `.xnl` 文档；唯一可编辑事实。
- parser tree：语法投影，只由 resource-core loader 消费。
- normalized descriptor：稳定领域边界，携带 `resourceId`、`kind`、metadata、members、subdomains、`documentUri`、`logicalPath`；Kind-owned 可选属性保持存在或缺失的原始事实。
- consumer projection：可重建；不得暴露 parser node 内部字段，也不得反写 authority。

package provenance 从 package manifest、document URI 与 logical path 派生。descriptor 不重复保存一份可由路径计算的 package identity。

## 声明式限制

- 一个 bundle 内的配置只使用 XNL，不引入 JSON/XML/YAML 第二配置入口。
- 动态代码保存在 `.ts` 等外部文件，通过 `vfs://...#Export` 挂接。
- 不允许将 XML attributes 转换成 `@_name` 或其他前缀键后暴露给 consumer。
- 不允许根据文件名猜测 kind；文件内容的 tag 才是 authority。
