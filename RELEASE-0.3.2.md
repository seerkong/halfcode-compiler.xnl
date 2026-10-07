# halfcode-compiler.xnl 0.3.2

Release preparation uses the repository quick path: existing trusted KindDefinition imports are already implemented at dd2bfd0; this change stabilizes the version and canonical LF transport, retaining runtime and test assertions. Exact locked artifacts are observed through https://registry.npmjs.com with unchanged versions/SRI.

Native Ubuntu-22.04 build: generate, typecheck, 342 tests / 1557 assertions, build:package, original package verification (real tarball install, 10 public exports, runtime and declaration checks), npm pack all exit 0. Actual landed-source SHA manifest and all command/log digests are preserved at E:/workbench/hr-ontology-workbench/.verification/halfcode-landed-5bfd832c-447a-4122-9e78-9c9b6ab32bf2/.

Published via https://registry.npmjs.com; downloaded tarball bytes verified. SHA256 4e8adf019e55b1a330bc0e2ca91b44c4ecdc76819f235e72ba4ac594b11e839d. Receipt E:/workbench/hr-ontology-workbench/.verification/dependency-publication-75096c30-75f3-4931-82a6-cf38595842e9/receipt.json. Immutable Resource DSL closure digest remains sha256:bd271b519f14bae31fddd6a2feff16620635b5a2f6818913bd6b370a1971509b.

Build on native Linux; Windows-mounted package build scripts currently have a known URL pathname limitation. Dependency transport from the same frozen Bun lock is recorded; no runtime source fork or weakened package verifier is used. Consumers use exact public 0.3.2, not the former local prerelease candidate.
