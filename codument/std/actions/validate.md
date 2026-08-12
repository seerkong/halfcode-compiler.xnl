# skill: codument-validate（校验 track.xnl / behavior）

你是 Codument 行为驱动开发框架的 AI 代理助手。本 skill 校验 track 或 behavior 登记表的格式是否正确：track.xnl 结构 / 调度 / hook / 引用，以及 behavior 增量（`<behavior-patch>`）与 behaviors 登记表。

> 本文以 Markdown 为主（校验清单、输出示例、错误表）；**校验流程**（确定目标 → 逐项检查 → pass/fail/strict 分支 → 外部 CLI fallback）用流程标记块。
>
> 口径映射（旧命令 / 旧格式 → 当前标准）：`codument:validate`→`codument-validate`；`plan.xml`/`track.xml`→`track.xnl`；旧 metadata JSON / XML `<Metadata>`→Track 根 `{}`；XML `cdt:` 扩展→XNL 无前缀节点；`spec_deltas/`→`behavior_deltas/`。校验规则对齐 `track-xnl-spec.md` §8。

---

## 1. 校验流程

接收可选参数 `item`（track / behavior / mission 名）与可选 `--strict`。

```text
@delimiter: --
-- #sequence ?validate
---- #step ?args
解析参数：有 [item] → 校验特定 track/behavior/mission；无 → 批量模式（§6）
---- /?args
---- #switch ?type on="item 类型"
------ #case ?as-track when="item 在 codument/tracks/pending/ 或 codument/tracks/active/"
按 §2 校验 track
------ /?as-track
------ #case ?as-behavior when="item 在 codument/behaviors/"
按 §3 校验 behavior 登记表
------ /?as-behavior
------ #case ?as-mission when="item 在 codument/missions/{pending,active,archived}/"
按 §2.8 校验 mission.xnl
------ /?as-mission
------ #case ?ambiguous when="两者都存在或都不存在"
用 --type 参数消歧
------ /?ambiguous
------ #default ?batch
进入批量模式（§6）
------ /?batch
---- /?type
---- #if ?strict cond="带 --strict"
执行 §5 额外检查
---- /?strict
---- #step ?ext
尝试外部 CLI fallback（§7）：有 codument 命令则跑 codument validate <item> --strict；找不到则跳过并明确说明已跳过，不阻塞
---- /?ext
---- #switch ?verdict on="逐项结果"
------ #case ?ok when="全部通过"
按 §4 输出「验证通过」
------ /?ok
------ #case ?bad when="存在错误"
按 §4 输出「验证失败」+ 每项错误定位与修复建议
------ /?bad
---- /?verdict
-- /?validate
```

---

## 2. 校验 Track

对于 track 目录 `codument/tracks/{pending,active}/<track_id>/`：

### 2.1 结构验证

- [ ] `track.xnl` 存在且 XNL 格式有效（可解析）。
- [ ] `behavior_deltas/**/*.xml` 存在；旧 track 可兼容 `spec.md`（仅作兼容格式验证）。
- [ ] 唯一根节点是 `<Track #id apiVersion="..." version="...">`，版本受 Track KindDefinition 支持。
- [ ] 同目录不存在 `track.xml`；两种 authority 并存必须报冲突。

### 2.2 XNL 通道与根属性验证

`#id` 使用 identity channel，`apiVersion`/`version` 使用 metadata channel；下列普通字段必须位于 Track 根 `{}`，不得创建 `<Metadata>`：

| 字段 | 约束 |
|---|---|
| `status` | `new\|in_progress\|completed\|cancelled` |
| `goal` / `description` | 必需，非空文本 |
| `created_at` / `updated_at` | 必需，ISO 8601 |
| `question_mode` | 可选，当前为 `decision-tree` |
| `question_severity` | 可选，`auto\|light\|normal\|deep` |
| `commit_mode` | 可选，`auto\|manual` |

普通节点属性必须放 `{}`，不得误放入 metadata。`Ports`、`SubNodes`、`Schedule`、`Hooks`、`Acceptance`、`Gate` 等集合必须使用 `[]`；singleton 子域使用 `()`。

### 2.3 `<TaskSpace>` 结构验证

