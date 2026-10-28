# Agent Note: 杀停会等待结算并报告终止态

Status: implemented

[English](2026-10-28-job-kill-waits-for-settlement.md) | 中文

## 问题

`job_kill` 在请求取消后立即返回。生产方是异步结算的——`jobs-local` 只在工作真正停止时才追加 `job/settled`——所以结果描述的是一个 `stopping` 状态的任务，模型必须再轮询 `job_output` 才能知道名额是否已释放。而这正是准入错误本身要求的顺序：“use job_kill to stop an unneeded job, wait for it to finish, then retry”。

会话日志继承了同一个缺口。结算落在下一步的哪个位置取决于被杀进程退出的快慢；紧随其后的前台命令可能因为名额仍被 `stopping` 占用而被拒绝准入，`tool-bash` 随后在不注册任务的情况下把它跑完。`background-job-admission` 场景记录的是快时序那一版，本地通过，却在负载中的 CI 上失败（[run 40653383460](https://github.com/xujian519/deepseek-harness/actions/runs/40653383460)：1 failed / 228 passed）：结算晚了一步，并少了两条任务记录。

## 决策

`job_kill` 在返回前等待结算，上限由新增的 `killTimeoutMs` 控制（默认 30s，受 `maxWaitTimeoutMs` 封顶）：

- 任务已终止 → `job <id> [status: killed, <detail>]`；
- 上限先到 → `requested cancellation of job <id>; [status: stopping]`；
- 任务早已结束 → 保持原有的 `had already finished` 结果。

输出 schema 仍为 `cancellation-requested | already-finished`；终止事实由结果本就携带的 `job` 快照给出。`jobs-local.settle()` 在唤醒等待者之前追加 `job/settled`，因此等待返回即保证该事件先于工具结果——顺序不再取决于进程退出的时序。

模型自己的杀停仍通过既有的 `killedByModel` 集合抑制完成通知。释放了等待的结算本来就会被报告为 `awaited`；超时的杀停则和以前一样抑制之后的结算，因此不会有多余通知进入某一步。

工具描述、参数与输出 schema 均未改动。等待行为记录在包 README、`Config` 的 JSDoc 与渲染结果中；“Request cancellation of a running background job” 依然成立，而仅为了措辞去改写 88 个场景里已提交的工具 schema 侧车并不划算。

## 考虑过的替代方案

**在快照 harness 里对并发的任务生命周期事件做规范化排序。** 比改产品便宜，但会掩盖步骤之间以及其他会话事件的真实顺序回归；本仓的规矩是修 fixture，不是修 normalizer。

**在 fixture 里于杀停后插入一个 `job_output(wait: true)` 步骤。** 实测后否决：等待只保证结算早于*更晚*的一步，它相对于下一个 `step/start` 的位置仍然随机，无法让 fixture 确定化。

**去掉杀停，交给关闭流程回收任务。** `bash-startup-timeout` 表明未结算的任务不会产生关闭事件，日志确实会确定下来——但场景会丢掉唯一的 `job_kill` 快照覆盖与释放名额的断言。

**在描述里写明调用会等待。** 那会为一次不改变 schema 的措辞改动，重新生成每个挂载 `tool-jobs` 的场景里已提交的工具 schema 侧车。

## 后果

杀停通常在工作停止的同一瞬间返回；忽略取消的生产方最多让该步骤占用 `killTimeoutMs`。`background-job-admission` 的 fixture 现在把结算记录在杀停结果之前，随后的前台命令也能确定地被准入。`job_output` 的等待语义不变。

渲染结果是模型可见文本，消费方随之更新：`tool-bash`、`tool-pwsh` 与 `tool-terminal` 断言终止行，Web 的 `job_kill` 详情卡渲染终止状态，同时仍识别早期会话记录的 `requested cancellation` 文本。

## 测试

`packages/jobs/tool-jobs/tests/tool-jobs.spec.ts` 覆盖已结算的杀停、上限先到而任务仍为 `stopping`、等待期间落地结算、早已结束的路径、通知抑制，以及适用于新渲染的输出上限。消费方套件（`tool-bash`、`tool-pwsh`、`tool-terminal`）与 Web 详情卡用例断言结算后的结果，以及保留的 `requested cancellation` 回执。

`snapshots/session/background-job-admission` 连续六次本地回放全绿（三次空闲，三次在八进程 CPU 负载下），整条快照车道为 227 passed / 2 platform skips。包覆盖率保持 100%（171/171 statements，147/147 branches）；`typecheck`、lint 与 `test:docs` 均通过。

## 相关

[`docs/testing.zh.md`](../../../../docs/testing.zh.md) 拥有快照车道策略；该场景的 [cordis overlay](../../../../snapshots/session/background-job-admission/cordis.snapshot.yml) 承载本次决策所验证的单名额准入配置。
