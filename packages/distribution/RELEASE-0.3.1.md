# 0.3.1 发布验证

本次交付原生 CodeBinding 冻结执行闭包：application-assembly 公开 capture/validate，authoring-runtime 公开 restore/bind。恢复依赖独立可信摘要和宿主环境身份，不读取 live source；不是不可信代码沙箱。

源码提交包含此前已发布但未提交的 0.3 资源契约基线及本次闭包增量。docs/resource-dsl 是发布构建输入；demo resources、两份 skills 是既有版本棘轮/集成测试输入。无关 Codument decision/archive 迁移不在本提交中。

2026-09-06，Bun 1.3.14 / macOS arm64：

- `bun test`：341 pass，0 fail，1550 assertions。
- 独立复核 closure/public：27 pass，0 fail，82 assertions。
- `bun run package:check`：10 个公开入口、安装后 Node 执行闭包及 types 验证通过。
- 暂存树复制到空目录，`bun install --ignore-scripts --frozen-lockfile` 后同一 package:check 通过，生成相同制品身份。
- tarball：70 files，140072 bytes；SHA-1 `2cfaa16a76f09bdf2595a093d00b6f64363ef946`。
- integrity：`sha512-PrMjRrQ6b330+H1npMwUWbX7NuaJzRSrJUCkbt5BH3L1XWRXckE3gPWpbnAKrtgTu900Xpjys54azsNrPfLbIw==`。

发布授权来自 Eidolon scroll Track 的上游依赖交付前置；使用 `.npmrc_official` 对应的官方 registry，不发布 private workspace/apps。
