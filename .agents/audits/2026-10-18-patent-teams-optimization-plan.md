# patent-teams 模块优化 — 执行任务清单与验证检查清单

- 日期：2026-10-18
- 基线：`master`（2026-10-18 审查当日）；`@deepseek-ai/dsh-patent-teams` `0.2.1-rc.2`
- 范围：`packages/patent/patent-teams`（`src/`、`tests/`、`README.md`、`README.zh.md`、`tsconfig.json`、`package.json`）；必要时只读核对 `packages/core/tools`、`packages/subagent/subagent`、`packages/client` 的消费方
- 依据：2026-10-18 深度审查（17 个源文件 5,078 行；16 个测试文件 280 用例全绿；上游 `@nanmicoder/dsh-agent-teams` 0.1.23 / 0.1.24-rc.1 对比）
- 用途：按批次推进；每个任务独立 PR、可独立回滚；完成后回写 §9 执行记录
- 原则：先正确性、再契约、最后工程化；P0 先于一切重构；行为变更必须附回归用例与必要的快照/文档更新

> 本文只描述待办工作，不包含任何代码变更。审查基线时工作树中 `packages/patent/patent-core` 有无关改动，本清单只以已提交的 `patent-teams` 代码为准。

## 1. 结论与批次

审查确认 **2 个 P0、4 个 P1** 是已存在的正确性/数据保真问题，不是风格建议。现有 280 个用例全部通过，说明覆盖率不低，但关键断言放错了位置（恒真断言、绕过 ToolRuntime、`v8 ignore`）。

| 批次 | 内容 | 目标 | 建议 PR 数 |
|---|---|---|---|
| A | P0-01、P0-02 | 消除安全机制死代码与工具契约错误 | 2 |
| B | P1-01 ~ P1-04 | 消除消息丢失、门禁绕过、归档失真 | 3~4 |
| C | P2-01 ~ P2-08 | 去重、性能、错误分类、文档与依赖漂移 | 分批 |
| D | U-01 ~ U-03 | 上游同步评估，默认不在 A/B/C 内执行 | 待决策 |

## 2. 任务总览

| ID | 优先级 | 任务 | 主要文件 | 依赖 | 状态 |
|---|---|---|---|---|---|
| P0-01 | P0 | 退休成员守卫接线（或整体移除） | `src/index.ts`、`src/members.ts`、`tests/composition-dispose.spec.ts` | — | 已完成 |
| P0-02 | P0 | `create_task` 输出契约补 `worker` | `src/tools.ts`、`src/task-ops.ts`、`tests/tools.spec.ts` | — | 已完成 |
| P1-01 | P1 | `status` 只 ack 已展示的消息 | `src/service.ts`、`src/status-view.ts`、`src/tools.ts`、`tests/service.spec.ts` | — | 已完成 |
| P1-02 | P1 | 质量门禁以已存 `output` 触发 | `src/task-ops.ts`、`tests/service.spec.ts` | — | 已完成 |
| P1-03 | P1 | 拒绝保留队名 `archive` | `src/service.ts`、`src/state.ts` | — | 已完成 |
| P1-04 | P1 | `delete` 归档保留任务终态 | `src/service.ts`、`src/state.ts` | — | 已完成 |
| P2-01 | P2 | 合并 4 组重复实现 | `src/team-lock.ts`、`src/scheduler.ts`、`src/mailbox.ts`、`src/team-access.ts` | B 批完成 | 待执行 |
| P2-02 | P2 | 降低 `status` 读取放大 | `src/service.ts`、`src/scheduler.ts`、`src/mailbox.ts` | P2-01 | 待执行 |
| P2-03 | P2 | 补持久化记录校验 | `src/state.ts`、`src/task-ops.ts` | — | 待执行 |
| P2-04 | P2 | 引入稳定错误码 | `src/types.ts`、`src/task-ops.ts`、`src/members.ts` | P0/P1 | 待执行 |
| P2-05 | P2 | 修配置与文档漂移 | `README.md`、`README.zh.md` | P1、P2-08 | 待执行 |
| P2-06 | P2 | 修依赖与 tsconfig references | `package.json`、`tsconfig.json` | — | 待执行 |
| P2-07 | P2 | 修测试真实性与覆盖盲区 | `tests/**`、`src/tools.ts` | P0/P1 | 待执行 |
| P2-08 | P2 | 邮箱租约提为 Config | `src/mailbox.ts`、`src/index.ts` | — | 待执行 |
| P2-09 | P2 | `service.ts` 分层拆分（可选） | `src/service.ts`、`src/status-view.ts` | P1 全部完成 | 部分完成（status 已拆出） |
| U-01 | U | deny 表容忍宿主工具缺失 | `src/members.ts` | — | 待决策 |
| U-02 | U | 成员延迟到首个任务就绪再启动 | `src/member-runtime.ts`、`src/members.ts` | — | 待决策 |
| U-03 | U | 缺失 `attempt_id` 时返回当前 attempt | `src/task-ops.ts` | — | 待决策 |

状态取值：待执行 / 进行中 / 已完成 / 已阻塞 / 不执行。

## 3. P0 任务

### P0-01 退休成员守卫接线（或整体移除）

**目标**：消除“定义了安全机制但生产路径从未安装”的死代码状态。`remove_member` / `delete` 的隔离承诺必须由一条被测试覆盖的生产路径承担。

**证据**

- `src/members.ts:427` 定义 `installRetiredMemberGuard`。
- `src/index.ts:106-152` 的 `apply()` 没有调用；全仓 `rg installRetiredMemberGuard` 仅命中 `tests/members.spec.ts`。
- 写侧存在：`src/member-runtime.ts:258`、`src/service.ts:599`；读侧唯一生产引用 `src/state.ts:178` 只在守卫内部被调用。
- 引入自初始移植提交（`git log -S installRetiredMemberGuard` 可复现），不是后续重构回归。
- `tests/composition-dispose.spec.ts:78-82` 断言 `guardProbe.listChildren` 等于 `stub.listChildren`，而两者在 `:30` 是同一函数引用，恒真。

