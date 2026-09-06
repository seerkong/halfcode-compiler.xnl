# 变更：增加 CodePackage resource shape

## 背景和动机 (Context And Why)

resource-core 目前只接受 `single-file | directory | manifest` 三种 source shape，能够规范化 XNL 资源，却不能表达“一个 XNL descriptor 绑定一个可执行模块入口”的通用代码包。application-assembly 已有 Kind-specific `CodeBinding` 投影，但它只生成 package/module/export specifier，不负责 workspace-local 模块的内容身份、安全加载、revision 或通用 export admission。

跨仓 Mission 要让消费方把代码型资源统一迁到 Halfcode CodePackage 协议。该协议必须留在通用资源层：Halfcode 只拥有 shape、binding、内容身份、路径约束、模块加载和 caller-defined admission；具体 LocalFunction/PageWorkflow/PageObject 品牌、schema 与 effects 由消费方拥有。

## "要做"和"不做" (Goals / Non-Goals)

**目标:**

- 增加 canonical `code-package` source shape，按目录加载每个 CodePackage 的 XNL descriptor。
- 规定 code-package descriptor 必须有一个显式 `<CodeBinding { module = "vfs://./..." }>`，入口是 package 内 self-contained ESM JavaScript。
- 把 entry raw bytes 作为 loader-owned digest contribution 纳入 `LoadedResourceTree.contentIdentities`。
- 增加只接受 authentic loaded tree 的模块 loader，使用 realpath confinement 和 contentDigest revision。
- 增加 target-neutral export admission helper，由 caller 提供 type predicate 与 identity projector。
- 从 distribution 的 `./resource-core` 公开 API，并在 pack/isolated consumer 中验证。

**非目标:**

- 不定义 host 的 LocalFunction、PageWorkflow、PageObject、Page、MCP App 等 Kind。
- 不引入 branded `define*`、AJV、capability injection 或业务 runtime effects。
- 不执行 npm publish 或修改正式 package version；发布由后继 Track 完成。
- 不编译 TypeScript、不追踪任意 ESM dependency graph；CodeBinding 指向消费方构建的 self-contained `.js`/`.mjs` entry。
- 不承诺沙箱隔离可信代码；`code-package` shape 明确表示可执行 artifact，安全边界是 entry/provenance confinement 与 caller admission。

## 变更内容（What Changes）

- **BREAKING for exhaustive type consumers**：`SourceShape` union 增加 `code-package`；KindDefinition 与 Catalog validator 接受该值。
- resource-core 新增 CodePackage binding normalization、entry confinement、code digest contribution、module load 和 generic admission API。
- effective content identity projector 保留 loader-owned contributions，再确定性合并 caller typed contributions。
- fixture、negative/security/revision tests 和 distribution isolated install smoke 覆盖公开 contract。
- modeling delta 记录 resource-core CodePackage runtime 的模块、数据和 effect 边界。

## 影响范围（Impact）

- 受影响的能力（behaviors）：`resource-loading`
- 受影响的代码：`packages/resource-core`、`packages/distribution`、package verification fixtures/tests
- 后继消费者：host 统一 workspace resource catalog 与 CodePackage runtime
