# Agent Note: citation-check 域图

Status: implemented

[English](2026-08-27-citation-check-domain-graph.md) | 中文

## 问题

专利实务常见缺陷是引用造假或牵强引用：撰写结论引用的对比文件（D1/D2 或专利号）实际上并不在检索到的现有技术中，或被引用却未公开所引特征。`novelty`/`inventiveness`/`enablement` 域图产出可自由点名对比文件的结论文本，但 `patent-core/src/graph/domains/` 里没有任何东西对照本次运行实际使用的证据校验这些引用。既有 `patent-fact-check` 技能偏文字化、模型驱动；缺失的是一道确定性、由图调度的校验，把每条引用接地到 `prior_art`。

## 决定

`patent-core` 现在提供第四个域子图 `citation-check`（`src/graph/domains/citation-check.ts`），在 `DOMAIN_GRAPHS` 中注册为 `'citation-check': { build: buildCitationCheckGraph, entry: 'check' }`，并经由两个 graph barrel 再导出。该子图是纯计算——单个确定性 `check` 节点，无 LLM、无审批门——由 Sati 的 citation-check 域移植而来。

抽取规则（与 Sati 移植对齐）为：专利号（`PATENT_NUMBER_RE` = `/[A-Z]{2}\d{1,14}[A-Z]?\d*/g`）优先，从结论文本与文档字段中抽取；自由文本结论只抽专利号，绝不对标题或段落做硬匹配；无专利号时回退到规范化文档标签（`对比文件N` / `证据N` / `D<N>`）；空的 `prior_art`（或无法抽取的）跳过硬校验，使降级的检索不被双重惩罚。`extractCitationIds` / `extractDocIds` / `checkCitations` 导出为纯函数，与 `extractNumericRanges` 及各结果抽取器的公开方式一致。

接地基于包含关系：当文档 id 等于、包含或被包含于引用 id 时，该引用即已接地——包含臂吸收了 URL 路径后缀（URL 内的 `US11452699B2`）与申请号/公开号拆分（`CN201910000000A` vs `CN201910000000`）。节点从可配置的 `refTextKeys` 列表（默认 `inventiveness_conclusion` / `inventiveness_closest` / `inventiveness_hint` / `novelty_report` / `text`）读取结论文本，从 `prior_art` 状态键读取证据，写出 `citation_check_grounded` / `citation_check_failures` / `citation_check_report`。`extractCitationCheckResult` 用仅存键展开约定读回这些字段。

`patent_workflow_run` 暴露该子图：`graph` 参数枚举新增 `citation-check`，新 `priorArt` 输入以 JSON 数组接收既有现有技术证据条目。`parsePriorArt` 在工具输入边界以 `PatentToolError('invalid_tool_input', ...)` 拒绝非 JSON 与非数组输入（fail loud，绝不静默降级）；`buildRunContext` 经 `buildWorkflowRunContext` 将其映射进 `prior_art` 工作流上下文键。

纯函数与抽取器为公开且 JSDoc 定型；`PATENT_NUMBER_RE` 被导出，使测试与未来工具复用同一抽取而无漂移。

## 曾考虑的替代方案

- **改为模型校验引用。** 让 LLM 节点读结论并判定每条引用是否匹配检索文档。这会重新引入该校验本想消除的幻觉风险、增加延迟，且无法被快照钉住——确定性的抽取-接地计算正是关键点。
- **并入既有 novelty/inventiveness 图作为门。** 共享的确定性尾节点会把引用接地耦合到那些图的 ref-text 键与审批流。独立子图保持校验可复用（`graph=citation-check` 单跑），并让每个工作流自选 ref-text 来源。
- **仅精确匹配接地。** 要求文档 id 等于引用 id 会误标 id 嵌在 URL 或带类型后缀的合法命中。包含臂（`d.includes(refId)` / `refId.includes(d)`）对齐 Sati 行为，吸收这些假阴性。
- **为 `checkCitations` 加运行时字符串过滤。** Sati 在运行时逐个类型校验 ref text；dsh 的类型化同进程契约使 `string[]` 成为静态保证，`typeof t === 'string'` 过滤将成为死代码。移植仅保留 `trim().length > 0` 过滤。

## 影响

- `patent_workflow_run(graph=citation-check, priorArt=[...])` 现在对「结论中的每条引用是否出现在所供现有技术证据中」给出确定性、模型可见的判定，而非依赖人工审计或信任模型自述。
- 无法校验的输入（未抽到引用、无可抽取的文档 id、空 `prior_art`）带显式报告行放行，因此降级或空检索永不被双重惩罚为造假。
- 该子图无 LLM，可在无模型接缝下运行——但 `patent_workflow_run` 的图路径为其他图仍要求模型端口，故 `graph=citation-check` 保留该前置条件。
- 抽取正则带文档化的误报面（中国实用新型的 `ZL` 前缀、`IP2022` 风格 token）；因引用与文档两侧共享同一抽取器，接地自洽，残余风险是「被标记但实际已接地」，而非静默漏检。

## 测试

`patent-core` 测试覆盖两条抽取分支（专利号优先 + 去重；文档标签回退规范化）、`extractDocIds` 的对象/null/非对象与非字符串字段分支、全部三种接地臂、`checkCitations` 全部五种结果、带 `prior_art` 状态的图节点、自定义 `refTextKeys`、`extractCitationCheckResult` 的存键/缺键，以及 `DOMAIN_GRAPHS` 注册。`patent-tools` 测试覆盖 `priorArt` JSON 解析（合法数组、非 JSON、非数组 → `invalid_tool_input`）、`prior_art` 工作流上下文映射，以及一次完整 `graph=citation-check` 运行，断言返回图状态中的接地字段。两个包均保持每文件 100% 语句/分支覆盖率。
