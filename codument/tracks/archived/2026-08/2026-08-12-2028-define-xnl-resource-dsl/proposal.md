# Change: define the XNL-native resource DSL

## Context And Why

The copied compiler treats XML element/attribute shapes as both authoring syntax and an implicit runtime API. The XNL migration needs a stable, reviewable language contract before parser and consumer code can change. That contract must use `xnl-core` semantics directly and follow the established depa-flows convention that metadata, unique subdomains and repeatable collections occupy different XNL channels.

BusinessObject and PageObject are intentionally excluded from specialized schema design in this track. Their reference implementation is undergoing an API refactor and the mission schedules their convergence last.

## Goals / Non-Goals

**Goals:**

- define identity, metadata, body and extension allocation for resource documents;
- define package catalogs, KindDefinition declarations, resource descriptors and ResourceMappings;
- define canonical `vfs://` references, code export fragments and file layout;
- provide representative parseable XNL examples and explicit XML-to-XNL migration rules;
- freeze behavior and modeling contracts that downstream tracks can implement.

**Non-goals:**

- no loader, registry or assembly implementation;
- no bulk resource conversion;
- no package rename or publication change;
- no BusinessObject/PageObject specialized fields, operations, mutations or public API shape.

## Impact

- Adds the authoritative resource DSL documentation under `docs/resource-dsl/`.
- Adds behavior and modeling deltas for later archival into durable registries.
- Constrains all later mission tracks to consume XNL nodes without recreating XML attribute-prefix conventions.

