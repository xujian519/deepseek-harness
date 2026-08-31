# Agent Note：analyze_patent_figure 把附图发给模型

Status: implemented

[English](2026-08-30-patent-figure-vision-path.md) | 中文

## 问题

`analyze_patent_figure` 此前是文本态最小路径：移植的壳保留了 schema、附图说明模板与标号校验，但图片字节从未到达模型——提示词让模型凭附图编号与权利要求上下文推断，每个结果都带"文本态最小路径"警告，P3.3 模态门禁也刻意不启用，因为启用会拦掉唯一可用的路径。读懂上传的图纸——这个工具的核心用途——实际上不可用。

## 决策

复用既有接缝把图片接通，而不是移植 Sati 视觉引擎：

- `PatentModelMessage` 增加 `images?: readonly ImageAttachmentRef[]`；`createLlmModelPort` 把引用映射为图片内容块，工具侧子请求由此走与会话图片相同的 provider 通路（归一化、按路由策略、Files-API/base64 表示）。
- 工具读取图纸，把字节经 harness 附件服务（`ctx 'attachments'`）入库，并把持久引用随提示词发到专用附图模型端口上；该端口建在被门禁的路由上（`Config.imageModel` 覆盖 → `provider`/`model` → 部署默认）。门禁判定与实际发送路由同源于 `figureRoute()`，不会分叉。
- P3.3 门禁现在在任何文件 IO 之前执行：声明模态缺 `image` 的路由以 `model_cannot_accept_image` 拒绝；无法解析的模态列表按 text-only 处理；门禁解析器缺席表示不设门禁（部署未提供能力源）。路由、端口或附件服务缺失时以 `setup_required` 带引导显式报错。文本态推断路径删除——README 早已写明启用门禁后的契约。
- `buildImageGateResolver` 在 llm 服务未暴露 `resolveModelInfo` 时不再返回会崩溃的闭包，而是返回 undefined（不设门禁），与其契约一致。

"进模型必入会话日志"无需新会话事件即成立：日志中的工具参数携带图片路径，字节持久保存在附件服务中，分析结果在工具结果里。

## 已考虑的替代方案

**移植 Sati 两步 PatentVision/PatentLMM 引擎。** 该模式现已落在 [FigureAnalysisEngine 接缝](2026-08-31-patent-figure-rendering-pipeline.zh.md)之后（`Config.figureAnalysisMode`，默认 `single`）；多图一致性以同批变更中的多面板输出与家族续号落地；电路网表仍延后。

**在专利请求词表里内联 base64。** 拒绝：这会在附件管线之外另立一条图片通路，丢掉入库校验、归一化与按路由策略。

## 验证

单元覆盖：门禁拒绝（text-only / 未知 / 空模态列表）先于任何文件 IO、无解析器时不设门禁、路由或附件服务缺失的 `setup_required`、不支持扩展名的拒绝、入库失败映射，以及完整视觉路径（入库引用随请求发送、提示词以图面为准、`modelUsed` 报告被门禁的路由、索引写入）。`createLlmModelPort` 把引用映射为图片块。插件组装测试补上 `attachments` 服务；66 个专利测试文件、879 个测试全绿。

提示词与描述为模型可见文本，但无 recorded-session snapshot 覆盖：`analyze_patent_figure` 需真实 vision 模型与真实附图输入，无法低成本 keyless 回放，故与专利域其他依赖真实 API 的工具一致，以 mock-port 单元测试锚定（专利 profile 未注册 snapshot）。

## 后果

部署必须指定具备图片输入能力的附图路由（`imageModel`，如 `deepseek-official`/`deepseek-v4-flash-vision-exp`），否则工具以引导信息拒绝；纯文本部署按设计失去仅推断的降级路径。`recognize_chemical_structure` 的图片模式在化学引擎落地前仍是壳。
