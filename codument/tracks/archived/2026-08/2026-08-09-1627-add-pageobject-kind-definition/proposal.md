# Change: add target-neutral PageObject authoring kind

## Context And Why

The browser-robot consumer needs to compile XML-described UI surfaces without teaching halfcode any browser/CDP policy. The existing FS-native registry validates known kinds, but `ApplicationAssembly` drops unknown PageObject records.

## Goals / Non-Goals

**Goals:** define a directory-shaped `PageObject` resource; normalize it into application assembly with code binding and named operations; expose that assembly API from the `halfcode-compiler.xml` distribution root; verify a downstream consumer needs only that root.

**Non-goals:** no browser selectors, routes, CDP methods, app installation paths, or browser-robot runtime types; no new public package identity or required subpath import.

## Impact

- Resources: demo authoring KindDefinitions and Pages module.
- Code: application-assembly normalization and distribution root build.
- Consumer boundary: `halfcode-compiler.xml` root remains the sole public entry.