- [ ] `<TaskSpace>` 必需。
- [ ] 第一层 `<SubNodes>` 至少一个 `<TaskGroup>`（phase）。
- [ ] 所有 phase 是第一层 `TaskGroup`（不引入独立 `<Phase>` 标签）。
- [ ] phase 之下 `Task`（叶）/`TaskGroup`（非叶）任意层级嵌套；id 全局唯一。
- [ ] 每个 `<TaskGroup>`/`<Task>` 有 `id`；`status` 为枚举 `NOT_STARTED|ACTIVE|DELEGATED|FORWARDED|DONE|REFUSED|ABANDONED`。
- [ ] Track XNL 使用无前缀 `<Gate>` / `<Acceptance>`，其成员进入 `[]`。

### 2.4 `<Schedule []>` 调度验证

- [ ] `<Schedule>` 与 `<TaskSpace>` 并列（兄弟节点）。
- [ ] 每个 `<Dag { for = "P" }>` 的 `for` 引用一个 `{ child_mode = "dag" }` 的节点。
- [ ] 其 `<Node #id>` 与 `<After { ref = "..." }>` 只引用该节点的直接下层 id。
- [ ] 该层内 DAG 无环。
- [ ] 未标 `dag` 的层默认 `sequential`、按 `order` 执行，无需任何依赖配置。
- [ ] 可选 `<Parallel max-concurrent spot-check>`（旧 wave_config）取值合法。

### 2.5 `<Hooks []>` 与引用验证

- [ ] `<Hook { on = "..." }>` 取值合法：`track:before|after`、`phase:before|after`、`task:before|after`。
- [ ] Hook 动作是 `()` 中唯一的 `<AttractorCheck>` / `<GapLoop>` / `<HumanConfirm>`。
- [ ] `<AttractorCheck { use = "..." }>` 的 `use` 能解析到 profile。
- [ ] `<GapLoop>` 的 `max_rounds`、`on_exhausted`、`verify_round` 合法。

### 2.6 `<Ports>` / MaterialBundle 验证

- [ ] `<Ports { scope = "track" } []>` 的 `<MaterialBundle>` `role`、`domain`、`path` 合法。
- [ ] track 作用域**不设** JSON input/output 端口（出现则报错）。
- [ ] input 物料含 `behavior_deltas`；output 物料含 `docs` 与 `behavior`（`codument/behaviors/`）。

### 2.7 behavior 增量验证（旧 XML spec delta）

对 `behavior_deltas/<capability>/delta.xml`：

- [ ] 至少存在一个 `behavior_deltas/**/*.xml` 文件。
- [ ] 每个 XML delta 根节点是 `<behavior-patch capability="<capability>" version="1">`。
- [ ] 每个 mutation 使用 `<upsert|delete|move selector="behavior://...">` wrapper；`move` 还必须有 `to="behavior://..."`。
- [ ] 新增/修改内容用 `<requirement>`、`<statement>`、`<suite>`、`<case>` 等业务节点表达。
- [ ] BDD 场景用可嵌套 `<suite>` / `<case>`，case 内用 `<given>`、`<when>`、`<then>`。
- [ ] 旧 track 的 `spec.md` 仅作兼容格式验证。

### 2.8 Mission 验证（mission-xml-spec §5/§6/§8；CLI rule 前缀 `mission.*`）

`codument validate <mission-id>` 或批量模式会校验 `codument/missions/{pending,active,archived}/<id>/mission.xnl`：

- [ ] `<Metadata><Status>` 为 `pending|active|completed|cancelled|superseded|archived`（`mission.metadata.status`）。
- [ ] `TaskGroup`/`Task` 的 `status` 为 mission 枚举 `NOT_STARTED|ACTIVE|DONE|BLOCKED|ABANDONED|SUPERSED`（`mission.taskspace.status`）——与 track 枚举不同。
- [ ] `<Hook on>` 取值：`track:before|after`、`phase:before|after`、`task:before|after`、`mission:after-node`（`mission.hook.on`）。
- [ ] `<cdt:MissionReconcile>` 的 `max-tracks` 为正整数，`on-limit` ∈ `checkpoint|continue|block`，`on-drift` ∈ `replan-or-block|replan|block`（`mission.reconcile.*`）。
- [ ] `<Schedule><Dag for>` 引用 `cdt:child-mode="dag"` 节点，`Node id`/`After ref` 只引用该层直接下层，且无环（`mission.schedule.*`）。
- [ ] `<cdt:TrackLink>` 只挂在叶子 `<Task>` 上（`mission.tracklink.group`）。
- [ ] `<cdt:ProjectRefs>` / `<cdt:ActorSets>` 契约（四个角色各一次、唯一 host、引用可解析）。

