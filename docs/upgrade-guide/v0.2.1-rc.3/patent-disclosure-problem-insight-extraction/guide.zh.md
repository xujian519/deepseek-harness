---
kind: upgrade-guide
description: "披露 manifest 把问题与发明认知的抽取合并为一次配对调用，阶段数降为 21/9，运行记录不再包含 extract_insight。"
---

# 披露抽取用一次调用配对问题与发明认知

[English](guide.md) | 中文

## 变更

`patent_disclosure_v1` 不再有 `extract_insight` 阶段。`extract_problem` 以 `output_mode: problem_insight` 运行 `extract`，这一次调用返回 `{"problem_insight": [{"id", "problem", "insight"}]}`。handler 写入配对数组与派生的 `problems` 清单；`merge` 用一条配对构造一个 PFIE 分组，发明认知不会再经数组顺序挂到别的问题上。

该 manifest 现有 21 个阶段、9 个模型调用阶段，原为 22 与 10。两条回退目标仍指向 `extract_problem`，因此重试时问题与发明认知由一次调用重抽。

`merge_result` 末尾现在标 `（配对: problem_insight）` 或 `（配对: index）`。`flexible_plan` 的原子说明点名新的 `output_mode`；`output_key: 'insight'` 仍可运行独立的槽位抽取。

## 迁移

1. `patent_workflow_run` 调用方无需改参数。每次披露运行少一次模型调用；通过持久化记录确认：`stages` 不再包含 `extract_insight`，三路抽取与 `merge` 未降级，且 `degradedSteps` 中不出现抽取阶段。
2. 自行拼装阶段输出的 recap 调用方去掉 `extract_insight` 条目，照旧提供 `extract_problem`。仍报告 `extract_insight` 的记录产生于本次变更之前，仍可读取；manifest 不再调度该阶段。
3. 断言该 manifest 阶段数或模型阶段数的用例改为 21 与 9。`snapshots/session` 下没有披露运行的录制；唯一受影响的固定会话快照是 `snapshots/session/patent-oa-response/tool-schemas.expected.json`，已按 `flexible_plan` 原子说明更新。
4. 解析 `merge_result` 时接受配对后缀。`（配对: problem_insight）` 表示分组由配对抽取产生；`（配对: index）` 表示 state 来自分键抽取。
