## 上下文
源码 capsule 与发布 capsule 是两种不同边界。现有 `packages/*` 继续负责内部依赖与 ownership；新的 distribution package 独占外部包名、版本、exports 和 tarball 内容。

## 方案概览
1. 新增 `packages/distribution` 公开包。
   - npm name 为 `halfcode-compiler.xml`，首个发布版本为 `0.1.0`。
   - `private=false`，`files` 仅包含 `dist` 和 README；仓库尚未声明许可证，不在本 track 擅自新增。
2. 暴露显式入口。
   - 根入口仅聚合 application assembly 与 Skill capsule compiler 的高级 API。
   - 子路径暴露 `application-assembly`、`skill-capsule`、`contract-schema`、`authoring-runtime`、`resource-core`、`resource-mapping`、`resource-projection`、`kind-definition` 和 `testing`。
   - `workspace-tools` 保持内部，不进入公共 API。
3. 构建发布制品。
   - 使用 tsdown 生成 ESM JavaScript 与 bundled `.d.ts`。
   - 私有 `halfcode-compiler-*` 包作为 distribution 的 devDependencies，并通过 `deps.alwaysBundle` 强制内联。
   - `fast-xml-parser`、`yaml` 和 `typescript` 作为公开包 dependencies 保持外部依赖。
   - `deps.onlyImport` 限定发布产物只可导入这三个第三方包；Node built-ins 自动允许。
4. 建立发布棘轮。
   - 自动扫描 `dist`，禁止出现任何 `halfcode-compiler-*` specifier。
   - `npm pack` 后在临时消费者目录安装 tarball，运行 ESM import smoke 与 TypeScript typecheck。
   - 生成 callable bundle 必须引用 `halfcode-compiler.xml/authoring-runtime`。

## 影响范围与修改点（Impact）
- 新增：`packages/distribution/**`
- 修改：根 `package.json`、`bun.lock`、`tsconfig.json`
- 修改：`packages/compiler-skill/src/index.ts` 与测试期望
- 修改：README 中安装和入口说明

## 决策摘要
- 详见 `decisions.xnl`。
- `halfcode-compiler.xml` 是唯一公开 publication authority。
- 内部包保持 private 且只在构建期存在。
- 采用显式子路径，避免根入口符号冲突与 API 面失控。

## 风险 / 权衡
- 类型 bundling 可能因跨 workspace 类型关系失败 → 使用与 JavaScript 一致的 dependency bundling，并以 tarball consumer typecheck 兜底。
- `typescript` 作为 schema compiler 的运行依赖会增大安装体积 → 保持 schema 子路径独立，但单包发布下仍作为 dependency 安装。
- 点号包名视觉上类似文件名 → npm 与 Node bare specifier 均支持，且能清晰区分未来 `.xnl` 产品。

## 兼容性设计
- 现有内部源码导入继续使用 `halfcode-compiler-*`，仅发布制品禁止泄露。
- 生成代码改用公开 runtime 子路径，这是面向未发布内部包名的必要迁移。

## 迁移计划
1. 新增发布入口和失败测试。
2. 配置 bundling 与 package exports。
3. 更新生成 runtime import。
4. 构建、pack、临时消费者安装并验证。
5. 若失败，删除 `dist`/tarball 即可回滚；不影响内部源码包。

## 待解决问题
- 无。本 track 不执行 registry publish。
