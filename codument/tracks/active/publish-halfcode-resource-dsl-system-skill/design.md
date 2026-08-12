# Design

## 1. Canonical content and consumer boundary

`docs/resource-dsl/` 是 Resource DSL 规范正文的唯一 authority。新增 `manifest.xnl`、KindDefinitions、WikiPage descriptors 与 SkillCapsule descriptor 只登记 identity、metadata 和 typed material references；WikiPage `Instruction` 直接引用同一目录中的 canonical Markdown，不复制正文。

仓库维护 Skill `skills/framework-resource-dsl` 保持开发者用途。消费者 Skill `sys-halfcode-resource-dsl` 不要求仓库 checkout，不执行 bun/npm/git，不拥有 Eidolon operations；它只告诉模型按任务渐进读取编译后的 references。

## 2. Generic Skill provenance

SkillCapsule 的 source identity 来自 XNL：

```ts
interface SkillCapsuleIdentity {
  readonly fqn: string
  readonly name: string
  readonly apiVersion: string
  readonly version: string
}
```

planner 为每个 capsule 生成固定路径 `references/.halfcode/provenance.json`：

```ts
interface SkillCapsuleProvenanceManifest {
  readonly format: "halfcode.skill-provenance/v1"
  readonly generatedBy: "halfcode.skill-distribution/v1"
  readonly source: {
    readonly fqn: string
    readonly apiVersion: string
    readonly version: string
  }
  readonly payloadFiles: readonly {
    readonly path: string
    readonly contentDigest: `sha256:${string}`
  }[]
}
```

`payloadFiles` 包含该 capsule 除 provenance manifest 自身之外的所有文件，按 target path 的固定 UTF-16 code-unit 顺序排列。digest 是 planner 已从 canonical bytes 计算的 `contentDigest`。manifest 自身继续作为普通 `PlannedSkillFile` 进入 capsule/closure digest，因此不存在自引用摘要。

生成器标识使用稳定协议 `halfcode.skill-distribution/v1`，而不是在 private workspace package 中复制 public npm semver。source name/version/apiVersion 只读 XNL authority，不从 YAML 或模板硬编码。新的 descriptor 在根 properties 声明 consumer-facing `name`，YAML 只保留 title/description；若两处同时声明 name，assembly fail closed。历史 descriptor 未声明 XNL name 时，既有 YAML/FQN fallback 只作为兼容路径保留。

## 3. Validation and compatibility

planner 在 collision preflight 前将 provenance 路径作为 generated claim。apply 在任何 resolve/mkdir/staging/write 之前：

1. 确认每个 capsule 恰有一个 canonical provenance manifest；
2. 从 `contentBase64` 解码并严格解析 JSON；
3. exact 比较 format、generatedBy、source identity；
4. exact 比较完整 payload file set、顺序、path 与 digest；
5. 再执行既有 file/capsule/closure digest 验证。

任一 mismatch 以稳定 `SKILL_PLAN_PROVENANCE_INVALID` 失败，不能返回 partial receipt 或修改 live root。`SkillCapsuleIdentity.apiVersion` 是当前尚未发布的 multi-capsule API 的 additive authority 收敛；legacy `SkillDescriptor`、`SkillCapsulePlan`、single-capsule compile entrypoints 与十个 package specifiers 保持。

## 4. Resource DSL package and references

`docs/resource-dsl/manifest.xnl` 声明：

- `KindDefinition` catalog；
- top-level canonical Markdown 对应的 `WikiPage` catalog；
- `SkillCapsule` catalog。

每个 WikiPage descriptor 的 FQN 稳定且最后一段与 canonical 文件名一致，使 compiler 输出到 `references/resource-dsl/<file>.md` 后，文档之间的相对链接仍有效。`examples/` 通过 capsule-owned `ResourceMappings` 从同一个 ResourcePackage module root 复制到 `references/resource-dsl/examples/`；没有绝对路径或跨 package traversal。

Skill identity：

- FQN: `Halfcode.ResourceDsl.Skill.System`
- name: `sys-halfcode-resource-dsl`
- apiVersion: `halfcode.resources/v1`
- version: `1.0.0`

四项 identity 均由 `SkillCapsules/System/manifest.xnl` 声明；`SKILL.metadata.yaml` 不重复 name/version。compiler 把 XNL name 投影到模板 metadata 和 plan roots。

`SKILL.md` 的渐进加载顺序：先读 `references/resource-dsl/index.md`；再按任务选择 language/documents/files/projections/skill-capsules/migration；只有需要具体语法时才加载 `examples/`。它不重复正文和完整规则。

## 5. Determinism and package candidate

同一 XNL/docs bytes 与不同 resource enumeration 顺序必须产生 byte-identical provenance、capsule digest 与 closure digest。任一 canonical doc、source identity、apiVersion/version 或 payload digest 变化必须改变相关 plan digest。

本 track 会重跑真实 tarball consumer，并刷新当前未发布 `halfcode-compiler.xnl@0.2.2` candidate 的 shasum/integrity。实际 registry publication 仍属于 host mission 的单独授权步骤。

## 6. Verification

先建立失败基线，再实现：

- source apiVersion/provenance 缺失；
- provenance missing/duplicate/malformed、source mismatch、file missing/extra/reordered/digest mismatch；
- live root 在全部异常输入上 byte-identical；
- canonical docs 修改影响 reference/provenance/digest，resource enumeration 不影响输出；
- system Skill exact name/version、渐进加载、references links、无 host operations；
- packed root/`./skill-capsule` types/runtime 与 legacy APIs。

终态运行 focused/full/typecheck/generate/verify/package、全部 Resource DSL XNL、behavior XML、diff/static boundary，并使用 fresh `AttractorCheck(coding)`。
