# Design：revision-isolated CodePackage module source

## 方案概览

loader 继续从 authentic `LoadedResourceTree` 取得 binding 和 contribution，并通过 `readCodePackageEntry` 完成 descriptor directory、entry realpath、regular-file 与 bytes 读取。确认当前 bytes 的 SHA-256 等于 tree contribution 后，隐藏 runtime effect 在私有临时目录物化一份精确 `.mjs` 来源，以唯一短 file URL 导入，并立即清理该目录。导入完成后重新读取原 canonical entry 并再次核对 digest，最后稳定排序并冻结 namespace。

## 为什么不继续使用 data URL

data URL 会复制整个 bundle 并把长度放大约三分之一；Bun 对较长动态 import specifier 会进入错误的 package resolution 路径，真实大 bundle 已稳定复现 `NameTooLong`。Bun 同时忽略原 entry file URL 的 query cache key，因此只加 revision query 仍会返回旧 namespace。独立的短生命周期 file URL 同时解决长度和 revision 隔离，并让模块内的 Node builtin import 按运行时原生语义解析。

## Revision 与 TOCTOU

- prepare effect 接收 `contentDigest` 与精确 bytes，但临时路径、URL 和 revision 都不暴露在 diagnostics 或 XNL projection 中。
- 每次加载使用独立 runtime-owned source URL；重新加载 tree 后运行时必然评估新 namespace，不依赖 Bun 对 query 的缓存语义。
- import 前后的 bytes 验证维持现有 fail-closed 边界。若 entry 在验证后、import 前发生极窄竞态，导入后校验会拒绝返回；不会把错误 namespace 交给 caller。

## 兼容性和边界

公开 API 不变；只有 `@internal` effect contract 的 URL 观察值改变。CodeBinding 仍只允许 descriptor directory 内的单个 `.js`/`.mjs` entry。本轮不承诺任意相对 import 的内容身份闭包；现有 target-neutral export admission 不变。

## 发布

通过全仓、package candidate、isolated consumer 和严格 Codument 门禁后，将 distribution 从 0.2.4 patch bump 到 0.2.5。发布前确认精确版本未占用；发布后回读 registry integrity/shasum，并把证据写入 Track report。

## 风险与缓解

- 临时文件 URL 可含机器路径：只在隐藏 runtime effect 内使用，diagnostics、digest、binding 和公开 projection 均不得包含它；测试覆盖无路径泄漏。
- Runtime cache：每次 prepare 的独立 source URL 隔离 namespace，reload 测试覆盖同进程更新。
- 临时目录清理：导入成功或失败后都调用 dispose；清理失败显式 fail closed。
- npm publish 不可逆：发布前执行完整 candidate/isolated consumer gate，禁止覆盖既有版本。
