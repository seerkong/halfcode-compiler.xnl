# Track: Prepare Halfcode authoring-runtime distribution candidate

## Problem

`add-transactional-runtime-resource-authoring` added the generic resource authoring API after `halfcode-compiler.xnl@0.2.8` had already been published. Reusing the immutable `0.2.8` identity would make downstream manifests resolve older bytes without `ResourceAuthoringProposal`, `planResourceAuthoring`, `applyResourceAuthoring`, or receipt types.

## Change

- Prepare `halfcode-compiler.xnl@0.2.9` as an unpublished local distribution candidate.
- Extend the packed installed-consumer gate to require the public `authoring-runtime` runtime and type exports.
- Build, test, pack, and consume the exact tarball that `depa-flows` will use during the current Mission.

## Non-goals

- Do not publish to npm or change a dist-tag.
- Do not add AI, Workflow, AgentDefinition, or Capability Catalog semantics to Halfcode.
- Do not let downstream packages import a source/private workspace path.
