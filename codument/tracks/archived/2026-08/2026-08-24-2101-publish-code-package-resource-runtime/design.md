# Design：CodePackage runtime 发布闭环

## 上下文

公开 registry 当前 latest 与本地 package identity 均为 0.2.3；npm 版本不可覆盖，因此包含新 CodePackage API 的最小合法发布版本是 0.2.4。当前 session 的 `npm whoami` 已确认具备发布身份，但发布必须仍由本 Track 的 pack/consumer gate 控制。

## 方案概览

1. 先把 verifier 的 candidate expectation 更新为 0.2.4，使旧 package metadata 产生预期失败。
2. 将 `packages/distribution/package.json` 和 lockfile 原子提升到 0.2.4，再执行全量 test、typecheck、workspace verify 与 `package:check`。
3. 从 `npm pack --json` 获取本地 candidate 的 integrity/shasum，确认 tarball 只含允许边界且 isolated consumer 能加载真实 CodePackage。
4. 发布精确版本 `halfcode-compiler.xnl@0.2.4`；不得使用 `--force`，不得覆盖 0.2.3。
5. 轮询 registry 的精确版本并校验 name/version/integrity/shasum 与本地 candidate 一致；把机器可读证据写入 Track reports，供 Mission G3 精确采用。

## 影响范围与修改点（Impact）

- `packages/distribution/package.json`：公开版本 authority。
- `packages/distribution/tools/verify-package.ts`：candidate 与 isolated consumer release gate。
- `bun.lock`：workspace package identity 投影。
- `reports/publication.json`：本地 candidate 与 registry 回读证据。

## 决策摘要

- 使用 0.2.4：registry 已发布 0.2.3，patch bump 是 additive CodePackage API 的最小不可变版本。
- 只发布正式 registry package；不创建 path/workspace fallback。
- 发布成功条件是 registry 精确版本的 integrity/shasum 与发布前 tarball 一致，而不只是 `npm publish` 退出码为零。

## 风险 / 权衡

- npm publish 不可逆：发布前用 exact-version absence、全量测试、pack 与隔离 consumer 四重 gate；不复用已占用版本。
- registry 可见性有短暂延迟：有限次回读精确版本；超时保持 Track ACTIVE，不改用本地依赖。
- dirty worktree 可能混入额外文件：package `files` allowlist 与 tarball inventory 验证限制发布边界。

## 兼容性设计

0.2.4 只 additive 增加 CodePackage 公共协议；既有十个 specifier 和 0.2.3 API 保持兼容。已发布版本不修改。

## 迁移计划

发布并验证后把精确版本与 integrity 回写 Mission evidence；Host 只在 G3 使用 0.2.4。若发布前 gate 失败则修复后重跑；若 publish 成功但回读不一致则停止并保留 registry 证据，不重复发布。

## 待解决问题

- 无；版本选择、registry identity 与授权状态均可由当前事实确定。