**改动文件**

- `packages/patent/patent-teams/src/index.ts`
- `packages/patent/patent-teams/src/members.ts`（仅在改用宿主 API 时）
- `packages/patent/patent-teams/tests/composition-dispose.spec.ts`
- `packages/patent/patent-teams/tests/members.spec.ts`

**步骤**

1. 先做决策：确认宿主 `ctx.subagents` 是否已提供 retire/forget/隐藏已退休子会话的原生 API（审查时 `packages/subagent/subagent/src/index.ts` 没有 forget/retire）。
2. 若没有原生 API：在 `apply()` 中 `new PatentTeamsService(ctx, resolved)` 之后、注册工具之前调用 `installRetiredMemberGuard(ctx, resolved.stateDir)`。
3. 若已有原生 API：改用宿主 API，并删除 `installRetiredMemberGuard`、`recordRetiredMemberIds` 的写侧与 `retired-members.json` 读取路径；不要保留中间态。
4. 确认守卫通过 `ctx.effect()` 注册，dispose 时恢复原方法；若没有，补上恢复逻辑并测试。
5. 把 `composition-dispose.spec.ts` 的恒真断言改为：安装后 `stub.listChildren !== guardProbe.listChildren`；dispose 后 `===`。
6. 新增行为用例：写入 retired id → mount → `listChildren` 不含该成员；`sendMessage` 以 `NOT_RESUMABLE` 拒绝。
7. 全仓搜索确认没有第二套 retirement 机制。

**测试**

- 安装后列表过滤 retired id；dispose 后恢复原始方法。
- `remove_member` 后 `listChildren` / `listDescendants` 不再包含该成员。
- 对 retired 成员 `sendMessage` 被拒绝。
- 变异检查：临时注释掉安装调用，组合测试必须失败；恢复后通过。

**完成标准**

- `rg -n "installRetiredMemberGuard" packages/patent/patent-teams/src` 返回“定义 + 生产调用”两处。
- `retired-members.json` 要么被读取并生效，要么随机制一起删除，不存在只写不读。
- 组合测试在移除安装后会失败（证明断言有效）。

**验证命令**

```sh
pnpm exec vitest run packages/patent/patent-teams/tests/composition-dispose.spec.ts packages/patent/patent-teams/tests/members.spec.ts
rg -n "installRetiredMemberGuard" packages/patent/patent-teams/src
```

**风险与回滚**

- 风险：宿主 API 变更导致 monkey patch 脆弱；重复 `apply()` 可能双重包装。安装函数必须幂等，或由 `ctx.effect` 保证只注册一次。
- 回滚：单 PR revert；若改为删除机制，需同时恢复写侧/读侧与测试，不保留半套。

### P0-02 `create_task` 输出契约补 `worker`

**目标**：带 `worker` 创建任务时，工具不再在任务已持久化之后抛 `ToolOutputError`。

**证据**

- `src/task-ops.ts:256-262` 条件性返回 `worker`。
- `src/tools.ts:244-254` 输出 schema 为 `additionalProperties: false`，只声明 `task_id/subject/status/assignee`。
- 校验发生在 `packages/core/tools/src/index.ts:1813-1815`；越界判定见 `json-schema.ts:573-577`。
- 现有 `tests/tools.spec.ts` 直接调 `tool.execute`，绕过 registry 校验，因此漏检。

**改动文件**

- `packages/patent/patent-teams/src/tools.ts`
- `packages/patent/patent-teams/tests/tools.spec.ts`（或新增 `tests/tool-contract.spec.ts`）

**步骤**

1. 在 `patent_teams_create_task` 的输出 `properties` 中增加 `worker: { type: 'string' }`。
2. 新增一条走真实 `ctx.tools.execute('patent_teams_create_task', { subject, worker }, exec)` 的集成用例：断言无 `ToolOutputError`、返回值包含 `worker`、`team.json` 中任务 `worker` 已写入、任务数仍为 1。
3. 逐个核对另外 11 个工具的“返回键 ⊆ 声明键”：
   - `create`、`add_member`、`remove_member`、`reassign_task`、`claim_task`、`update_task`、`send_message`、`wait`、`status`、`archive`、`delete`。
   - `status` / `archive` 的 schema 是 `additionalProperties: true`，重点核对其余封闭 schema。
4. 在 PR 描述中贴出核对表；若发现第二处不一致，在同一 PR 修复并补用例。

**测试**

- 带 `worker` 创建任务成功；不带 `worker` 仍成功。
- 失败重试不会产生重复任务（模拟模型收到错误后重试的路径）。
- 其余 11 个工具的封闭输出 schema 与返回值一致。

**完成标准**

- 真实 ToolRuntime 路径下 `create_task + worker` 成功。
- 输出 schema 中 `worker` 可见，模型能读到契约字段。
- 不存在“先写盘、后报错”的路径。

**验证命令**

```sh
pnpm exec vitest run packages/patent/patent-teams/tests/tools.spec.ts
pnpm exec vitest run packages/patent/patent-teams/tests
```

**风险与回滚**

- 风险：增加模型可见字段，Web 工具卡/快照可能需要更新。
- 回滚：单 PR revert；若选择删除返回字段而非补 schema，需确认没有消费方依赖该字段（当前审查未发现）。

## 4. P1 任务

### P1-01 `status` 只 ack 已展示的消息

**目标**：消除“只展示一部分、却确认全部”的静默消息丢失。

**证据**

- 队长：`src/service.ts:553` 渲染 `captainInbox.slice(-10)`，`:563-569` 却 ack `captainInbox` 全量。
- 成员：`src/service.ts:531-544` 只保留 `{ count, latest: content.slice(0, 200) }`，`:565-569` 却 ack 全量未读。
- 调度器依赖 `readAt` 过滤补投（`src/scheduler.ts:136-140`），被错误 ack 的消息不会重投。
- 现有用例只覆盖单条消息的完整确认（`tests/service.spec.ts` 的 “acknowledges its own inbox” 用例），没有覆盖“部分展示、部分确认”。

