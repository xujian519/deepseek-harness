# Agent Note: 附图提交规格、幅面落版与矢量图型

Status: implemented

[English](2026-09-21-patent-drawing-office-profiles-and-vector-figures.md) | 中文

## Problem

附图工具只在图形自身的尺寸上绘制，到此为止。`generate_patent_figure` 设置 Graphviz 的 `page`/`size`/`margin`/`dpi` 属性，却不报告图纸信息；`generate_structure_figure` 返回视图片段，并在代码中声明"图号不入像素"正是《专利审查指南》第一部分第一章 4.3 的要求。两者都答不上提交时真正要问的问题：图形落在哪张图纸上、字最终有多大、这幅图要不要编号、所选色彩策略在目标受理局是否允许。本机实测 Graphviz 15.1.1：`page` 对 svg/png/pdf 不产生幅面（只有 PostScript 分页），`size` 只在图形超出时缩小，`margin` 只加空白——因此既有的"提交规格"旋钮在原理上也无法拼出图纸。

另有三类本领域需要的附图完全无法表达：电路图（电气符号、正交走线、连接点）、曲线图（坐标轴、刻度、单位）、剖视图（裁剪到零件轮廓的剖面线、剖切位置符号）、时序图（生命线、消息箭线）与外观设计视图页（六面视图统一比例、视图名标在各自视图下方）。

还有四处内部矛盾与工具自己的说明相冲突：`generate_patent_figure` 默认标号步进为 2，而 `analyze_patent_figure` 把步进变化报为不连续，`FIGURE_SPEC_GUIDE` 又告诉模型标号不得跳号；附图说明句在三个工具中各不相同；`dot-builder` 把指南引成「墨色墨水」，条文原文是「黑色墨水绘制」；结构线稿的"图号属于像素之外"只在单幅附图的申请里成立，因为一件申请有两幅以上附图时，4.3 要求把编号标注在附图正下方。

## Decision

**按受理局固化的规格档案、落版步骤与合规核算。** `figure/office-profile.ts` 固化已核实的数值——中国 A4 与 25/25/15/15 毫米页边距、两幅以上附图才编号的「图N」（指南 4.3、第五部分第一章 4.2/4.3）；PCT 的 0.32 厘米最短字高、「Fig. N」、不得着色与「1/3」页码（细则 11.6(c)、11.13(a)、11.13(h)、11.13(k)、行政规程 Section 207(b)(iii)）；USPTO 的页边距、0.32 厘米最短字高、「FIG. N」与需呈请的彩色（37 CFR 1.84(a)(2)、1.84(g)、1.84(p)(3)、1.84(u)）——并刻意不列 EPO。`figure/submission-page.ts` 解析渲染出的 SVG（width/height/viewBox，毫米/厘米/英寸/点/像素），按档案的版心等比缩放，把图号写在图形正下方、页码写在版心底部，并返回落版缩放比、落版尺寸，以及由调用方字号推出的字高。`figure/compliance.ts` 报告色彩策略违规、两幅以上却未编号，以及落版字高低于该法域下限。

**落版仅支持 SVG，并且明说。** png/pdf 返回「未落版」警告，而不是静默输出缺少幅面的图；`fit_to_page: false` 只核算、不改写画布。Graphviz 加一个页面装配步骤是不引入 PDF 引擎就能得到 A4 幅面的唯一组合。

**为 Graphviz 无法表达的图型另开一条绘制通路。** `figure/vector-figure.ts` 定义接缝：`VectorFigureSpec`（毫米画布、黑色描边片段、图面词语）与封装为独立 SVG 的函数；`figure/vector-figure-build.ts` 把工具的 snake_case JSON 映射到五个模块（`circuit-diagram`、`plot-diagram`、`section-diagram`、`sequence-diagram`、`appearance-view-sheet`）。片段约定要求文本元素自带 `fill="#000000" stroke="none"`，因为外壳分组设了 `fill="none"`。矢量图型仅支持 SVG，非 svg 的 `format` 被拒绝，其图面词语进入用语检查，且被面板 schema 排除在 `panels` 之外。

**在 DOT 通路上补齐缺失图型。** `buildStateDiagramDOT` 把状态画成圆角框、终态画成双圆，并按 4.3 对流程图与框图"在框内给出必要文字和符号"的要求，把初始伪状态画成实心小圆、不带标签、因而不分配参考标号。

**在规则所及之处扩展检查。** `figure/wording-rules.ts` 新增：图号入图、比例标注（PCT 细则 11.13(d)、37 CFR 1.84(k)）、数字与括号引号连用（PCT 细则 11.13(e)、37 CFR 1.84(p)(1)）；纯图号优先于"非中文词语"报告，因为缺陷在于图号的位置而不在语言。`validate_specification` 除附图说明章节外，还把图面标号与具体实施方式正文、权利要求双向核对（《专利法实施细则》第二十一条的义务是双向的），读取权利要求中带括号的标号（第二十二条第四款），并检查摘要指定的附图确实存在。`analyze_patent_figure` 接受固定标号步进、只在步进变化时报告，`figure/figure-description.ts` 让三个生成工具共用同一句式。

