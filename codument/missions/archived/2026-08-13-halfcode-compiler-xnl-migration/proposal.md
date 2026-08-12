# Mission：halfcode compiler XNL migration

## 背景和动机

当前系统是一套 FS-native 资源编译与管理工具：资源树经 catalog 与 KindDefinition 进入 registry，再被 application assembly 归一化，最终投影为标准 Skill capsule。源码职责已经拆分为 resource core、application assembly、resource mapping、contract schema、runtime、Skill compiler 与统一 distribution package。

现有 authoring authority 仍是 XML。迁入当前 workspace 的基线包含 38 个应用资源 XML、9 个测试 fixture XML，以及对 `fast-xml-parser`、`Manifest.xml`、`KindDefinition.xml`、`resource-mappings.xml`、XML-shaped descriptor object 和公开包名 `halfcode-compiler.xml` 的代码、测试、skill 与文档耦合。仅替换文件后缀无法获得 XNL 的身份、分段、唯一子域、列表、引用和单/多文件同构能力。

本 mission 以 `xnl-core` 的实际 parser/AST/formatter 能力和 depa-flows Flow DSL 的 L1/L2/L3 规范习惯为设计证据，将产品 authoring surface、编译链和发布边界收敛为 `halfcode-compiler.xnl`。

## 目标

- 建立 halfcode resource XNL DSL 的权威语义与文件组织规范，而不是逐标签机械转写 XML。
- 用 `xnl-core` 替换产品资源链中的 XML parser，并形成稳定、格式无关或明确 XNL-native 的规范内存模型。
- 将 resource catalog、KindDefinition、resource descriptors、ResourceMappings、demo authoring tree 和测试 fixtures 迁移为 XNL。
- 让 application assembly、resource mapping、Skill capsule compiler、workspace verification 与测试只消费 XNL authority 或其规范投影。
- 将唯一公开 npm package、生成代码 import、文档和发布验证迁移到 `halfcode-compiler.xnl`。
- 保持现有 target-neutral resource behavior、contract schema boundary、multi-module assembly、collision preflight 和 deterministic Skill projection 可验证等价。
- 将正在进行 API 重构的 BusinessObject 与 PageObject 明确放到最后一批：通用 XNL 基础先落地，最终迁移前重新观察其稳定 API，再冻结 XNL contract。
- 清理 XML 时代已完成但尚未归档的 tracks，并保留其历史 provenance；新的 XNL decisions 明确取代冲突的当前约束。

## 非目标

- mission 本身不直接修改产品代码、资源 DSL 或测试；真实落地由 mission 绑定的 Codument tracks 承担。
- 不修改 `xnl.ts` 或 `depa-flows.ts` 外部项目；它们只提供参考实现与规范证据。
- 不把 `package.json`、TypeScript contract source、生成 JSON Schema、registry JSON、Markdown material 或 EJS template 无差别改成 XNL；只有被确认属于资源 DSL/config authority 的入口才迁移。
- 不改变生成 Skill capsule 的目标格式或引入特定平台/browser runtime policy。
- 不把 Codument 的 `mission.xml`、`track.xml`、behavior delta 和 workspace config XML 当作产品资源 XML 迁移；它们属于 Codument 控制面协议。
- 不在本 mission 中执行真实 npm publish。

## 成功判据

- baseline 中 47 个产品 XML authority/fixture 均被等价 XNL source 或 XNL fixture 取代；产品路径下不再依赖 XML authoring。
- 产品源码、测试、skills 与 docs 不再依赖 `fast-xml-parser`、XML AST 形状或 `Manifest.xml` / `KindDefinition.xml` / `resource-mappings.xml` 约定。
- resource unit 使用内容声明 kind/identity；目录 bundle 统一以 `manifest.xnl` 为入口，独立 definition 可使用描述性 `.xnl` 文件名。
- XNL 节点按 `Tag/#id/metadata/{}/()/[]` 分责，重复条目使用 `[]`，唯一子域使用 `()`，引用使用已登记且带引号的 URI，动态实现只以外部 code ref 挂接。
- 唯一公开包名、exports、生成 runtime import、tarball smoke 与文档统一为 `halfcode-compiler.xnl`；私有 workspace package 仍不泄漏到发布制品。
- `xnl-core` 是产品 XNL parsing authority，`fast-xml-parser` 从产品依赖和 distribution allowlist 中移除。
- BusinessObject/PageObject 的 XNL descriptor、normalized assembly API、fixtures、tests 和 public types 只在其他通用迁移分支完成后实施，并以执行时重新观察到的 API 事实为准。
- resource load/validate、application assembly、resource mapping、contract generation、Skill capsule build、package verification、typecheck 与全量测试通过。
- 最终 inventory 只允许 Codument 控制面保留 XML；所有 linked tracks 均已验证并归档，mission 节点全部 `DONE` 或有证据地 `SUPERSEDED`。

## 为什么需要 mission 而不是单个 track

该目标同时改变 DSL、文件组织、parser/AST、多个消费者、资源样例、测试夹具、skills/docs 与公开 npm identity；其中 XML-era decisions 与新的 XNL product boundary 还存在显式冲突。它需要先冻结语言契约，再按依赖分批实施，并在每批验证后根据 parser 能力、迁移证据和兼容风险受控重规划。单个 track 无法在保持可审查行为边界的同时安全闭环。
