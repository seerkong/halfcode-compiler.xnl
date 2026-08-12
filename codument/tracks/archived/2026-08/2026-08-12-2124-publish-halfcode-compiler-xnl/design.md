# Design

- `packages/distribution/package.json#name` is the single package identity authority.
- Root/subpath imports use `halfcode-compiler.xnl[/subpath]` consistently.
- Generated callable bundles import `runWithRuntime` from the new authoring-runtime subpath.
- Tarball smoke imports every public entry at runtime and typechecks normalized resource-core types; it intentionally does not assert BusinessObject/PageObject API during their deferral window.
- Historical Codument XML-era records remain immutable provenance and are not rewritten.

