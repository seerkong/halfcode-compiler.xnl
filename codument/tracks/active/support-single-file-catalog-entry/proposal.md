# Proposal: support single-file catalog entry

## Motivation

`single-file` catalog currently scans every `.xnl` file below its root. A package
cannot place several different singleton Kinds in one directory without every
catalog reading every file and producing `RESOURCE_KIND_MISMATCH` diagnostics.
Codument needs four independently versioned configuration Kinds under
`codument/config/`.

## Change

- Allow an optional `entry` on a `shape = "single-file"` Catalog.
- When present, load exactly `root + entry`; when absent, preserve directory scan.
- Require `entry` to be a plain `.xnl` filename contained by the catalog root.
- Keep missing selected files observable through the existing resource-file diagnostic path.
- Document and test both selection and backward compatibility.
- Release the distribution as patch version `0.2.1`; do not bump the minor component.

## Acceptance

1. Two single-file catalogs of different Kinds may share one root directory and select distinct files without kind mismatch.
2. Unsafe or non-XNL entries fail validation.
3. A catalog without `entry` still scans all `.xnl` files.
4. Full tests, typecheck, workspace verify, and distribution package checks pass.
