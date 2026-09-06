# Design: Halfcode authoring-runtime distribution candidate

`0.2.8` is an immutable registry identity and cannot represent the new authoring runtime. The candidate therefore uses the next patch `0.2.9`. The distribution build remains the sole public package surface and bundles the private workspace packages behind `halfcode-compiler.xnl/authoring-runtime`.

The verifier must exercise both dimensions from an isolated tarball-only consumer:

1. runtime imports expose `planResourceAuthoring`, `applyResourceAuthoring`, `deriveResourceAuthoringRegistryRevision`, and `RESOURCE_AUTHORING_SCHEMA_VERSION`;
2. TypeScript can import proposal, plan, receipt, runtime, and transaction-port types from the same public subpath.

The output is an exact local tarball plus its npm pack identity. Registry publication remains a separate explicitly authorized operation. Downstream development may install this tarball locally while keeping public package manifests on exact `0.2.9`; `file:` and `workspace:` protocols must not enter those manifests.
