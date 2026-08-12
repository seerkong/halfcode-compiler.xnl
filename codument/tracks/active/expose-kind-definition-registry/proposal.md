# Track: expose-kind-definition-registry

## 背景

resource-core 已读取、验证并在内部注册 KindDefinition，但成功返回的 `ResourceTree.registry` 只暴露业务 resource records。Codument 作为真实 consumer 无法取得已验证的 Kind contract，只能重复解析 XNL 或维护第二份 schema authority。

## 目标

- 在 public resource-core contract 中公开规范化、带 provenance 的 KindDefinition registry。
- 复用 loader 已验证的版本、source shape 与 cardinality 事实，不引入第二条解析路径。
- 保持现有 `registry.byKind` 行为与 package subpath 兼容。

## 非目标

- 不在 Halfcode 内实现 Codument scaffold writer。
- 不让 XNL 承载可执行 migration transform。
- 不改变 catalog 扫描或资源 identity 规则。
