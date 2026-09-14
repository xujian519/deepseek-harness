# Agent Note: 收编硬编码可调参数审计（Issue #88）

Status: implemented

[English](2026-09-14-hardcoded-tunable-closeout.md) | 中文

## Problem

Issue #88 列出了全树十五个模块级常量，并对每一个追问：它硬编码的原因，是否就是缺少一个 `Config` 字段。判定这条追问的规则把它一分为二：随部署而变的取值，属于可从 `cordis.yml` 变更的、经校验的 `Config` 字段；而协议常量、外部规格、安全不变量、内部节奏，一律保持固定。`DEFAULT_*` 常量本身不等于可配置性——因此，只有当某个部署有理由需要别的取值、却无从提供时，这个常量才算缺陷。

要回答该 issue，就需要把每个列出的常量对照这条规则逐一定性，然后只对定性真正指向的项动手。

## Decision

十五个当中只有一个够得上 `Config` 候选，而它保持固定。`SYMLINK_PROBE_CONCURRENCY`（`packages/client/better-sidebar/src/fs-tree.ts`）限制一次目录列举中并发的 `stat` 调用数；部署在网络挂载上的实例确实有可能想要另一个上界，但目前没有任何使用方提出过，且 sidebar 这条路是人机交互路径。依据「Require evidence for public choices」，它保持为常量，现在补上了理由。

其余十四个都已是正确形态，无需改动源码：

| 常量 | 位置 | 为何保持固定 |
| --- | --- | --- |
| `SESSION_SEARCH_RESULT_LIMIT` | `packages/api/session-controller/src/types.ts` | 产品可见的结果条数，已导出并有文档 |
| `SETTINGS_NAMESPACE` | `packages/preset/agent-presets/src/index.ts` | 持久化 settings 文档的键；改名即丢弃已存状态 |
| `SHELL_SETTINGS_NAMESPACE` | `packages/shell/shell/src/index.ts` | 同上，其 JSDoc 已写明归属依据 |
| `FAIL_LOUD_RELEASE_TIMEOUT_MS` | `packages/boot/app-boot/src/index.ts` | 安全不变量：卡住的 disposer 只能推迟致命退出，绝不能取消它 |
| `ZSTD_DECODE_YIELD_INTERVAL_MS` | `packages/session/session-persistence-jsonl/src/index.ts` | 内部调度；已注明它不是部署配置 |
| `ELU_POLL_INTERVAL_MS` | `packages/code-runtime/code-runtime-worker-thread/src/index.ts` | 内部节奏；已注明不是 config |
| `DEFAULT_STREAM_IDLE_TIMEOUT_MS` | `packages/llm/llm-deepseek/src/index.ts`、`packages/llm/llm-pi-ai/src/config.ts` | 已可配置：两个包各自在全字段可选的 `Config` 接口上，以显式的 `resolveAdapterOptions`／`resolve` 步骤，把 `streamIdleTimeoutMs` 的 schema 默认值与 `?? DEFAULT_*` 回退配对 |

剩下五个常量确实固定，但哪儿都没说明，现在各自补上了它不是 `Config` 字段的理由：`STDERR_TAIL_LIMIT` 与 `STREAM_SETTLE_MS`（`packages/sdk/client/src/client.ts`）、`MAX_MISSED_HEARTBEATS`（`packages/api/gateway/src/stream-server.ts`）、`SEARCH_PROVIDER_CALL_LIMIT`（`packages/api/session-controller/src/list.ts`），以及 `SCROLLBACK_PAGE_LINES` 与 `POLL_INTERVAL_MS`（`packages/shell/tool-bash-persistent/src/index.ts`、`packages/shell/tool-pwsh-persistent/src/index.ts`）。

过程中浮现了一个 issue 本身没有点名的真实缺陷。两个 persistent 工具把 `backendType`、`timeoutMs`、`maxOutputChars` 的默认值以裸字面量写了两遍——一遍在 schema、一遍在 `apply()` 的 resolve 步骤——而同一个对象字面量里的 `DEFAULT_DESCRIPTION` 却已经抽取成了常量。在两个包中抽取 `DEFAULT_BACKEND_TYPE`、`DEFAULT_TIMEOUT_MS`、`DEFAULT_MAX_OUTPUT_CHARS`，恢复了周围代码本已示范的对称性，且 schema 默认值与解析结果都不变。

## 前台超时默认值不是同一个旋钮

前台命令的两个默认值分别是：本地执行器（`bash-local`、`pwsh-local`）为 `120_000`，persistent 工具（`tool-bash-persistent`、`tool-pwsh-persistent`）为 `300_000`。这个差异是结构性的，不是疏漏：

- `tool-bash` 与 `tool-pwsh` 不持有自己的默认值。它们只在模型给出 `timeoutMs` 时透传（`...args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}`），否则落到执行器的 `resolve()`，由它填入 `config.timeoutMs` 并夹到 `config.maxTimeoutMs`（`clampTimeout(request.timeoutMs, config.timeoutMs, config.maxTimeoutMs)`）。执行器的取值是「兜底值 + 上限」。
- `tool-bash-persistent` 与 `tool-pwsh-persistent` 通过 `ctx.terminals` 驱动长驻 PTY shell，而非走执行器的 `run()` 路径，因此它们底下没有执行器的 `resolve()`。每个工具必须自己持有截止时间（`deadline(upstream, config.timeoutMs, TIMEOUT_CODE)`），该取值就是工具施加在每条命令上的墙钟上限。

两个取值都是各自包上的 `Config` 字段，仍可从 `cordis.yml` 变更；这个不对称反映的是「上限之下的兜底值」与「自持的上限」两种不同的契约，而不是同一个选择的重复。

## Alternatives considered

- **把 `SYMLINK_PROBE_CONCURRENCY` 提升为 `Config` 字段。** 拒绝：当前没有任何使用方需要别的上界，且规则要求在拓宽公共配置面之前先有证据。改为记录为固定常量并附依据。
- **统一本地与 persistent 的前台超时。** 拒绝：两者经由不同机制解析、适用于不同契约，共享同一个数值并不能让它们变成同一个选择。
- **给其余固定常量补 `Config` 字段。** 拒绝：把内部节奏暴露为配置，只是把一个固定的选择搬进部署文件，并不能让任何部署得到更好的取值。
- **因为正确就不记录这些固定常量。** 拒绝：定性结论正是 Issue #88 索要的交付物；没有它，后来的读者无法区分一个经过斟酌的固定值与一个从未被审视的值。

## Consequences

- 两个 persistent 工具的这三个默认值各自从单一常量解析，schema 与 `apply()` 步骤不可能再漂移。
- 十六个常量现在都写明了为何不是 `Config` 字段，这才使定性结论可被审计，而不只是断言。
- 行为零变更：每个常量保持原值，每个 `Config` 字段保持原默认值。

## Related

- `.agents/audits/2026-09-11-tech-debt-issue-manifest.md` Issue #88
- `docs/TECH_DEBT.md`
- `packages/shell/tool-bash-persistent/src/index.ts`、`packages/shell/tool-pwsh-persistent/src/index.ts`
- `packages/shell/bash-local/src/index.ts`（`resolve`、`maxTimeoutMs`）
- `packages/client/better-sidebar/src/fs-tree.ts`
- `packages/api/gateway/src/stream-server.ts`、`packages/api/session-controller/src/list.ts`
- `packages/sdk/client/src/client.ts`
