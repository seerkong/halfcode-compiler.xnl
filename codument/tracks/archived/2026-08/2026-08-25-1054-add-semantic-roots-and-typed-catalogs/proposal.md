# 变更：增加语义根与具名资源 Catalog

## 背景和动机 (Context And Why)

当前 loader 固定要求根节点为 `ResourcePackage`，且所有发现规则都压缩进 `<Catalog kind shape ...>`。这让应用根身份不可表达，也让 source shape、子资源 Kind 与目录枚举策略互相混淆。

## “要做”和“不做” (Goals / Non-Goals)

目标：

- 支持由 KindDefinition 验证并注册的 SkillApp 等语义根。
- 支持 FileResourceCatalog、DirectoryResourceCatalog、ManifestResourceCatalog。
- 为 DirectoryResourceCatalog 支持 root/children scope。
- 保持非 CodePackage 的旧通用 Catalog 输入兼容。
- Catalog 的期望 Kind 与资源自述 Kind 冲突时拒绝加载。

非目标：

- 本 Track 不删除 CodePackage，删除工作由后续 Track 承担。
- 不执行 Bundle 代码，不定义任何 materializer。
- 不解释 Host 的 LocalFunction/PageWorkflow/PageObject 语义。

## 变更内容（What Changes）

- **BREAKING（仅新语义根校验）**：非 ResourcePackage 根必须有匹配 KindDefinition，并满足 manifest source shape 与 apiVersion contract。
- 新增 typed Catalog parser/normalizer 和 directory scope。
- 将语义根纳入 registry/content identity；旧 ResourcePackage 根继续只作为 package manifest 暴露。
- 增加正反例与 DSL 文档。

## 影响范围（Impact）

- 受影响能力：`resource-catalogs`、`resource-loading`
- 受影响代码：resource-core XNL loader、fixtures/tests、resource DSL docs、resource_core modeling
