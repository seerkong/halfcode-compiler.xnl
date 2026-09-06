# Track: support-direct-code-package-catalog-roots

Halfcode 0.2.6 要求 `code-package` catalog root 是 collection，其子目录各含 entry；参考布局则让 `LocalFunction/`、`PageWorkflow/`、`PageObject/` 本身直接含 manifest。Host 自扫会破坏 Halfcode authority。

新增无歧义规则：若 `<root>/<entry>` 是普通非符号链接文件，加载唯一 descriptor；若不存在，保持原有子目录扫描；若存在但不安全，fail closed。随后发布正式补丁。
