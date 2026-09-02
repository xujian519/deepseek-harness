# Agent Note: /proc stat 读取返回 ESRCH 即代表 pid 已消失

Status: implemented

[English](2026-09-02-procfs-stat-read-esrch-means-gone.md) | 中文

## 问题

`spawnSubprocess` 的进程组用例曾在 Linux CI 上失败一次，错误是 spec 内 `waitGone` helper 抛出的 `Error: ESRCH: no such process, read`。该 helper 用 `process.kill(pid, 0)` 轮询退出状态，并在 Linux 上读取 `/proc/<pid>/stat` 以穿透僵尸态。`readFileSync` 先打开 procfs 文件再读取；当目标任务在两个系统调用之间被回收——恰好是进程组被杀之后的窗口——已打开文件上的 read 返回 `ESRCH`。helper 此前只把 `ENOENT` 当作「已消失」而将 `ESRCH` 重新抛出，导致用例失败，尽管被测行为本身已经成功：helper 崩溃前 `done` 已以 SIGTERM 结算。窗口很窄，这正是该用例此前每次 Linux 运行都通过的原因。

## 决策

`packages/subprocess/subprocess-local/tests/spawn.spec.ts` 中的 `waitGone` 现在把 `/proc/<pid>/stat` 读取返回的 `ESRCH` 与 `ENOENT` 同等对待：两者都表示 pid 不复存在，即 helper 轮询的目标状态。catch 处的注释写明了 open 与 read 之间被回收的竞态。`process.kill(pid, 0)` 探测本就把一切错误视为已消失，保持不变。

## 后果

Linux 退出轮询现在识别任务消失的全部三种 procfs 信号：open 前的 `ENOENT`、open 后 read 的 `ESRCH`、以及僵尸态 `Z`。同形的兄弟探测保持各自策略：`terminal-bash` 的 `processIsRunning` 把任何 procfs 读取错误视为已消失；`lsp-stdio` 的 `processAlive` 仍重新抛出非 `ENOENT` 的读取错误，携带同样的潜在竞态，此处不改，因为它尚未失败，且其所有者可能更倾向更宽的 catch。验证证据：修复前失败为 CI run 33510696039（提交 9bbdc210）；该签名是 Linux procfs 特有，而工作区主机是 macOS 且无 Linux 容器，故本次变更后的下一个 Linux lane 即为修复后复现。

## 落选方案

**像 `terminal-bash` 的 `processIsRunning` 那样把任何 procfs 读取错误都视为已消失。** 在此 helper 处拒绝：stat 读取返回 `EACCES` 或 `EIO` 时无法区分「已消失」与「不可读」，而 `ENOENT` 与 `ESRCH` 各自都精确表示已消失；重新抛出其余错误让轮询对意外平台行为保持响亮。

**给轮询套重试或加大超时。** 拒绝：等待的状态早已明确、轮询本就有界；缺陷是把一个内核信号误读成了该状态，重试或久等只是掩盖误读而非修复。
