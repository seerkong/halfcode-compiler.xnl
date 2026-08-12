# Design: XNL resource-core foundation

## Parser boundary

`xnl-core` is the only parser for `.xnl` inputs. resource-core accepts its node tree at one adapter boundary and immediately projects it into immutable `ResourceNode` records with explicit `tag`, `resourceId`, `metadata`, `properties`, `body`, `subdomains` and optional `text`. Consumers do not import `xnl-core` node types.

## Loading model

- `manifest.xnl` is the canonical default; during migration, missing XNL authority falls back to `Manifest.xml` through an internal legacy adapter.
- `ResourcePackage`/manifest roots own a unique `Catalogs` subdomain.
- `Catalog.shape` is `single-file`, `directory` or `manifest`; `entry` is required for directory/manifest shapes.
- KindDefinition catalogs load first. Resource kind identity derives from `resourceKind` or the definition `#id` name.
- `vfs://./` resolves from the current manifest directory; `vfs://@/` resolves from the root package boundary. Both are containment checked.
- registry identity is the descriptor root `#id`; duplicates fail before a tree is returned.

## Compatibility boundary

Legacy XML loading is isolated and marked `format="xml-legacy"`. It preserves `legacyDescriptor` only for consumers not yet migrated; all records also receive a normalized `node`, `resourceId`, `documentUri` and `logicalPath`. The closure track removes this adapter and `fast-xml-parser` after consumers and authoring are XNL-native.

BusinessObject/PageObject remain opaque generic resource kinds here. Their specialized structure is not decoded or surfaced.

## Verification

Tests start from XNL fixtures and cover parse/registry success, normalized channels, nested manifest discovery, unsafe references, duplicate identity, malformed XNL and missing kind definitions. Existing XML characterization tests remain green through the compatibility adapter. Typecheck and repository tests guard downstream compatibility.

