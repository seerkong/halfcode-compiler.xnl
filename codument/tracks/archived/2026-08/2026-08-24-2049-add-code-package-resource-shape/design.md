# Design：CodePackage shape、内容身份与模块加载

## 上下文

Halfcode 的 XNL loader 已拥有 package realpath boundary、KindDefinition source shape 校验、raw authority digest、authentic `LoadedResourceTree` 和 effective identity projector。新增能力应复用这些安全与 provenance authority，不另建目录扫描器，也不把消费方资源语义带入 resource-core。

## 方案概览

### 1. source shape 与 XNL contract

`SourceShape` 增加 `code-package`。Catalog 的目录枚举语义与 `directory` 相同：`root` 是 VFS directory，`entry` 是每个直接子目录中的 XNL descriptor 文件。descriptor 的 Kind 仍由 Catalog/KindDefinition 决定；`code-package` 是 source shape，不硬编码具体业务 Kind。

每个该 shape 的 descriptor 必须包含恰好一个 singleton：

```xnl
<CodeBinding { module = "vfs://./bundle/index.js" }>
```

`module` 只接受相对当前 descriptor 目录的 `vfs://./` URI，拒绝空段、`.`、`..`、反斜杠、编码分隔符、绝对路径和非 `.js`/`.mjs` 文件。`export` 可选：存在时 loader 要求 module namespace 中有该 named export；缺省时把完整 module namespace交给 caller admission。既有非 code-package resource 上的 Kind-specific CodeBinding 语义不变。

### 2. normalized facts 与内容身份

公开 `CodePackageBinding` 至少包含 `resourceId`、canonical `moduleUri` 和可选 `exportName`，不包含机器绝对路径。XNL loader 在构造 code-package record 后解析 binding，解析 package directory 与真实 entry，执行 lexical + realpath confinement，读取 entry raw bytes并创建稳定 digest contribution：

- key：`code-binding:module`
- digest：entry raw bytes SHA-256
- sourceUri：canonical package-local VFS URI

`authorityDigest` 继续只代表 XNL bytes；`contentDigest` 同时绑定 authority 与 code contribution。effective projector 必须从 authentic loaded identity 保留 loader-owned contributions，再合并 caller 提供的 typed contributions；同 key 异 digest fail closed，排序沿用 UTF-16 code-unit canonical 规则。

### 3. module loader

`loadCodePackageModule` 接受 authentic `LoadedResourceTree`、resourceId 和本次 load 的 rootDir。它重新定位 record/binding，重复 realpath confinement，重新摘要 entry 并与 tree identity 的 `code-binding:module` contribution 对比：

- tree 不是 canonical loader 产物、resource 不存在或 shape 不匹配：拒绝。
- entry 已变而 tree 未重载：返回 stable stale-revision diagnostic，不执行 module。
- facts 一致：用 file URL + `halfcode_revision=<contentDigest>` 动态 import。

成功结果只公开 frozen binding、revision 和 module namespace，不持久化绝对路径。调用方先重新运行 `loadResourceTree`，再加载 module，便能在同一进程观察 entry 修改后的新 exports。

### 4. caller-owned export admission

Halfcode 不知道 host brand 或 Kind schema。`admitCodePackageExports<T>` 由 caller 提供：

- `isDefinition(value): value is T`
- `identityOf(value): string`

候选只来自 named exports；每个 named export 若为数组，仅展开一层。普通值被忽略，不递归任意对象或执行 factory。若 binding 指定 `export`，只检查该 export。成功 definitions 按 caller identity 稳定排序并冻结；一个 package 内重复和 `admitCodePackages` 跨 package 重复都拒绝。

### 5. API 与兼容

API 从 `halfcode-compiler-resource-core` 导出，并由 `halfcode-compiler.xnl/resource-core` 原样重导出。现有 `loadResourceTree` 和 structural `ResourceTree` 字段保持兼容；只有 exhaustive `SourceShape` 分支需要处理新增成员。

application-assembly 现有 package/module/export CodeBinding 投影不在本 Track 迁移。后继 consumer 可以逐步改用 CodePackage shape，Halfcode 不把旧语义解释为新 shape。

## 影响范围与修改点（Impact）

- `packages/resource-core/src/index.ts`：SourceShape 与公共 contract/export。
- `packages/resource-core/src/xnl-loader.ts`：catalog shape、binding、confinement 与 entry contribution。
- `packages/resource-core/src/code-package.ts`：module loader 与 generic admission。
- `packages/resource-core/src/effective-content-identities.ts`：保留/合并 loader-owned contributions。
- `packages/resource-core/src/*.test.ts` 与 fixtures：行为、安全、revision、immutability。
- `packages/distribution`：公开 re-export 与 isolated consumer verification。

## 决策摘要

- XNL 仍是 descriptor/binding authority；module exports 只在显式 CodeBinding 范围内成为 caller resource definitions 的 authority。
- CodePackage 是通用 source shape，不是 Halfcode 内置业务 Kind。
- JavaScript entry 必须是 self-contained bundle；Halfcode 不承担 TS 编译和 dependency graph hashing。
- host brand/schema/effect 留给 caller，Halfcode 只提供 caller-owned admission protocol。

## 风险 / 权衡

- ESM 顶层代码在 admission 前会执行，不能视为安全沙箱；仅对可信 workspace artifact 使用，并在文档/类型命名中明确 executable boundary。
- file URL query 解决 Node/Bun entry cache，但不追踪 entry 内动态依赖；self-contained bundle 约束和 entry digest test 防止产生虚假完整性承诺。
- `SourceShape` union 扩展可能触发 consumer exhaustive-switch 编译错误；这是有意的 additive contract signal，现有非穷尽 consumer 不受影响。
- loader-owned contributions 会影响 effective projector 既有“不含贡献”假设；通过 structural compatibility、layer projection 和 forged identity tests 防回退。

## 迁移计划

1. 先用 fixture/negative tests冻结 shape 和 binding contract。
2. 实现 code bytes identity，再修正 effective projector 保留 loader facts。
3. 实现 module loader/admission 并验证 reload、stale、symlink 与 duplicate cases。
4. 公开 distribution API、运行 pack isolated consumer 和全仓验证。
5. 后继发布 Track 升级正式版本；host 只在正式版本可用后采用。

## 待解决问题

- 无阻塞性产品决策；具体诊断 code 与 helper 函数拆分可在测试保护下调整。
