# Design: package-contained Resource DSL authoring module

## Authority pipeline

```text
canonical docs/resource-dsl ResourcePackage
  -> distribution build copies exact physical source tree
  -> package-contained dist/system-skills/resource-dsl
  -> public AuthoringModuleDescriptor loader
  -> resolveApplicationAssembly(modules=[...])
  -> planSkillCapsuleDistribution(root Skill FQNs)
```

The copied tree is a generated package artifact, not a second maintained documentation source. Build and package verification compare the canonical source tree, packaged tree and regenerated distribution projection.

## Public API

The root package additively exports:

```ts
function loadHalfcodeResourceDslSystemSkillModule(): AuthoringModuleDescriptor
```

Each call returns an immutable descriptor with the existing module identity:

- `id = "ResourceDsl"`
- `packageName = "halfcode-resource-dsl-system-skill"`
- `family = "halfcode-resource-dsl"`
- `scope = "shared"`
- `resourceRootDir` resolves to the installed package-contained ResourcePackage root.

The descriptor exposes source composition only. The existing `loadHalfcodeResourceDslSystemSkillPlan()` remains the ready-plan API and derives Skill identity from the generated plan.

## Build and verification

`tools/build-resource-dsl-system-skill.ts` performs a deterministic artifact build after `tsdown`:

1. remove and recreate the package-contained resource root;
2. copy the canonical physical ResourcePackage tree without host path policy;
3. resolve the copied module through application assembly;
4. plan `Halfcode.ResourceDsl.Skill.System` from that copied module;
5. emit the immutable plan module.

Package verification installs only the candidate tarball, loads the public module, resolves and replans it, and requires the result to match the bundled ready plan. It also verifies the exact package version, public entrypoint count and absence of workspace/file dependencies.

## Compatibility

- The ten existing export specifiers remain unchanged.
- Existing root, resource-core and skill-capsule imports remain source/type compatible.
- The system Skill remains `sys-halfcode-resource-dsl@1.0.0`; only the compiler package moves to 0.2.3.
- The descriptor is additive and host-neutral.

## Release

After focused, full, type, generate, verify and packed-consumer gates, publish `halfcode-compiler.xnl@0.2.3`. Registry readback must match name/version and expose the new function. No larger version increment is allowed.

## Risks and controls

- Packaged source drift: replan from the package-contained copy and compare the projection.
- Missing package files: fresh tarball consumer resolves the module and compiles the Skill.
- Host policy leakage: static checks reject Eidolon/global/workspace/installer concepts in the public module path.
- Partial build residue: `tsdown` clean plus deterministic build owns the entire `dist/system-skills` artifact subtree.
