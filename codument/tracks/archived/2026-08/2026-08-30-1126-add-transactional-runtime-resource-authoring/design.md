# Design: Transactional runtime resource authoring

## Boundary

The protocol belongs to generic Halfcode runtime authoring. It follows `fn(runtime, input, config)` and uses explicit narrow effect ports. `currentRuntime()` may remain a convenience facade but is not the only way to invoke the transaction.

The Track initially implements the contract and orchestration in `packages/runtime-authoring`. It consumes canonical validation/loading projections from resource-core through ports. The current resource-core worktree contains separate uncommitted Markdown, semantic-root, typed-catalog and resource-material changes; this Track must re-read and integrate their committed/current authority before touching loader or identity code, and must never overwrite them from the older HEAD baseline.

## Protocol

```text
ResourceAuthoringProposal
  -> planResourceAuthoring (pure parse/Kind/catalog/target validation)
  -> immutable ResourceAuthoringPlan
  -> applyResourceAuthoring(runtime ports, plan)
       prepare CAS write
       canonical reload + compose in candidate view
       verify projected identity/origin/content
       commit write and registry publication
       return immutable ResourceAuthoringReceipt
```

The plan freezes:

- canonical authority bytes and digest;
- resource id, Kind and apiVersion;
- host-neutral logical document URI;
- source shape and whole-authority-file mutation unit;
- expected absent/old authority digest;
- expected content-sensitive registry revision when applicable;
- deterministic plan digest.

Apply revalidates every field and the digest. A caller cannot alter and re-sign a plan to bypass Kind, target or expected-state checks.

## CAS and transaction semantics

The write port performs CAS atomically; the orchestrator never implements read-then-write. Create requires `expected = absent`, update binds the old authority digest. `compositionRevision` is not a content token because it intentionally excludes descriptor content changes.

The effect boundary offers prepare/commit/rollback (or an equivalent host transaction) so a reload/verification failure restores the previous authority and leaves the live registry unchanged. Staging residue is removed or recorded as a recoverable typed fact. A successful receipt binds plan digest, target URI, resource identity, old/new authority digests, effective origin and refreshed registry/content revision.

Retry of the same accepted plan returns the same receipt or a stable already-applied result. A stale/competing plan returns a typed CAS conflict without partial registry mutation.

## Canonical refresh

Refresh must call the standard loader/composer and return an authentic loaded tree/effective registry. The transaction verifies resource id, Kind, document URI, layer origin and content identity against the write receipt. It never pushes a fabricated `ResourceRecord` into an old registry.

## Bounded source shapes

The first version supports a declared set of single-authority-file resources. If a file contains multiple root resources, the CAS unit is the complete authority document and all sibling roots are revalidated. Directory, manifest and other source shapes are either implemented with an explicit atomic unit or rejected before prepare. "Generic" means product-neutral, not silently universal.

## Product composition

Future AI Data code may author valid `AIAgentDefinition` bytes and call this protocol, then use the returned exact resource revision in a successor run/child invocation. Halfcode remains unaware of that Kind's fields and does not extend a Capability Catalog.
