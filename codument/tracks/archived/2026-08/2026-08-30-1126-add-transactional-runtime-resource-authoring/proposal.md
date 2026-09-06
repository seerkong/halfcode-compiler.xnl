# Track: Transactional runtime resource authoring

## Problem

Halfcode can load, validate, compose and project resources, and its runtime-authoring package exposes a generic effect bridge. It does not yet expose a typed transaction by which deterministic code can propose a new resource, prove its Kind/catalog placement, atomically write it under compare-and-swap, refresh the canonical registry and receive an auditable receipt.

Without this boundary, an autonomous consumer such as AI Data Workflow must either write files directly, mutate a registry projection, or embed product-specific resource logic. All three would break the Halfcode authority model and make runtime-created `AIAgentDefinition` resources unreviewable and unrecoverable.

## Change

- Add a generic `ResourceAuthoringProposal → ResourceAuthoringPlan → apply` protocol.
- Freeze canonical authority bytes, resource identity, Kind/apiVersion, logical target, expected authority state and plan digest.
- Inject a narrow write/CAS/rollback/refresh port; planning remains pure and performs no write.
- Make write plus canonical loader refresh a recoverable transaction and return an immutable receipt binding before/after authority and registry facts.
- Support a deliberately bounded initial source-shape surface and reject unsupported shapes before mutation.

## Non-goals

- No `AIAgentDefinition`, AI Data, Workflow, Eidolon or Capability Catalog semantics in Halfcode.
- No dynamic creation of KindDefinition or catalog entries.
- No mutation through `compositionRevision`; content CAS uses exact authority/content identity.
- No implicit global/workspace product enum or physical path in plans and receipts.
- No replacement of canonical resource loading or composition with hand-built registry records.

## Verification

Use adversarial tests for deterministic planning, unsafe targets, unknown Kind/version/catalog, concurrent create/update CAS, forged plans, refresh failure rollback, idempotent retry, multi-root authority units and isolated package consumption.
