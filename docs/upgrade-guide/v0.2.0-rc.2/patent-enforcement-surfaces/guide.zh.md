---
kind: upgrade-guide
description: "专利插件五个执行面加强：调用前制品门禁、附图三类新发现、强制剖切符号、要求核对表、声明的指南通道。此前通过的交付现在可能不通过。"
---

# 专利执行面：制品门禁、附图判据、要求核对表

[English](guide.md) | 中文

## 变更

专利部署依赖的六个面发生变化，共同点是把「可以被跳过的步骤」变成「必须交代的步骤」。

**`patent-rule` 在调用前做制品门禁（`structuralGate`），并可按族放宽结果门禁（`gateCheckTypes`）。** 结果门禁默认仍只取 `keyword_blocklist`；`gateCheckTypes` 只接受其余「命中即违规」族，随包规则 action 均为 warn——放宽只增加日志；声明「缺失即违规」族会被告警拒绝。新增的 `structuralGate` 条目按工具声明「哪些入参承载制品文本、用哪些缺失即违规规则判」，命中 block 级规则即在调用前拒绝；声明的规则 id 不在规则集内时加载期告警并剔除该条。随包不带任何条目：渲染器的入参只是槽位片段，不是成品文书。

**`verify_patent_figure` 新增三类发现。** `element-overlap`——两个闭合轮廓的包围盒部分相交（只擦边、有意嵌套、同一 `data-dsh-hatch-group`、以及两侧都是纯填充的图元都不计）。`font-below-minimum`——文字字高低于新参数 `min_font_mm`（或 `Config.figureMinFontMm`）给出的下限；报告同时给出量测值 `minFontMm`。`figure-hierarchy`——权利要求自己写出的构造归属（「控制单元31的输入端311」）与新参数 `hierarchy` 声明的图内层级矛盾；只有 `hierarchy` 与 `claims` 同时给出时才判，且两端标记都必须在声明里出现过。

**`generate_patent_figure` 强制剖切符号。** 新增参数 `require_cutting_marks`（与 `Config.figureRequireCuttingMarks`）：剖视图未给 `sections.cutting_marks` 时报 `invalid_input`，不再静默省略。GB/T 4458.6 只在剖切平面与对称面重合且视图在标准位置时允许省略，此类剖视图可传 `require_cutting_marks: false`。

**`verify_deliverable` 产出要求核对表。** 新增可选 `requirements`（每条给指令原话与证据文件路径）：要求没有证据、或证据文件不存在即报错，返回结果按条给出 requirement/evidence/satisfied，交付报告直接引用它。

**`law_search` 接通指南通道。** cnlaw 索引只核验法条与判例、不含《专利审查指南》节号，故指南原文取自部署的外接 IP 知识库——`law_search`（scope=guideline 取指南全文、scope=law 取法规条文，命中自带语料路径），规则卡片走 `patent_kg_query`（node_type=GuidelineRule）与 `patent_wiki_search`。取不到的节号保持未核验。

## 迁移

1. 附图复核：此前通过复核的图可能新增 `element-overlap` 与 `font-below-minimum` 发现；逐条处置（移动或缩小叠压图元、调大字号），不要驳回——确要驳回须引用量测值并由第二人复核。
2. 配置 `Config.figureFontMm`（小四 = 4.23 毫米）与 `Config.figureMinFontMm`；开启 `Config.figureRequireCuttingMarks: true` 后，每次剖视图都要给 `sections.cutting_marks`，对称全剖可传 `require_cutting_marks: false`。
3. 交付：把用户要求与案卷要求传给 `verify_deliverable({ …, requirements: [{ requirement, evidence }] })`，并在交付报告里引用核对表。
4. 制品结构门禁：只对「入参就是文书全文」的工具启用。
5. 指南：`law_verify` 判「未核验」的指南引用，用 `law_search` 的 `scope: 'guideline'` 取原文，并把命中的 `sourcePath` 记为引文来源。
6. 确认：带 `min_font_mm` 跑 `verify_patent_figure` 应报 `font-below-minimum`；剖视图传 `require_cutting_marks: true` 且不给符号应报错；一条无证据的要求应报错。
