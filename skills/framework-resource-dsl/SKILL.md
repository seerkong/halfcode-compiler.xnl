---
name: framework-resource-dsl
description: Author, validate, and migrate XNL-native resource packages for halfcode-compiler.xnl. Use for manifest.xnl catalogs, KindDefinitions, generic resource descriptors, VFS materials, SkillCapsules, or resource-mappings.xnl.
---

# Framework Resource DSL

Use semantic XNL as the authoring authority. Treat generated projections as rebuildable output.

Read `docs/resource-dsl/` before changing the grammar. Keep parser-private `xnl-core` nodes behind `halfcode-compiler-resource-core`; downstream packages consume normalized `ResourceNode` and assembly facts.

## Discover resources explicitly

Start each package at `manifest.xnl`. Admit resources only through `Catalog` entries and a matching `KindDefinition`:

```xnl
<ResourcePackage #Demo.ResourceWorkflow.Authoring apiVersion="halfcode.resources/v1" version="1.0.0" {
  lifecycle = "Active"
  description = "Demo authoring package."
} (
  <Catalogs [
    <Catalog #KindDefinitions {
      kind = "KindDefinition"
      shape = "directory"
      root = "vfs://./KindDefinitions/"
      entry = "manifest.xnl"
    }>
    <Catalog #Functions {
      kind = "Function"
      shape = "directory"
      root = "vfs://./Functions/"
      entry = "manifest.xnl"
    }>
  ]>
)>
```

Use semantic channels consistently:

- root tag: resource kind;
- `#id`: global resource identity/FQN;
- metadata channel: `apiVersion`, `version`;
- property channel: Kind-owned lifecycle, description, and scalar configuration when applicable;
- unique extension subdomains: contracts, binding, materials, catalogs;
- body members: repeated catalogs, includes, refs, files, and operations.

Do not encode XML artifacts such as attribute prefixes, wrapper objects, or repeated-tag ambiguity into XNL.

## Define each kind

Store one `manifest.xnl` per PascalCase kind directory:

```xnl
<KindDefinition #Demo.ResourceWorkflow.KindDefinition.Function apiVersion="halfcode.resources/v1" version="1.0.0" {
  lifecycle = "Stable"
  description = "Kind definition for Function resources."
  resourceKind = "Function"
  sourceShapes = ["directory"]
} (
  <DescriptorContract (
    <RequiredFiles [
      <File { name = "instruction.md" }>
    ]>
  )>
)>
```

The loader universally enforces non-empty identity, `apiVersion`, catalog shape, kind match, required files, unique identity, and VFS containment. `lifecycle` and `description` are optional Kind-owned properties; require them only in the specific Kind or consumer contract that owns their semantics.

## Author generic descriptors

Use directory-shaped resources with a local `manifest.xnl`:

```xnl
<Function #Demo.ResourceWorkflow.Function.PrepareProcedure apiVersion="halfcode.resources/v1" version="1.0.0" {
  lifecycle = "Active"
  description = "Prepare a procedure draft from structured input."
} (
  <InputContract { ref = "resource://Demo.Contract.Prepare.Input" }>
  <OutputContract { ref = "resource://Demo.Contract.Prepare.Output" }>
  <Instruction { href = "vfs://./instruction.md" format = "markdown" }>
  <CodeBinding {
    package = "demo-resource-workflow-authoring"
    module = "./src/Functions/PrepareProcedure"
    export = "prepareProcedure"
  }>
)>
```

Use the same `Instruction` channel for text resources such as `ApplicationSOP`, `PromptFragment`, and `WikiPage`.

## Author SkillCapsules and mappings

Keep unique materials as subdomains and repeated includes in an `Includes` body:

```xnl
<SkillCapsule #Demo.ResourceWorkflow.Skill.Main apiVersion="halfcode.resources/v1" version="1.0.0" {
  lifecycle = "Active"
  description = "Main demo Skill capsule."
} (
  <SkillMetadata { href = "vfs://./SKILL.metadata.yaml" format = "yaml" }>
  <Template { href = "vfs://./SKILL.template.ejs" format = "ejs" }>
  <ResourceMappings { href = "vfs://./resource-mappings.xnl" format = "xnl" }>
  <Includes [
    <Include { kind = "Function" ref = "resource://Demo.ResourceWorkflow.Function.PrepareProcedure" }>
  ]>
)>
```

Use XNL for copy planning:

```xnl
<ResourceMappings #Demo.ResourceWorkflow.ResourceMappings.Main (
  <ReferenceTargets [
    <ReferenceTarget { kind = "Function" target = "references/Functions/" }>
  ]>
  <CallableArtifacts { target = "functions/" }>
  <SourceRoots [
    <SourceRoot #SharedMaterials { sourceRoot = "vfs://module/SharedAuthoring/" } [
      <CopyFile { from = "Static/SharedNotes.md" to = "references/Shared/SharedNotes.md" }>
    ]>
  ]>
)>
```

Use PascalCase `SourceRoot` IDs. Keep `from` and `to` relative, forward-slash paths without `..`. Planning must reject containment escapes, symlinks, duplicate targets, and overlaps before writing.

## Resolve VFS references

- Use `vfs://./` relative to the document directory for descriptor-owned materials and catalogs.
- Use `vfs://@/` relative to the package root only when package ownership is intended.
- End catalog roots with `/`.
- Reject absolute paths, `..`, encoded separators, and paths outside the package boundary.
- Use `vfs://module/<PascalCaseModuleId>/...` only in ResourceMappings source roots.

## Model object-operation owners

BusinessObject and PageObject use the shared operation definition vocabulary and `(runtime, targets, invocation, config)` handler boundary. Put target cardinality and operation identity on the owner. BusinessObject implementations bind through private BusinessAction/BusinessMutation resources; PageObject implementations bind through private module exports. Public projections must not expose either binding form.

## Validate

Run from the workspace root:

```bash
bun test packages/resource-core packages/application-assembly packages/resource-mapping
bun run typecheck
bun run verify
```

Load packages from `apps/*/resources-xnl/`. Confirm every discovered record reports `format: "xnl"`; product trees and runtime dependencies must contain no XML compatibility path.
