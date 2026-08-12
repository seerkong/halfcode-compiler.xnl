# Design：多 SkillCapsule dependency distribution

## 上下文

当前 `ApplicationAssembly.skillCapsules` 只投影 metadata/template/mappings/includes；`compileResourceSkillCapsule` 找到一个 skill 后立即规划局部资源、删除 `outputDir` 并逐文件写入。现有代码已经能在删除前发现单 capsule 的 generated/mapping collision，却没有 sibling Skill 依赖图、全闭包目标空间、不可变计划或原子成组 commit。

本 track 是 Halfcode 通用资源与 compiler 能力，不拥有任何 host 的安装位置或产品阶段。调用方负责选择目标 root 以及何时安装；Halfcode 只保证给定资源事实与目标 root 下的 deterministic plan 和 atomic group apply。

## 方案概览

### 1. XNL authority 与 sibling dependency

Canonical authoring 形态：

```xnl
<SkillCapsule #example.resource_lifecycle.skill.devops apiVersion="halfcode.resources/v1" version="1.0.0" {
  description = "Generic resource lifecycle router."
} (
  <SkillMetadata { href = "vfs://./SKILL.metadata.yaml" format = "yaml" }>
  <Template { href = "vfs://./SKILL.template.ejs" format = "ejs" }>
  <SkillDependencies [
    <SkillDependency {
      ref = "resource://example.resource_lifecycle.skill.authoring"
      version = "1.0.0"
    }>
    <SkillDependency {
      ref = "resource://example.resource_lifecycle.skill.run"
      version = "1.0.0"
    }>
  ]>
)>
```

- `SkillDependencies` 只承载 sibling `SkillCapsule` 依赖；`Includes` 继续承载编入当前 capsule 的普通资源。
- dependency `ref` 必须是 `resource://`，目标必须存在于当前 `ApplicationAssembly.byFqn` 且 kind 为 `SkillCapsule`。
- dependency `version` 是精确 binding，必须等于目标 XNL root 的 metadata `version`。本阶段不解释 range。
- XNL root metadata `version` 是唯一 authority。`SKILL.metadata.yaml.version` 可以缺失；若存在必须严格等于 XNL version，否则 assembly 在编译前 fail closed。
- assembly 输出的 skill metadata 始终把 canonical XNL version 投影给模板上下文；YAML 不能覆盖它。
- `SKILL.metadata.yaml.name` 缺失时，为保持旧 consumer 兼容，planner 可以使用 Skill FQN 最后一段作为 output name；字段一旦显式存在，empty、whitespace、non-string、control 或其他 unsafe segment 必须以 `SKILL_OUTPUT_NAME_INVALID` fail closed，不能把 present-invalid 偷换成 absent 后 fallback。
- 未声明 `SkillDependencies` 的现有 capsule 得到空依赖集合，行为保持不变。历史 `Includes kind="SkillCapsule"` 不被隐式提升为 dependency，以免模糊语义。

### 2. Dependency graph 与完整闭包

Planner 接收一个或多个 root Skill FQN，从 assembly 建立有向图 `skill -> dependencies`：

1. 先校验 root、dependency ref、kind 和 exact version。
2. 计算 roots 的传递闭包；相同 FQN 只出现一次。
3. 使用稳定 DFS/Kahn 组合检测 cycle，并在 diagnostic 中输出规范化 cycle path。
4. 生成 dependency-first topological order；同一 ready set 按 FQN lexical order 排序。
5. 多 root 共享 dependency 时只编译一次，但每个 root 的 closure identity 可从同一全局 plan 投影。

所有 missing/kind/version/cycle 失败都发生在读取目标 output root 之前，更不能写入或删除它。

### 3. Complete deterministic compile plan

新增 additive public contract，名称可以在实现时按现有命名校准，但必须保留以下语义：

```ts
interface SkillCapsuleDistributionPlan {
  format: "halfcode.skill-distribution/v1"
  roots: readonly SkillCapsuleIdentity[]
  topology: readonly string[]
  capsules: readonly PlannedSkillCapsule[]
  files: readonly PlannedSkillFile[]
  closureDigest: string
}

interface PlannedSkillFile {
  skillFqn: string
  skillVersion: string
  targetRelativePath: string
  contentBase64: string
  readonly content: Uint8Array // compatibility getter; returns a defensive copy
  contentDigest: string
}
```

