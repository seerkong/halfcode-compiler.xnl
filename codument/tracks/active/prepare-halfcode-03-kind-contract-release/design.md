# Design: prepare-halfcode-03-kind-contract-release

## 上下文

本 Track 不重新实现 0.3，而是把当前脏工作树中的大版本实现纳入可重复的 contract 和 distribution 验证。工作树已有其他历史/迁移改动；执行器只追加本 Track 的证据和必要修复，不回退不相关文件。

## 方案概览

1. Contract authority
   - `resource-core` 唯一拥有 envelope contract/fingerprint算法；
   - `kind-definition` 公开 owner、SpecRevision、reader/resolver构造；
   - authored description 只携带代码侧 contract 的精确 fingerprints。
2. Distribution candidate
   - `packages/distribution` 构建唯一公开 package；
   - `package:check` 对公开 specifiers、内部依赖泄漏、内置 DSL bytes、dry-run pack 与真实 tarball做门禁；
   - 隔离 consumer 仅安装 tarball。
3. Cross-repo handoff
   - 报告记录候选 identity/provenance与公开消费入口；
   - registry/auth只读预检显式使用 `/Users/kongweixian/.npmrc_official`；
   - publish 保持为独立授权 gate。

## Authority 与 DEPA 边界

- Data：envelope、Kind owner/revision/reader facts 由纯 contract对象承载；
- Processor：loader/resolver验证并投影，不访问 npm或业务存储；
- Effect：filesystem读取、build/pack和 registry preflight留在工具/发布适配层；
- Actor：本 Track executor只调谐实现到候选目标，不替 Holarchy/Eidolon拥有业务 Kind。

## 风险 / 权衡

- 当前工作树包含大量未提交 0.3 改动：以测试和 tarball bytes为证据，不根据 git clean状态判断完成；
- 若 package checker仅覆盖内部 fixture，需补 tarball-only external contract smoke；
- 不把本机 tarball绝对路径写入长期 authority，只在报告中记录候选身份和可重建命令。

## 迁移计划

1. 跑 core contract矩阵并修复真实偏差；
2. build/package check并生成候选；
3. 只读验证官方 registry config；
4. 将结果交给 Holarchy Track使用相同公开 API重建 owner contract。

## 待解决问题

- 无需用户决策；真实发布不在本 Track授权范围内。