---

## 3. 校验 Behavior 登记表

对于 behavior 目录 `codument/behaviors/<capability>/`：

### 3.1 结构验证

- [ ] `behaviors/<capability>.xml` 或 `behaviors/<capability>/index.xml` 存在；旧 registry 可兼容 `behaviors/<capability>/spec.md`。

### 3.2 XML behavior 验证

- [ ] XML 根节点是 `<capability id="...">`。
- [ ] 至少包含一个 `<requirement>`。
- [ ] 至少包含一个 `<case>`。

---

## 4. 输出格式

### 验证通过

```text
✓ codument/tracks/active/add-user-auth/
  ✓ track.xnl identity / metadata / root properties - 有效
  ✓ <TaskSpace> - 有效 (2 个 phase, 8 个任务)
  ✓ <Schedule> - 有效 (1 个 dag 层, 无环)
  ✓ <Hooks> - 有效 (use=coding 解析成功)
  ✓ behavior_deltas - 有效 (2 个 patch, 3 个 capability)

验证通过！
```

### 验证失败

```text
✗ codument/tracks/active/add-user-auth/
  ✓ track.xnl identity / metadata / root properties - 有效
  ✗ behavior_deltas/csv-export/delta.xml - 错误
    - XML behavior delta root must be <behavior-patch>
    - XML behavior delta must contain at least one mutation with a behavior:// selector
  ✓ <TaskSpace> - 有效

验证失败！请修复以上错误后重试。
```

---

## 5. 严格模式（--strict）

使用 `--strict` 时执行额外检查。

### Track 额外检查

- [ ] `proposal.md` 存在（如果是新 track）。
- [ ] `proposal.md` 含必需部分：背景、变更内容、影响范围。
- [ ] `design.md` 格式正确（如果存在）。
- [ ] 所有 `<case>` 的 `<when>` / `<then>` 语义完整。
- [ ] 无重复的需求名称。
- [ ] 任务 ID 唯一且符合命名规范（phase=`P{n}`、task=`T{phase}.{n}`、验收=`{taskId}-AC{n}`）。

### Behavior 额外检查

- [ ] 无重复的需求名称。
- [ ] 所有需求有唯一标识符。
- [ ] `design.md` 存在且格式正确（如果能力复杂）。

### Action Hooks 额外检查

如果存在 `codument/config/action-hooks.xml`：

- [ ] 根节点是 `<ActionHooks version="1">`（或等价 `<Hook on>` 同构语法）。
- [ ] `<Hook on="...">` 使用已知 action 生命周期点，例如 `plan-track:before`、`plan-mission:before`、`archive-track:after`、`maintain-track:before`。
- [ ] hook 内嵌套的 `<cdt:AttractorCheck>`/`<cdt:ArtifactSync>`/`<cdt:GapLoop>`/`<cdt:HumanConfirm>` 遵循同一套 DSL。
- [ ] `<cdt:AttractorCheck use="...">` 解析到 `attractor-profiles.xml` 的 profile，不使用 direct 文件属性。
- [ ] 缺失 `action-hooks.xml` 是合法状态，不产生错误。

---

## 6. 批量验证

当未指定 `[item]` 时：

1. 列出 `codument/tracks/pending/` 与 `codument/tracks/active/` 下的 tracks。
2. 列出 `codument/missions/{pending,active,archived}/` 下的 missions。
3. 列出所有 `codument/behaviors/` 下的 behaviors。
4. 依次验证每个项目。
5. 汇总结果：

```text
批量验证结果:

Tracks:
  ✓ add-user-auth
  ✓ update-payment-flow
  ✗ fix-login-bug (2 个错误)

Behaviors:
  ✓ auth
  ✓ payment

总计: 4 通过, 1 失败
```

---

## 7. 外部 CLI fallback

若系统装有 `codument` 命令，可跑 `codument validate <item> --strict` 作为补充。**找不到 `codument` 命令时，跳过该步并明确说明「已跳过外部 CLI 校验（未找到 codument 命令）」，不阻塞**——本 skill 的 Markdown 清单校验已是权威结果。

---

## 8. 参考

### 常见错误及修复