**改动文件**

- `packages/patent/patent-teams/src/service.ts`（`PatentTeamsStatus` 接口在 `:701-760`）
- `packages/patent/patent-teams/src/tools.ts`（`renderStatus` 在 `:21`）
- `packages/patent/patent-teams/tests/service.spec.ts`
- `packages/patent/patent-teams/tests/service-coverage.spec.ts`

**步骤**

1. 队长侧：`const visibleCaptain = captainInbox.slice(-10)`；`captain_inbox` 由 `visibleCaptain` 渲染；新增 `captain_inbox_omitted = captainInbox.length - visibleCaptain.length`；只 ack `visibleCaptain.map(message => message.id)`。
2. 成员侧：读取未读后取前 10 条（FIFO，保证任务指令按顺序到达）；返回 `{ count, messages: visible.map(({from, content, ts}) => ({from, content, ts})), omitted }`；只 ack 这 10 条的 id。
3. 删除 200 字截断：凡是会被 ack 的消息，正文必须完整返回；未展示的消息不得 ack。
4. 更新 `service.ts:701-760` 的 `PatentTeamsStatus` 接口与 `tools.ts:21` 的 `renderStatus`，显式打印 `omitted` 数量。
5. 更新 `service.spec.ts` 中固化的旧断言（单条消息的确认行为保持不变），并在 PR 说明中标注“这是行为修正，不是测试适配”。

**测试**

- 队长 11 条未读：返回 10 条、`omitted=1`、恰好 10 条被 ack；第二次 `status` 返回剩余 1 条。
- 成员 3 条各 500 字：3 条完整正文可见、3 条被 ack，无截断丢失。
- 成员 25 条未读：前 10 条可见、10 条被 ack、`omitted=15`；第二次从第 11 条继续。
- ack 集合始终是展示集合的子集。

**完成标准**

- 不存在“消息被 ack 但模型从未看到完整正文”的路径。
- 超过上限时，返回体明确给出 `omitted` 计数。
- 调度器补投路径仍能读到未被 ack 的消息。

**验证命令**

```sh
pnpm exec vitest run packages/patent/patent-teams/tests/service.spec.ts packages/patent/patent-teams/tests/service-coverage.spec.ts
```

**风险与回滚**

- 风险：返回体变大；用 10 条上限约束。成员侧改 FIFO 会改变消息出现顺序，需在 PR 说明理由。
- 回滚：单 PR revert；不要只回滚 ack 而保留截断，那会恢复数据丢失。

### P1-02 质量门禁以已存 `output` 触发

**目标**：带 `worker` 的任务不能在“完成时不带 `output`”的路径上跳过门禁。

**证据**

- `src/task-ops.ts:494-496`：`shouldGate` 要求 `args.output !== undefined`。
- `src/task-ops.ts:543`：契约校验同样以 `task.output !== undefined` 为前提。
- 工具 schema 允许先 `in_progress + output`、再 `completed` 不带 output（`src/tools.ts:335-343`）。

**改动文件**

- `packages/patent/patent-teams/src/task-ops.ts`
- `packages/patent/patent-teams/tests/service.spec.ts`

**步骤**

1. 计算 `const submittedOutput = args.output ?? task.output`（用 `!== undefined` 判断，空字符串是合法输出）。
2. `shouldGate = targetCompleted && host.qualityGate && task.worker !== undefined`。
3. 若 `shouldGate && submittedOutput === undefined`：在写状态前返回带错误码的失败（建议 `WORKER_OUTPUT_REQUIRED`），提示成员必须提交 output。
4. 用 `submittedOutput` 调用 `runQualityGate`；通过后把 `submittedOutput` 落到 `task.output`，再进入完成路径。
5. 契约校验使用同一个 `submittedOutput`，不再单独依赖 `args.output`。

**测试**

- 先 `in_progress + output`（低分），再 `completed` 不带 output → 门禁运行、被打回、`gateFeedback` 存在、`gateRejections` 递增、状态回到 `in_progress`。
- 先 `in_progress + output`（高分），再 `completed` 不带 output → 完成。
- 带 `worker` 从未提供 output 就 `completed` → 失败、状态不变、不追加完成事件。
- 非 `worker` 任务不带 output 完成 → 行为不变。

**完成标准**

- 任何带 `worker` 的完成路径都经过门禁或显式拒绝。
- 失败路径不产生 `task-updated` 完成事件，不写脏状态。

**验证命令**

```sh
pnpm exec vitest run packages/patent/patent-teams/tests/service.spec.ts
```

**风险与回滚**

- 风险：现有成员可能依赖“先写 output 再完成”的宽松路径；修复后无 output 的完成会被拒绝，属行为收紧。README/系统提示需说明。
- 回滚：单 PR revert；不要只改 `shouldGate` 而保留 `args.output` 契约校验。

### P1-03 拒绝保留队名 `archive`

**目标**：队名 `archive` 不再造成归档目录自嵌套与队长永久锁死。

**证据**

- `src/team-lock.ts:94-105` 的 `sanitizeKey` 没有保留字。
- `src/service.ts:193` 直接把清洗后的队名用作目录 id。
- `src/state.ts:379-383` 归档 source=`<root>/archive`、target=`<root>/archive/archive`，`rename` 必然失败。
- 失败后 `create` 又因“一队长一团队”（`src/service.ts:196-201`）拒绝新队，队长只能手工改文件系统。

**改动文件**

- `packages/patent/patent-teams/src/service.ts`
- `packages/patent/patent-teams/src/state.ts`（保留字常量）
- `packages/patent/patent-teams/tests/service.spec.ts`

**步骤**

