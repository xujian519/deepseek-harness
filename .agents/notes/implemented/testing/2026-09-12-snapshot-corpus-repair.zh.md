# Agent Note: 修复 keyless recorded-session 语料

Status: implemented

[English](2026-09-12-snapshot-corpus-repair.md) | 中文

## Problem

`pnpm run test:snapshot`(keyless 回放层)在 master 上是红的:4 个文件、14 个用例失败。它没有浮出水面,是因为 fork 的 CI 跑的是 `vitest run`,不包含 `vitest.snapshot.config.ts`。累积的漂移有四处,每一处都是「已合并的对模型/协议可见输出的改动、其 fixture 从未更新」:

- `todo_write` 新增 `tags`(`daebc0e82f`),而 `sdk/system-prompt-in-history`、`session/subagent-tool-filter`、`session/macos-tools-validation` 的 tool-schema 侧录仍是旧 schema。
- `SESSION_FORMAT_VERSION` 升到 3(`f7a6221158`),而 `macos-tools-validation` 目录只有 v2 代,语料策略因此拒绝其选中代。
- `str_replace_editor` 退出默认工具集(`36a4665144`),而 `macos-tools-validation` 的侧录仍在列它。
- 客户端面开始再导出宿主 `ToolCallId`(Issue #83)、ACP 握手上报包版本(Issue #84),而 `session/cordis-inspect-jsdoc` 与全部 `snapshots/acp` 的 stdout 期望仍钉着旧值。

修 fixture 时又暴露出漂移之下的两个缺陷:

- `macos-tools-validation` 用 `persona` 配置 system-prompt 插件,而字段名是 `personaPrefix`。schema 非严格,未知键被剥掉,于是该场景一直在断言一段它的组合从未组装的 persona。
- ACP 的会话创建转录存在竞态:会话通过排在 `session/new` 响应之外的 `config_option_update` 公告配置项,并在会话关闭后丢弃它;于是以该响应为最后一步的场景能否捕获公告取决于调度——某次 refresh 写出两行期望,下一次写出三行。

## Decision

- 用官方 keyless 路径 `pnpm run test:snapshot:refresh` 再生漂移的期望(回放并重写 stdout 期望与可比会话 fixture)。`macos-tools-validation` 在保留的 v2 代旁新增 `session.v3.jsonl`;其余改动都是上表能解释的取值或行数更新。
- 修正该场景的配置键,使其组合真正组装它所声明的 persona。
- 让 ACP 会话转录在构造上确定:`newSession` 输入步骤接受 `waitForConfigOptionUpdate`,它在**发出请求之前**装好对公告的等待,并在响应之后 await。关键是「请求前装好」——在响应之后才注册的等待会错过已经到达的公告,因为客户端不重放先前的更新。七个会创建会话的 ACP 场景全部启用它;`reject-extra-dirs` 的 `session/new` 被拒,没有公告可等。
- 保留 v2 代:回放选取编号最高者,语料策略把该场景计为 current-writer。

## Alternatives considered

- **把 refresh 对 `writer.expected.jsonl` 的重写一并提交。** 否决:这些差异只是重新盖上时间字段(`time`、`time0`、`dt`),而比较过程本就会归一化它们;已提交的值是经过评审的固定点,重盖属于无关噪声。
- **让 bridge 在应答 `session/new` 之前就公告配置项。** 否决:bridge 有意把拓扑解析放在响应路径之外,而竞态只影响「以响应收尾」的转录;为稳定测试去串行化它会改变所有客户端的生产时序。
- **把两种顺序都接受为 stdout 变体。** 否决:`stdoutExpectedVariants` 只支持规范期望加可选的 Windows 原生变体,且实际差异是「有没有」而非顺序。
- **在 harness 里为每个 `newSession` 自动装等待。** 否决,改用显式的场景字段:组合根本不发公告的 ACP 场景会因此死在隐藏超时上,而不是声明它在等什么。

## Consequences

keyless 层转绿且稳定(连续三次回放,132 通过 / 2 跳过),refresh 可复现(两次 refresh 产出的 ACP 期望逐字节一致)。但该层仍在 fork CI 之外,同类漂移可能再次累积:四处漂移都是合法产品改动随未更新 fixture 一起合入。漂移之下发现的两个缺陷现在由该层钉住,却仍无自己的门禁——非严格的插件配置依旧吞掉拼错的键,而新增 ACP 场景必须记得那个公告等待。

## Testing

`pnpm run test:snapshot` 跑三次(每次 132 通过 / 2 跳过),`pnpm run test:snapshot:refresh` 跑两次且 ACP 期望逐字节一致,以及 `pnpm exec vitest run packages/test-support/session-snapshot`(68 通过,含新增的步骤断言)。

## Related

- [声明式类型依赖、带品牌的桥接身份,与真实上报的 agent 版本](../bug-fix/2026-09-12-cross-boundary-declarations.zh.md)——本修复为其 ACP 版本改动更新了期望的那一批。
- [在仓内 Issue 中跟踪技术债](../process/2026-09-11-tech-debt-issue-tracking.zh.md)——记录该红层的审计,Issue #92 以测试可靠性跟踪它。
