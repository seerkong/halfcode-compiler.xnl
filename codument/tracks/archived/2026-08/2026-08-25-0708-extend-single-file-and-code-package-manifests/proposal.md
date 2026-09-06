# 变更：补全 single-file 与 CodePackage manifest 契约

## 背景和动机 (Context And Why)

`single-file` 已是 Halfcode 的通用 source shape，但当前 loader 只扫描并解析 `.xnl`，无法让 Markdown frontmatter 直接承载 ApplicationSOP 等文本资源。消费方只能为正文再造一份配对 XNL descriptor，产生 identity、description 和文件绑定的重复 authority。

CodePackage 已使用显式 package-local `CodeBinding`，但 descriptor 没有参考资源协议所要求的 `entry` 与 `runtime` manifest facts，导致资源树只能观察 binding，无法稳定展示或校验执行入口及运行时。

## "要做"和"不做" (Goals / Non-Goals)

**目标:**

- 让 `single-file` catalog 同时发现 XNL 与 Markdown frontmatter 单文件资源。
- 把 Markdown 原始 bytes 纳入既有 content identity，并投影规范化 Kind/FQN/apiVersion/version/spec。
- 要求 CodePackage descriptor 声明安全相对 `entry` 与非空 `runtime`，且 `entry` 与显式 `CodeBinding.module` 完全一致。
- 发布包含该协议的正式 npm 包，并完成隔离安装态验证。

**非目标:**

- 不引入 Host 专属 ApplicationSOP、Page、LocalFunction 或 browser effect。
- 不恢复 YAML manifest root、XML 或 legacy registry。
- 不解析 Markdown 正文中的自然语言依赖。
- 不允许 CodePackage 外部包绑定或越界入口。

## 变更内容（What Changes）

- **BREAKING**：`code-package` resource 必须新增 `entry` 与 `runtime`，旧的仅 CodeBinding descriptor 将 fail closed。
- `ResourceRecord.format` 增加 `markdown`，`single-file` catalog 接纳 `.md`。
- Markdown frontmatter 使用 `apiVersion`、`kind`、`metadata.fqn`、可选 `metadata.version/name` 与 `spec`，正文保留在 authority 文件中。
- CodePackage normalize/load 对 entry、runtime、binding 一致性提供稳定 diagnostics。
- 更新公开类型、文档、测试、distribution capsule 与包版本。

## 影响范围（Impact）

- 受影响的能力（behaviors）：`resource-loading`
- 受影响的代码：`packages/resource-core`、`packages/distribution`、resource DSL 文档与发布配置