1. 在 `state.ts` 定义并导出 `RESERVED_TEAM_IDS = new Set(['archive'])`，与 `archive/` 目录常量放在一起。
2. 在 `create` 中 `sanitizeKey` 之后、加锁之前校验；命中保留字时抛出可操作错误（建议 `TEAM_RESERVED_ID`），提示换名。
3. 覆盖大小写与符号变体：`archive`、`Archive`、`ARCHIVE`、` archive ` 均被拒绝（因为 `sanitizeKey` 会归一化）。
4. 不创建任何目录、不写 team.json、不追加事件。

**测试**

- `create('archive')` → 错误，状态根下无该队目录。
- 之后 `create('archive-2')` 成功。
- `delete` 一个正常队仍能归档成功。

**完成标准**

- 任何合法队名都不会解析为 `archive`。
- 归档根目录永远不会被当作 live 队目录。

**验证命令**

```sh
pnpm exec vitest run packages/patent/patent-teams/tests/service.spec.ts
```

**风险与回滚**

- 风险：已存在的 `archive` 队已经处于锁死状态；本修复不自动迁移，需在 README/错误文案给出人工恢复指引。
- 回滚：单 PR revert。

### P1-04 `delete` 归档保留任务终态

**目标**：删除团队后归档仍能真实复盘失败/取消的任务。

**证据**

- `src/service.ts:592-594` 对非 `completed` 任务调用 `invalidateTaskAttempt`。
- `src/state.ts:109-125` 无条件 `task.status = 'pending'` 并删除 `output`。
- `src/service.ts:654-661` 的归档详情直接读该记录，不做状态修补。
- README 承诺删除后保留任务供复盘（`README.md:53,77`）。

**改动文件**

- `packages/patent/patent-teams/src/state.ts`
- `packages/patent/patent-teams/src/service.ts`
- `packages/patent/patent-teams/tests/service.spec.ts`
- 必要时 `packages/client` 的归档读取方测试

**步骤**

1. 在 `state.ts` 新增 `revokeTaskAttempt(task)`：删除 `attemptId`、设置 `handoffId = randomUUID()`、删除 `reassigning`；**保留** `status`、`assignee`、`output`、`gateFeedback`、`gateRejections`。
2. `delete` 对非 `completed` 任务改用 `revokeTaskAttempt`；`invalidateTaskAttempt` 继续服务 reassign/retry 的“重置为 pending”语义。
3. 确认归档读取方（`patent_teams_archive`、Web 面板）能处理 `failed`/`cancelled` 状态，不假设只有 `pending`。
4. 新增用例：失败任务带 `output: 'boom'` → 删除后归档详情仍为 `failed`、`output` 保留、`attemptId` 已清除。

**测试**

- 失败任务归档后状态仍为 `failed`，失败输出保留。
- 取消任务归档后状态仍为 `cancelled`。
- 完成任务归档后状态不变。
- 所有成员任务在归档后 `attemptId` 为空，晚到的成员更新被拒绝。

**完成标准**

- 归档记录的 `completed/total` 统计与删除前一致（除成员状态改为 removed）。
- 不存在的“失败任务变未开始”现象。

**验证命令**

```sh
pnpm exec vitest run packages/patent/patent-teams/tests/service.spec.ts packages/patent/patent-teams/tests/state.spec.ts
```

**风险与回滚**

- 风险：改变归档数据形态；现有 UI/测试可能依赖 `pending`。需同时检查 `packages/client` 的 Teams 视图。
- 回滚：单 PR revert；不要只保留状态而继续删除 `output`。

## 5. P2 任务

### P2-01 合并 4 组重复实现

**目标**：消除跨文件同构代码，降低“一处修复要改多处”的成本。

**证据与动作**

1. 互斥队列：`src/team-lock.ts:24-37` 与 `src/scheduler.ts:249-262` 逐行同构。提取 `serialize(key, fn)`，`withTeamLock` 作为薄包装；确认两者 key 语义一致后再合并。
2. open-task 谓词：`src/scheduler.ts:86-89` 与 `src/team-access.ts:114-118`。复用 `memberOpenTask`。
3. `isFiniteNumber`：`src/state.ts:290-292` 与 `src/mailbox.ts:246-248`。先查 `@deepseek-ai/dsh-util-values` 是否已有同义 helper，再决定提取位置。
4. 邮箱租约包装：`src/service.ts:393-400,412-421`、`src/scheduler.ts:138-156` 共 5 处 `withTeamLock(... claim|ack|release)`。提取 `withMailboxLease(stateRoot, teamId, agentKey, fn)`。

**完成标准**

- 行为不变，全部 280 个既有用例通过。
- `pnpm run duplication` 不再报告这些克隆。
- 新增/修改代码有对应单测；不为了去重改变锁的获取顺序。

**验证命令**

```sh
pnpm exec vitest run packages/patent/patent-teams/tests
pnpm run duplication
```

**风险**：并发语义变化；必须在 P1 全部完成后做，且每个合并单独提交。

### P2-02 降低 `status` 读取放大

**目标**：一次 `status` 不再对每个成员重复解析 `team.json`、整读邮箱。

**证据**

- `src/service.ts:462` 每次队长 `status` 先 `kickTeam`；`src/scheduler.ts:283-286` 对每个成员 `kickMember`，`:293` 每次重新 `readTeam`。
- `src/service.ts:531-537` 再对每个成员 `readUnreadMailbox`（整文件 `split('\n')`，`src/mailbox.ts:100-117`）。
- `acknowledgeMailbox` 整文件重写（`src/mailbox.ts:177`）。

**动作**

1. `status` 开头只 `readTeam` 一次，把快照传给 `kickTeam` / `kickMember`；若 kick 需要修改记录，传只读视图并避免并发写。
2. 邮箱读取改为尾部增量读，或至少缓存文件偏移；没有未读时跳过 `acknowledgeMailbox` 重写。
3. 新增 spy 用例：8 人团队一次 `status`，`readTeam` 调用次数 ≤ 2；无未读时 `acknowledgeMailbox` 不被调用。

**完成标准**：行为不变；读取次数有可断言的下降；不引入跨请求缓存。

**验证命令**

```sh
pnpm exec vitest run packages/patent/patent-teams/tests/service.spec.ts packages/patent/patent-teams/tests/scheduler.spec.ts
```

