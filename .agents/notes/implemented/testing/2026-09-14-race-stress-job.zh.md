# Agent Note: 夜间竞态压测任务（重复 + 乱序）

Status: implemented

[English](2026-09-14-race-stress-job.md) | 中文

## 问题

核心循环、会话、ACP、子代理和子进程套件中的调度、生命周期与拆卸竞态很容易引入，却很难在单次确定性运行中捕获。当文件或测试以特定顺序执行时才会失败的测试，在 CI 上看起来是绿的，随后却在其他工作中随机变红。

## 决策

新增一个专用的夜间 GitHub Actions 任务，以随机顺序多次运行聚焦后的套件子集。该任务中的任何失败都被视为需要修复的竞态缺陷，而不是可以用重试掩盖的噪音。

## 范围

任务聚焦在六个调度、生命周期与拆卸竞态风险最高的目录：

- `packages/core/agent-loop/tests/**/*.spec.ts`
- `packages/core/session/tests/**/*.spec.ts`
- `packages/acp/acp/tests/**/*.spec.ts`
- `packages/subagent/subagent-acp/tests/**/*.spec.ts`
- `packages/subprocess/subprocess-local/tests/**/*.spec.ts`
- `packages/subprocess/subprocess/tests/**/*.spec.ts`

客户端 jsdom 套件被排除：227 个文件的运行成本超出了本轮压测的收益。

## 机制

文件：

- `vitest.race-stress.config.ts` — 专用 Vitest 配置，使用 `pool: 'forks'`、`sequence.shuffle: true`、`retry: 0`，并禁用覆盖率。
- `scripts/vitest-race-stress-runner.ts` — 自定义 runner，在每个收集到的测试运行前注入 `repeats`。
- `.github/workflows/race-stress.yml` — 夜间工作流，通过 cron（UTC 02:00）和 `workflow_dispatch` 触发。
- `package.json` — `test:race-stress` 脚本。

Vitest 4 仅将 `repeats` 暴露为每个测试的选项，而非全局配置或 CLI 参数。自定义 runner 从环境变量 `DSH_RACE_STRESS_REPEATS` 读取重复次数（默认 10），并为未显式声明 repeats 的每个测试设置该值，因此单个 spec 仍可自行选择退出。

`sequence.shuffle: true` 同时对文件顺序和测试顺序进行随机化。`retry: 0` 保持任务的严格性：任何 flaky 都是缺陷。覆盖率被禁用，因为重复会扭曲每个文件的覆盖率门槛，而本任务的目标是发现 flaky，不是测量覆盖率。

## 触发与失败处理

- 触发：夜间 cron（`0 2 * * *`）加手动 `workflow_dispatch`。
- 失败处理：调查并修复底层竞态；不要通过添加重试或重新运行来让任务变绿。

## 验证

一个临时的负控制 spec 包含两个共享可变状态的测试，在竞态压测配置下失败，确认乱序和重复能够暴露顺序依赖。移除该控制后，完整任务在本地通过：

```
Test Files  61 passed | 3 skipped (64)
     Tests  1408 passed | 13 skipped (1421)
  Duration  182.53s
```

## 备选方案

**为 Vitest 添加 `--repeat` CLI 参数或打补丁。**  rejected：仅为一个任务维护 Vitest 的分支或补丁，成本远高于使用公开 `TestRunner` 扩展点编写的约 30 行自定义 runner。

**用 repeats 运行整个套件。**  rejected：完整套件包含 227 个客户端 jsdom 文件，启动缓慢且不是最有价值的竞态表面；聚焦后的子集使夜间任务足够快，结果可执行。

**使用 Vitest 内置重试而非 `retry: 0`。**  rejected：重试会掩盖本任务旨在捕获的 flaky。这里的失败必须按 bug 分诊。

## 后果

- 夜间信号：仓库获得一项针对高敏感区域顺序与调度竞态的每日高容量检查。
- 成本：聚焦后的套件以 10 次重复运行约 3 分钟；扩大重复次数或范围会线性增加时间。
- 失败处理：race-stress 任务变红需要修复；不允许用重试或重新运行来压制。
- 自定义 runner 扩展了 Vitest 公开的 runner API；若该 API 形态变化，runner 必须与 Vitest 版本升级同步更新。

## 相关

- Issue #121 — 提出该机制的跟踪项。
- `.agents/notes/proposed/testing/2026-06-11-deterministic-and-stress-testing.md` — 更广泛的提案；其中的夜间竞态压测项（提案 3）现已实现。
