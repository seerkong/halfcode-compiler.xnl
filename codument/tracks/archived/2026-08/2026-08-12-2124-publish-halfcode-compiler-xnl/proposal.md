# Change: publish halfcode-compiler.xnl

## Context And Why

The distribution package still advertises the XML product identity even though XNL is now the target authoring language and resource-core foundation. Rename the sole public package and every generated/imported specifier while preserving the existing export topology.

## Goals / Non-Goals

**Goals:** rename package identity, TypeScript paths, generated runtime import, README/install examples, governance tests and tarball consumer smoke; prove the packed artifact works with only `halfcode-compiler.xnl` installed.

**Non-goals:** no resource conversion, no consumer descriptor rewrite, no BusinessObject/PageObject API or type changes, no XML dependency removal.

## Impact

Public npm identity changes from `halfcode-compiler.xml` to `halfcode-compiler.xnl`; all subpath names remain stable beneath the new root.

