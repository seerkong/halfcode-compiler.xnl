# Proposal: expose Halfcode Resource DSL authoring module

## Why

Halfcode 0.2.2 publishes an immutable `sys-halfcode-resource-dsl` distribution plan, but downstream multi-Skill planners cannot include that capsule as a typed sibling dependency because its canonical application-assembly module and resource root are not part of the public package.

Eidolon needs to generate one four-Skill closure in which its authoring capsule depends on `Halfcode.ResourceDsl.Skill.System`. Merging already-built plans in the host would duplicate dependency/topology authority and violate the established Halfcode boundary.

## What

- Package the canonical `docs/resource-dsl` ResourcePackage beneath the distribution output.
- Expose a public loader that returns an `AuthoringModuleDescriptor` bound to that package-contained root.
- Build the existing bundled plan from the package-contained copy and verify it is equivalent to the canonical source.
- Publish the additive result as the smallest terminal patch `halfcode-compiler.xnl@0.2.3` after package gates.

## Goals

- Allow any consumer to compose the canonical Resource DSL SkillCapsule into a larger Halfcode application assembly.
- Preserve `sys-halfcode-resource-dsl@1.0.0` identity and current plan bytes.
- Keep all host installation paths, global/workspace policy and product routing outside Halfcode.
- Preserve all existing public entrypoints and APIs.

## Non-goals

- No Eidolon-specific dependency or installation API.
- No new system Skill identity.
- No plan-merging implementation in downstream hosts.
- No change to canonical Resource DSL prose or Skill semantics.

## Impact

- `packages/distribution` build, public root API, package contents and consumer smoke.
- Resource DSL Skill package tests and documentation.
- Patch publication from 0.2.2 to 0.2.3.
