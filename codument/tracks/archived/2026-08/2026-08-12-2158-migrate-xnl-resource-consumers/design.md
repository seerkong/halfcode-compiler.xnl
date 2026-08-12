# Design

- Generic assembly readers branch on `record.format`: XNL uses `ResourceNode`; XML uses a clearly named temporary legacy adapter.
- XNL child contracts (`InputContract`, `OutputContract`, `CodeBinding`, materials) are unique subdomains. Includes and ref collections use body members.
- `vfs://./` resolves relative to the descriptor directory; `vfs://@/` resolves from module resource root.
- ResourceMappings uses unique `ReferenceTargets`, `CallableArtifacts`, `SourceRoots`; repeated mappings/operations are body members. `xnl-core` parser types stay internal.
- BusinessObject and PageObject dispatch reject XNL specialized decoding in this track and continue through existing legacy readers only.