**风险**：快照可能过期；kick 本身是尽力而为，过期快照可接受，但不能用于授权判定。

### P2-03 补持久化记录校验

**目标**：手工编辑或旧版本的 `team.json` 不再让 `updateTask` 在锁内抛 `TypeError`。

**证据**

- `src/state.ts:309-331` 的 `isTeamTask` 不校验 `worker`、`contractValidation`、`gateFeedback`、`gateRejections`。
- `src/task-ops.ts:581,615` 使用 `workerContract(workerName)!`，而 `:611-641` 的 JSDoc 声称 “Never throws”。
- `src/state.ts:140` 的 `JSON.parse` 异常没有文件上下文。

**动作**

1. `isTeamTask` 增加可选字段校验：`worker` 为字符串；`gateRejections` 为非负整数；`contractValidation` / `gateFeedback` 为对象且关键字段类型正确。
2. 把 `workerContract(workerName)!` 换成显式未命中分支，返回带错误码的失败（建议 `WORKER_CONTRACT_UNKNOWN`）。
3. `parseTeamRecord` 包裹 `JSON.parse` 异常，错误信息带文件路径与 team id。
4. 用例：`worker: 123`、`gateRejections: -1`、`contractValidation: []` 均被拒绝并指明文件；`updateTask` 返回错误而不是 `TypeError`。

**完成标准**：持久化记录的任何畸形字段都在读取边界失败，错误可定位到文件。

**验证命令**

```sh
pnpm exec vitest run packages/patent/patent-teams/tests/state.spec.ts packages/patent/patent-teams/tests/service.spec.ts
```

### P2-04 引入稳定错误码

**目标**：成员不需要解析英文/中文文案来判断“所有权已变”。

**证据**

- 8 个文件 30+ 个裸 `new Error(`；唯一类型化错误是 `TeamApprovalError`（`src/approval.ts:22-35`）。
- `src/members.ts:222` 的 persona 让成员把 stale-attempt 文案当作“停止工作”的信号。

**动作**

1. 在 `types.ts` 或新 `errors.ts` 定义 `PatentTeamsError`，带稳定 `code`：`STALE_ATTEMPT`、`ALREADY_CLAIMED`、`TASK_TERMINAL`、`DEPENDENCIES_OPEN`、`WORKER_OUTPUT_REQUIRED`、`WORKER_CONTRACT_UNKNOWN`、`TEAM_RESERVED_ID`。
2. 先改 `task-ops.ts` 的模型可见失败路径；消息保留人类可读文本，测试同时断言 `code`。
3. 更新 persona：引用 `code` 而不是具体文案。
4. 不要求一次改完 30+ 处；按文件拆分，避免大 diff。

**完成标准**：stale/claimed/terminal 三类失败有稳定码；改文案不改变 agent 行为。

**验证命令**

```sh
pnpm exec vitest run packages/patent/patent-teams/tests
```

**风险**：模型可见文本变化，需快照/文档同步。

### P2-05 修配置与文档漂移

**目标**：README 与实现一致，部署方能找到门禁开关。

**证据**

- `src/index.ts:86-87` 的 `qualityGate` / `passThreshold` 未进 `README.md:31-42`、`README.zh.md:31-41`。
- `README.zh.md:61` 声称“加载与追加时校验每个载荷”，但 `src/events.ts:36-47` 只追加不校验；英文版无此句。
- 状态模型只列 `team.json` 与 `inbox/`（`README.md:48-51`），漏 `retired-members.json`（`src/state.ts:26`）。
- 组合测试名 “all ten tools” / “all eleven tools” 与实际 12 个不一致（归入 P2-07）。

**动作**

1. 中英文 README 的配置块补 `qualityGate`、`passThreshold`，注明默认关闭/默认 0.7。
2. 删除或修正 `README.zh.md:61` 的 invariant 声明。
3. 状态模型补 `retired-members.json`（若 P0-01 决定删除该机制，则改为说明不存在）。
4. 检查 `## Known Limitations and Deferred Work` 是否仍准确。
5. 运行文档门禁。

**完成标准**：`rg -n "qualityGate|passThreshold" README.md README.zh.md` 有命中；中英文事实一致。

**验证命令**

```sh
pnpm run test:docs
```

**风险**：若 P2-08 新增配置，需同批更新 README，避免二次漂移。

### P2-06 修依赖与 tsconfig references

**目标**：依赖清单与项目引用反映真实 import。

**证据**

- `package.json:36,51` 与 `tsconfig.json:38` 声明 `dsh-patent-core`，但 `rg patent-core packages/patent/patent-teams/src tests` 零命中。
- `src/ids.ts:12`、`src/state.ts:19`、`src/mailbox.ts:15`、`src/tools.ts:13`、`src/approval.ts:17` 使用了 `dsh-brand` / `dsh-value` / `dsh-util-values` / `dsh-user-approval`，但 `tsconfig.json:10-46` 没有对应 references。

**动作**

1. 删除 `package.json` 的 `dsh-patent-core`（peer + dev）与 `tsconfig.json` 的 `../patent-core` reference。
2. 按 `src` 实际 import 补齐 references：`../../util/brand`、`../../util/value`、`../../util/values`、`../../interaction/user-approval`。
3. 运行 `pnpm install` 更新 lockfile；确认没有其他包依赖本包间接获得 `patent-core`。
4. 运行 `pnpm run typecheck` 与 `pnpm run hygiene`。

**完成标准**：`rg -n "patent-core" packages/patent/patent-teams` 零命中；typecheck/hygiene 通过。

**验证命令**

```sh
pnpm run typecheck
pnpm run hygiene
```

**风险**：lockfile churn；单独 PR，避免与行为修复混在一起。

### P2-07 修测试真实性与覆盖盲区

**目标**：让测试能发现 P0-01/P0-02 这类问题。

**动作**

