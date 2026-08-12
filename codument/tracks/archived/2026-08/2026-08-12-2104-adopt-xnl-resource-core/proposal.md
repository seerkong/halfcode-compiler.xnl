# Change: adopt XNL in resource-core

## Context And Why

`packages/resource-core` currently treats `fast-xml-parser` objects as its parser model, derives identity from XML attributes and exposes the raw descriptor to consumers. The accepted resource DSL requires `xnl-core` parsing, `#id` identity, semantic `{}`/`()`/`[]` channels, VFS-aware provenance and a normalized boundary.

This track establishes that foundation without migrating consumer-specific resource decoding or the production authoring trees. A temporary legacy XML adapter remains internal so the mission can move consumers and resources in later tracks without breaking every branch at once.

## Goals / Non-Goals

**Goals:** add `xnl-core`; load XNL package/catalog/KindDefinition/resource documents; normalize every XNL root into a stable `ResourceNode`; derive canonical identity and provenance; validate catalog shapes, kind contracts, duplicate ids and containment; retain explicitly marked internal XML compatibility.

**Non-goals:** no application-assembly migration; no resource-mapping migration; no production resource conversion; no package rename; no BusinessObject/PageObject specialized interpretation.

## Impact

- `packages/resource-core` public types and loader behavior.
- XNL-native resource-core fixtures and contract tests.
- Workspace lockfile/dependency graph.
- Durable resource-loading behavior and resource-core component modeling.

