---
name: app-develop
description: Develop halfcode-compiler.xnl application package families with XNL-native authoring resources, typed contracts, deterministic TypeScript bindings, multi-module assembly, and generated Skill capsules.
---

# Application Development

Work from the Bun workspace root. Do not add npm, pnpm, or yarn workflow instructions.

## Respect package authority

- `*-contracts`: own TypeScript input/output contracts and generated JSON Schema.
- `*-authoring`: own XNL resource facts and deterministic target-neutral bindings.
- `*-shared-authoring`: own reusable XNL facts and optional typed assembly ports; never import a domain implementation.
- `*-skill-capsule`: own projection wiring and rebuildable `dist/` output.
- `packages/*`: own reusable compiler mechanisms.

Call framework APIs instead of reimplementing XNL parsing, schema generation, assembly, resource mapping, or projection.

## Define contracts first

Use one `contract.json` discovery fact per callable folder:

```text
apps/demo-resource-workflow-contracts/src/
  Function/PrepareProcedure/
    contract.json
    input.ts
    output.ts
    input.schema.generated.ts
    output.schema.generated.ts
    index.ts
```

Put shared types under `src/Shared/`. Never hand-edit generated schema or indexes. Run:

```bash
bun run generate
bun run generate:check
```

Reference contracts from XNL with `resource://...`; do not redefine TypeScript types in resource documents.

## Author generic resources in XNL

Use this XNL-only layout:

```text
apps/demo-resource-workflow-authoring/resources-xnl/
  manifest.xnl
  KindDefinitions/
    Function/manifest.xnl
    ComposedFunction/manifest.xnl
    ApplicationSOP/manifest.xnl
    PromptFragment/manifest.xnl
    WikiPage/manifest.xnl
    SkillCapsule/manifest.xnl
  Functions/PrepareProcedure/
    manifest.xnl
    instruction.md
  ComposedFunctions/PrepareWorkflow/
  ApplicationSOPs/ReservationApproval/
  PromptFragments/SkillPrelude/
  Wiki/ReservationLifecycle/
  SkillCapsules/Main/
    manifest.xnl
    SKILL.metadata.yaml
    SKILL.template.ejs
    resource-mappings.xnl
```

Directories are storage until a root `Catalog` admits them and a `KindDefinition` permits their source shape. Follow `framework-resource-dsl` for channel and VFS rules.

`resources-xnl/manifest.xnl` is the only authoring authority. Do not create XML descriptors or a parallel compatibility tree.

## Bind deterministic code

Keep implementations in the authoring package and bind them semantically:

```xnl
<Function #Demo.ResourceWorkflow.Function.PrepareProcedure apiVersion="halfcode.resources/v1" {
  lifecycle = "Active"
  description = "Prepare a procedure."
} (
  <InputContract { ref = "resource://Demo.Contract.Prepare.Input" }>
  <OutputContract { ref = "resource://Demo.Contract.Prepare.Output" }>
  <CodeBinding {
    package = "demo-resource-workflow-authoring"
    module = "./src/Functions/PrepareProcedure"
    export = "prepareProcedure"
  }>
)>
```

Keep bindings target-neutral. Generic callables use `(runtime, input, config)`. BusinessObject and PageObject operations use `(runtime, targets, invocation, config)`; action payload belongs in `invocation.input`, mutation desired state belongs in `invocation.desired`.

## Compose modules and ports

Export an `AuthoringModuleDescriptor` with PascalCase id, package provenance, family, scope, and XNL resource root. Resolve modules at the capsule root:

```ts
const assembly = await resolveApplicationAssembly({
  modules: [sharedAuthoringModule, domainAuthoringModule],
  portBindings: [{
    portFqn: "Demo.ResourceWorkflow.Shared.Port.PrepareProcedure",
    resourceRef: "resource://Demo.ResourceWorkflow.Function.PrepareProcedure",
  }],
})
```

Assembly validates module/FQN uniqueness, required ports, resource kinds, and contract compatibility. Projection code consumes normalized assembly facts, never raw `xnl-core` AST nodes.

## Project a SkillCapsule

Let `manifest.xnl` name metadata, template, XNL mappings, and includes. Keep generated target locations and extra material copies in `resource-mappings.xnl`; preflight all copies and generated targets before replacing `dist/`.

Build through `compileResourceSkillCapsule`. Preserve the single callable ABI:

```js
initialize_callable_runtime(runtime)
const output = await run_callable_resource(resourceFqn, input, config)
```

Do not add kind-specific runner APIs or expose host runtime as an AI-facing call argument. Missing schema, include, or binding is a compile error.

## Author object-operation owners

BusinessObject and PageObject XNL owners publish target kinds and shared operation definitions. BusinessObject operations bind private BusinessAction/BusinessMutation resources; PageObject operations bind private exports from the owner's module. The generated public registry exposes definitions only, never module, export, or resource binding facts.

## Verify

Run:

```bash
bun run generate:check
bun run typecheck
bun test
bun run build:demo-resource-workflow-skill
bun run verify
```

Load both `resources-xnl/` roots and verify generic resources, object-operation projection, ResourceMappings planning, generated bundles, and real action/mutation execution.
