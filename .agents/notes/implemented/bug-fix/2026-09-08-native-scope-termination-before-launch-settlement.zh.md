# Agent Note: 原生进程围栏在启动请求被消费前收到终止请求时按该信号结算

Status: implemented

[English](2026-09-08-native-scope-termination-before-launch-settlement.md) | 中文

## 问题

上游 v0.1.3-alpha.2 为普通子进程与 PTY 终端引入了 Linux 用户级 systemd scope 启动方式（`packages/subprocess/subprocess-local/src/linux-scope.ts`）：`systemd-run --user --scope` 启动一个 node 引导 runner，runner 消费一份私有的启动请求文件，再 execve 目标进程。只要 scope 在该文件仍存在时退出，直接启动结果就以 `subprocess scope exited before its bootstrap consumed the launch request` 拒绝。

在具备可用用户级 systemd 的主机（GitHub 托管的 `ubuntu-latest`）上，在引导窗口内向进程组发信号——立即 `kill()`、50 ms 中止、或早于引导完成的按调用超时——会在 runner 消费请求前终止 `systemd-run`，因此这类调用全部暴露出该拒绝而非被杀结果。fork CI 有 17 个测试分布在七个文件（`bash-local`、`pwsh-local`、`bash-sandbox`、`tool-bash`、`tool-pwsh`、`subprocess-local`）在该窗口内失败。在没有用户级 systemd 的主机上，`selectContainmentMode` 选择 detached 直接 spawn，被信号命中的子进程直接报告该信号，同样的测试得以通过；上游的 Linux 机型通过了该套件，这只可能在 fallback 路径上成立（合成 pty 永远无法消费原生启动请求），因此立即终止类测试编码的是 fallback 契约。同套件的 TERM 升级测试记录了相邻风险："a fixed sleep is load-flaky: a slow spawn would take the SIGTERM before the trap"。

同一窗口还间歇性地挂起整个 fiber 的 disposal（在近乎空闲的 2 核 runner 上，相位计时诊断显示 27% 的启动触发）：当组信号同时结束 `systemd-run` 与 runner 时，用户级 systemd 可能在没有任何存活进程的情况下持续报告 scope `active`——cgroup 中可能残留未被收割的 runner 僵尸（GitHub 托管 runner 不收割再孤化的孤儿进程），也可能只是 manager 的单元状态滞后——`SystemdScopeOwner.waitForExit()` 因此永久轮询；`disposeManagedProcesses` 等待该观察结果，`fiber.dispose()` 永不返回。诊断转储给出了证据：一个 `loaded active running` 的 scope 带着未消费的 `launch-request.json`，而进程表中没有任何存活成员（第一版残留检查以 owner 的 establishment 标志为门槛而从未触发，因为首次轮询在启动器退出可见之前就把 loaded 单元标记为 established）。

另一个 fork CI 失败，`reports the plugin version in lockstep with package.json`，源于 v0.1.3-alpha.2 同步只更新了 `@deepseek-ai/dsh-better-sidebar` 的 package.json 而没有同步 `SIDEBAR_SERVICE_VERSION`。

## 决策

`bindManagedProcess`（`packages/subprocess/subprocess-local/src/spawn.ts`）现在在终止请求已发出且拒绝携带新的 `DSH_LAUNCH_REQUEST_UNCONSUMED` 标记码时，把启动拒绝结算为 `{ exitCode: null, signal: <最后请求的信号> }`——该标记由 `packages/subprocess/subprocess-local/src/runner-protocol.ts` 的 `unconsumedLaunchRequestError` 构造，普通与终端两类 scope 结果都会抛出。其余拒绝保持拒绝语义，因此与 teardown 竞争的真实 spawn 失败仍然上浮（`disposal contains a spawn-failure rejection that races teardown` 契约），且调用方保留自己的取消事实：截止时间分类（`timedOut`/`aborted`）与 tool 层的结构化 `TOOL_ABORTED` 错误都来自调用方的 signal，而非该结果。

`packages/subprocess/subprocess-local/tests/local.spec.ts` 中有三个测试固定 `internals.platform = 'darwin'`，按编写时的 fallback 围栏选择路径运行：两个驱动合成 node-pty 的终端簿记测试（`releases a terminal after top-level exit reaches quiescence`、`retains a terminal whose automatic cleanup fails`——合成 pty 无法消费原生 scope 的启动请求），以及 `disposal contains a spawn-failure rejection that races teardown`（在原生 scope 上，teardown 信号可以在坏工作目录被读取之前，正当地把引导中的启动结算为请求的终止信号）。

`SystemdScopeOwner.rangeActive()` 现在在加载态单元报告 `active` 但启动从未到达消费阶段时结算该范围：启动请求仍存在（消费时会删除它）、直接启动器已退出、且启动器进程组没有任何存活成员（`linuxProcessGroupHasLiveMembers`，即 fallback owner 使用的忽略僵尸的探测，通过 `DirectRange.hasLiveMembers` 闭包与 `processGroupHasLiveMembers` 测试 seam 接入）时，单元状态属于残留，观察停止。该检查不依赖 establishment 标志，因此「在启动器退出可见前就把单元标记为 loaded」的轮询不会搁浅观察；已消费请求的启动不满足检查条件，保留其以 manager 为权威的退出语义。

`SIDEBAR_SERVICE_VERSION` 重新对齐为 `0.1.3-alpha.2`。

## 备选方案

**在 `linux-scope.ts` 内翻译该拒绝。** 直接层在被信号终止的未消费退出上的拒绝由 `linux-scope.spec.ts` 断言（`does not mistake pre-establishment unit absence for quiescence and settles an empty range after cancellation`），因此该层契约保持不变；与 fallback 路径的等价性属于启动结果组合层。

**把请求终止之后到达的拒绝全部结算为被杀。** 否决：与 teardown 竞争的真实 spawn 失败（如坏工作目录的 ENOENT）必须保持拒绝，只有未消费启动请求标记能识别由我方信号导致的退出。

**让立即终止类测试先等输出标记再 kill。** 削弱测试契约（启动后立即 kill 应结算为被杀）只是掩盖引导窗口语义而非修复；fallback 路径本就满足该契约。

## 影响

- 在具备用户级 systemd 的主机上，引导窗口内的立即 kill、中止或短超时按请求的信号结算，与 fallback 路径一致；无用户级 systemd 的主机行为不变，因为其直接结果本就携带信号正常结算。
- 被信号终止且 cgroup 中仅剩僵尸的未消费 scope 不再阻塞 `waitForExit()` 与整个 fiber 的 disposal；泄漏的启动请求目录经由正常的 owner 清理移除。
- 未消费启动请求的拒绝在 `linux-scope` 直接层、以及在没有终止请求的退出场景中仍然可观察。
- fork CI 在 `ubuntu-latest` 上选择原生围栏路径（上游的 Linux 机型在这些套件上不选择它），因此该引导窗口在每次 fork CI 运行中都被覆盖。