## Alternatives considered

**用 Graphviz 自己的 page 属性拼图纸。** 由实测否定：`page` 对 svg/png/pdf 无效，`size` 只向下缩放，`margin` 无法预留图号带。提交规格旋钮对图形自身画布仍然有意义，图纸则由独立步骤给出。

**把 SVG 转成 PDF 以获得真实幅面。** 暂不采用：这会给本已可用的 SVG 通路引入栅格化器或无头浏览器，而电子申请接受 SVG。

**缩小到三分之二后字高低于法域下限时直接报错。** 否定：三个法域都没有给出缩小后的数值下限，因此工具在 `layout` 中报出实测的缩小字高，只对提交态的下限告警。

**用 Graphviz 绘制矢量图型。** 否定：电气符号、剖面线、坐标刻度、生命线与视图名定位都不是节点与边的构造，用记录形状近似会产出不再遵循规则所指制图实践的图。

**按 PCT 数值补一份 EPO 档案。** 否定：本次工作期间 EPC 细则 46/47 与 EPO 审查指南不可达（epo.org 对本机返回 403），而 EPO 自 2025-10-01 起对彩色与灰度的接受是经 PCT 途径发生的。未核实的档案会把工具无法引证的规则写进产品。

**无条件给每幅图编号。** 否定：4.3 与 PCT 申请人指南 IP 5.141 都把编号系于"申请有两幅以上附图"，因此 `figureCaption` 对单幅申请返回空，其余情形由工具入参 `figure_count` 决定。

**在 `panels` 中支持矢量图型。** 暂缓而非近似：面板条目是 DOT 形状的，矢量图型被面板 schema 拒绝，而多面板矢量组合需要自己的入参契约。

## Consequences

- 绘制出的附图现在带有图纸、图号、页码与实测尺寸，工具同时报告哪些给不出来。向具名受理局提交的调用方不必重述该局的页边距与编号方式。
- 规格档案是逐条注明出处的常数；条文变化（EPO 的彩色实践、新的中文法域）只需改一张表，模块同时记录 EPO 为何缺席。
- 矢量图型只出 SVG。需要 PNG 或 PDF 的调用方必须在下游转换，工具会说明这一点，而不是输出一个看起来可提交的文件。
- 外观设计视图页只组合调用方给出的视图，不绘制产品轮廓，因此该工作流中"画形"的一半（线条图、表面阴影、照片合规）仍属调用方或 CAD 环节。
- 用语检查报告变多，其中包括严格说来属于偏好而非缺陷的情形（曲线图内的比例说明）。检查仍然只提示、绝不改写输入，调用方可以忽略。
- 图号规则与拼版相互作用：图号位于图纸上图形的正下方，调用方后续调整页序时必须连同图形一起移动图号，而不是重编像素里的数字。

## Testing

- `tests/figure-submission.spec.ts` 钉住规格档案、图号与页码写法、SVG 长度解析（毫米/厘米/英寸/点/像素/无单位/百分号）、几何解析（仅有 viewBox 的回退、不安全与缺尺寸的拒绝）、落版输出（A4 尺寸、图号在图形下方、放大截断提示、尺寸与字高指标、入参范围错误）、每条合规分支，以及工具层的多幅编号、`fit_to_page: false`、PNG 拒绝、PCT 彩色拒绝与逐面板图号。
- `tests/figure-vector.spec.ts` 钉住接缝契约；`tests/figure-vector-tool.spec.ts` 让五种矢量图型经工具执行，包括它们从不进入 Graphviz 渲染器、`cross_section` 与 `plot` 携带各自提示、落版生效，以及非法输入与非 SVG 格式映射为 `invalid_tool_input`。
- 每个图型模块各有规格：`figure-circuit-diagram.spec.ts`、`figure-plot-diagram.spec.ts`、`figure-section-diagram.spec.ts`、`figure-sequence-diagram.spec.ts`、`figure-appearance-view-sheet.spec.ts`。
- `tests/figure-wording.spec.ts`、`tests/validate-specification.spec.ts`、`tests/figure-tools.spec.ts` 与 `tests/structure-figure-tool.spec.ts` 覆盖扩展后的检查、标号步进的接受、共享句式与结构线稿的落版通路。
- `snapshots/session/patent-oa-response/tool-schemas.expected.json` 已按新的工具入参刷新。

## Deferred

- 化学结构式渲染（RDKit 仍不可用）与外观设计中"画形"的一半。
- `generate_structure_figure` 与矢量图型的 PNG/PDF 输出。
- `docs/tool-catalog.zh.md` 及其配对记录仍需在重新生成的 `docs/tool-catalog.md` 之后走一遍翻译流程。
