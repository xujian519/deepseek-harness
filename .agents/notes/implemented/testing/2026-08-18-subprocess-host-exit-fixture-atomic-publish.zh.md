# Agent Note：subprocess 宿主退出 fixture 原子发布托管进程树

Status: implemented

[English](2026-08-18-subprocess-host-exit-fixture-atomic-publish.md) | 中文

## 问题

`process-exit.spec.ts` 在 fork 的 CI 上偶发失败:5 个用例中有 2 个在 30 秒后以 `readTree` 抛出的 `SyntaxError: Unexpected end of JSON input` 超时,即 `tree.json` 存在却始终没有内容。host fixture 只用 `access()` 轮询文件存在,而 managed-tree fixture 用异步 `writeFile` 写入,其 `open` 会在 `write` 完成前先创建空文件。在 fork 的 4 核 `ubuntu-latest` runner 全并发跑 816 个文件时,该间隙大到 host 的 10 毫秒轮询足以命中。host 的 `JSON.parse` 随即抛出未捕获异常,host 退出,其 `exit` 监听清理在写入中途杀死 managed-tree,空文件在整个轮询窗口内保持为空。同一 commit 重跑即通过,因此失败随负载变化,并非代码回归。

## 决策

两个 fixture 都加固了发布握手:

- `managed-tree.ts` 先把 `tree.json` 写入暂存路径,再 rename 就位,读者永远不会看到写了一半的文件:`rename` 是原子的。
- `process-exit-host.ts` 用 `waitForTreeState()` 取代仅检查存在的轮询:持续轮询直到文件可解析为两个有效、不同且为正的 pid。部分或空内容只继续轮询,不使 host 崩溃,因此慢写入永远不会让托管进程树滞留。

## 曾考虑的替代方案

**保留存在性轮询,只加大超时或降低 CI 并发。** 治标不治本:竞态窗口随负载放大,套件在任何繁忙 runner 上仍然脆弱。

**在 managed-tree 中使用同步写入。** 缩小但不消除"可见为空"的窗口,host 仍需容忍部分读取。原子 rename 加内容校验轮询同时覆盖两个方向。

## 后果

套件在 fork 的全并发 CI 下稳定:部分发布的进程树不再使 host 崩溃,任何读者都看不到写了一半的 `tree.json`。轮询无上限,因此托管进程树始终未发布有效内容时,场景仍会在 30 秒截止时响亮失败而非挂起。
