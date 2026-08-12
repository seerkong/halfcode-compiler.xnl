# Design: multi-root XNL resource documents

## 方案

1. KindDefinition 新增可选 `documentCardinality`，缺省 `one`。
2. loader 将“解析文档”和“构造 record”拆开；普通 catalog 在取得 KindDefinition 后按 cardinality 解释顶层节点。
3. `many` 仅允许 `single-file` catalog，所有顶层节点必须为 data element且 tag 与 catalog kind 一致。
4. 每个根节点产生独立 ResourceRecord；`documentUri`/`logicalPath` 相同，`resourceId` 各自唯一。
5. bootstrap manifest 和目录/manifest source shape 继续使用严格单根读取。

## 验证

- 两个 Decision 根成功进入同一 kind registry。
- 默认单根 Kind 仍拒绝 forest。
- forest 中混合 tag 与重复 ID 失败。
