# SkillCapsule Dependencies And Distribution

## Identity authority

`SkillCapsule` descriptor 由 XNL 根节点拥有 FQN、consumer-facing `name`、resource `envelopeVersion` 与 writer `specVersion`。`SKILL.metadata.yaml` 拥有独立的 Skill SemVer 和 title/description 等呈现字段；它不重复 XNL name。若 descriptor 已声明 `name` 而 YAML 仍重复该字段，assembly 在 compiler 写入前以 `SKILL_CAPSULE_NAME_DUPLICATE` 失败。

Skill dependency binding 使用 YAML 的 Skill SemVer；它与 resource writer `specVersion` 是两个正交维度，不能互相推导。provenance 同时记录 envelope/writer revision 与 Skill version。

```xnl
<SkillCapsule #example.resource_lifecycle.skill.authoring
  envelopeVersion="halfcode.resource-envelope/v1"
  specVersion=1 {
  name = "example-resource-authoring"
  description = "Generic resource authoring operations."
} (
  <SkillMetadata { href = "vfs://./SKILL.metadata.yaml" format = "yaml" }>
  <Template { href = "vfs://./SKILL.template.ejs" format = "ejs" }>
)>
```

对应 YAML 保存 Skill-owned version 与呈现字段：

```yaml
title: Example Resource Authoring
description: Generic resource authoring operations.
version: 1.0.0
```

## `SkillDependencies` 与 `Includes`

两种关系不可互换，也不做名称或文本推断：

- `SkillDependencies/SkillDependency` 声明同一个 `ApplicationAssembly.byFqn` resource universe 中的 sibling `SkillCapsule`。`ref` 必须是 `resource://<FQN>`，目标 kind 必须是 `SkillCapsule`，`version` 是必填的精确 binding；当前版本不解释 semver range。
- `Includes/Include` 选择要编入当前 capsule 的 Function、PromptFragment 等普通资源。即便一个 Include 写了 `kind = "SkillCapsule"`，planner 也不会把它提升为 sibling dependency。

```xnl
<SkillDependencies [
  <SkillDependency {
    ref = "resource://example.resource_lifecycle.skill.resource_dsl"
    version = "1.0.0"
  }>
]>
<Includes [
  <Include {
    kind = "PromptFragment"
    ref = "resource://example.resource_lifecycle.prompt.authoring_prelude"
  }>
]>
```

缺失目标、错误 kind、重复 dependency、精确版本不匹配和 cycle 都会 fail closed。依赖解析只读取既有 application assembly，不创建第二份 catalog 或 scanner。

## 四 Skill canonical topology

规范示例使用与具体产品无关的四个 Skill：

```text
resource DSL -> authoring -> devops/root
                         run -> devops/root
```

- `devops/root` 显式依赖 `authoring` 与 `run`；
- `authoring` 显式依赖共享 `resource DSL`；
- `run` 与 `resource DSL` 没有 sibling dependency。

完整 descriptor 分别位于 [skill-capsule-devops.xnl](examples/skill-capsule-devops.xnl)、[skill-capsule-authoring.xnl](examples/skill-capsule-authoring.xnl)、[skill-capsule-run.xnl](examples/skill-capsule-run.xnl) 和 [skill-capsule-resource-dsl.xnl](examples/skill-capsule-resource-dsl.xnl)。可加载、可规划的 bundle fixture 位于 `apps/demo-resource-workflow-authoring/resources-xnl/SkillCapsules/Topology*`。consumer name 由 XNL 声明，Skill version 由 YAML 声明，dependency 精确绑定 `1.0.0`。

## Deterministic plan 与 atomic apply

`planSkillCapsuleDistribution` 与 `applySkillCapsuleDistributionPlan` 是两个独立阶段：

1. planner 从显式 roots 解析传递闭包，按固定 code-unit 顺序生成 dependency-first topology；
2. planner 读取所有 generated/mapped bytes，并将 canonical bytes 保存为不可变、可序列化的 `contentBase64` authority；兼容字段 `content` 每次读取只返回新的 defensive copy；
3. planner 对所有会进入 SKILL/reference/callable bytes 的资源集合按 FQN 使用固定 UTF-16 code-unit comparator 排序，并对完整 closure 做重复 output name、相同 target 与文件/目录 prefix collision preflight；
4. plan 保存 versioned content/capsule/closure digest，且不含绝对路径、时间戳或函数对象；plan 成功或失败都不写目标 root；
5. applier 先 fail-closed 校验非空 roots、root 可达的完整闭包、canonical base64 与全部 digest，再在 caller 提供的 `outputRoot` 同父目录 stage、readback，以 backup/rename/rollback 成组切换。

每个 planned capsule 还必须包含固定路径 `references/.halfcode/provenance.json`。该文件由 compiler 生成，不由模板维护；它记录 `halfcode.skill-provenance/v1` format、`halfcode.skill-distribution/v1` generator、SkillCapsule source 的 FQN/`envelopeVersion`/writer `specVersion`、独立 Skill version，以及除自身以外全部 payload files 的 canonical path/content digest。manifest 自身作为普通 planned file 进入 capsule/closure digest，因此不需要自引用摘要。applier 会在任何目标写入前从 plan 重建并 exact 校验这些 facts。

```ts
const plan = await planSkillCapsuleDistribution({
  assembly,
  rootSkillFqns: ["example.resource_lifecycle.skill.devops"],
})

await applySkillCapsuleDistributionPlan(plan, { outputRoot })
```

Halfcode 只拥有通用 resource dependency、plan 与 atomic apply contract；目标 root、安装位置、生命周期阶段和升级策略都由 caller/host 决定。compiler 不推导这些 policy，也不把它们写进资源 authority。

## Consumer Resource DSL Skill

`docs/resource-dsl/manifest.xnl` 将本目录的 canonical 文档登记为 ResourcePackage/WikiPage resources，并声明 `Halfcode.ResourceDsl.Skill.System`。compiler 从这些原始文档生成 `sys-halfcode-resource-dsl@1.0.0` 的 references；`SKILL.md` 只提供渐进加载顺序，不复制规范正文，也不包含仓库维护命令或 host 安装操作。仓库维护者继续使用 `skills/framework-resource-dsl`，两者职责不可互换。

既有 `compileSkillCapsule`、`compileResourceSkillCapsule` 与 `SkillCapsulePlan` 保持兼容。新 planner/applier 和类型从 package root 及 `halfcode-compiler.xnl/skill-capsule` additive 导出。
