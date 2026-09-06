# 设计：语义根与具名 Catalog normalization

## 上下文

XNL 根在读取 Catalogs 前已经可解析为 ResourceRecord，但其 KindDefinition 通常由同一根 Catalogs 中的 KindDefinition catalog 提供。实现必须先读取系统定义，再校验根，不能退回固定包装 Kind。

## 方案概览

1. 把 Catalog 规范化为内部 `XnlCatalog`：tag 决定具名 shape，旧 `Catalog.shape` 保持兼容；`resourceKind` 是新字段，旧 `kind` 是兼容字段。
2. 先从根记录读取并加载 KindDefinition catalogs，再验证语义根的 KindDefinition、manifest shape、apiVersion 与 required files，最后注册根及其 content identity。
3. `ResourcePackage` 作为旧 bootstrap 根保持原行为，不要求 KindDefinition，也不进入业务 registry。
4. DirectoryResourceCatalog 用 `scope=root|children` 明确是目录本身还是各子目录；旧 Catalog 默认 children。
5. 子 manifest/文件自述 Kind 是 authority；Catalog 的 `resourceKind`/`kind` 是 expected/fallback。已自述且不一致时 fail-closed。

## 影响范围与修改点（Impact）

- `packages/resource-core/src/xnl-loader.ts`
- `packages/resource-core/src/index.test.ts`
- `packages/resource-core/tests/fixtures/`
- `docs/resource-dsl/`
- `modeling_deltas/domain/resource_core.xnl`

## 决策摘要

- Mission 已确认采用语义根、三种具名 Catalog，并兼容非 CodePackage 通用 Catalog。
- 本 Track 不拥有或触碰 Bundle materializer authority。

## 风险 / 权衡

- 根 bootstrap 顺序错误可能形成自引用 → KindDefinitions 优先加载，根只在 registry ready 后验证。
- scope 默认值可能破坏旧布局 → 旧 Catalog 固定使用 children 兼容语义，具名 Directory 明确声明或默认 children。
- typed tag 与属性冲突 → tag-owned shape 优先，显式冲突产生诊断而非静默覆盖。

## 迁移计划

先以测试锁定新旧两类输入，再实现 normalizer；CodePackage 仍暂时保持可编译，后续独立 Track 物理删除。

## 待解决问题

- 无；运行语言与 Bundle admission 已明确属于 Host。
