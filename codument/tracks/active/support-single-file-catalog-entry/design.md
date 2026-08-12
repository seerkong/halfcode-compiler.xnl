# Design

## DSL

```xnl
<Catalog #modeling_config {
  kind = "ModelingConfig"
  shape = "single-file"
  root = "vfs://./config/"
  entry = "modeling.xnl"
}>
```

For `single-file`, `entry` changes discovery cardinality from "all XNL files in
the root directory" to "one named XNL document". It does not change the Kind's
`documentCardinality`; the selected document may still be a one-root document or
an authorized forest.

## Loader change

- `shape = single-file`, no entry: stable sorted directory scan, unchanged.
- `shape = single-file`, valid entry: return the one resolved file path.
- `shape = single-file`, invalid entry: emit `RESOURCE_CATALOG_ENTRY_INVALID` and return no files.
- directory/manifest: continue requiring an entry.

`isPlainEntry` remains the containment guard and the single-file branch adds a
case-insensitive `.xnl` suffix requirement.

## Verification

Use a temporary package fixture with two KindDefinitions and two files sharing a
directory. Assert precise selection, legacy scan behavior, and invalid-entry diagnostics.
