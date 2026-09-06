# Design：0.2.8 publication closure

1. 先确认 registry 不存在精确版本 `0.2.8`，再同步 distribution metadata、lockfile 与 verifier candidate identity。
2. 运行 `bun test`、`bun run typecheck`、`bun run verify`、`bun run package:check`；后者从真实 tarball 安装 consumer，验证十个 public specifiers、`readResourceMaterial` 与旧 CodePackage API 负例。
3. 从 `npm pack --json` 记录 candidate filename/integrity/shasum/size/files；只在这些门禁成功后执行一次 `npm publish`。
4. 回读精确 registry 版本并要求 name/version/integrity/shasum 全等；不以 latest 标签或 publish 退出码替代身份验证。
5. Halfcode 发布物止于 target-neutral ResourceMaterial；不包含 BundleMaterializer、Bun/Python/Java runtime 或叶子 Kind admission。

发布不可逆，因此任何发布前失败都保持 Track 活跃；若 publish 成功但回读异常，只观察同一精确版本，绝不重复发布或换版本掩盖偏差。
