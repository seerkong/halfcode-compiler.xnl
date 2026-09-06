# Design：Halfcode ResourceTree storage-neutral read port

## 上下文

资源加载包含两类职责：source I/O 与 Halfcode semantic compilation。当前 `xnl-loader.ts` 用 Node fs/path 同时承担两者，导致 canonical `vfs://@/...` provenance 依赖物理根。目标不是新增一套 VFS loader，而是把成熟的同一条 manifest → KindDefinition bootstrap → Catalog discovery → record validation → content identity 链路改为消费一个最小 read port。

## 方案概览

```text
loadResourceTree({ rootDir })
  -> PhysicalDirectoryReadPort(rootDir)
                         ┐
loadResourceTreeFromReadPort({ port, rootPath })
                         ├─ canonical package-relative path core
                         ├─ manifest / catalogs / required files
                         ├─ XNL + Markdown normalization
                         └─ LoadedResourceTree + content identities
```

### Read port contract

Port 接收 canonical POSIX absolute source path；它只报告 entry kind、稳定枚举和原始 bytes：

```ts
interface ResourcePackageReadPort {
  stat(path: string): Awaitable<ResourcePackageEntry | undefined>
  readDirectory(path: string): Awaitable<readonly ResourcePackageDirectoryEntry[] | undefined>
  readBytes(path: string): Awaitable<Uint8Array | undefined>
}
```

`rootPath` 只用于在 port namespace 内定位 package，不进入输出。loader 从 package-relative path 唯一生成 `logicalPath` 和 `vfs://@/...`；FQN 继续在 bytes 解析后产生，不参与 source overlay。

### 单一 semantic loader

`xnl-loader.ts` 内部只持有 `{ port, rootPath, diagnostics }`。manifest、Catalog root、entry、required file 与 authority byte cache 都经 port 访问；目录枚举由 loader 按 UTF-16 code-unit 排序，不信任 provider 顺序。XNL/Markdown parser、Kind/API 校验、identity uniqueness、digest 与 contribution 逻辑保持原实现。

### Physical directory compatibility adapter

现有 `loadResourceTree({ rootDir })` 创建受 root containment 约束的 Node directory port，再调用同一核心入口。adapter 负责 realpath、symlink/entry kind 和物理异常到缺失事实的映射；loader 输出不得含 real path。旧签名、diagnostic code 与成功结果保持兼容。

### 失败语义

- 非 canonical/越界 logical reference：loader 产生既有 containment diagnostic，不调用越界 port path。
- 缺失目录、文件或 required material：使用现有稳定 diagnostic。
- 无效 UTF-8/语法/Kind/identity：由同一 parser/validator 产生相同结果。
- provider 抛异常：转换为稳定 read diagnostic，不泄漏机器路径或 provider error 文本。
- 任一 diagnostic 存在时不返回 partial tree。

## 原逻辑到新边界的映射

| 原位置 / 逻辑 | 新 Halfcode 边界 |
|---|---|
| `xnl-loader.ts: buildXnlResourceTree` 解析 `rootDir/manifestPath` | normalized read-port source + package-relative manifest |
| `catalogFiles` 中 `readdir/lstat` | `readDirectory/stat`，loader 自己稳定排序与 shape 校验 |
| `readAuthorityFile` 中 `readFile` | `readBytes`；同一次 byte read 继续生成 authority digest |
| `validateRequiredFiles` 中 `stat` | port `stat` file-kind check |
| `resolveCatalogDirectory` 中 `realpath/resolve` | lexical canonical containment + port directory existence |
| `relative(rootDir,filePath)` provenance | package-relative canonical path → `vfs://@/...` |

## 影响范围与修改点（Impact）

- `packages/resource-core/src/resource-package-read-port.ts`
- `packages/resource-core/src/directory-resource-package-read-port.ts`
- `packages/resource-core/src/xnl-loader.ts`
- `packages/resource-core/src/index.ts`
- `packages/resource-core/src/read-port.test.ts`
- 当前 Track behavior/modeling delta

## 决策摘要

- 新 API 与旧 directory API 共享一个 semantic loader，禁止双实现。
- read port 使用 logical source coordinate；输出 provenance 只使用 package-relative coordinate。
- provider adapter 决定 transport，Halfcode 决定发现顺序、解析、校验和身份。
- 保留当前工作树的 typed Catalog、Markdown 与 material identity 行为作为兼容基线。

## 风险 / 权衡

- fs 语义与 VFS 语义不完全相同 → port 显式 entry kind，parity tests 覆盖目录/文件/缺失/乱序。
- 大范围替换 path API 易改变 diagnostics → 保持 code/message 断言，并以旧 API vs port API 同输入对比。
- 当前 dirty loader 有并行改动 → 在最新文件上做机械 I/O 抽取，不覆盖格式/semantic Catalog 分支；每步跑现有 resource-core tests。

## 兼容性设计

- `LoadResourceTreeOptions { rootDir, manifestPath? }` 保持可用。
- 新增 read-port API，不要求现有 consumer 迁移。
- 不改变 `ResourceTree` / `ResourceRecord` 公共形态和 content identity 算法。

## 迁移计划

1. 用 directory/read-port parity tests 固定当前成功与失败结果。
2. 抽出 contract、canonical path 与 directory adapter。
3. 把 loader I/O 全部切到 port，保持现有 API 委派。
4. 跑 resource-core、全仓 typecheck/test、distribution verification。

## 待解决问题

- Eidolon 对 `xnl-vfs` 的具体 adapter 由 host owner Track 实现，不进入本 package。
