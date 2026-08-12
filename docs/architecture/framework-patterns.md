# Framework Patterns

This project migrates generic engineering mechanisms from its predecessor, not
domain examples or target-platform layouts.

## Migrated Mechanisms

- Bun workspace package roles.
- One-way dependency direction from contracts to authoring to Skill capsule.
- Framework packages as mechanism owners.
- FS-native resource validation before projection.
- Fact-driven contract generation with generated freshness checks.
- Deterministic standard Skill capsule output.
- Workspace verification for package shape and naming guardrails.

## Excluded Concepts

- Platform-specific application targets.
- Browser runtime protocol wording.
- Old domain package names, resource identifiers, examples, and generated output.

## Current Package Roles

```text
packages/resource-core              # resource tree validation and registry facts
packages/kind-definition            # future KindDefinition authority expansion
packages/resource-projection         # future projection input helpers
packages/compiler-skill              # standard Skill capsule output
packages/runtime-authoring           # deterministic-code runtime boundary
packages/workspace-tools             # verification and generation commands
apps/demo-resource-workflow-contracts
apps/demo-resource-workflow-authoring
apps/demo-resource-workflow-skill-capsule
```

The demo package family exists only to demonstrate generic resource workflows.

