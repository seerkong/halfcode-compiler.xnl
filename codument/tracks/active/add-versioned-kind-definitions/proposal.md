# 变更：为 KindDefinition 增加资源版本契约与迁移注册

## 背景和动机

Halfcode 资源根已经要求 `apiVersion`，但 loader 只检查字段存在，不知道某个 Kind 接受哪些版本、当前版本是什么，也没有可复用的确定性迁移路径注册。Codument 正式接入前需要把版本 authority 放在 KindDefinition，而不是由各消费方散落判断。

## 目标

- KindDefinition 显式声明 `currentApiVersion` 与 `supportedApiVersions`。
- resource-core 按所属 Kind 拒绝不支持的资源版本，并对契约自身做一致性校验。
- 公开包提供代码侧 migration registry，唯一确定迁移链；转换函数仍由具体系统拥有，不内嵌到 XNL。
- 保持 ResourcePackage 与 KindDefinition bootstrap 文档可加载。

## 非目标

- 不发布新的 npm 版本。
- 不在本 track 支持一个文档多个资源根。
- 不定义 Codument 的具体 KindDefinition。

## 影响范围

- `packages/kind-definition/`
- `packages/resource-core/`
- demo/fixture KindDefinitions
- resource DSL 文档与公开 distribution