- plan 的目标路径统一为 `<skill-output-name>/<capsule-relative-file>`；output name 使用规范化 Skill metadata `name` 并做安全相对路径校验。
- Skill output segment、legacy reference、generated/mapping claim、`capsuleRelativePath`、`targetRelativePath` 与 apply revalidation 复用同一明确 lexical contract。它按 UTF-16 code unit、合法 surrogate pair、数值 code point 与 segment 顺序扫描，拒绝任意 unpaired high/low surrogate、C0/C1 control（含 NUL）、output segment 内 separator、percent-encoded separator/control、直接或 encoded dot segment、backslash、empty segment、POSIX/Windows absolute 与 segment leading/trailing whitespace；合法 paired surrogate/non-BMP/中文 Unicode 原样保留，不使用 regex/name/NL 模糊推断。plan file 校验失败时，稳定诊断必须保留 raw `skillFqn` owner、`capsuleRelativePath|targetRelativePath` field 名与 JSON-escaped raw target，并在任何 output parent/staging/live mutation 前返回。
- ResourceMappings lower boundary 是 raw authoring path 的第一 reader：`ReferenceTarget`、`CallableArtifacts` 与 `Copy* to` 必须在任何 `posix.normalize/join`、`safeResolve`、digest、collision projection 或写入前先消费上述 lexical contract。合法 directory marker 只允许一个末尾 `/`；非法 `a/./b`、`a//b` 或 unpaired surrogate authority 不得被静默规范化/替换为合法 target 或 U+FFFD。typed mapping diagnostic 保留 raw owner+target，compiler public boundary 统一翻译为稳定 Halfcode code。所有 accepted path 在 `posix.join` 前后必须保持逐 UTF-16 code unit identity。
- 所有文本/生成代码/registry/resource mapping copy 在 plan 阶段被读取，canonical bytes 以 immutable `contentBase64` string 保存；`content` 仅为每次读取返回新副本的 compatibility view，apply 不回读 authoring source。
- schema registry 在唯一 reader 边界递归投影为 canonical JSON value：plain object keys 使用固定 UTF-16 code-unit comparator 排序，array 保留输入顺序，scalar 稳定；nested `undefined`、non-finite number、non-plain/accessor/symbol value、sparse/extra-property array 与 cycle 均以稳定 `SKILL_SCHEMA_INVALID` fail closed。callable reference、callable registry、object registry 与 digest 只能消费该 canonical schema authority。
- files 按规范化 target path 排序，capsules 按 topology 再按 FQN 稳定排序。
- digest 使用明确版本化算法，例如 `sha256`；content digest 基于 bytes，capsule digest 基于 identity/version/dependencies/ordered file claims，closure digest 基于 roots/topology/capsule digests。
- 计划的可序列化 projection 不包含 host absolute path、时间戳、临时目录或函数对象。相同输入事实必须产生 byte-equivalent projection 与相同 digest。
- planner 在返回前完成全 closure target claim preflight：重复 output name、相同目标、文件/目录前缀覆盖、generated/resource-mapping 相互覆盖均 fail closed。generated、legacy 与 closure 使用同一个显式 owner 的 segment-prefix claim index；它在规范排序后保留所有已见 ancestor，不依赖相邻字符串，因此 `a`、`a-b`、`a/b` 也必须稳定报告原始冲突 owners/targets，不能泄漏 filesystem `EEXIST`。
- 每个 `PlannedSkillCapsule` 的结构性最小制品是非空 files 且恰有一个根级 canonical `capsuleRelativePath = "SKILL.md"`，对应 target 必须严格为 `<safe-output-name>/SKILL.md`。root 与 dependency capsules 一视同仁；该事实由 planner 建立、applier 在 content/digest 与任何 filesystem mutation 前重验。self-signed digest 只能证明 bytes 一致性，不能替代此结构约束；任意 optional references 不在此最小集合内。
- 计划与 apply 是严格分离的 component；planner 失败时不存在任何目标目录 mutation。

### 4. Atomic group apply

`applySkillCapsuleDistributionPlan(plan, { outputRoot })` 的 `outputRoot` 完全由 caller 提供。Halfcode 不推导 home、global、workspace 或 Eidolon 路径。

通用 apply 协议：

1. 在解析或创建 output root parent 之前，重新校验 plan format、每 capsule canonical `SKILL.md` 最小结构、共享 lexical path contract、relative targets、全文件 digest 与 closure digest。
2. 在 `outputRoot` 同一父目录创建唯一 staging sibling，写入完整 closure。
3. 对 staging 做 files/readback/digest 验证，未通过则删除 staging，live root 不变。
4. commit 时把既有 root 原子 rename 到唯一 backup，再把 staging rename 为 live root。
5. commit 任一步失败时把 backup 恢复为 live root，并清理未成为 live 的 staging。
6. commit 成功后清理 backup，并返回含 closure digest、installed capsules 和 files 的 receipt。

原子性单位是调用方给出的整个 output root，而不是单个文件或单 capsule。调用方若只希望管理某一组 Skill，应给该组一个独立 root；Halfcode 不决定该 policy。

### 5. 单 capsule public API 兼容

- `compileSkillCapsule(input): Promise<SkillCapsulePlan>` 保持现有签名和输出语义。
- `compileResourceSkillCapsule(input): Promise<SkillCapsulePlan>` 保持现有签名、`outputDir` 语义和 file list。
- resource 版本的 legacy wrapper 以一个 root Skill 创建 distribution plan，再把该 root 的内容原子应用到原 `outputDir`；wrapper 返回现有 `SkillCapsulePlan` shape。
- characterization tests 锁定现有输出文件、排序、错误消息关键码和“preflight 失败时旧输出保留”。
- 新 dependency/distribution API 通过 `halfcode-compiler.xnl` 根入口及 `halfcode-compiler.xnl/skill-capsule` additive 导出，不删除历史 export。

