# halfcode-compiler.xnl

Generic Bun workspace for compiling XNL-native resource trees and
deterministic TypeScript package bindings into standard Skill capsules.

The workspace starts with a neutral demonstration family:

```text
apps/demo-resource-workflow-contracts
apps/demo-resource-workflow-authoring
apps/demo-resource-workflow-skill-capsule
```

This repository owns target-neutral resource authoring, contract compilation,
application assembly, runtime test harnesses, and standard Skill capsule
projection. It intentionally does not contain ACE or Omni target compilers and
does not use IT-asset business material as its demonstration domain.

Application examples live under `apps/*`; reusable compiler mechanisms live
under `packages/*`. Generated `dist/` and `*.schema.generated.ts` files are
rebuildable projections, never the source authority.

## Public package

`halfcode-compiler.xnl` is the only npm package intended for public release.
The packages under `packages/*` remain private implementation workspaces and
are bundled into the public JavaScript and type declarations.

```bash
npm install halfcode-compiler.xnl
```

The root entry exposes application assembly and Skill capsule compilation:

```ts
import { resolveApplicationAssembly, compileResourceSkillCapsule } from "halfcode-compiler.xnl"
```

Lower-level APIs use explicit subpaths, for example
`halfcode-compiler.xnl/resource-core`, `halfcode-compiler.xnl/contract-schema`,
and `halfcode-compiler.xnl/authoring-runtime`.

## Commands

```bash
bun install
bun run typecheck
bun test
bun run verify
bun run generate
bun run generate:check
bun run build:demo-resource-workflow-skill
bun run build:package
bun run package:check
```
