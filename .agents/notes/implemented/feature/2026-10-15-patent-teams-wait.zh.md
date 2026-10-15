# Agent Note: PatentTeams 队长改为等待团队变化，而不是轮询

Status: implemented

[English](2026-10-15-patent-teams-wait.md) | 中文

## 问题

从导出会话日志实测两个真实专利团队会话，绝大多数墙钟时间花在等自己：

| | 会话 A（实用新型撰写） | 会话 B（堆肥加速器） |
|---|---|---|
| 墙钟总时长 | 4h34m | 15h40m |
| 工具调用中的纯等待 | 1h13m（27%） | 7h29m（48%） |
| 其中 `sleep` + `job_output` 轮询 | 58m / 13 次 | 5h08m + 33m / 111 次 |
| 其中 `ask_user_question` | 15m | 1h48m（一次阻塞 1h27m） |
| 成员利用率（在队活跃时间） | 0–30% | 2–22% |

队长没有「等到某个成员动手」的原语，于是用 `bash` 拼了一个：

```
+44.6min  bash        sleep 150; cd .../.patent-teams && ls 01-检索/*.md
+45.7min  job_output  {"job_id":"bash-53","wait":true,"timeout_ms":180000}
+49.9min  bash        sleep 280; cd .../.patent-teams && ls ...
+49.9min  job_output  {"job_id":"bash-59","timeout_ms":300000,"wait":true}
```

会话 B 的每一次 `job_output` 都等满了 5 分钟超时。七名成员各自「在队」7.7–10.4 小时，全员活跃合计只有 9.0 小时，而墙钟是 15.7 小时——并行没有换来加速，因为每一次交接都要等队长的下一轮轮询。会话 B 的 82 次轮询快照里有 14 次与上一次逐字节相同。

唤醒通路从来不是问题：成员用 `patent_teams_send_message` 汇报，服务本来就会把这条消息 steer 进队长的下一个模型步。会话 B 的队长收到 73 条成员消息、258 个 `next-step` 收件箱事件——它仍然在 `sleep` 里睡过去了。

三处文案教它这么做：`patent_teams_status` 的描述以 *"Poll this to watch progress."* 结尾；插件的系统提示词用法段写着 *"monitor with patent_teams_status"* 与 *"Poll status until every required task is terminal"*；而 `patent-team-composition` 完全没有「队长该怎么等」的章节。

## 决策

`@deepseek-ai/dsh-patent-teams` 新增 `patent_teams_wait`（队长专用），底层是 `TeamActivity` 等待注册表；同时重写每一处轮询导向的指令。

**原语**（`src/team-activity.ts`，对齐 `@deepseek-ai/dsh-experimental-agent-team` 的 `TeamActivity`）：按团队 id 分桶的一次性 waiter，提供 `wait(teamId, timeoutMs, signal)`、`notify(teamId)`，以及处置时的 `close()`。`timeout_ms` 取 10 000 至 3 600 000 的整数，默认 30 000；服务校验范围，并拒绝没有队长团队的调用方。这份对齐是有意的，并带 `jscpd:ignore` 标记：[实验包规则](../../../../packages/experimental/AGENTS.md)禁止发布包依赖实验包，所以本包无法复用实验包里的那份实现，把该原语下沉到 `util/` 一事保持待办。

**通告点**是已提交的变更，每个都在自己的 `writeTeam`/`appendMailbox` 与事件记录之后触发——建任务、认领、更新（含质量门禁打回）、改派、成员增删、双向邮箱投递，以及调度器镜像进名册的成员状态边沿。

**工具只回答一个问题**——有没有变化（`timed_out`）——不返回快照。持久团队状态仍是唯一事实源：队长在每次等待返回后重读 `patent_teams_status`。等待从不唤醒成员，且只观察注册之后通告的变化。

**文案随之对齐。** status 描述改为 *"Read it before dispatching and again after patent_teams_wait returns; it is a point-in-time snapshot, so never poll it in a loop."*；用法段的派活步骤写明 *"never sleep, poll, or loop on status to pass the time"*，并把超时定位成决策点（派活、接管，或交给用户），而不是再等一轮的理由。`patent-team-composition` 新增「等待纪律」一节，把循环写死为 派活 → `patent_teams_wait` → 重读状态。

## 备选方案

**让等待直接返回变化摘要（谁完成了什么），省掉后续那次 status 读取。** 否决：摘要是状态的第二份投影，会与 `patent_teams_status` 漂移；而且队长无论如何都要看全盘才能决定下一次派活。`dsh-agent-team` 的 `wait_agent` 同样只回报「有变化」。

**把等待也开放给成员。** 否决：成员由调度器经 `deliverToMember` 唤醒，没有可等的事；开放只会诱导成员阻塞自己的回合——正是本次要消除的反模式。

**没有任何成员 running 时立即返回 `noProgress`，对齐 `wait_agent`。** 否决：本插件的调度器在任务图变化后异步 kick 成员，`memberActivity` 要过了那个窗口才报 `running`；派活后立刻等待会误报「没人在干活」。超时本身已经携带信号，队长据全盘判断即可。

**不新增工具，只改提示词让队长「结束 step，等成员消息唤醒」。** 部分采纳，但不充分。消息驱动确实可用，可队长等的是整批任务收敛，而消息是一条条到的；没有阻塞原语它仍要自己造循环。等待把「等到下一次变化」变成一次工具调用。提示词改写与之同批落地，两者互补。

**给 `patent_teams_status` 加 `wait_ms` 参数，而不是新增工具。** 否决：读快照与阻塞等待是两种操作。合并会让读取路径带上阻塞语义，且既有的调用习惯会继续走轮询分支。分开的工具让纪律体现在工具名上：`status` 读，`wait` 等。

## 影响

- 实测会话里产生 5h08m `job_output` 超时与 58m `sleep` 的那套模式不再有存在理由：队长派活、等待、重读。
- 一次等待的代价降到「一次工具调用 + 变化落地的那一刻」，而不是一个固定的轮询周期。会话 B 每次交接 5 分钟的感知延迟降到亚秒级。
- 等待是**进程内**的。其他 DSH 进程改动同一团队时，等待方只能在自己的超时点上醒来。团队状态本身仍是文件持久化的，所以这影响的是唤醒时延而非正确性；已记入 README 的 Known Limitations。
- 等待不是持久状态。它随进程结束，而这正是阻塞调用自身的生命周期——没有需要迁移的东西。
- 模型可见成本：用法段从约 2.4 KB 增至 2.7 KB，目录从 11 个工具 schema 增至 12 个。
- 验证：`pnpm run typecheck`、`pnpm run build`、`pnpm run lint` 均通过。`pnpm run build:check` 抓到了一处包内跑不出来的测试类型错误——vitest 只转译不做类型检查，所以此处改动 spec 后值得补跑一次。包测试 269 条通过，新增了对 waiter 唤醒/超时/中断/处置、队长专用与范围校验的服务路径、以及工具默认值与渲染输出的覆盖。新工具还牵动两份共享夹具，均已复跑：`gen-tool-catalog` 的已发布工具名清单与 `patent-preset`。`pnpm run doc-sync` 51 个门禁通过 50 个；唯一的 `verify-repository-references` 失败是上一次同步的 note 已记录的 full-history clone 现象，与本次改动无关。