| 错误 | 原因 | 修复 |
|------|------|------|
| "XML behavior delta root must be <behavior-patch>" | 新 track 误写成 Markdown 或 XML 根节点错误 | 改为 `<behavior-patch capability="<capability>" version="1">` |
| "XML behavior delta must contain at least one mutation" | patch 中没有 selector mutation | 添加带 `selector="behavior://..."` 的 `<upsert>` / `<delete>` / `<move>` 节点 |
| "Invalid XNL format" | track.xnl 语法错误 | 检查 metadata / `{}` / `()` / `[]` 通道与节点闭合 |
| "Missing required Track property" | Track 根 `{}` 缺字段 | 补 `status` / `goal` / `created_at` 等 |
| "Track must have at least one delta" | 没有 XML behavior delta | 添加 `behavior_deltas/<capability>/delta.xml` |
| "Dag for refers to non-dag node" | `<Dag>` 指向未标 `child_mode = "dag"` 的节点 | 给该节点补 `child_mode`，或移除该 Dag |
| "After ref crosses layer" | `<After ref>` 引用了非直接下层 id | 只在同一父的直接下层之间连边 |
| "mission.taskspace.status 非法" | mission 节点用了 track 枚举（如 `DELEGATED`）或旧 `TODO` | 用 mission 枚举 `NOT_STARTED|ACTIVE|DONE|BLOCKED|ABANDONED|SUPERSED` |
| "mission.hook.on 取值非法" | Hook 用了非 mission 生命周期点 | 用 `track/phase/task:before|after` 或 `mission:after-node` |

---

## 9. 独立验证子代理模式

当本 skill 被旧 `codument-execute-wave` 入口作为验证子代理调用时，执行以下独立验证流程；当前标准下波次执行已并入 `codument-impl-track`。

### 9.1 触发条件

当提示词中包含以下参数时，进入独立验证模式：

- `workspace_dir`：工作区根目录。
- `track_dir`：track 目录路径。
- `wave_id`（可选）：指定验证的 wave。
- `phase_id`（可选）：指定验证的 phase。

### 9.2 Goal-Backward 验证方法

从目标倒推验证，而非从代码正推：

1. **读取验收标准：** 从 `track.xnl` 提取目标 task 的 `<Acceptance []>` 标准。
2. **逐条验证：** 对每个 criterion，检查实现是否满足。
3. **报告差距：** 列出未满足的标准和原因。

### 9.3 三级验证

对每个已完成的 task，执行三级递进验证：

**Level 1: Exists（存在性）**
- 验证 task 声明要修改/创建的文件是否存在。
- 验证 git commits 是否存在（auto 模式 / `CommitMode=auto`）。
- 验证 task `status` 是否为 `DONE`。

**Level 2: Substantive（实质性）**
- 验证文件内容是否包含 task 描述（`<Description>`）中提到的关键变更。
- 验证代码变更是否与 `<Acceptance>` criteria 对应。
- 验证测试是否存在且通过（如 workflow 要求 TDD）。

**Level 3: Wired（连通性）**
- 验证新增代码是否被正确引用/导入。
- 验证新增功能是否在系统中可达。
- 验证配置变更是否生效。

### 9.4 验证报告格式

```text
📋 **验证报告：<wave_id 或 phase_id>**

## 总览
- 验证任务数：<n>
- 通过：<n>
- 失败：<n>

## 详细结果

### T{x}.{y}: <task name>

**Level 1 - Exists:** ✅ 通过
- [x] 文件存在：src/foo.ts
- [x] Task 状态：DONE

**Level 2 - Substantive:** ✅ 通过
- [x] AC1: <标准描述> — 已验证
- [x] AC2: <标准描述> — 已验证

**Level 3 - Wired:** ⚠️ 部分通过
- [x] 导入正确：src/index.ts 引用了 src/foo.ts
- [ ] 配置未更新：config.json 缺少新字段

## 阻塞问题
- <问题描述>（影响：<影响范围>）

## 非阻塞问题
- <问题描述>（建议：<改进建议>）
```

### 9.5 输出协议

验证结果必须按以下顺序输出（issues-first）：

1. **阻塞问题**（blocking issues）— 必须修复才能继续。
2. **非阻塞问题**（non-blocking issues）— 建议修复但不阻塞。
3. **简要总结**（brief summary）— 通过/失败统计。

---

## 10. 参考

- track 文件格式与校验规则：`codument/std/spec/track-xnl-spec.md`（§9）
- behavior delta 写法：`codument/std/spec/behavior-delta.md`
- behavior 登记表格式：`codument/std/spec/behavior-registry.md`
- profile 配置：`codument/config/attractor-profiles.xml`
- 命令级 hook：`codument/config/action-hooks.xml`
