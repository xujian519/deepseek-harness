# Agent Note: 专利域附图生成（Graphviz 支撑）

Status: implemented

[English](2026-08-28-patent-figure-generation.md) | 中文

## 问题

专利域只有附图**分析**能力（`analyze_patent_figure`、`recognize_chemical_structure`、`search_patent_figure` 与附图索引持久化），撰写阶段缺少**产出**专利风格附图的通道。对照图描述技能（Claude-Patent-Creator 的 `diagram_generator` / `add_diagram_references`，MIT）补上闭环：权利要求/描述 → 结构化输入 → DOT → 专利风格 SVG/PNG/PDF（含参考标号）→ 标号映射表 + 附图说明句子 → 附图索引（`search_patent_figure` 可检索、`analyze_patent_figure` 可回读核验）。

## 决定

生成侧原生移植进 `packages/patent/patent-tools`（无 Python 进程、无 WASM、无 torch 栈）：Graphviz `dot` CLI 经 `ctx.subprocess.spawn`，沿用 `pdfRenderer` 的候选路径模式。三个新模块 + 两个工具：

- `figure/dot-builder.ts` — 纯 DOT 构建器（flowchart / block_diagram / component_hierarchy / 四个内置模板），固化专利风格规则：默认 `grayscale` 零填充色（依据《专利审查指南》第一部分第一章 4.3，2023 修订；`semantic` 彩色仅当色彩承载技术内容时允许）、决策菱形分支**必须**带边标签、标号内嵌节点标签（`Processor (20)`、`101. 接收`）、每图独立标号系列（FIG.N = 100+100·(N−1)，默认步进 2，`numerals` 显式传递支持跨图同号续接）。
- `figure/svg-annotate.ts` — 既有 SVG 后处理：按 `<text>`/`<tspan>` 匹配文本追加 ` (标号)`；拒绝 DOCTYPE/ENTITY/CDATA 与超限输入，未命中参考列 warnings。
- `figure/graphviz-renderer.ts` — `findDot`（覆盖值 → `DSH_GRAPHVIZ_DOT` → 平台候选路径 → PATH）、`probeGraphviz`（`dot -V`）、`renderWithGraphviz`（argv 直传子进程、stdin 传 DOT、超时/取消分类、缺失时安装引导）。
- `tool/generate-patent-figure.ts`（+ `add_patent_figure_references.ts`）— `apply()` 注册，新增 `Config.graphvizExecutable` / `figureOutputDir` / `dotFont`；标号一次分配驱动 DOT 与返回标号表；`persist_index`（默认开）把确定性 `FigureAnalysisResult`（置信度 1，`modelUsed='graphviz-generator'`）upsert 进既有附图索引，闭环：生成 → 检索 → 分析复核。

否决：MCP 桥接（沿 Sati 移植决定——模型可见表面必须原生进 dsh）、BigQuery/EPO/USPTO 检索、整体插件；移植范围仅附图。

## 验证

单测覆盖：dot-builder（标号系列/冲突检测/黑白风格/决策边标签/模板 101-105 固定编号）、svg-annotate（安全拒绝/多次命中/警告）、graphviz-renderer（探测顺序/退出/取消/渲染失败分类，经注入子进程）、工具层（输入校验、错误码映射、索引 upsert 与失败静默、经真实索引存储的 search 端到端）。新文件 100% 语句/分支/函数/行覆盖。

## 备注

Graphviz 为系统依赖：无 `dot` 时工具 fail loud 返回 `setup_required` 与安装引导（brew/apt/winget）。已知限制（见 README）：无引线标号（内嵌标签）、仅单图（无 FIG. 1A/1B）、无跨图自动标号记忆、`raw_dot`/`template` 输出无结构化组件供索引还原。
