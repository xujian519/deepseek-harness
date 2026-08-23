# Agent Note：文档交付物登记

Status: implemented

[English](2026-08-23-document-deliver-registration.md) | 中文

## 问题

[文档交付工作室](2026-08-23-document-delivery-studio.zh.md)的交付物列表此前只从变更工具的 render-intent `locations`（diff 卡片、generic edit 卡片）推导。文档工作线的二进制产物——经 shell 中的用户级 `officecli` 技能产出的 `.docx`/`.pptx`（`terminal` 卡片不带 `locations`），以及打印动作保存的 PDF——从未出现在工作室里。质量门（`document-quality-gate`）纯文本：P0/P1 结果只存在于消息文本中，没有任何东西能按交付物渲染质量门状态。

## 决策

**一个模型可见的登记工具 `document_deliver`（`@deepseek-ai/dsh-document-deliver`，由文档 preset 挂载），让声明本身成为数据源。** 质量门通过后，模型调用 `document_deliver`，参数为 `files`（`path` + `format`，取值 `markdown | html | pdf | docx | pptx | other`）、`gate`（`p0` 已核验项、可选 `p1`）与可选 `brief_ref`。工具按调用方会话工作区解析每个路径，文件缺失即报错——幽灵文件不是交付物——否则回执 P0/P1 项数确认登记。工具调用与其他工具一样写入会话日志，"model-visible ⟺ logged" 由构造保证：不新增会话事件类型、不改 `SessionEventMap`、不加 host 写 RPC；会话日志仍是唯一写路径。`document-quality-gate` 技能的最后一步在 P0 通过后调用该工具。

**工作室从日志折叠该调用。** `documentDeliverables` 节点定义解析 `document_deliver` 的 `tool/call` 参数（日志事件中的无损 JSON），在成功的 `tool/result` 时产出携带 `format`、`gate`、`briefRef` 的条目。会话级折叠保持首次出现顺序，但当后续登记覆盖同一路径时原地升级变更派生的条目——因此先由 `write` 看到的文件，登记后会显示其声明的格式与质量门状态。无登记的条目显示可见的"未登记质量门"降级徽标，而不是默认报告门通过；工具存在之前记录的会话降级为变更派生列表。

## 备选方案

- **扩展 render-intent 联合增加 `deliver` kind**——可让 shell 产物经现有折叠上列表，但封闭联合需要 bridge 改动且不携带 gate 载荷或格式；日志参数路线以零传输改动覆盖列表与元数据。
- **为登记增加专用会话事件**——新增 `SessionEventMap` 成员与 `SESSION_FORMAT_VERSION` 机制；工具调用日志已携带全部信息，且仓库规则只要求 model-visible ⟺ logged，并不要求新事件。
- **客户端解析质量门 prose**——无 schema 约束、回放脆弱；以 schema 校验的调用替代。
- **验证清单被如实执行**——工具只强制 P0 非空与文件存在，不检查模型确实跑了清单；把质量门机器化验证超出范围，作为已记录风险而非不可执行的声明。

## 后果

- 工作室在登记后列出二进制产物（格式 + 质量门徽标），仍列出变更派生文件；旧会话显示降级徽标。
- 质量门状态由模型自报——声明者是模型，清单诚实性仍是模型的纪律。
- 登记仅为声明：不复制、不渲染、不转换；PDF 导出仍走打印动作，`.docx`/`.pptx` 转换仍依赖用户级 `officecli`。
- 工具仅随文档 preset 挂载；其他 preset 既不看到工具也不看到徽标（工作室标签对所有会话渲染，但只列出其推导所见）。
