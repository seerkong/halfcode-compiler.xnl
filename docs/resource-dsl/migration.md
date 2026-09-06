# XML To XNL Migration

## 迁移原则

迁移单位是“资源语义”，不是 tag/attribute 的逐字符替换：

| XML-era 表达 | XNL authority |
|---|---|
| 根 element 名 | 根 tag（resource kind） |
| `Id`/`Name` 等身份 attribute | 根 `#id` FQN；display name 若存在则留在 `{}` |
| `Version`/schema version | 固定 `envelopeVersion` + Kind-owned 正整数 writer `specVersion`；业务 SemVer 留在所属 Kind 字段 |
| 普通 attributes | `{}` 中归节点所有的属性 |
| 唯一 child section | `()` 中的唯一子域 |
| 重复 child elements | 父 `[]` 或复数子域的 `[]` |
| 文件路径/code export | 引号字符串 `vfs://...#Export` |
| parser `@_foo`/XmlObject | 不迁移；在 normalized descriptor 边界消失 |

## 顺序

1. 用 `KindDefinition` 明确 kind contract。
   - 声明 `subjectFqn`、source/cardinality/required-file contract 与 exact `SpecRevisions` fingerprints。
   - reader resolution 只负责把 immutable authored writer spec 投影到显式 reader revision；需要改变 authority 时，单独执行可审计的 source-migration 操作。XNL 不内嵌 transformer。
2. 将 package/catalog authority 改为 XNL。
3. 逐个资源按领域语义分配 `{}`、`()`、`[]`，保留稳定 `#id`。
4. 将路径与代码引用规范为 VFS URI。
5. 通过 resource-core 得到 normalized descriptor，再迁移 consumer。
   - loader 产出 `AuthoredResourceTree`；Host 通过 exact reader profile 产出带普通 receipts 的 `ResolvedResourceTree`。
6. 删除兼容 XML 与 `fast-xml-parser`，以产品 XML inventory 清零作为关闭条件。

## 明确拒绝

- 在 TypeScript 中保留 `XmlObject`、`@_` 属性前缀或 XML child-array 作为公开类型。
- 同一资源同时维护 XML 与 XNL 两份长期 authority。
- 根据目录名/文件名猜 kind 或 identity。
- 在 XNL 内嵌函数、闭包或可执行表达式字符串。
- 用无语义的 wrapper 模拟 XML 层级。
- 把 reader/package 版本当成 writer `specVersion`，或让 `backward` reader 接受比自身更新的 writer。
- 在同一字段中混用 resource envelope、Kind spec revision 与业务 SemVer。
- 在 BusinessObject/PageObject API 尚未稳定时提前设计二者的专用 XNL schema。

## 暂时兼容

后续实现 track 可以在内部短期 dual-read，用于小步迁移和 characterization test；兼容层不得进入 public API，并必须在 `close-xnl-only-product-surface` track 删除。
