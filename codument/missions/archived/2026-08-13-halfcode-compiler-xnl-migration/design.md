# Mission Design：halfcode compiler XNL migration

## 控制目标

- desired state：`mission.xml` 中的 DAG、已接受 decisions、XNL resource DSL contract、linked track 状态，以及“产品 authoring/config 只以 XNL 为真源”的最终 inventory。
- actual state：当前 workspace 的源码、47 个产品 XML、8 个 Codument 控制 XML、依赖清单、测试、生成物、skills/docs、两个 XML-era completed tracks 及后续 linked tracks。
- actuation：创建、执行、验证并归档真实 Codument tracks；必要时基于 evidence 修订后续 DAG、验收或 track slice。
- feedback / drift：XNL parse/round-trip 结果、resource/assembly/mapping diagnostics、全量测试、distribution tarball smoke、XML inventory、linked track reports 和用户新约束。

## 事实源

- host workspace 中的 resource compiler 源码、资源树、测试、skills、文档与既有 Codument records 是当前 actual-state authority。
- `xnl-core` parser、AST、formatter、tests 与 AI guide 是可实现 XNL 语法能力的事实源；文档与代码不一致时以当前代码和 tests 为准，并在 track 中记录差异。
- depa-flows Flow DSL bundle 是本项目采用 XNL 做 DSL/config 的设计习惯证据，尤其是 foundation 的 syntax、naming、DEPA axioms 以及 flow-core 的 files/refs/domains 规则。
- BusinessObject/PageObject 的参考 API 当前处于重构中；启动时观察到 descriptor 与 application-assembly 实现/测试存在未提交改动。因此它们的最终事实源必须在末段 track 创建前重新观察，不能由本次初始复制快照冻结。
- mission 不把外部 workspace path 持久化为项目 identity，也不要求在外部项目创建 track。

## 目标 XNL 风格

首个 DSL track 必须把以下原则收敛成可验证 contract：

- `Tag` 表达 kind，根 `#id` 表达稳定 FQN；`apiVersion`、`version` 等系统字段进入 metadata，普通业务属性进入 `{}`。
- `()` 只承载父节点唯一的子域概念；同类、可重复或有序条目进入 `[]`。不得用无语义 wrapper 凑层级。
- 目录 resource unit 的统一入口为 `manifest.xnl`；文件路径只负责布局，kind 与 identity 来自内容。独立 definition 可用描述性 `.xnl` 文件名。
- 单文件与多文件形态同构；能外提的唯一子域保持与内联根相同的 XNL shape。
- 引用统一使用带引号 URI。`vfs://./` 表示当前 bundle，`vfs://@/` 表示 workspace root；`resource://` 表示已登记资源 identity。不得沿用 XML 时代把 `vfs://@/` 重新解释为每层 nested manifest boundary 的隐式规则。
- 节点采用“内联定义或同类节点 `ref` 引用”的二相写法；避免 `XxxRef` wrapper 与重复 identity 字段。静态描述数据由拥有它的节点内联持有。
- 动态代码不进入 XNL；callable binding 使用可解析的 `vfs://...#Export` code ref，并保持 `output = fn(runtime, input, config)` 的 DEPA 四边界。包 provenance 与发布 module specifier 由 assembly/projection 负责，不在共享资源中重复成为第二真源。
- XNL authoring 是最终唯一真源。迁移 track 内可以短暂提供受测试保护的转换或兼容读路径，但最终 integration gate 必须移除 XML authoring、XML parser 与双写。

具体 tag、字段、catalog shape、KindDefinition contract、material binding 和 normalized TypeScript types 由 `define-xnl-resource-dsl` track 冻结；本 design 不抢先复制一份第二规范。

## Mission 与 track 的边界

mission 只负责目标图、依赖、事实观察、漂移判断、跨 track 编排与最终整体验证。代码、资源规范、parser、测试、迁移脚本、docs/skills 和 package rename 都必须落入带 `cdt:TrackLink` 的真实 track，并由各自 behavior delta / design / tests 管理。

本 mission 没有绕过 track 的直接产品实现例外。普通 mission tasks 只做 inventory、evidence synthesis、总目标验证、历史 reconciliation 与收口报告。

## 分批策略

1. 盘点 XML authority、consumer coupling、历史 decisions 与 XNL 能力，冻结迁移基线。
2. 先建立 XNL resource DSL contract，明确语法分段、文件入口、URI、code ref、KindDefinition 与 catalog 语义。
3. 改造 resource-core，使 XNL parsing、diagnostics、registry identity 和 logical path 成为底层稳定边界。
4. 在底层 contract 稳定后，并行推进通用 normalized consumers/resource mapping、非 BusinessObject/PageObject authoring tree/fixtures/docs、public distribution identity 三条分支。
5. 三条通用分支完成后，重新观察参考实现的 BusinessObject/PageObject API 重构结果，再以独立 track 迁移其 descriptors、assembly API、fixtures、tests 与 public types。
6. 用 integration track 删除临时 compatibility、消除残余产品 XML/fast-xml-parser，并跑完整 build/package/demo verification。
7. 独立做 mission 级验收、历史 track reconciliation 与最终收口。

## 受控重规划

active mission 允许基于 evidence 增删、拆并或 supersede 后续节点，但必须写 `reports/replan-XXX.md`，递增 `Metadata.Revision` 并说明 trigger、actual state、desired state、diff 与 decision。以下情况触发重规划：

- `xnl-core` 当前 AST/formatter 无法无损表达已冻结的 DSL 语义；
- code ref、material ref 或 nested bundle boundary 无法在不引入第二真源的前提下解析；
- normalized assembly 被发现仍泄漏 XML AST shape；
- BusinessObject/PageObject 末段观察时其参考 API 仍在漂移，或与早期通用 normalized boundary 不兼容；
- public package rename需要明确兼容/弃用周期，且不能由现有 evidence 保守解决；
- 某个 track 跨越多个可独立验收的 behavior，或多个 tracks 产生同一 authority owner；
- 全量验证发现输出行为漂移、未登记 URI scheme、残余产品 XML 或私有包泄漏。

`QuestionSeverity=auto` 下，执行期使用有证据的保守默认并记录 decision；只有显式 confirmation gate、权限/凭证或无法自动恢复的真实阻塞才返回人工介入。

## 风险与控制

- **机械转写风险**：以 DSL contract 与 parser tests 先行，拒绝只改后缀和闭合符。
- **AST 泄漏风险**：resource-core 输出规范 resource facts，assembly/mapping 不直接依赖 parser 私有 shape。
- **identity/path 漂移**：以内容 `#id`、URI registry 与 deterministic logical path tests 锁定，文件移动不改变业务 identity。
- **双真源风险**：final integration inventory 失败即不收口；兼容层只能临时存在且必须有删除任务。
- **发布破坏风险**：distribution rename 独立成 track，用 bundled JS/d.ts scan、pack 与临时消费者 smoke 验证。
- **移动 API 风险**：BusinessObject/PageObject 只在最后一批实施；此前 tracks 禁止冻结其专有 descriptor/API，末段必须重新取证并按稳定边界迁移。
- **历史冲突风险**：XML-era tracks 不被改写；XNL mission decisions 记录 supersession rationale，归档时保留 provenance。
- **范围蔓延风险**：非 XML 的 contract/schema/material 格式只有在证据证明其是 resource DSL/config 的第二 authority 时才纳入 replan。
