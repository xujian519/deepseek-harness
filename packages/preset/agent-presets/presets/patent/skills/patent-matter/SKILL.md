---
name: patent-matter
description: 专利案件管理：七级工作目录 + 两个跟踪文件、L1–L5 流水线状态机、只追加事件日志与审计链。建案、案件状态流转、归档、追溯证据链时使用。
---

# 案件管理

一个案子一个子目录，所有中间产物与证据落盘。案件生命周期由只追加事件日志驱动，产物文件头元数据构成审计链。

## 建案

1. 目录：`patent-workspace/<案号>/` 下建七级目录（`00-交底书` / `01-检索` / `02-对比文件` / `03-分析` / `04-撰写` / `05-答复` / `99-知识库`；目录命名与落盘规则详见 patent-workspace-layout 技能），加 `_case-registry.md` 与 `_matter-log.md` 两个跟踪文件。
2. 注册：`_case-registry.md` 追加一行（案号、状态、阶段产物索引）。
3. 初始化事件日志 `_matter-log.md`，首行记录建案（时间、动作=建案、产物=目录骨架、审批人=用户）。
4. 建案即生成 `_checklist.md`，按案型勾选（见下表）：勾选即证据，未勾选项不得进入交付。

## 案件检查单（`_checklist.md`）

建案时按案型复制一份，逐项在对应阶段勾选并写产物路径；空着的项就是未完成的阶段。

| 阶段 | 必勾项（撰写案示例） | 证据 |
|---|---|---|
| 入口 | 载入 patent-workspace-layout / patent-disclosure-understanding / patent-prior-art-search | 技能加载记录 |
| 检索 | 检索式经用户确认；多通道执行并记录覆盖范围与未覆盖清单 | `01-检索/YYYY-MM-DD_<主题>.md` |
| 对比文件 | D1/D2/D3 落盘、公开日核验、双源交叉 | `02-对比文件/D*_<公开号>.pdf` |
| 撰写 | 要素拆分、权利要求布局（HITL）、说明书五部分、validate_specification | `03-分析/`、`04-撰写/` |
| 收口 | `patent_workflow_run`（按案型 manifest）留下 stage 记录 | 工作流 run 记录 |
| 闸门 | `rule_check`（patent-compliance-review）+ 法条/日期/数字核验（patent-fact-check） | 门禁结论 |
| 交付 | patent-quality-gate 通过、`render_patent_document` 渲染、`_matter-log.md` 登记、工作台桥接 | `05-交付/` 或对应目录产物 |

案型差异：答复案把"撰写"换成 OA 解析 + 逐权项修改对照（`patent_oa_response_v1`）；检索/无效/复审/侵权案把"撰写"换成对应技能的分析流程与要素级比对，收口用该案型 manifest；补正案无 manifest 入口，以替换页逐项核验清单替代收口行。

## 状态机（六列，按 L1–L5 流水线映射）

| 状态 | 含义 | 对应流水线 |
|---|---|---|
| open | 已建案；含 t1 交底书理解（产物 `03-分析/<案号>_案件理解.md`） | 建案 / L1 |
| retrieving | 检索中 | L2 检索 |
| analyzing | 分析中 | L2 三性 / L5 侵权·无效 |
| drafting | 撰写中 | L3 撰写 / L4 答复 / L5 文书 |
| review | 门禁/审批中 | L3/L4/L5 quality-gate |
| closed | 归档 | 交付完成 |

状态只增不改：状态变更必须写日志，不覆盖历史。

## 事件日志（_matter-log.md，只追加）

每条记录字段：时间（ISO）/ 动作（建案/检索/分析/撰写/门禁/交付/归档）/ 产物（文件路径）/ 审批人（ask_user 确认者）/ 备注（可选）。

示例：

```
2026-08-19T21:00:00+08:00 | 建案 | patent-workspace/CN2026-0001/ 目录骨架 | 用户 | 交底书已入 00-交底书/
2026-08-19T21:15:00+08:00 | 检索 | 01-检索/2026-08-19_硅基负极.md | 用户(检索式确认) | 命中 D1/D2
```

禁止覆写或删除历史行；发现记录错误追加更正行。

## 审计链

- 每份交付产物（分析报告/权利要求书/答复意见/比对报告）文件头带元数据块：来源（输入文件）、版本（v1/v2…）、审批（ask_user 结果）、时间戳。
- 与 patent-workflow 的审批/plantask 记录并轨（`patent/plantask` 会话事件；ApprovalRecord 仅在部署配置 approvalStore 时产生）：事件日志是唯一事实源，审批记录只是投影，不另立账本。
- 交付物修订（tracked changes 的接受/拒绝）以追加行记录：动作=修订，备注=接受/拒绝与原因；不覆写已交付版本的日志行。
- 追溯：任一产物 → 文件头元数据 → `_matter-log.md` → `01-检索/` 记录 → 对比文件，链路完整才算审计可重建。

## 与编排机制对齐

- 一个案子注册一个 goal（跨轮持续推进）。
- 流水线阶段用 todo 跟踪，阶段产物即 todo 完成标准。
- 关键 HITL 点（按 persona 纪律 6，非穷举）：检索式确认（L2 前，见 patent-prior-art-search）、权利要求布局确认（L3 plan-mode 获批时）、答复策略确认（L4）、无效理由组合确认（L5，见 patent-invalidity）、交付放行确认（门禁后，见 patent-quality-gate）。
