# Agent Note: M1 第三批下沉——中止与键集谓词

Status: implemented

[English](2026-09-12-abort-and-keyset-sink.md) | 中文

## 问题

2026-09-11 的复测推翻了 M1 的「0 剩余」结论,并点出两个台账从未登记过的谓词族。`isAbortError` 有五份副本、两种形态:inspector 与三个 `web-search-*` provider 判定 `instanceof DOMException`,而 `fs-local` 判定 `instanceof Error`——同一个问题被两套运行时假设各自回答。`hasExactKeys` 有三份副本、三种签名:`schedule` 比较排序后的键列表,`llm-replay` 比较数量加存在性,`subprocess-local` 带着最完整的形式(`required` 加 `optional`)。每份副本都在重新推导一个本该由 `@deepseek-ai/dsh-value` 提供的边界检查。

## 决策

- `dsh-value` 新增 `isAbortError` 与 `hasExactKeys`。
- `isAbortError` 采用严格形式:真实 `Error` 且 `name` 为 `AbortError`。被中止的 `AbortSignal` 携带的正是该值,`fetch` 也以它拒绝,其背后的 `DOMException` 在所有受支持运行时(Node 22+ 与当前浏览器)都继承 `Error`,因此该谓词覆盖了 `instanceof DOMException` 的副本,而不是改变它们所分类的对象。只带同名的非 `Error` 同形值会向上浮出,与 `isENOENT`/`isEEXIST` 的契约一致。
- `hasExactKeys` 采用 `subprocess-local` 的签名——`required` 加 `optional`,只统计自身键。另外两份副本是该形式不带 optional 键的调用点。
- `subprocess-local` 与 `hasExactKeys` 同文件的本地 `isRecord` 一并收敛到权威定义。
- 每个消费方在 `dependencies` 声明 `@deepseek-ai/dsh-value`,并补上缺失的 TypeScript project reference。三个 web provider 保留本地 `isPositiveInteger`;台账现在登记该族及其缺失的归属。

## 结果

九处本地定义消失:五处 `isAbortError`、三处 `hasExactKeys`、一处 `isRecord`。谓词与其失败文案现在只有一个属主,下一次修正只需落一处。唯一的语义变化是 `isAbortError` 收紧:名为 `AbortError` 的 `DOMException` 原先被判为中止、现在仍然如此,而原先会被判为中止的非 `Error` 同形值现在会向上浮出。

M1 台账表改为记录复测出的真实残留,而不是「0 剩余」;同时记录本次收敛,并把 `sleep` 记录为「已评估、暂不下沉」:其副本在 `unref`(worker 线程的 dispose 宽限不得吊住进程)与可中止性上分叉,而两个共享包都不持有「可 unref、可中止的定时等待」契约。Issue #87 仍开放,用于剩余各族。

## 考虑过的替代方案

**保留 web provider 的本地谓词。**否决:它们的注释捍卫的是「不把通用内部从公开 web seam 导出」,而 import 共享谓词并不触碰这一点——provider 的公开 API 不变。

**用鸭子类型 `value.name === 'AbortError'` 判定。**否决:它会把同形对象判为取消,从而把真实失败静默变成「已中止」结果;`isENOENT` 已经立下了从严的先例。

**在同一次改动里下沉 `sleep`。**否决:这些副本不是同一个函数。收敛它们需要先为 `unref` 与中止选定一个契约,而现有消费方都不足以支撑该选择。