1. 从 `tools.ts` 导出唯一的 `PATENT_TEAMS_TOOL_NAMES` 元组，`index.ts` 的系统提示与测试共用，删除三处重复清单。
2. `composition-dispose.spec.ts:50`、`loader-composition.spec.ts:83` 改为断言完整清单（12 个），不再写死 10/11。
3. 删除 `tests/probe.spec.ts`（与 `state.spec.ts:471-540` 重叠）。
4. 新增 `withTeamLock` 的“回调抛错后队列释放 / FIFO 顺序 / 并发互斥”专项用例。
5. 删除 `v8 ignore` 块，优先 `service.ts:469-514` 的 status 投影；补空值/无成员/无任务/无未读分支。
6. 增加真实 ToolRuntime 集成用例：`create_task`、`update_task`、`status` 至少各一条走 registry 的路径。
7. 变异检查写入 PR：移除守卫生成安装或 `worker` 字段时，对应测试必须失败。

**完成标准**

- 组合测试在缺少任一工具时失败。
- 新增集成用例覆盖“输出 schema 越界”。
- `service.ts` 的 status 投影不再依赖 `v8 ignore`。

**验证命令**

```sh
pnpm exec vitest run packages/patent/patent-teams/tests
pnpm run test:coverage
```

**风险**：覆盖率工作量大，可分文件推进；`test:coverage` 是全仓门禁，较慢，只在删除 ignore 的 PR 中运行。

### P2-08 邮箱租约提为 Config

**目标**：投递租约是部署可变行为，不再硬编码。

**证据**：`src/mailbox.ts:20` 的 `MAILBOX_DELIVERY_LEASE_MS = 60_000` 直接影响重投语义。

**动作**

1. `Config` 增加 `mailboxDeliveryLeaseMs`，默认 60000，校验为正整数。
2. `mailbox.ts` 从配置读取，不在模块级写死。
3. 队长收件箱 10 条上限与 200/300 字截断保持固定，作为 token 预算常量在 README 说明。
4. 用例：租约设为 1ms 时，过期消息可被重投；默认值行为不变。

**完成标准**：配置覆盖生效；README 配置块同步。

**验证命令**

```sh
pnpm exec vitest run packages/patent/patent-teams/tests/state.spec.ts packages/patent/patent-teams/tests/scheduler.spec.ts
```

### P2-09 `service.ts` 分层拆分（可选，最后做）

**目标**：`status` / `sendMessage` / `delete` / `archive` 不再内联在 Service Definition 中，与 `task-ops` / `member-runtime` 的委托范式一致。

**动作**：新增 `status-view.ts`、`messaging.ts`、`archive-ops.ts`，`service.ts` 只保留委托与类型；纯移动，不改行为。

**完成标准**：`service.ts` 行数显著下降；全部测试不改断言即通过。

**风险**：大 diff、易冲突；必须在 P1 全部完成后做，且单独 PR。若 P1 已重构相关方法，可取消本项。

## 6. 上游同步候选（待决策）

本地移植基点约为上游 v0.1.8（推断，仓库无书面记录）；上游最新 `0.1.23` / `0.1.24-rc.1`。以下不作为本地缺陷，需单独评估。

### U-01 deny 表容忍宿主工具缺失

- 证据：`src/members.ts:42-54` 的 `MEMBER_DENIED_TOOLS` 硬编码宿主工具 `send_message`，注释明确 `tools.restrict()` 遇未知名会抛错并导致 `patent_teams_add_member` 失败。
- 上游 v0.1.19 已修复同类问题。
- 建议：spawn 时按 `ctx.tools` 实际注册名过滤 deny 表；缺失工具在 status 中给出警告，而不是中止成员创建。
- 决策点：是否存在部署会改名/移除 `send_message`；若没有，可降为 P3。

### U-02 成员延迟到首个任务就绪再启动

- 证据：`src/members.ts:304-320` 每次 `add_member` 都用 welcome prompt 启动一轮模型 turn；`src/member-runtime.ts:165-188` 随后才 kick 首个任务。
- 上游 v0.1.18 改为“首个任务就绪时启动”，消除 welcome-only turn。
- 建议：单独立项，涉及成员状态机（未启动成员、remove_member、status 显示）与 `startActivation` 时序；不要与 P1 混做。
- 预期收益：8 人团队减少 8 次无任务模型调用。

### U-03 缺失 `attempt_id` 时返回当前 attempt

- 证据：`src/task-ops.ts:478` 对缺失/不匹配一律抛 stale。
- 上游 v0.1.18 允许成员拿回当前 attempt 后重试，只拒绝真正过期。
- 决策点：必须限定“调用者就是当前 assignee 且任务处于 claimed/in_progress”，否则会削弱能力模型。

## 7. 可验证检查清单

每个任务 PR 必须勾选对应条目，并在 PR 描述中粘贴命令与结果。不要只写“测试通过”。

### 7.1 静态检查

- [ ] **A-01 守卫已接线**：`rg -n "installRetiredMemberGuard" packages/patent/patent-teams/src` 返回定义 + 生产调用两处（若选择删除机制，则返回零处且 `retired-members.json` 写侧一并删除）。
- [ ] **A-02 `worker` 在输出 schema 中**：`rg -n -A14 "name: 'patent_teams_create_task'" packages/patent/patent-teams/src/tools.ts`，确认 `output.schema.properties.worker` 存在。
- [ ] **A-03 ack 集合来自展示集合**：`rg -n "captainInbox.slice|acknowledgeMailbox|member_inboxes" packages/patent/patent-teams/src/service.ts`，确认 ack 的 id 列表由 `visibleCaptain` / `visibleMember` 派生。
- [ ] **A-04 门禁不再依赖 `args.output`**：`rg -n "shouldGate|submittedOutput" packages/patent/patent-teams/src/task-ops.ts`，确认 `shouldGate` 不含 `args.output !== undefined`。
- [ ] **A-05 保留队名**：`rg -n "RESERVED_TEAM_IDS|TEAM_RESERVED_ID" packages/patent/patent-teams/src` 有命中，且 `create` 在写盘前校验。
- [ ] **A-06 归档保留终态**：`rg -n "revokeTaskAttempt" packages/patent/patent-teams/src` 在 `delete` 路径命中；`invalidateTaskAttempt` 不再出现在 `delete` 中。
- [ ] **A-07 重复实现已合并**：`rg -n "serialize\(|memberOpenTask|withMailboxLease" packages/patent/patent-teams/src` 有单一实现；`pnpm run duplication` 无新增克隆。
- [ ] **A-08 文档一致**：`rg -n "qualityGate|passThreshold|retired-members" packages/patent/patent-teams/README.md packages/patent/patent-teams/README.zh.md` 中英文均有命中。
- [ ] **A-09 依赖无漂移**：`rg -n "patent-core" packages/patent/patent-teams` 零命中。
- [ ] **A-10 `v8 ignore` 已收敛**：`rg -c "v8 ignore" packages/patent/patent-teams/src` 为 0，或每个保留块在 PR 中有理由与对应覆盖缺口说明。

