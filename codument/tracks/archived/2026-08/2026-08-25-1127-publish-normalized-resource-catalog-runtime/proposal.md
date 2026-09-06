# Proposal：发布规范化 Resource Catalog runtime

## Why

Host 不能采用 path/workspace fallback，也不能继续依赖已发布版本中的旧 CodePackage 协议。Halfcode 当前源码已完成语义根、具名 Catalog、通用目录 resource material 和旧协议删除，需要一个新的不可变 registry identity 作为跨仓 authority。

## What Changes

- 发布 `halfcode-compiler.xnl@0.2.8`，不覆盖 `0.2.7`。
- 发布前以全仓测试、类型检查、workspace verify、真实 tarball、安装态 runtime/type consumer 和旧 API 负例为门禁。
- 发布后精确回读 integrity/shasum，固化 `reports/publication.json`。
- 当前 package behavior 与 publication modeling 不再把 CodePackage 作为现行能力。

## Impact

- `packages/distribution/package.json`、`bun.lock`、candidate verifier。
- npm registry 的新不可变版本。
- `package-distribution` behavior 与 publication modeling。

## Out of Scope

- Host BundleMaterializer、语言 adapter 与叶子 admission；由后续 Host Track 实现。
