# Design

- Each authoring app gets a parallel `resources-xnl/manifest.xnl`. The root catalog points directly to semantic generic resources and XNL KindDefinitions; it does not mix XML and XNL authority.
- Directory resources use `manifest.xnl` with local `vfs://./` material references. Root-relative references are reserved for package-level resources.
- The domain tree covers Function, ComposedFunction, ApplicationSOP, PromptFragment, WikiPage, and SkillCapsule. The shared tree covers PromptFragment. BusinessObject, BusinessAction, BusinessMutation, BusinessObjectSOP, and PageObject remain together in the deferred aggregate boundary because their reference API is still moving.
- `resource-mappings.xnl` uses `ReferenceTargets`, `CallableArtifacts`, and `SourceRoots` semantic channels. The staged SkillCapsule points to the XNL mapping material.
- Existing XML remains the runtime default during this track. Tests load `resources-xnl/` explicitly and compare generic projections with the legacy trees. G7 owns default cutover and XML deletion after BO/PO convergence.
- Guidance must name `manifest.xnl`, semantic subdomains/body collections, and XNL ResourceMappings as the authoring contract. Any BO/PO examples are marked deferred rather than translated speculatively.
