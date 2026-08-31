# Agent Note: Patent figure rendering defaults and analysis modes

Status: implemented

[English](2026-08-31-patent-figure-rendering-pipeline.md) | 中文

## Problem

专利附图工具此前只有一条渲染路径（`dot` CLI 子进程）、一次调用只出一图、标号内嵌在组件标签里（`Processor (20)`）、每次调用标号系列都从 100 重来，分析器也只有单次模型调用。没有 Graphviz 的机器上 SVG 生成直接 fail loud；提交规格版面（页面尺寸、DPI、页边距）没有表达；跨图标号连续需要调用方逐个手工重传；分析器的结构定位与说明文字质量无法彼此独立地改进。

## Decision

- **渲染器选择由 `figure/render-selector.ts` 拥有。** `Config.figureRenderer` 默认 `wasm`：SVG 经内置 `@viz-js/viz` 引擎渲染，无系统依赖；png/pdf——内置构建无法产出的格式（预研实测）——路由到 `dot` CLI，这些格式与 `figureRenderer: 'cli'` 下它仍是系统依赖。
- **提交规格版面是一个 DOT `page` 包。** `figurePageSize`/`figureOrientation`/`figureDpi`/`figureMargin`（加上 per-call `page_size`/`orient`/`dpi`/`margin`）输出 `page`/`size`/`margin`/`dpi` 图属性；缺省字段不输出。
- **引线标号是 SVG 后处理**（`figure/leader-line.ts`）：节点标签去掉内嵌标号，在一个无碰撞的外侧锚点画 `<line>` 加独立标号文本。框图/层级图 SVG 默认开启，其余默认关闭；非 SVG 格式保持内嵌标号并返回警告。
- **多面板与家族续号共用一条标号系列。** `panels` 从一次 `assignNumerals` 调用按面板拆分，渲染 `figN`+后缀 文件；per-call `figure_family` 按索引记录的 `figureFamily` 划定先代条目，图中出现的组件种子为显式标号，其余作为 reserved 占用号跳过自动分配。按规范化组件名匹配，因为索引条目只存 `name` + `refNumber`，没有组件 id；无 `figureFamily` 的条目不参与。
- **`figure/analysis-engine.ts` 是分析模式接缝。** 工具只 type-import 它（无运行时循环；two-step 引擎值导入工具模块的共享规范化函数）。`Config.figureAnalysisMode: 'two-step'` 选择结构抽取趟加说明生成趟，走同一视觉路由；第一趟不可解析时按空组件加警告返回并跳过第二趟。图片门禁、附件入库与索引写入留在工具层，两种模式完全一致。

## Alternatives considered

**保持 CLI 为唯一渲染器。** SVG 生成将继续要求每台机器装 Graphviz；内置引擎为默认格式消除该依赖，png/pdf 继续由 CLI 支撑。

**让 WASM 引擎渲染 png/pdf。** 内置构建只带文本格式插件；假装支持会把干净的 `setup_required` 变成渲染中途失败。

**在 DOT 层画引线。** Graphviz 没有外侧锚点或引线原语；标注必须发生在渲染后的 SVG 上，那里节点组几何可查。

**按组件 id 续号。** 索引条目只存组件名与标号；引入 id 会破坏磁盘索引格式，所以家族匹配用规范化名称、首次出现优先。

**把 `figureFamily` 设为必填并拒绝旧索引条目。** 静默丢历史；宽容守卫让旧索引照常加载，只是这些条目不参与续号。

**在工具内用 if/else 写两步流程。** 模式选择、提示词与降级是引擎策略；接缝让工具的门禁与索引逻辑保持模式无关。

## Verification

figure/registration/analyze 测试子集共 212 个单测加包级 `tsc --noEmit`。无 recorded-session 快照适用：顶层 `snapshots/` 树没有 patent 内容，patent profile 未注册快照（[视觉路径笔记](2026-08-30-patent-figure-vision-path.zh.md)对 `analyze_patent_figure` 得出过同一结论）；本次工具描述与输入 schema 变更是模型可见的，注册工具前缀复用随每个部署移位一次。

## Consequences

- SVG 生成无需系统依赖；png/pdf 与 `figureRenderer: 'cli'` 在 `dot` 缺失时仍 fail loud 并给出安装引导。
- `figureAnalysisMode: 'two-step'` 使每次分析的模型成本翻倍；`single` 与接缝前逐字节同一提示词。
- 家族续号按名称匹配：组件跨代改名会取新标号，索引首次出现优先。
- 网表可视化与 SMILES 解析仍延后（由包 README 的 Known Limitations 拥有）。
