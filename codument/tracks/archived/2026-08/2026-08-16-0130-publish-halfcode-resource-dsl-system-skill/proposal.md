# 变更：发布 Halfcode Resource DSL consumer system Skill

## 背景和动机 (Context And Why)

Halfcode 已有 canonical `docs/resource-dsl/`、ResourcePackage loader 与多 SkillCapsule distribution plan，但当前 `skills/framework-resource-dsl` 是仓库维护者 Skill：它要求读取仓库、执行开发命令，不能作为 Eidolon 等消费者安装的系统 Skill。与此同时，distribution plan 已记录 Skill FQN、version 与 file digest，却没有把 XNL `apiVersion` 和明确的生成协议投影成安装后可读取的 provenance。

本 track 将 canonical Resource DSL 文档注册为 Halfcode ResourcePackage 内的 WikiPage resources，生成版本为 `1.0.0` 的 `sys-halfcode-resource-dsl` SkillCapsule，并为所有 SkillCapsule 生成通用、可校验的 provenance manifest。规范正文只来自 canonical docs，不手工维护副本；本 track 的 “publish” 是生成可分发 capsule/plan，不执行 npm registry 或 Eidolon global installation。

## “要做”和“不做” (Goals / Non-Goals)

**目标：**

- 让 SkillCapsule XNL `apiVersion` 与 `version` 一起进入 public identity/provenance projection。
- 为每个 compiled capsule 生成 canonical `references/.halfcode/provenance.json`，记录 source Skill FQN、apiVersion、version、generated-by protocol 与全部 payload file content digests。
- apply 在任何目标写入前重新校验 provenance 与 plan file/digest facts。
- 把 `docs/resource-dsl/` 建模为 canonical ResourcePackage/WikiPage resources，并从原文件生成 references。
- 生成 `sys-halfcode-resource-dsl@1.0.0`，其 `SKILL.md` 只负责渐进加载与规则导航，不包含仓库维护命令或 host-specific operations。
- 保持现有十个 package exports、legacy single-capsule API 与 0.2.2 candidate identity，刷新本地 candidate evidence。

**非目标：**

- 不复制 Resource DSL 正文，不把 `skills/framework-resource-dsl` 直接安装给消费者。
- 不实现 Eidolon global/workspace roots、global init、TUI/CLI 或 authoring/run operations。
- 不在 Skill 中推断领域 resource kind、tool、approval 或 workflow 行为。
- 不执行 npm publish，不修改 registry，不安装到用户目录。
- 不新增第二个 resource scanner、catalog、Skill dependency resolver 或 installer。

## 影响范围（Impact）

- `packages/application-assembly/`：additive SkillCapsule apiVersion projection。
- `packages/compiler-skill/`：通用 provenance manifest planning、digest binding 与 apply-side validation。
- `docs/resource-dsl/`：canonical ResourcePackage descriptors 与 consumer SkillCapsule；Markdown/XNL 正文继续是唯一规范内容。
- `packages/distribution/`：packed public type/runtime smoke 与刷新后的 0.2.2 candidate evidence。
- 不修改 Eidolon 或 depa-flows 源码。
