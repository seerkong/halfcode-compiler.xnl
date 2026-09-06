# 设计：单文件 Markdown authority 与完整 CodePackage manifest

## 上下文

ResourcePackage XNL 继续拥有 catalog 拓扑与 Kind source-shape allowlist；本变更只扩展 `single-file` 中单个资源文件的可接受格式。Markdown 文件自身同时拥有 identity metadata 与正文，避免为文本资源建立伴生 descriptor。

CodePackage 仍采用 Halfcode 原生显式 CodeBinding。新增 manifest fields 不替换 binding：`entry/runtime` 描述 package 执行事实，CodeBinding 描述 effect loader 绑定；loader 强制 entry 与 module 指向同一 package-local 文件，使两者不能漂移。

## 方案概览

1. `single-file` 多格式装载
   - catalog 无 `entry` 时稳定扫描 `.xnl` 与 `.md` 普通文件。
   - `.xnl` 沿用现有 parser；`.md` 只接受文件开头的闭合 YAML frontmatter。
   - frontmatter 要求 `apiVersion`、`kind`、`metadata.fqn`；可选 `metadata.version/name`；`spec` 规范化为 ResourceNode properties。
   - 文件完整 raw bytes 是 authority digest；正文不被扫描成 dependency，也不复制进 metadata。
2. CodePackage manifest
   - descriptor properties 必须有 lexical-safe `entry` 和非空 `runtime`。
   - `entry` 只允许相对 `.js/.mjs` 路径；`CodeBinding.module` 必须等于 `vfs://./${entry}`。
   - `runtime` 作为 target-neutral identifier 保留，不在 resource-core 硬编码 host capability；具体 consumer 可拒绝不支持的 runtime。
3. 公共投影与发布
   - `ResourceRecord.format` 变为 `"xnl" | "markdown"`。
   - 新依赖使用正式 `yaml` parser，不自制不完整 YAML 语法。
   - distribution 的 JS/d.ts、isolated consumer、package check 与全仓测试同步更新。

## 影响范围与修改点（Impact）

- `packages/resource-core/src/xnl-loader.ts`
- `packages/resource-core/src/index.ts`
- `packages/resource-core/src/code-package.ts`
- `packages/resource-core/src/*.test.ts`
- `packages/resource-core/package.json`
- `packages/distribution/` 与 lock/version 文件
- `docs/resource-dsl/`

## 决策摘要

- 复用既有 `single-file` source shape，不新增业务命名 source shape。
- Markdown FQN 使用中性的 `metadata.fqn`，不引入任何参考项目域名。
- CodePackage entry/runtime 是必填协议；显式 CodeBinding 继续存在且必须与 entry 一致。
- Markdown 正文留在资源文件，不进入 ResourceNode properties。

## 风险 / 权衡

- `single-file` 扫描范围扩大可能把无 frontmatter Markdown 当资源并报错；这是 catalog root 内 fail-closed 的预期行为，非资源 Markdown 不应放入该 catalog。
- entry 与 CodeBinding.module 表面重复；严格相等校验把它收敛为可观察 manifest fact + effect binding，而不是两个可漂移 authority。
- 引入 YAML parser 增加公开 capsule 依赖；distribution 已具备 `yaml` 依赖与 bundling policy，需以隔离安装验证守住。

## 迁移计划

1. 先增加 Markdown 正反例和 CodePackage 缺字段/漂移红测。
2. 实现 loader 与 contract，迁移仓内全部 CodePackage fixture。
3. 更新文档、公开类型和 distribution smoke。
4. bump patch version、pack/check、发布并从 registry 做 clean consumer 验证。

## 待解决问题

- 无；Host 专属资源布局由后继 ProjectRef Track 负责。
