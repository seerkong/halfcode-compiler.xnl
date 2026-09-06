# 变更：发布包含 CodePackage 协议的 Halfcode npm 包

## 背景和动机 (Context And Why)

`halfcode-compiler.xnl@0.2.3` 已存在于公开 npm registry，而新归档的 CodePackage resource shape 只存在于当前工作树。Host Mission 不允许通过 workspace link、路径依赖或复制源码消费它，因此必须生成一个不可变的新版本并从 registry 回读发布事实。

## “要做”和“不做” (Goals / Non-Goals)

**目标:**

- 将 distribution identity 从 0.2.3 提升到未占用的 0.2.4。
- 用真实 tarball、隔离 consumer、runtime/type smoke 验证 CodePackage API 与全部公开 specifiers。
- 发布 `halfcode-compiler.xnl@0.2.4`，并回读 version、integrity 与 shasum 作为后续 Host Track 的输入。

**非目标:**

- 不发布 floating tag 之外的新 channel，不覆盖任何既有版本。
- 不在 Halfcode 中引入 Host 专属 Kind、品牌、schema 或 capability/effect。
- 不让后续 Host 使用本地路径或 workspace 依赖代替正式包。

## 变更内容（What Changes）

- 更新 npm package version 与 package verifier 的 candidate identity。
- 保持十个 public specifiers，并要求隔离安装可真实加载、接纳 CodePackage export。
- 执行一次公开 npm 发布，并验证 registry 返回的 immutable dist metadata 与本地 pack identity 一致。

## 影响范围（Impact）

- 受影响的能力：`package-distribution`
- 受影响的代码：`packages/distribution/package.json`、`packages/distribution/tools/verify-package.ts`、lockfile、npm registry 中的新版本元数据