### 7.2 行为场景

| ID | 场景 | 操作 | 期望 |
|---|---|---|---|
| S-01 | 带 worker 创建任务 | 真实 ToolRuntime `create_task {subject, worker}` | 成功；返回含 `worker`；`team.json` 任务数 1、`worker` 已写 |
| S-02 | 移除成员后可见性 | `remove_member` → `list_agents` | 成员不再出现；`sendMessage` 被拒绝 |
| S-03 | 队长 11 条未读 | 连续发送 11 条 → `status` | 返回 10 条、`omitted=1`、仅 10 条被 ack；第二次返回剩余 1 条 |
| S-04 | 成员长消息 | 发送 500 字 → `status` | 完整正文可见且被 ack，无 200 字截断丢失 |
| S-05 | 门禁绕过 | `in_progress + output(低分)` → `completed` 不带 output | 被打回；`gateFeedback` 存在；状态回到 `in_progress` |
| S-06 | 无 output 完成 | 带 worker、从未提交 output → `completed` | 被拒绝；状态不变；无完成事件 |
| S-07 | 保留队名 | `create('archive')` / `create('Archive')` | 被拒绝；无目录；可另建 `archive-2` |
| S-08 | 归档保真 | 失败任务带 output → `delete` → `archive` | 状态仍 `failed`、output 保留、`attemptId` 已清除 |
| S-09 | status 读取次数 | 8 人团队一次 `status`（spy） | `readTeam` ≤ 2 次；无未读时不重写邮箱 |
| S-10 | 畸形记录 | `team.json` 的 `worker=123` → `update_task` | 返回带文件路径的错误，无 `TypeError` |
| S-11 | 错误码 | stale attempt / already claimed / terminal | 错误带稳定 `code`，文案变化不影响断言 |

### 7.3 命令门禁

| ID | 门禁 | 命令 | 适用 | 通过标准 |
|---|---|---|---|---|
| G-01 | 包级单测 | `pnpm exec vitest run packages/patent/patent-teams/tests` | 每个任务 | 全绿；基线 280 用例不得因修复而删除（P2-07 明确删除的 `probe.spec.ts` 除外，删除需在 PR 说明） |
| G-02 | 类型检查 | `pnpm run typecheck` | 每个任务 | 退出码 0 |
| G-03 | Lint | `pnpm run lint` | 每个任务 | 退出码 0 |
| G-04 | 构建 | `pnpm run build` | 合并前 | `build:artifacts` + `build:check` 均通过 |
| G-05 | 文档门禁 | `pnpm run test:docs` | 改 README | 退出码 0 |
| G-06 | 文档全量 | `pnpm run doc-sync` | 改文档树/包 README | 退出码 0 |
| G-07 | 覆盖率 | `pnpm run test:coverage` | 删除 `v8 ignore` 时 | 目标文件 per-file 100%；若用分区则 `pnpm run test:coverage:partitioned` |
| G-08 | 依赖卫生 | `pnpm run hygiene` | 改 `package.json`/lockfile | 退出码 0 |
| G-09 | 重复检测 | `pnpm run duplication` | P2-01 | 无新增克隆 |
| G-10 | Web 快照 | `pnpm run build && pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/patent-teams-panel.e2e.ts` | 工具卡/状态展示变化 | 快照与预期一致；若行为变更需说明并刷新 |
| G-11 | 变异检查 | 临时移除守卫安装 / `worker` 字段，跑 G-01 | P0-01、P0-02、P2-07 | 对应测试必须失败；恢复后全绿 |

> `G-07` 是全仓门禁，较慢；只在删除 `v8 ignore` 或改动覆盖率敏感代码的 PR 中运行，不在每个小 PR 重复。

### 7.4 批次完成定义（DoD）

- **A 批（P0）**：G-01、G-02、G-03、G-04 通过；G-11 两项变异检查均能失败；无新增 `v8 ignore`。
- **B 批（P1）**：A 批 DoD + S-03 ~ S-08 全部通过；涉及模型/用户可见输出的变更已更新 README 与 Web 快照（G-10）。
- **C 批（P2）**：B 批 DoD + G-07（若删除 ignore）、G-08（若改依赖）、G-09（若去重）通过；文档漂移清零。

## 8. 风险、回滚与不做的事

### 8.1 全局风险

- **P0-01 的方向必须先决策**：安装守卫 vs 删除机制。不要在未确认宿主 API 的情况下直接补一行安装，否则可能保留一套与宿主 retirement 冲突的 monkey patch。
- **P1-01 / P1-04 改变用户可见数据**：消息 ack 语义与归档状态都可能影响 Web 面板；必须同批检查 `packages/client` 的读取方。
- **P2-01 是并发重构**：必须在 P1 全部完成后做，且按“互斥队列 → 谓词 → 数值 helper → 邮箱包装”逐项提交，不做一次性大改。
- **U-02 不是小改**：成员启动时序涉及状态机、remove_member、status 显示，单独立项，不与 P1 混做。

### 8.2 回滚策略

