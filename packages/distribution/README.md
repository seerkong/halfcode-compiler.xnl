# halfcode-compiler.xnl

The single public npm package for compiling XNL-described applications into runtime-ready skill capsules.

```sh
npm install halfcode-compiler.xnl
```

Use the package root for the high-level application assembly and skill capsule APIs:

```ts
import {
  resolveApplicationAssembly,
  compileResourceSkillCapsule,
  type PageObjectResource,
} from "halfcode-compiler.xnl"
```

Multi-capsule distribution is an additive plan/apply surface. Planning resolves exact sibling dependencies, captures every output as canonical immutable `contentBase64`, preflights the complete closure, and does not mutate the target. `PlannedSkillFile.content` remains a compatibility byte view, but every read returns a defensive copy; projection, validation, and apply use the canonical string authority. Applying rejects empty or disconnected closures before any live mutation and consumes only that plan plus a caller-selected output root:

```ts
import {
  applySkillCapsuleDistributionPlan,
  planSkillCapsuleDistribution,
  type SkillCapsuleDependency,
  type SkillCapsuleDistributionPlan,
} from "halfcode-compiler.xnl"

const plan: SkillCapsuleDistributionPlan = await planSkillCapsuleDistribution({
  assembly,
  rootSkillFqns: ["example.resource_lifecycle.skill.devops"],
})

await applySkillCapsuleDistributionPlan(plan, { outputRoot })
```

Each capsule source identity includes the resource `envelopeVersion` and exact writer `specVersion`. Skill SemVer remains a separate Skill-owned business field. The planner generates exactly one `references/.halfcode/provenance.json` per capsule with those source facts, the Skill version, the `halfcode.skill-distribution/v1` generator and every payload file digest. The applier reconstructs and validates this manifest before any target mutation.

The legacy `compileSkillCapsule` and `compileResourceSkillCapsule` APIs remain available from both the package root and `halfcode-compiler.xnl/skill-capsule`. The subpath also exports the new plan/apply APIs and `SkillCapsuleDependency` type.

The package root also exposes the canonical Resource DSL system Skill in two forms. Use the module descriptor when composing it as a typed sibling dependency in a larger application assembly; use the immutable bundled plan when installing it directly:

```ts
import {
  loadHalfcodeResourceDslSystemSkillModule,
  loadHalfcodeResourceDslSystemSkillPlan,
} from "halfcode-compiler.xnl"

const resourceDslModule = loadHalfcodeResourceDslSystemSkillModule()
const readyToInstall = await loadHalfcodeResourceDslSystemSkillPlan()
```

The module's resource root is contained in the installed npm package. Both forms are generated from that same packaged ResourcePackage during build, while `sys-halfcode-resource-dsl` keeps its independent `1.0.0` Skill version.

Lower-level APIs are available through explicit subpaths such as `halfcode-compiler.xnl/resource-core` and `halfcode-compiler.xnl/authoring-runtime`.

The resource-core subpath preserves the single-package loader and adds deterministic, read-only composition APIs:

```ts
import {
  loadResourceTree,
  composeLayeredResourceRegistry,
  resolveEffectiveResourceContentIdentities,
  buildResourceDependencySnapshot,
} from "halfcode-compiler.xnl/resource-core"
```

`loadResourceTree()` returns an `AuthoredResourceTree`; its content identities come from the same raw-byte read used for fatal UTF-8 decoding and XNL/Markdown parsing. Markdown records preserve every body code unit after the closing frontmatter delimiter and exactly one separator newline as `node.text`/`authoredSpec.text`. `resolveResourceTree()` admits the authored tree against an exact reader profile and publishes a distinct `ResolvedResourceTree` with ordinary receipts for the package manifest, KindDefinition authorities and business resources.

Layer order, tombstones, dependency edges, and digest contributions are explicit caller-owned facts. Resource core does not assign semantics to layer names, infer dependencies from arbitrary strings, or own host installation paths. Content-sensitive projection requires authentic `AuthoredResourceTree` inputs from the canonical loader.

The immutable `RESOURCE_ENVELOPE_CONTRACT` and derived `RESOURCE_ENVELOPE_FINGERPRINT` are the sole public authority for envelope v1 decoding, authority formats, identity projection, Catalog traversal and authored-spec projection. `CORE_KIND_SUBJECT_OWNERS`, `CORE_KIND_SPEC_REVISIONS` and `CORE_KIND_READER_REGISTRATIONS` provide the compiler-owned exact ResourcePackage and KindDefinition bootstrap registrations; hosts admit them verbatim rather than recreating their fingerprints or readers.

`EffectiveResourceRegistry.compositionRevision` binds ordered identity/presence/layer/shadow/tombstone, selected KindDefinition authority identity/contract, and canonical logical-origin facts, but deliberately excludes descriptor/node/metadata bytes; its `revision` field remains an exact compatibility alias. Snapshot construction accepts only the immutable registry returned by the canonical composer, copies/freeze its own origin facts, and rejects inconsistent structural projections. `ResourceDependencySnapshot.registryRevision` additionally binds the revalidated content digests of every effective resource, while `snapshotRevision` binds the selected roots, reachable closure, and participating typed edges. Duplicate contribution keys fail closed, and all canonical ordering uses fixed UTF-16 code-unit order rather than locale-dependent sorting.
