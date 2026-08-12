# Design — add-pageobject-kind-definition

- `PageObject` is a target-neutral interactive-surface descriptor, not a URL page.
- Source shape is `directory`, entry is `PageObject.xml`, and no browser-specific required files are imposed.
- Each descriptor carries a `CodeBinding` plus `Operations`: exactly one `Open`, zero or more uniquely named `Primitive` operations, and exactly one `Verify`. Operation values are export names only.
- `ApplicationAssembly.pageObjects` normalizes these records and adds them to `byFqn`; malformed/missing binding or operations fail before projection.
- The distribution root already re-exports application-assembly, so rebuilding it exposes the new types without consumer subpath imports.
