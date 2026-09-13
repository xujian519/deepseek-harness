# Agent Note: 以状态等待取代固定睡眠，并界定每个墙钟界的判定对象

Status: implemented

[English](2026-09-13-state-waits-over-fixed-sleeps.md) | 中文

## 问题

Issue #92 列出四类可靠性债务。同一 Issue 上先前的两批已修复快照 harness 的等待诊断（#115）与 keyless 语料漂移（#120）；本批处理其余部分。

- `apps/desktop/tests/bridge-server.spec.ts` 用固定 20 ms 睡眠同步 20 处套接字往返，是全仓最大的单簇。固定延迟不构成「对端已写出帧」的证据：在负载高的 runner 上睡眠先到期，断言读到空的 `frames` 数组，失败信息里没有任何关于「在等什么」的信息。
- 墙钟界在五个套件里累积，却没说清哪一处是被测对象本身、哪一处只是重复另一个断言已经证明的事。
- `vitest.e2e.config.ts` 持有全仓唯一的重试，其注释只把重试归因于并发配额抖动，而配置的 `retry: 2` 会重跑任意失败，含断言失败。
- `packages/experimental/webworker-runtime/tests/compile/transform-corpus.spec.ts` 的已构建包导入扫描在仓库无构建产物时自我跳过——即所有不跑 `pnpm run build` 的车道，包括本 fork 的 CI job——于是丢失构建步骤的车道会退化为静默通过。
- 两项尚未登记：`packages/web/web-search-deepseek/tests/deepseek.e2e.ts` 中永久停用的真实 API 探针，以及确定性测试笔记的措施 3（repeat/shuffle 竞态压测），后者没有属主、也没有任何 CI 机制承载。

## 决定

**桥接服务的往返改为等待帧。** `waitForFrame(predicate)` 解析客户端已累积的行，轮询直到某行匹配，并在无匹配时报告实际到达的帧。以下三点由桥接服务自身行为推出：

- `beforeEach` 用白名单内的无副作用方法（`desktop/unregisterGlobalShortcut`）做就绪握手。桥接服务在 accept 回调里挂上后端套接字，因此连接事件不能证明之后的 `notify()` 推送会到达该客户端，完成一次往返才能。
- 无 id 帧的用例断言的是「不存在」，而无存在之事件可等；它现在在非法帧之后补发一个合法帧，并断言帧总数。桥接服务按请求顺序作答，因此若对无 id 帧有回复，它必然出现在 id 1 响应之前。
- `afterEach` 去掉固定等待，只保留一次尽力而为的 `unlinkSync`：POSIX 下关闭监听时 Node 自己会 unlink 套接字文件，Windows 的管道名则根本不是文件；给这一改动第一版的有界重试做插桩后，十次尝试全部报 `ENOENT`——该循环每个用例白白多等 200 ms，等的是一个早已被删掉的文件。

**墙钟界只保留它真正判定的部分。** `packages/experimental/code-runtime-python/tests/runtime.spec.ts` 删除三处 elapsed 断言：它们的「记录在案」断言是运行结局本身，而消耗掉墙钟预算的运行会报告 `timeout`（或得到一个已定义的 `error`）而非被断言的取值，故这些界只可能虚假失败。保留的界各自区分两种真实结局，并写明所区分者：墙钟截止对「否则永久运行」的程序（`maxWallMs: 500`）、CPU 硬上限对墙钟天花板、`dispose()` 必须等满的宽限期、close 截止兜底对 setsid 孤儿的自行退出、以及 `ui-primitives` 中回退工作量上限——实测约 60 ms 对 3 s 界。

**e2e 重试留在外部边界，但如实描述。** `retry: 2` 保留，注释记录它会重跑任意失败，因为真实 API 测试无法把自己的期望与提供方区分开：一次运行共用一个内部 key，配额或提供方抖动会包在它所破坏的那个断言里。收窄的 `condition` 正则表达不了这件事，并写明 keyless 快照层才是复现间歇缺陷的地方。

