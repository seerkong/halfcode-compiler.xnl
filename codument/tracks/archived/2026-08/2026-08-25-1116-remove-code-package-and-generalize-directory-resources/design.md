# 设计：结构资源止于 ResourceMaterial

## 方案概览

1. 删除 `code-package.ts`、测试、loader 分支、SourceShape 与 public surface。
2. `readResourceMaterial({ tree, rootDir, resourceId, uri })` 只接受 authentic `LoadedResourceTree` 中 `sourceShape=directory` 的资源。
3. owner boundary 从 `ResourceRecord.logicalPath` 的 manifest dirname 派生；URI 必须为 lexical-safe `vfs://./`，realpath 必须闭合于 owner directory，symlink 和非普通文件 fail closed。
4. 返回同次读取的 frozen bytes、SHA-256 digest、canonical VFS source URI 和 `ResourceDigestContribution`；Halfcode 不解释材料用途。
5. Host 可把 contribution 合并到自己的 Bundle revision，并在执行前后重读以检测漂移；该流程不是 Halfcode materializer。

## 影响范围与修改点（Impact）

- resource-core index/xnl-loader/new material module/tests
- distribution installed-consumer verifier
- resource DSL docs
- resource-loading behavior 与 resource_core modeling

## 决策摘要

- Mission 明确旧 CodePackage 不兼容。
- Halfcode 完全不拥有 BundleMaterializer 或 leaf admission。

## 风险 / 权衡

- 调用方传入 rootDir 可能与 tree 不匹配 → authentic provenance、resource boundary 与 canonical URI 联合校验。
- symlink 可绕出目录 → lexical 与 realpath 双层闭合，任何 symlink material 均拒绝。
- 自动递归摘要会把 node_modules 等无关材料纳入 → 只读取调用方显式 URI，不做依赖推断。

## 迁移计划

先补新 API 和旧协议负例，再删除专属实现及打包验证；正式版本发布由后续 Mission Track 完成。
