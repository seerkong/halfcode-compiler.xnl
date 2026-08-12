# Design: XNL object-operation convergence

## 上下文

用户确认参考工作树中的 BO/PO API 重构已经完成。当前 workspace 已有 normalized `ResourceNode`、generic XNL consumers 和 staged `resources-xnl/`，本 track 负责把最后的 owner-specific schema 与 runtime projection接入该边界。

## 方案概览

### 1. 公共 Data 契约

- `ObjectTargets = none | single | selection`；selection 只允许 owner-published business target kind 与 `all | filter | refs` selector。
- `ObjectInvocation` 是 discriminated union：action 包含 `input?`，mutation 必须包含 `desired`。
- `ObjectOperationHandler` 参数顺序固定为 `(runtime, targets, invocation, config)`。
- public definition 只包含 owner、behavior、target declaration、invocation modes、effect；实现 binding 保持 capsule-private。

### 2. XNL owner authority

- XNL root 的 `#id` 是 owner kind FQN。
- `TargetKinds` body 承载重复 `TargetKind`；owner 自身 object target 由 assembly 确定性补齐。
- `Operations` body 承载 `Action` / `Mutation` definitions。
- PageObject operation 以 `export` 连接 owner module；BusinessObject operation 以 `resourceRef` 连接 BusinessAction / BusinessMutation。
- `CodeBinding` 使用 property channel 表达 package/module/export；PageObject owner binding只声明 module，operation 声明 export。

### 3. Closure 与编译

- assembly 在返回前验证 operation ref、target kind、owner、behavior、binding resource 与 code binding 闭包。
- compiler 从 owner catalog 生成 `objects/registry.json`；registry 不发布 module/resource/export binding。
- bundle 读取 registry definition 校验 call，再调用私有 handler `(runtime, targets, invocation, config)`。
- BusinessAction / BusinessMutation 仅作为 BusinessObject operation binding，不生成 generic callable 或独立 AI reference。

### 4. 迁移顺序

1. 同步参考实现的类型、validator、compiler、demo handler 与测试事实。
2. 将 XML owner schema 转译为 XNL semantic channels，并为 XNL reader 写集成/反例测试。
3. 切换 demo authoring modules 到完整 `resources-xnl/` authority，构建并真实执行四类 object operations。
4. 全量验证后归档；G7 删除 legacy XML/adapter。

## 风险 / 权衡

- 参考工作树未提交，但用户明确声明 API 已稳定；本 track 将用户声明与源文件清单固化为输入证据。
- XNL 与 XML reader 在本 track 短暂共存；只允许共享 normalized definition，不允许公开 XmlObject shape。
- runtime-specific config 不在 target-neutral compiler 中提前收窄。

## 待解决问题

- 无阻塞问题。
