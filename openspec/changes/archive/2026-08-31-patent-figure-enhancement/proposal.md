## Why

`@deepseek-ai/dsh-patent-tools` 的专利附图子系统目前功能完整、测试全绿，但存在 5 个已披露的落地短板：渲染强依赖系统 Graphviz 二进制（缺则 fail-loud）、输出不达 CNIPA/KIPO 提交规格（A4/300DPI/边距）、标号内嵌节点标签而非「数字+引线指向部件」、不支持多面板（FIG 1A/1B）与跨图同件自动续号、附图分析是单步 LLM（无结构提取→描述的两步收敛）。这些短板限制了它在机械/电子附图与提交级出图场景的可用性。

## What Changes

- **WASM 渲染引擎（去系统依赖）**：默认走 `@viz-js/viz`（Graphviz WASM，MIT）在内存渲染并落盘；新增 `figureRenderer: 'wasm'|'cli'` 配置，CLI 作为 PDF 与兜底分支保留。消除对 `brew install graphviz` 的强依赖。
- **提交规格**：新增 `figurePageSize/figureDpi/figureMargin/figureOrientation` 配置，DOT 层输出 `page/size/margin/dpi/orientation` 属性；工具输入支持 per-call 覆盖（`page_size/dpi/margin/orient`）。默认不指定时行为与现状一致（零回归）。
- **真·引线标号**：`generate_patent_figure` 对框图/层级图默认改为「数字+引线指向部件」，标签不再内嵌标号（DOT 构建器新增 `embedNumerals` 开关，默认 true 保持现状），流程图保留内嵌前缀；新增 `leader-line` SVG 后处理。仅 SVG 支持，非 SVG 返回 warning。
- **图型推荐 + 多面板 + 跨图续号**：`figure_type` 可缺省并按输入唯一结构推断；支持 `panels[]`（FIG 1A/1B 共享标号系列，与顶层结构输入互斥）；新增 per-call `figure_family` 输入（可选，默认不续号、行为与现状一致）与 `loadIndex` 依赖，声明族时跨图同件同号自动续接（旧索引无此字段按无族处理，绝不抛错）。
- **两步分析引擎**：`analyze_patent_figure` 新增可选 `figureAnalysisMode: 'single'|'two-step'` 与 `FigureAnalysisEngine` 能力缝；两步为「结构提取→描述生成」，默认 single 零回归。

无 **BREAKING** 变更（所有新增字段与行为均默认兼容现状；仅 `figureRenderer` 默认值从 CLI 切到 WASM，属同输出契约下的实现替换——工具行为与错误语义零回归，渲染产物可能因 Graphviz 构建版本差异存在可接受的布局差异）。

## Capabilities

### New Capabilities

- `patent-figure/wasm-rendering`: 附图渲染不使用系统 Graphviz 二进制，通过 WASM 引擎与 CLI 兜底选择器产出 SVG/PNG/PDF，错误分类与现有 `setup_required` 语义一致。
- `patent-figure/submission-spec`: 附图输出支持 A4 页面、300 DPI、边距与方向，并允许 per-call 覆盖；未配置时行为与现状一致。
- `patent-figure/leader-line-numerals`: 框图/层级图输出「数字+引线指向部件」的引线标号，流程图保留内嵌前缀，非 SVG 输出返回提示。
- `patent-figure/multi-panel-continuation`: 附图生成可省略 `figure_type` 自动推断；支持多面板（FIG 1A/1B）共享标号系列；声明发明族（opt-in per-call `figure_family`）时跨图同件自动续号且不重复/不跳号，未声明时编号行为与现状一致。
- `patent-figure/two-step-analysis`: 附图分析支持结构提取→描述生成的两步模式，出错时降级不抛；默认单步行为不变。

### Modified Capabilities

None（仓库尚无既有 `openspec/specs/`，本 change 全部为新增能力）。

## Impact

- **代码**：`packages/patent/patent-tools/src/figure/`（新增 `viz-wasm-renderer.ts`、`render-selector.ts`、`leader-line.ts`；改 `dot-builder.ts`、`graphviz-renderer.ts`、`index-store.ts`；`svg-annotate.ts` 仅导出共享安全校验助手）、`src/tool/generate-patent-figure.ts`、`analyze-patent-figure.ts`、`add-patent-figure-references.ts`、`src/index.ts`（`apply()` + `Config`）。
- **依赖**：`@viz-js/viz@^3.29.0`（MIT）新增为 `dependencies`，渲染器内经动态 `import()` 惰性加载；非 cordis 插件，不涉 vendoring/rescope。
- **配置**：新增 schemastery `Config` 字段 `figureRenderer/figurePageSize/figureDpi/figureMargin/figureOrientation/figureAnalysisMode`；`figure_family` 为工具输入而非 Config 字段。
- **文档**：`packages/patent/patent-tools/README.md`（Config 表 + Known Limitations）、`src/index.ts` Config JSDoc、重生成 `docs/tool-catalog.md`、过 `doc-sync`、同 PR 附 Agent Note。
- **测试**：新增/扩展 `figure-viz-wasm-renderer.spec.ts`、`figure-dot-builder.spec.ts`、`figure-svg-annotate.spec.ts`、`figure-generate-tool.spec.ts`、`analyze-patent-figure.spec.ts`、`index.spec.ts`；`figure-graphviz-real-render.spec.ts` 增 WASM 真实渲染分支。