- 每个任务一个 PR；回滚即 revert 该 PR。
- 数据形态变更（P1-04）需要向前兼容读取：归档读取方应能处理旧记录；若不能，先加读取兼容再改写入。
- 删除 `v8 ignore` 的 PR 若覆盖率无法达标，先恢复 ignore 并保留新增用例，不要降低全仓阈值。

### 8.3 已确认健康、不要动的部分

- 无循环依赖；17 个模块分层清晰。
- 锁内无外部服务 `await`；spawn/路由/投递/审批都在锁外。
- 无死锁；唯一嵌套锁是 `create` 的 captain → team。
- 无双重认领窗口；`reassigning` 与 `attemptId` 校验覆盖。
- 邮箱追加是单次 `O_APPEND`；变更走原子替换；租约过期可重投。
- 归档失败回滚完整；隐藏恢复目录被过滤。
- 路径遍历已封堵；`sanitizeKey` 处理 Unicode/长度。
- 状态机 6 个状态全部可达，终态无出边。
- `team-activity` waiter 无泄漏。
- 12 个工具与 9 个事件清单与 README 一致。

## 9. 执行记录

| 任务 | 状态 | PR | 日期 | 备注 |
|---|---|---|---|---|
| P0-01 | 已完成 | — | 2026-10-18 | 宿主无 forget/retire seam，选择安装；组合测试改为非恒真并新增 retired 过滤/`sendMessage` 拒绝用例 |
| P0-02 | 已完成 | — | 2026-10-18 | 输出 schema 补 `worker`，带 worker 时渲染文本也显示该字段；新增真实 ToolRuntime 契约用例；两项变异检查均按预期失败 |
| P1-01 | 已完成 | — | 2026-10-18 | 队长展示最新 10 条并只 ack 这 10 条；成员按 FIFO 展示 10 条完整正文并只 ack 该页；状态投影拆到 `status-view.ts` |
| P1-02 | 已完成 | — | 2026-10-18 | 以 `args.output ?? task.output` 触发门禁；带 worker 且从未提交 output 的完成被显式拒绝 |
| P1-03 | 已完成 | — | 2026-10-18 | `RESERVED_TEAM_IDS` 拒绝 `archive`/`Archive`，`archive-2` 可正常创建 |
| P1-04 | 已完成 | — | 2026-10-18 | `revokeTaskAttempt` 保留 status/assignee/output，仅清 attempt/handoff/reassigning；归档保留失败与取消终态 |
| P2-01 | 待执行 | — | — | B 批完成后开始 |
| P2-02 | 待执行 | — | — | 依赖 P2-01 |
| P2-03 | 待执行 | — | — | 只校验可选字段 |
| P2-04 | 待执行 | — | — | 按文件拆分 |
| P2-05 | 待执行 | — | — | 与 P2-08 同批更新 |
| P2-06 | 待执行 | — | — | 单独 PR，含 lockfile |
| P2-07 | 待执行 | — | — | 先做工具清单单一真源 |
| P2-08 | 待执行 | — | — | 只提租约，不提 token 常量 |
| P2-09 | 部分完成 | — | 2026-10-18 | `status` 已拆到 `status-view.ts`；`sendMessage`/`delete`/`archive` 仍在 service 中 |
| U-01 | 待决策 | — | — | 先确认部署是否改名宿主工具 |
| U-02 | 待决策 | — | — | 单独立项 |
| U-03 | 待决策 | — | — | 需限定 assignee 与状态 |

### A 批验证（2026-10-18）

- `pnpm exec vitest run packages/patent/patent-teams/tests` → 17 个测试文件、283 个用例通过（基线 280 + 3 个新增）。
- 新增 `tool-contract.spec.ts`：真实 ToolRuntime 下 `create_task + worker` 成功，结构化输出与渲染文本均含 `worker`；无 worker 路径不受影响。
- `pnpm run typecheck` → 5/5 门禁通过。
- `pnpm exec tsx scripts/run-oxlint.ts packages/patent/patent-teams` → 退出码 0。
- `pnpm run build` → 9/9 门禁通过。
- 变异检查 1：移除 `create_task` 输出 schema 的 `worker` 声明 → `tool-contract.spec.ts` 的带 worker 用例如期失败；已恢复。
- 变异检查 2：注释 `apply()` 中的守卫安装 → `composition-dispose.spec.ts` 的安装/行为用例如期失败；已恢复。
- 已提交：`111e9c4570`（`fix(patent-teams): install retirement guard and fix create_task output`）。

### B 批验证（2026-10-18）

- `pnpm exec vitest run packages/patent/patent-teams/tests` → 17 个测试文件、292 个用例通过。
- `pnpm run typecheck` → 5/5 门禁通过。
- `pnpm exec tsx scripts/run-oxlint.ts packages/patent/patent-teams` → 退出码 0。
- `pnpm run build` → 9/9 门禁通过。
- `pnpm run verify-cordis-catalog` → 133 个生成文件/区域最新。
- `pnpm run verify-export-jsdoc` → 通过。
- `pnpm run verify-translation-pairing packages/patent/patent-teams/README.md` → 1 对一致。
- `pnpm run verify-repository-references` → 通过（已移除计划中的 commit hash）。
- 债务计数：`structure.large-files` 回到 77（拆出 `status-view.ts` 后 `service.ts` 降到 800 行以下）；`lint.v8-ignore` 由 1172 降至 1166 并已回写 `docs/TECH_DEBT.md`。
- 全量 `pnpm run test:docs` 仍有两项与本批无关的本地失败：`structure.long-functions` 因工作树中未提交的 `packages/patent/patent-core/src/atoms/handlers/builtin/chart.ts` 新增 151 行 `execute`；`verify-translation-pairing` 因被 gitignore 的 `litho.docs/patent/README.md` 缺少中文对照。这两项不进入 B 批提交。
- P1-01 不变量：队长与成员的 `acknowledged` 集合都严格等于本次展示的消息 id；未展示的消息保持未读。
