# 变更：从 storage-neutral read port 加载 Halfcode ResourceTree

## 背景和动机 (Context And Why)

`resource-core` 当前把资源解析、规范化和物理目录访问集中在 `xnl-loader.ts`：`realpath/readdir/readFile/stat` 既决定发现，也决定 provenance。Eidolon 的最终资源 authority 将是 revisioned Effective VFS；若 Halfcode 只能读取物理目录，下游只能把 VFS 临时落盘或维护第二套 loader，都会破坏单一 authority 与内容身份一致性。

当前工作树正在演进 typed Catalog、Markdown single-file 和 directory material。本 Track 以这些未提交改动为实际基线，保持其格式、scope、digest contribution 与 diagnostics 行为，不回退或覆盖。

## “要做”和“不做” (Goals / Non-Goals)

**目标：**

- 定义只包含 `stat/readDirectory/readBytes` 的 framework-neutral ResourcePackage read port。
- 让 parser/discovery/normalization 只依赖该 port 和 canonical logical path。
- 保持 `loadResourceTree({ rootDir })` / `validateResourceTree({ rootDir })` 兼容，并由 physical-directory adapter 接入同一核心链路。
- 提供 read-port 入口，使内存/VFS adapter 不经临时目录即可加载 ResourceTree。
- 证明 directory 与 read-port 输入产生等价 records、KindDefinitions、canonical provenance、diagnostics 和 content identities。

**非目标：**

- 不依赖 `xnl-vfs`、BunFS、Eidolon 或任何 host runtime。
- 不在 Halfcode 内 materialize home/workspace overlay；调用方只传最终文件视图。
- 不改变 ResourceRecord FQN、Catalog admission、Markdown/XNL 解析或 resource material 读取语义。
- 不把 provider 的内部路径写入 `logicalPath`、`documentUri` 或 digest。

## 变更内容（What Changes）

- 新增 ResourcePackage read-port contract、canonical path helpers 与 physical-directory adapter。
- 重构 `xnl-loader.ts`，使所有 manifest/catalog/required-file/authority-byte 访问经过 read port。
- 新增 read-port load/validate API，同时保留现有 directory API。
- 增加 directory vs memory/VFS-like source 的成功与失败 parity tests。
- 在 modeling registry 中登记 read-port 边界与单向加载职责。

## 影响范围（Impact）

- 受影响能力：`resource-loading`
- 受影响代码：`packages/resource-core/src/index.ts`、`xnl-loader.ts`、新增 read-port/adapter 模块与测试
- 兼容消费者：`application-assembly`、`runtime-authoring`、distribution package verification
