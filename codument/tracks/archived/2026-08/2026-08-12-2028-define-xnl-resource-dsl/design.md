# Design: XNL-native resource language contract

## Language allocation

Every standalone resource document has one semantic root with a globally meaningful `#id`. XNL channels have fixed roles:

- root tag: resource kind (`ResourcePackage`, `KindDefinition`, `Function`, `ResourceMappings`, and similar kinds);
- `#id`: canonical resource identity, never a display label;
- `{}`: unordered scalar/list metadata used for selection, validation and lifecycle;
- `[]`: ordered or repeatable body members;
- `()`: unique named subdomains such as `Catalogs`, `DescriptorContract`, `Includes` and mapping sections;
- text elements: prose, source snippets or schema text that must remain unescaped.

This keeps syntax semantic instead of mechanically translating XML attributes to prefixed object keys.

## Document families

### Resource package

`ResourcePackage` owns package metadata and one unique `Catalogs` subdomain. Catalog entries identify logical roots and their manifest filename. Package provenance is derived from the package document and logical path, not copied into each descriptor as mutable author metadata.

### Kind definition

`KindDefinition` declares a kind's accepted source shapes and one `DescriptorContract`. Generic contracts cover identity, lifecycle, instruction/code binding, includes and other cross-kind conventions. BusinessObject and PageObject specialized contracts remain unresolved until the mission's final API-convergence group.

### Resource descriptor

The root tag is the declared kind, `#id` is the fully qualified resource id, `{}` carries lifecycle and kind-neutral metadata, `[]` carries repeatable members, and `()` carries unique subdomains. Relative material references use `vfs://./`; workspace references use `vfs://@/`; code references append an export fragment such as `#prepareProcedure`.

### Resource mappings

`ResourceMappings` contains unique collection subdomains for reference targets, callable artifacts and source roots. Each collection uses `[]` for repeatable entries. Mapping keys are explicit properties; XNL element names are not dynamically synthesized from keys.

## Normalized boundary

The authoring syntax is an input contract, not the shape consumed by application assembly. The later core track will normalize XNL nodes into explicit domain records while retaining provenance (`documentUri`, `logicalPath`, `resourceId`). Consumers must not depend on parser-private node fields or XML-style attribute prefixes.

## Compatibility and sequencing

The migration is intentionally breaking at the product-authoring boundary. Temporary dual-read compatibility may exist only inside later implementation tracks and must be removed by mission closure. BusinessObject and PageObject remain XML-era authority until the late track re-observes the reference API and defines their final XNL form.

## Verification strategy

- Parse all fenced XNL examples with the current `xnl-core` parser.
- Assert the examples exercise identity, properties, repeatable body, unique extensions, VFS URI and code fragment conventions.
- Search the contract for prohibited specialization of BusinessObject/PageObject.
- Validate Codument behavior/modeling deltas and track structure.