**语料扫描宣告自己的跳过。** CI 下发 `::warning::compiled-bundle import sweep skipped: the workspace has no build output`，与 sandbox-windows-acl 探针跳过的做法一致，并把同一理由传给 `context.skip`。该警告就是消费方：它把静默通过变成一条运行注解。

**登记。** 停用的搜索探针保留停用状态与既有理由，并记入债务台账。确定性测试笔记的措施 3 现由 [Issue #121](https://github.com/xujian519/deepseek-harness/issues/121) 跟踪，并在该笔记中记录 Vitest 4 的选项名与其 `--repeat`/`--shuffle` 措辞不同（`test.repeats`、`--sequence.shuffle`）。

## 考虑过的替代方案

- **用 `condition` 正则收窄 e2e 重试。** 否决：提供方瞬时故障的失败文本是它所破坏的断言而非故障本身，消息过滤恰好会在重试该生效时把它移除。
- **删除全部 elapsed 界。** 否决：其中数处是唯一能把「被测截止」与「无界等待」分开的可观测量；删除等于用盲区换掉一次偶发失败。
- **为负载余量放宽保留的界。** 否决：那会缩小每个界存在的意义，而实测余量已超过任何可信的调度延迟。
- **让语料扫描在无构建产物时失败。** 否决：纯单测车道本就没有构建产物，失败会打断正确的车道；消除静默靠的是注解。
- **用有界重试等待套接字文件消失。** 试过后否决：给该循环插桩发现每次尝试都报 `ENOENT`，即关闭监听的一方早已删掉该文件，于是这段等待只给它本要加速的套件每用例多加了 200 ms。
- **把 better-sidebar 两个 EditorHost 用例改写成 `vi.waitFor`。** 以「无据」否决：这两个用例只在审计的全量跑中失败过一次，而在 CPU 饱和下的十次运行每次 18 个用例全过，从失败信息里也指认不出被等待的状态。台账改为登记该观测与复现尝试。
- **在本批顺带落地竞态压测 job。** 否决：那属于 CI 拓扑而非测试修复，需要自行决定范围、预算与失败消费方式。

## 影响

桌面桥接套件的每次套接字往返现在都会带着实际到达的帧失败，而不是读到空数组；该文件约 0.4 s 跑完（每用例 14 ms），而此前仅睡眠就每用例 20 ms。墙钟界的「删除还是记录」划分给仓库留下一条规则：elapsed 断言必须写明它区分的两种结局。两处盲区是构造使然：e2e 车道仍会重跑断言失败，因此该车道的间歇缺陷要么被快照层、要么被人工重跑才能复现；已构建包扫描仍不跑在本 fork 的 CI 里——它现在会说出来，而不是静默通过。EditorHost 的观测是登记，不是修复。

## 测试

`pnpm exec vitest run apps/desktop/tests/bridge-server.spec.ts`（19 通过，0.4 s）；`pnpm exec vitest run packages/client/better-sidebar/tests/cov-host-git.spec.ts packages/client/ui-primitives/tests/markdown.client.spec.tsx packages/experimental/code-runtime-python/tests/runtime.spec.ts packages/experimental/webworker-runtime/tests/compile/transform-corpus.spec.ts`（302 通过 / 2 跳过）；语料跳过分支通过临时强制空语料并设 `CI=1` 实跑，打印出 `::warning::` 行并跳过（已回退）；`pnpm run lint`（0 警告 / 0 错误）与 `pnpm run typecheck`。

## 相关

- [快照 harness 的等待诊断](2026-09-12-snapshot-wait-diagnostic.zh.md) —— 同一条规则在 session-snapshot 等待上的应用。
- [修复 keyless 录制会话语料](2026-09-12-snapshot-corpus-repair.zh.md) —— Issue #92 上的前一批。
- [用户补丁事务决定文件系统事件投递](2026-09-09-user-patch-hmr-test-delivery.zh.md) —— 其 `eventually` 辅助已报告负载与已等待时长，覆盖该族的负载敏感用例。
- [同仓 Issue 的技术债务跟踪](../process/2026-09-11-tech-debt-issue-tracking.zh.md) —— Issue #92 与新开 Issue #121 的登记处。
