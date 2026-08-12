# Design: expose-kind-definition-registry

## Public contract

resource-core 定义无依赖环的 `ResourceKindContract` 与 `RegisteredKindDefinition`。后者包含：

- `resourceId`、`documentUri` provenance；
- `resourceKind`、`sourceShapes`、`requiredFiles`；
- `currentApiVersion`、`supportedApiVersions`、`documentCardinality`。

`ResourceRegistry` 增加 `kindDefinitions: ReadonlyMap<string, RegisteredKindDefinition>`，key 为 `resourceKind`。`halfcode-compiler-kind-definition` 的 authoring `KindDefinition` interface 复用 `ResourceKindContract`，避免同一字段在两个包内漂移。

## Loader projection

`normalizeKindDefinition` 在原有验证成功后直接生成 public record。loader context 持有该 record，最终与 `byKind` 一起投影到 registry。KindDefinition 不混入 `byKind`，consumer 可显式区分 schema contract 与业务 resources。

## Compatibility

该变更只增加字段与导出类型。已有 consumer 读取 `registry.byKind` 的路径不变；distribution 的 `resource-core` 与 `kind-definition` subpath 均继续导出相应类型。
