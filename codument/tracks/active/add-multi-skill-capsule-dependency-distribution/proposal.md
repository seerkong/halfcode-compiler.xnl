# 变更：增加多 SkillCapsule 依赖闭包与确定性分发

## 背景和动机 (Context And Why)

Halfcode 当前可以把一个 `SkillCapsule` 编译到一个输出目录，但 `SkillCapsule` 只能通过 `Includes` 选择 Function、PromptFragment 等普通资源，不能显式声明另一个 sibling `SkillCapsule`。`compileResourceSkillCapsule` 也把计划、删除旧目录和逐文件写入放在同一个调用中，现有 collision preflight 只覆盖单个 capsule，无法向 host 提供完整、可审计、可原子消费的多 Skill 分发计划。

当前 Skill 的版本还同时存在于 XNL `SkillCapsule` metadata 和 `SKILL.metadata.yaml`。示例中二者分别为 `1.0.0` 与 `0.0.0`，已经形成双 authority。需要在扩大 Skill 资源拓扑前先收敛版本真源、依赖语法、完整闭包验证和 plan/apply 边界。

## “要做”和“不做” (Goals / Non-Goals)

**目标：**

- 以 XNL `SkillCapsule` 的 metadata `version` 作为 capsule/version binding 唯一 authority；YAML 不再拥有独立版本语义。
- 为 sibling `SkillCapsule` 增加显式、有类型、带精确版本绑定的依赖关系，并投影到 public assembly contract。
- 对 roots 的完整传递闭包执行 missing、cycle、duplicate target、version mismatch 和 topology 校验。
- 把“生成完整确定性计划”与“应用计划”分为两个公开步骤；plan 阶段不得写目标目录。
- 在任何写入前对全闭包的所有相对目标进行 collision preflight，并为 capsule 与闭包生成稳定 digest。
- 对一个 caller-provided output root 执行 staged、rollback-capable、原子成组 apply；失败不得留下部分新版本。
- 保持现有 `compileSkillCapsule`、`compileResourceSkillCapsule` 和 `SkillCapsulePlan` public surface 可继续使用。
- 通过 unit/integration tests、全仓校验和 tarball consumer smoke 证明公开 package 兼容。

**非目标：**

- 不定义 Eidolon 的 `~/.eidolon`、global/workspace root、系统 Skill 名称、安装策略或升级政策。
- 不实现 Eidolon `global init` 或任何产品专用 installer。
- 不把 Skill dependency 复用为普通 resource `Includes`；两种关系继续表达不同语义。
- 不在本 track 引入 semver range resolver、远程 package registry 或跨 ResourcePackage dependency acquisition。
- 不发布 npm 版本；发布与版本号选择由后续 release 流程拥有。
- 不改变非 SkillCapsule Kind 的 resource loading、mapping 或 application assembly 行为。

## 变更内容（What Changes）

- 扩展 `SkillCapsule` XNL/assembly projection，增加 `SkillDependencies/SkillDependency`，每条 dependency 使用 sibling `resource://<FQN>` 和精确 `version`。
- 校验 dependency 只指向同一已组装 resource universe 中的 `SkillCapsule`，并产生稳定 missing/cycle/version diagnostics。
- 新增完整 `SkillCapsuleDistributionPlan`：roots、dependency-first topology、每 capsule identity/version、冻结的文件 bytes、relative target、content digest、capsule digest 和 closure digest。
- 新增 planner API。它读取并冻结完整输出内容，排序所有 identity/path，完成 closure 与 collision preflight，但不修改 output root。
- 新增 applier API。它只消费已完成 plan，在 caller-provided root 的同父目录 staging，完成 readback/digest 校验后成组切换；commit 失败恢复上一完整 root。
- 让现有单 capsule compile API 通过单 root distribution plan/apply 兼容实现，保持调用签名、输出文件集合和错误前不破坏旧输出的行为。
- 更新 SkillCapsule fixture、KindDefinition/DSL 文档、distribution exports 和 package smoke。

## 影响范围（Impact）

- 受影响的能力（behaviors）：`skill-capsule-distribution`。
- 受影响的代码：`packages/application-assembly/`、`packages/compiler-skill/`、`packages/distribution/`、SkillCapsule XNL fixtures/examples、resource DSL 文档。
- 受影响的公开 API：对 `halfcode-compiler.xnl` 根入口和 `halfcode-compiler.xnl/skill-capsule` 增加 additive exports；已有单 capsule exports 不删除、不改签名。
- 数据/资源兼容：不声明 dependency 的现有 SkillCapsule 继续作为单节点闭包；YAML `version` 缺失合法，存在时必须与 XNL version 一致。