### 6. Diagnostics

实现应使用稳定 code 或稳定错误 class，至少区分：

- root Skill missing；
- dependency missing；
- dependency target kind mismatch；
- dependency exact version mismatch；
- dependency cycle；
- invalid/duplicate skill output name；
- invalid legacy reference path；
- invalid planned/generated/mapping relative target；
- invalid required capsule `SKILL.md` structure；
- closure target collision；
- generated target collision（含两个 owners 与 targets）；
- invalid/non-canonical schema JSON；
- plan digest invalid；
- stage/readback failure；
- commit/rollback failure。

诊断只表达通用 Skill/resource facts，不出现 Eidolon 专用名称或安装路径。

## TDD 与验证设计

### Characterization / RED

- 先冻结当前两条单 capsule API 的输出与失败前不写行为。
- assembly fixture 增加 A -> B -> C、共享 dependency、多 root、missing、wrong kind、version mismatch、self-cycle 和 multi-node cycle。
- planner tests 先证明无写入、stable topology、全 closure files/digests 和 collision fail-before-write。
- applier tests 使用临时 root 与可控 fault seam，在 stage、readback、backup 后、live rename 等位置注入失败，验证上一完整 root 可恢复。

### GREEN / Refactor

- 先扩展 assembly contract/reader，再实现 graph resolver 和 plan builder。
- 把当前 compiler 中“决定文件内容”与“写文件”拆开，复用单 capsule reference/callable/object/mapping 生成逻辑，避免第二 compiler。
- 最后实现 generic atomic applier 和 legacy wrapper；每一步只做足以通过前述测试的最小修改。

### 完整验证

- `bun test packages/application-assembly packages/compiler-skill packages/resource-mapping`
- `bun run typecheck`
- `bun test`
- `bun run verify`
- `bun run generate:check`
- `bun run package:check`，并在 tarball consumer 中同时导入 legacy 与新增 distribution API。
- diff/dirty-base audit：实现前后只检查本 track 声明的路径，不 reset/checkout/stash，不覆盖启动时已有未提交改动。

## 影响范围与修改点（Impact）

- `packages/application-assembly/src/index.ts`：canonical version 与 dependency projection。
- `packages/compiler-skill/src/index.ts`：graph、planner、atomic applier、legacy wrapper。
- `packages/application-assembly/src/index.test.ts`、`packages/compiler-skill/src/index.test.ts`：TDD/compatibility/fault tests。
- `packages/distribution/`：additive exports 与 tarball smoke。
- `apps/demo-resource-workflow-authoring/resources-xnl/`、test fixtures：multi-skill XNL examples 与 version authority 修正。
- `docs/resource-dsl/`：Skill dependency、version、plan/apply 和 host boundary。

## 决策摘要

- XNL SkillCapsule metadata version 是唯一 version authority；YAML 只能省略或与其相等。
- sibling Skill 使用独立的 `SkillDependencies` typed relation 和 exact version binding。
- planner 冻结完整 closure bytes；applier 不再读取 source，只原子应用 caller-provided output root。
- Halfcode 拥有通用 dependency/distribution semantics，不拥有 Eidolon path、安装 policy 或产品阶段。
- 保持单 capsule public API compatibility，新增能力走 additive exports。

详见 `decisions.xnl`。

## 风险 / 权衡

- **内存成本增加**：完整 plan 冻结 bytes 会占用内存；换取 plan/apply 时间边界和可重复 digest。后续可在不改变 plan 语义的前提下增加 content-addressed blob store。
- **rename 原子性受文件系统限制**：只允许同父目录 staging/backup；跨设备路径在 commit 前拒绝。
- **当前工作树很脏**：实现者必须把当前内容视为输入事实，逐文件 re-read 和局部 patch；禁止清理、还原或覆盖无关改动。
- **公开 API 处于 0.x**：仍采用 additive compatibility 策略，并通过 tarball consumer 锁定已有入口。
- **YAML 历史版本不一致**：先用 fixture/diagnostic 明确暴露，再迁移为省略或一致值；不得静默选择 YAML。

## 迁移计划

1. 建 characterization 与 dependency/version failure fixtures。
2. additive 扩展 assembly projection，现有 capsule 得到空 dependencies。
3. 实现完整 planner 与 digest，不接入 legacy wrapper。
4. 实现 atomic applier 与 rollback fault tests。
5. 用单 root plan/apply 重构 legacy wrapper并复跑兼容测试。
6. 更新 demo/docs/public exports/package smoke。

回滚时保留 legacy 单 capsule路径；新增 distribution exports 可以在未被 consumer 采用前撤回。任何 apply 失败必须由 runtime rollback 恢复上一完整 output root，而不是靠 git 或人工清理。

## 待解决问题

- 无阻塞待决问题。semver range、跨 package acquisition、content-addressed external blob store 均明确留到后续 track。
