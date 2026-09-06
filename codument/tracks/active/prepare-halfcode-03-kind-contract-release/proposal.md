# 变更：准备 Halfcode 0.3 exact Kind contract 发布候选

## 背景和动机 (Context And Why)

Halfcode 工作树已经形成 0.3 resource envelope、versioned Kind contracts 与 distribution candidate，但 npm 仍是 0.2.9，Holarchy/Eidolon 也尚未有可审计的上游候选。需要先把现有实现当作待验证状态，建立真实 tarball-only consumer 与跨仓交接证据。

## “要做”和“不做” (Goals / Non-Goals)

目标：

- 冻结 0.3 公开 envelope/Kind contract identity 与 fail-closed 行为；
- 验证 build、核心测试、package check、tarball边界和隔离 consumer；
- 记录候选 provenance、消费入口与发布顺序；
- 用官方 npm userconfig 做只读 preflight。

非目标：

- 不执行 `npm publish` 或 dist-tag mutation；
- 不在 Halfcode 中实现 Holon/Eidolon 业务 Kind；
- 不为 legacy consumer 增加隐式 envelope 猜测。

## 变更内容（What Changes）

- 以现有 0.3 implementation 为 characterization 基线，补齐缺失的 release evidence/ratchet；
- 确认 `halfcode-compiler.xnl@0.3.0` 是唯一公开包 identity；
- 生成下游可消费的候选 tarball 和自包含报告。

## 影响范围（Impact）

- 能力：`resource-loading`、`package-distribution`；
- 代码：`packages/resource-core`、`packages/kind-definition`、`packages/distribution` 及其测试/文档；
- 下游：Holarchy snapshot contract 与 Eidolon resource runtime。
