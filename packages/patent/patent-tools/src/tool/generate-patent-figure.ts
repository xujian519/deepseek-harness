/**
 * `generate_patent_figure` tool: 从结构化描述生成专利风格附图。
 *
 * 组合链：dot-builder（DOT 构建，默认黑白线条、semantic 可选彩色）→
 * graphviz-renderer（dot CLI 子进程渲染）→ 返回标号映射表与「图N是…；
 * 图中：…」附图说明文字，并按 persist_index 写入既有附图索引
 * （figureIndexStore），使生成图可被 search_patent_figure 检索、被
 * analyze_patent_figure 回读核验。矢量图型（电路/曲线/剖视/时序/外观）不经
 * Graphviz，由 vector-figure-build 直接绘制 SVG。
 *
 * 移植自 Claude-Patent-Creator 的 diagram_generator / add_references
 * 思路（MIT，见包 README 归属）。风格依据《专利审查指南》第一部分第一章
 * 4.3（2023 修订）：「附图一般使用黑色墨水绘制，必要时可以提交彩色附图」。
 *
 * 输入词汇与归一在 `figure-input.ts`，DOT 构建与标注在 `figure-render-plan.ts`，
 * 落版在 `figure-submission.ts`，结果组装在 `figure-output.ts`，输入 schema 在
 * `figure-tool-schemas.ts`；本模块持有 schema 门面、单图与多面板两条执行路径。
 * @module @deepseek-ai/dsh-patent-tools/tool/generate-patent-figure
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { defineTool, validateArgs } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { PatentToolError } from '../error.ts'
import { DIAGRAM_TEMPLATE_NAMES, DOT_ENGINES, DOT_FORMATS, DotBuildError, assignNumerals, resolvePageBundle } from '../figure/dot-builder.ts'
import type { DotEngine, DotFormat, DotPageBundle, NumeralAssignment } from '../figure/dot-builder.ts'
import { figureSentence } from '../figure/figure-description.ts'
import { sanitizeDotFilename } from '../figure/graphviz-renderer.ts'
import { TARGET_OFFICES } from '../figure/office-profile.ts'
import type { TargetOffice } from '../figure/office-profile.ts'
import { buildVectorFigure, isVectorFigureType } from '../figure/vector-figure-build.ts'
import { VectorFigureError, vectorFigureSvg } from '../figure/vector-figure.ts'
import { checkFigureRendering } from '../figure/render-check.ts'
import { SvgAnnotateError } from '../figure/svg-annotate.ts'
import { figureWordingWarnings } from '../figure/wording-rules.ts'
import { FIGURE_TYPE_NAMES, FIGURE_TYPES } from './analyze-patent-figure.ts'
import { collectComponents, collectFigureWording, inferFigureType, presentStructuralFields, readNumerals, resolveFamilySeeds, toFigureType, vectorTitle } from './figure-input.ts'
import type { DotFigureType, GenerateFigureType, GeneratePatentFigureDeps, GeneratePatentFigureInput, GeneratePatentFigureOutput, GeneratePatentFigurePanelInput, NormalizedFigureInput, StructuralFigureInput } from './figure-input.ts'
import type { SectionFigureJson } from '../figure/vector-figure-build.ts'
import { buildOutput, indexAnalysis, renderGenerateFigureResult, upsertFigureIndex } from './figure-output.ts'
import { annotateRenderedSvg, buildFigureDot } from './figure-render-plan.ts'
import { applySubmissionPage, buildLayout, resolveSubmission } from './figure-submission.ts'
import type { SubmissionPlanInput } from './figure-submission.ts'
import {
  APPEARANCE_INPUT_SCHEMA,
  BLOCK_SCHEMA,
  CIRCUIT_INPUT_SCHEMA,
  CONNECTION_SCHEMA,
  LAYOUT_SCHEMA,
  PANEL_SCHEMA,
  PLOT_INPUT_SCHEMA,
  SECTION_INPUT_SCHEMA,
  SEQUENCE_INPUT_SCHEMA,
  STATE_SCHEMA,
  STEP_SCHEMA,
  TRANSITION_SCHEMA,
  TREE_SCHEMA,
} from './figure-tool-schemas.ts'
import { COMPONENT_SCHEMA, NUMERAL_MAP_SCHEMA } from './internal/figure-schemas.ts'
import { assertRendered } from './internal/render-outcome.ts'

const DESCRIPTION = [
  '生成专利风格附图：流程图（方法步骤）、状态图（状态+转移条件）、系统框图（组件+连接）、组件层级图，以及直接绘制 SVG 的电路图、曲线图/坐标图、剖视图（含剖面线与剖切符号）、时序图、外观设计六面视图排布；另有内置模板与原始 DOT，输出 SVG/PNG/PDF 到工作区 patent/figures/，返回参考标号映射表与「图N是…；图中：…」格式的附图说明文字。撰写权利要求/说明书需要配图时使用。',
  '',
  '标号体系：每图独立 100 系列（FIG.1=100-199、FIG.2=200-299，默认步进 2，可调）；同一组件跨图出现时用 numerals 显式传入沿用同号，或声明 figure_family 自动续号（同名组件沿用既有标号、新组件取空闲号；缺省每图独立编号）。',
  '',
  '图型推断：figure_type 缺省时从唯一结构输入推断（steps→流程图、states→状态图、blocks→框图、tree→层级图、dot→原始 DOT、template→模板）；同时提供多个结构输入或全空时须显式指定 figure_type。',
  '',
  '多面板：panels 一次生成 FIG.1A/1B 等多张面板（每面板独立文件 figN+后缀，如 A → fig1A.svg），全部面板组件共享一条连续标号系列，附图说明合并输出。',
  '',
  '色彩策略：默认 grayscale（黑白线条，符合《专利审查指南》第一部分第一章 4.3「附图一般使用黑色墨水绘制」）；semantic 模式允许按块类型填充颜色，仅当色彩承载技术内容时使用；target_office="pct" 时 semantic 被拒绝（PCT 实施细则 11.13(a) 规定附图不得着色）。',
  '',
  '输出格式：默认 svg。png/pdf 在需要落版（给了 target_office）时走「先出 SVG → 落版 → 渲染复核 → 文字转路径 → 用本机 Inkscape 导出」的全链，故落版、复核与引线标号对它们同样生效；本机没有 Inkscape 时退回渲染器直接出图，并给出「落版与复核未生效」的警告。直绘图型（电路/曲线/剖视/时序/外观）只有 SVG 一条绘图通路，导出 png/pdf 同样需要 Inkscape。含中文的图导出 pdf 时要先开启文字转路径（Config.figureTextToPath）——Inkscape 对个别未转路径的中文字形会写出缺 xref 的不完整 PDF，工具检出后按导出失败处理，不交出半成品。',
  '',
  '落版：给定 target_office（cnipa/pct/uspto）时，按该法域的 A4 幅面与页边距把图形落版为固定幅面附图页——图号按法域写法（图1 / Fig. 1 / FIG. 1）画在图形正下方（附图两幅以上才编号，单幅不编号），页码按法域写法（中国「2」、PCT/USPTO「2/3」）画在版心底部；同时返回落版缩放比、落版尺寸与字高（含缩小至三分之二后的字高）并核算合规项。fit_to_page=false 时只核算尺寸、不改写画布。',
  '',
  '引线标号：框图/层级图 SVG 默认以「数字+引线指向部件」标注（leader_lines 可关闭），流程图默认保留步骤内嵌 NNN. 前缀；png/pdf 走导出全链时引线随中间 SVG 一起进最终产物，否则不支持并返回警告、保持内嵌标号；直绘图型（电路/曲线/剖视/时序/外观）的标号由输入决定，对它们传 leader_lines 会返回「不生效」警告——剖视图用 sections.labels 给出标号落点与引线起点。引线与标号随图面一起落在画布内，并避开图内已绘的边线与箭头；无引线空间时退化为内嵌标号。',
  '',
  '剖视图要素：sections 直接给出零件轮廓与剖面线，并可给 labels（数字在轮廓外、引线自零件引出且止于数字外框）、centerlines（细点划线，不要用细长多边形伪造）、label_font_size_mm（图面字号）与 hatch: "none"（该轮廓不是被剖切实体，只画轮廓）。sections 也可传 JSON 文件路径。生成后按渲染复核量测图面（标号是否被线条贯穿、点划线是否被实线覆盖、相邻零件剖面线是否可区分、内容是否越出画布）。',
  '',
  '图面用语检查：生成后按《专利法实施细则》第二十一条与《专利审查指南》第一部分第一章 4.3 检查图面词语与标号——非必需注释（注释前缀/正文引用/尺寸标注/句末标点）、非中文词语（缩写与数字符号除外）、非阿拉伯数字标号各出一条警告；只提示，不改写输入。',
  '',
  '本机未安装 Graphviz 时返回 setup_required 与安装引导。',
].join('\n')

/** 一次生成调用的运行参数：输出目录基准、格式、引擎、色彩策略与取消信号。 */
type FigureContext = {
  deps: GeneratePatentFigureDeps
  cwd: string
  format: DotFormat
  engine: DotEngine
  style: 'grayscale' | 'semantic'
  signal: AbortSignal
}

/** 面板的结构输入：面板 schema 已把图型限制为 DOT 图型，此处按该约束收窄。 */
type PanelStructural = StructuralFigureInput & { figure_type: DotFigureType }

/** 一个面板的构建计划：文件后缀、收窄后的图型、引线开关与结构输入。 */
type PanelPlan = {
  suffix: string
  figureType: DotFigureType
  leaderLines: boolean
  structural: PanelStructural
}

/** 多面板一次调用中逐面板复用的数据：标号分配结果、字体与落版参数。 */
type PanelRun = {
  input: GeneratePatentFigureInput
  context: FigureContext
  figureNumber: number
  outputDir: string
  fontName: string
  pageBundle: DotPageBundle | undefined
  assignments: readonly NumeralAssignment[]
}

/** 单图一次渲染的参数：渲染器、文件命名、标号与引线。 */
type SingleFigureRun = {
  context: FigureContext
  figureNumber: number
  outputDir: string
  fontName: string
  numeralsForBuilder: Record<string, string>
  leaderLinesActive: boolean
}

/** 文件形式已解析的单图输入：`sections` 恒为对象（字符串形式在归一前读入）。 */
type ResolvedFigureInput = Omit<GeneratePatentFigureInput, 'sections'> & { sections?: SectionFigureJson }

/**
 * 校验 `sections` 的 JSON 值形状（文件形式的边界校验）：必须是 JSON 对象。
 * @param value - 解析后的 JSON 值。
 * @param source - 报错用的文件路径。
 * @throws PatentToolError 值不是 JSON 对象时。
 */
function assertSectionsValue(value: unknown, source: string): asserts value is SectionFigureJson {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PatentToolError('invalid_tool_input', `sections 文件内容不是 JSON 对象：${source}`, { tool: 'generate_patent_figure' })
  }
}

/**
 * 解析 `sections` 的文件形式：字符串时按 cwd 读 JSON 文件，并用与内联对象同一套
 * 参数校验（`validateArgs` + 同一 schema）核一遍 —— 两条路径的接受范围与报错一致。
 * @param input - the model-supplied input.
 * @param cwd - 相对路径基准。
 * @returns 输入本身，或 `sections` 已换成文件内容的那份输入。
 * @throws PatentToolError 文件缺失（file_not_found）、非 JSON 或不符合剖视图输入时。
 */
async function resolveSectionsFile(
  input: GeneratePatentFigureInput,
  cwd: string,
): Promise<ResolvedFigureInput> {
  const { sections, ...rest } = input
  if (typeof sections !== 'string') return sections === undefined ? rest : { ...rest, sections }
  let raw: string
  try {
    raw = await readFile(resolve(cwd, sections), 'utf8')
  } catch {
    throw new PatentToolError('file_not_found', `sections 文件不存在或不可读：${sections}`, { tool: 'generate_patent_figure' })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new PatentToolError(
      'invalid_tool_input',
      `sections 文件不是合法 JSON：${sections}（${error instanceof Error ? error.message : String(error)}）`,
      { tool: 'generate_patent_figure' },
    )
  }
  assertSectionsValue(parsed, sections)
  const violations = validateArgs({ sections: SECTION_INPUT_SCHEMA }, { sections: parsed })
  if (violations.length > 0) {
    throw new PatentToolError(
      'invalid_tool_input',
      `sections 文件内容不符合剖视图输入：${violations.slice(0, 3).join('；')}`,
      { tool: 'generate_patent_figure' },
    )
  }
  return { ...rest, sections: parsed }
}

/**
 * panels 模式：全部面板组件并入一次 assignNumerals（FIG.1A/1B 共享连续系列），
 * 逐面板构建/渲染/标注后合并输出。
 * @param input - the model-supplied input.
 * @param context - the resolved run parameters.
 * @returns the merged output for every panel.
 */
async function generatePanels(
  input: GeneratePatentFigureInput,
  context: FigureContext,
): Promise<GeneratePatentFigureOutput> {
  const { deps, cwd } = context
  /* v8 ignore next -- execute() only dispatches here with panels present; ?? guards standalone library callers */
  const panels = input.panels ?? []
  assertPanelInput(input, panels)
  const figureNumber = input.figure_number ?? 1
  const panelStructurals = toPanelStructurals(panels, input)
  const allComponents = panelStructurals.flatMap(ps => collectComponents(ps.structural))
  const fontName = (deps.resolveFont ?? ((): string => 'Helvetica'))(allComponents.map(c => c.label))
  const familySeeds = await resolveFamilySeeds(input.figure_family, allComponents, deps)
  // 显式标号优先级：面板 numerals > 顶层 numerals > 家族种子。
  const panelNumerals: Record<string, string> = {}
  for (const panel of panels) {
    for (const [id, numeral] of Object.entries(readNumerals(panel.numerals, `面板 ${panel.suffix}`))) {
      panelNumerals[id] = numeral
    }
  }
  const explicit: Record<string, string> = {
    ...familySeeds.explicit,
    ...readNumerals(input.numerals, '顶层'),
    ...panelNumerals,
  }
  const assignments = assignFigureNumerals({
    ids: allComponents.map(c => c.id),
    figureNumber,
    explicit,
    numeralStart: input.numeral_start,
    numeralStep: input.numeral_step,
    reserved: familySeeds.reserved,
  })
  const pageBundle = resolvePageBundle({
    pageSize: input.page_size ?? deps.pageSize,
    orientation: input.orient ?? deps.orientation,
    dpi: input.dpi ?? deps.dpi,
    marginCm: input.margin ?? deps.marginCm,
  })
  /* v8 ignore next -- apply() always injects outputDir; the cwd-relative default stays for standalone library callers */
  const outputDir = deps.outputDir ?? resolve(cwd, 'patent/figures')
  await mkdir(outputDir, { recursive: true })
  const run: PanelRun = { input, context, figureNumber, outputDir, fontName, pageBundle, assignments }
  const panelOutputs: { suffix: string; output: GeneratePatentFigureOutput }[] = []
  for (const ps of panelStructurals) {
    panelOutputs.push(await renderPanel(ps, run))
  }
  return mergePanelOutputs({ panelOutputs, panelStructurals, input, context })
}

/**
 * 单图路径：归一化输入、分配标号、渲染、组装结果并写索引。
 * @param input - the model-supplied input.
 * @param context - the resolved run parameters.
 * @returns the single-figure output.
 */
async function generateSingleFigure(
  input: ResolvedFigureInput,
  context: FigureContext,
): Promise<GeneratePatentFigureOutput> {
  const { deps, cwd, format } = context
  const normalized = normalizeSingleFigure(input)
  const figureNumber = normalized.figure_number ?? 1
  const vector = isVectorFigureType(normalized.figure_type)
  // 非 SVG 交付走 SVG 全链：中间产物是 SVG，落版/复核/转路径在其上生效，最后导出。
  const chain = needsSvgChain({
    figureType: normalized.figure_type,
    format,
    targetOffice: normalized.target_office,
    exportAvailable: deps.exportFigure !== undefined,
  })
  const svgCapable = format === 'svg' || chain
  // 引线标号默认按图型：框图/层级图开、流程图关；落在 SVG 上，全链时随中间 SVG 一起进最终产物。
  const leaderLines = normalized.leader_lines ?? (normalized.figure_type === 'block_diagram' || normalized.figure_type === 'component_hierarchy')
  const leaderLinesActive = leaderLines && svgCapable && !vector
  const components = collectComponents(normalized)
  const fontName = (deps.resolveFont ?? ((): string => 'Helvetica'))(components.map(c => c.label))

  // 跨图续号种子 + 一次分配、双处使用：分配结果同时作为 builder 的显式标号（图面一致）与输出标号表。
  const familySeeds = await resolveFamilySeeds(normalized.figure_family, components, deps)
  const explicit = {
    ...familySeeds.explicit,
    ...readNumerals(normalized.numerals, '顶层'),
  }
  const assignments = assignFigureNumerals({
    ids: components.map(c => c.id),
    figureNumber,
    explicit,
    numeralStart: normalized.numeral_start,
    numeralStep: normalized.numeral_step,
    reserved: familySeeds.reserved,
  })
  const numeralsForBuilder = Object.fromEntries(assignments.map(a => [a.id, a.numeral]))
  const numeralBy = new Map(assignments.map(a => [a.id, a.numeral]))

  /* v8 ignore next -- apply() always injects outputDir; the cwd-relative default stays for standalone library callers */
  const outputDir = deps.outputDir ?? resolve(cwd, 'patent/figures')
  await mkdir(outputDir, { recursive: true })
  const rendered = await renderSingleFigure(normalized, {
    context,
    figureNumber,
    outputDir,
    fontName,
    numeralsForBuilder,
    leaderLinesActive,
  }, chain ? 'svg' : format)

  // 全链时渲染器写出的是中间 SVG，交付路径是同一基名的目标格式。
  const outcomePath = chain ? rendered.path.replace(/\.svg$/, `.${format}`) : rendered.path
  const result = buildOutput(normalized, {
    cwd,
    outcomePath,
    figureNumber,
    format,
    engine: context.engine,
    figureType: toFigureType(normalized.figure_type),
    numeralBy,
  })
  if (leaderLines && !leaderLinesActive) {
    result.warnings.push(vector
      ? `引线标号（leader_lines）对直绘图型（${normalized.figure_type}）不生效：本图型的标号由输入决定——剖视图用 sections.labels 给出标号落点与引线起点`
      : `引线标号仅支持 SVG 矢量输出；本次 ${format} 保持内嵌标号`)
  } else if (leaderLinesActive) {
    await annotateRenderedSvg(rendered.path, result.numeralMap, result.warnings)
  }
  result.warnings.push(...rendered.vectorWarnings)
  result.warnings.push(...figureWordingWarnings(
    rendered.vectorLabels ?? collectFigureWording(normalized),
    result.numeralMap.map(entry => entry.numeral),
  ))
  if (chain) {
    const outcome = await finishSvgChain({
      deps,
      svgPath: rendered.path,
      outcomePath: result.absolutePath,
      input: normalized,
      suffix: '',
      format,
      dpi: normalized.dpi ?? deps.dpi,
      style: context.style,
      signal: context.signal,
      output: result,
      hasDirectRender: !vector,
    })
    if (outcome === 'fallback') {
      // 直绘通路：按请求的格式重新渲染一次，交付物与不带 target_office 时逐字节相同。
      const direct = await renderSingleFigure(normalized, {
        context,
        figureNumber,
        outputDir,
        fontName,
        numeralsForBuilder,
        leaderLinesActive: leaderLines && !vector,
      }, format)
      await finishDirectRender({
        deps,
        outcomePath: direct.path,
        input: normalized,
        suffix: '',
        format,
        check: false,
        style: context.style,
        signal: context.signal,
        output: result,
      })
    }
  } else {
    await finishDirectRender({
      deps,
      outcomePath: rendered.path,
      input: normalized,
      suffix: '',
      format,
      check: vector,
      style: context.style,
      signal: context.signal,
      output: result,
    })
  }
  let indexed = false
  if ((normalized.persist_index ?? true) && deps.upsertIndex !== undefined) {
    indexed = await upsertFigureIndex({
      upsertIndex: deps.upsertIndex,
      imagePath: result.path,
      analysis: indexAnalysis(result, context.style, normalized.figure_family),
      warnings: result.warnings,
      label: '',
    })
  }
  return { ...result, indexed }
}

/**
 * 补全单图输入的缺省字段：树/嵌套结构在 schema 层只做了形状约束，此处窄化为领域类型后统一下传；
 * 图型显式优先，缺省从唯一结构输入推断（歧义/为空报 invalid_tool_input，由 inferFigureType 抛出）。
 * @param input - the model-supplied input.
 * @returns the input with every structural field present.
 */
function normalizeSingleFigure(input: ResolvedFigureInput): NormalizedFigureInput {
  const { sections, ...rest } = input
  return {
    ...rest,
    ...(sections === undefined ? {} : { sections }),
    figure_type: input.figure_type ?? inferFigureType(input),
    steps: input.steps ?? [],
    states: input.states ?? [],
    transitions: input.transitions ?? [],
    blocks: input.blocks ?? [],
    connections: input.connections ?? [],
    tree: input.tree ?? [],
  }
}

/**
 * panels 模式的输入约束：与顶层结构输入互斥、列表非空、不接受 filename、后缀限字母数字下划线连字符。
 * @param input - the model-supplied input.
 * @param panels - the supplied panels.
 * @throws PatentToolError for each violated constraint.
 */
function assertPanelInput(input: GeneratePatentFigureInput, panels: readonly GeneratePatentFigurePanelInput[]): void {
  const topLevelFields = presentStructuralFields(input).map(p => p.field)
  if (topLevelFields.length > 0) {
    throw new PatentToolError('invalid_tool_input', `panels 不能与顶层结构输入（${topLevelFields.join('、')}）同时提供`, { tool: 'generate_patent_figure' })
  }
  if (panels.length === 0) {
    throw new PatentToolError('invalid_tool_input', 'panels 不能为空列表', { tool: 'generate_patent_figure' })
  }
  if (input.filename !== undefined) {
    throw new PatentToolError('invalid_tool_input', 'panels 模式按 figN<suffix> 命名输出文件，不接受 filename', { tool: 'generate_patent_figure' })
  }
  for (const panel of panels) {
    if (!/^[A-Za-z0-9_-]+$/.test(panel.suffix)) {
      throw new PatentToolError('invalid_tool_input', `面板后缀只能包含字母/数字/下划线/连字符：${panel.suffix}`, { tool: 'generate_patent_figure' })
    }
  }
}

/**
 * 逐面板解析图型（缺省推断）并构造结构化输入；引线标号按面板图型取默认。
 * @param panels - the supplied panels.
 * @param input - the top-level input the panel fields inherit from.
 * @returns one plan per panel, in supplied order.
 */
function toPanelStructurals(
  panels: readonly GeneratePatentFigurePanelInput[],
  input: GeneratePatentFigureInput,
): PanelPlan[] {
  return panels.map((panel) => {
    // schema 层已把面板图型限制为 DOT 图型（矢量图型字段不在面板 schema 内），此处按该约束收窄。
    const figureType = (panel.figure_type ?? inferFigureType(panel, `面板 ${panel.suffix}`)) as DotFigureType
    return {
      suffix: panel.suffix,
      figureType,
      // 顶层 leader_lines 强制全部面板；缺省按面板图型取默认（框图/层级图开）。
      leaderLines: input.leader_lines ?? (figureType === 'block_diagram' || figureType === 'component_hierarchy'),
      structural: {
        figure_type: figureType,
        steps: panel.steps ?? [],
        states: panel.states ?? [],
        transitions: panel.transitions ?? [],
        blocks: panel.blocks ?? [],
        connections: panel.connections ?? [],
        tree: panel.tree ?? [],
        template: panel.template,
        dot: panel.dot,
        invention_name: input.invention_name,
      } satisfies PanelStructural,
    }
  })
}

/**
 * 分配标号系列。显式标号重复、系列起止非法都在这里译成 invalid_tool_input：
 * 单图与多面板两条路径共用同一条分配与报错路径。
 * @param args - ids in figure order, the figure number, explicit numerals, and optional start/step/reserved.
 * @returns the assignments in id order; empty when the figure has no components.
 * @throws PatentToolError when the series bounds or an explicit numeral is invalid.
 */
function assignFigureNumerals(args: {
  ids: readonly string[]
  figureNumber: number
  explicit: Record<string, string>
  numeralStart?: number | undefined
  numeralStep?: number | undefined
  reserved?: readonly string[] | undefined
}): NumeralAssignment[] {
  if (args.ids.length === 0) return []
  try {
    return assignNumerals(args.ids, {
      figureNumber: args.figureNumber,
      ...(args.numeralStart === undefined ? {} : { start: args.numeralStart }),
      ...(args.numeralStep === undefined ? {} : { step: args.numeralStep }),
      explicit: args.explicit,
      ...(args.reserved === undefined || args.reserved.length === 0 ? {} : { reserved: args.reserved }),
    })
  } catch (error) {
    /* v8 ignore start -- assignNumerals only throws DotBuildError; keep the rethrow loud for invariant drift */
    if (error instanceof DotBuildError) {
      throw new PatentToolError('invalid_tool_input', `标号分配失败：${error.message}`, { tool: 'generate_patent_figure' })
    }
    throw error
    /* v8 ignore stop */
  }
}

/**
 * 面板渲染：按该面板的组件子集取标号，构建并渲染，再标注引线、落版。
 * @param panel - the panel plan.
 * @param run - the data shared by every panel of this call.
 * @returns the panel suffix with its output record.
 */
async function renderPanel(
  panel: PanelPlan,
  run: PanelRun,
): Promise<{ suffix: string; output: GeneratePatentFigureOutput }> {
  const { deps, format } = run.context
  const panelIds = new Set(collectComponents(panel.structural).map(c => c.id))
  const panelAssignments = run.assignments.filter(a => panelIds.has(a.id))
  const numeralsForBuilder = Object.fromEntries(panelAssignments.map(a => [a.id, a.numeral]))
  const numeralBy = new Map(panelAssignments.map(a => [a.id, a.numeral]))
  const chain = needsSvgChain({
    figureType: panel.figureType,
    format,
    targetOffice: run.input.target_office,
    exportAvailable: deps.exportFigure !== undefined,
  })
  const leaderLinesActive = panel.leaderLines && (format === 'svg' || chain)
  let dot: string
  try {
    dot = buildFigureDot(panel.structural, {
      figureNumber: run.figureNumber,
      numeralsForBuilder,
      numeralStep: run.input.numeral_step,
      style: run.context.style,
      fontName: run.fontName,
      pageBundle: run.pageBundle,
      leaderLinesActive,
    })
  } catch (error) {
    /* v8 ignore start -- builders only throw DotBuildError; keep the rethrow loud for invariant drift */
    if (error instanceof DotBuildError) {
      throw new PatentToolError('invalid_tool_input', `附图内容校验失败（面板 ${panel.suffix}）：${error.message}`, { tool: 'generate_patent_figure' })
    }
    throw error
    /* v8 ignore stop */
  }
  const outcome = await deps.render({
    dot,
    filename: `fig${run.figureNumber}${panel.suffix}`,
    format: chain ? 'svg' : format,
    engine: run.context.engine,
    outputDir: run.outputDir,
    signal: run.context.signal,
  })
  assertRendered(outcome, 'generate_patent_figure')
  const output = buildOutput(panel.structural, {
    cwd: run.context.cwd,
    outcomePath: chain ? outcome.path.replace(/\.svg$/, `.${format}`) : outcome.path,
    figureNumber: run.figureNumber,
    format,
    engine: run.context.engine,
    figureType: toFigureType(panel.figureType),
    numeralBy,
    suffix: panel.suffix,
  })
  if (leaderLinesActive) {
    await annotateRenderedSvg(outcome.path, output.numeralMap, output.warnings)
  }
  // 全链成功后不再走直绘收尾；失败则按请求的格式重渲染一次，交付物与不带
  // target_office 时逐字节相同（`finishSvgChain` 已把未生效的原因写进警告）。
  let directPath = outcome.path
  const chained = chain && await finishSvgChain({
    deps,
    svgPath: outcome.path,
    outcomePath: output.absolutePath,
    input: run.input,
    suffix: panel.suffix,
    format,
    dpi: run.input.dpi ?? deps.dpi,
    style: run.context.style,
    signal: run.context.signal,
    output,
    hasDirectRender: true,
  }) === 'done'
  if (!chained) {
    if (chain) {
      const direct = await deps.render({
        dot,
        filename: `fig${run.figureNumber}${panel.suffix}`,
        format,
        engine: run.context.engine,
        outputDir: run.outputDir,
        signal: run.context.signal,
      })
      assertRendered(direct, 'generate_patent_figure')
      directPath = direct.path
    }
    await finishDirectRender({
      deps,
      outcomePath: directPath,
      input: run.input,
      suffix: panel.suffix,
      format,
      check: false,
      style: run.context.style,
      signal: run.context.signal,
      output,
    })
  }
  return { suffix: panel.suffix, output }
}

/**
 * 是否需要「SVG 全链」交付非 SVG：先出 SVG、落版、复核、文字转路径，再交 Inkscape 导出。
 *
 * 两种情况需要它——落版/复核/文字转路径只作用于 SVG，而矢量图型本来就只有 SVG 一条
 * 绘图通路（渲染器无法直接出 png/pdf）。没有注入导出端口时不走全链：渲染器直接出图，
 * 落版与复核的缺席由各自的警告说明。
 * @param args - the figure type, the requested format, the target office, and whether the export port is wired.
 * @returns 本次调用是否走全链。
 */
function needsSvgChain(args: {
  figureType: GenerateFigureType
  format: DotFormat
  targetOffice: TargetOffice | undefined
  exportAvailable: boolean
}): boolean {
  if (args.format === 'svg' || !args.exportAvailable) return false
  return isVectorFigureType(args.figureType) || args.targetOffice !== undefined
}

/**
 * SVG 全链的收尾：在中间 SVG 上落版、复核、转路径，再导出请求的格式。
 *
 * 三步的警告先攒在暂存输出里，导出成功才并入：导出失败时它们描述的交付物并不存在，
 * 逐条抛出去会误导用户。
 * @param args - the deps, the intermediate SVG and final paths, the layout input, the format, dpi, signal, and the output to extend.
 * @returns 'done' 表示导出成功；'fallback' 表示导出失败但调用方还有直绘通路可退回。
 * @throws PatentToolError 导出失败且该图型没有 SVG 直绘以外的通路时（`setup_required` / `tool_execution_failed`）。
 */
async function finishSvgChain(args: {
  deps: GeneratePatentFigureDeps
  svgPath: string
  outcomePath: string
  input: SubmissionPlanInput
  suffix: string
  format: DotFormat
  dpi: number | undefined
  style: 'grayscale' | 'semantic'
  signal: AbortSignal
  output: GeneratePatentFigureOutput
  /** 渲染器直接出图的通路是否存在（矢量图型为 false：导出失败即无产物可交）。 */
  hasDirectRender: boolean
}): Promise<'done' | 'fallback'> {
  const staged: GeneratePatentFigureOutput = { ...args.output, warnings: [] }
  await layoutSubmissionPage({
    input: args.input,
    suffix: args.suffix,
    outcomePath: args.svgPath,
    format: 'svg',
    style: args.style,
    output: staged,
  })
  await checkRenderedFigure({ path: args.svgPath, warnings: staged.warnings })
  await outlineFigureText({ deps: args.deps, path: args.svgPath, format: 'svg', signal: args.signal, warnings: staged.warnings })
  const exported = await args.deps.exportFigure?.({
    path: args.svgPath,
    outcomePath: args.outcomePath,
    format: toExportFormat(args.format),
    ...(args.dpi === undefined ? {} : { dpi: args.dpi }),
    signal: args.signal,
  })
  if (exported !== undefined && exported.ok) {
    args.output.warnings.push(...staged.warnings)
    if (staged.layout !== undefined) args.output.layout = staged.layout
    return 'done'
  }
  const reason = exported === undefined ? '宿主未注入格式导出端口' : exported.error
  if (!args.hasDirectRender) {
    throw new PatentToolError(exported?.code === 'not_installed' ? 'setup_required' : 'tool_execution_failed', `导出 ${args.format} 失败：${reason}`, { tool: 'generate_patent_figure' })
  }
  args.output.warnings.push(`未能导出 ${args.format}：${reason}；落版、渲染复核与文字转路径未生效（它们只作用于 SVG），改由渲染器直接出图`)
  return 'fallback'
}

/**
 * 渲染器直绘路径的收尾：落版、按需复核、文字转路径。全链回退时也走这里——那时
 * 交付物是渲染器的原始产物，这三步应按各自对非 SVG 的既有规则给出警告。
 * @param args - the deps, the delivered path and format, whether to run the render check, the signal, and the warning sink.
 */
async function finishDirectRender(args: {
  deps: GeneratePatentFigureDeps
  outcomePath: string
  input: SubmissionPlanInput
  suffix: string
  format: DotFormat
  check: boolean
  style: 'grayscale' | 'semantic'
  signal: AbortSignal
  output: GeneratePatentFigureOutput
}): Promise<void> {
  await layoutSubmissionPage({
    input: args.input,
    suffix: args.suffix,
    outcomePath: args.outcomePath,
    format: args.format,
    style: args.style,
    output: args.output,
  })
  if (args.check) await checkRenderedFigure({ path: args.outcomePath, warnings: args.output.warnings })
  await outlineFigureText({
    deps: args.deps,
    path: args.outcomePath,
    format: args.format,
    signal: args.signal,
    warnings: args.output.warnings,
  })
}

/** 导出格式窄化（全链只在非 SVG 时启用）。 */
function toExportFormat(format: DotFormat): 'png' | 'pdf' {
  /* v8 ignore next -- 全链由 needsSvgChain 保证只在 png/pdf 时启用 */
  if (format !== 'png' && format !== 'pdf') throw new PatentToolError('invalid_tool_input', `不支持的导出格式：${format}`, { tool: 'generate_patent_figure' })
  return format
}

/**
 * 单图渲染：矢量图型直接绘制 SVG（无 Graphviz 依赖），其余图型构建 DOT 交渲染器。
 * @param normalized - the normalized single-figure input.
 * @param run - the render parameters resolved for this call.
 * @param renderFormat - the format to render (the SVG chain renders SVG and exports afterwards).
 * @returns the rendered path with the vector path's labels and warnings.
 */
async function renderSingleFigure(
  normalized: NormalizedFigureInput,
  run: SingleFigureRun,
  renderFormat: DotFormat,
): Promise<{ path: string; vectorLabels: readonly string[] | undefined; vectorWarnings: readonly string[] }> {
  const { deps, engine, style, signal } = run.context
  const filename = normalized.filename ?? `fig${run.figureNumber}`
  // 两条通路：矢量图型直接绘制 SVG（无 Graphviz 依赖）；其余图型构建 DOT 交渲染器。
  if (isVectorFigureType(normalized.figure_type)) {
    if (renderFormat !== 'svg') {
      throw new PatentToolError('invalid_tool_input', `${normalized.figure_type} 是 SVG 直绘图型，仅支持 format="svg"`, { tool: 'generate_patent_figure' })
    }
    let build
    try {
      build = buildVectorFigure(normalized.figure_type, normalized)
    } catch (error) {
      if (error instanceof VectorFigureError) {
        throw new PatentToolError('invalid_tool_input', `${normalized.figure_type} 输入校验失败：${error.message}`, { tool: 'generate_patent_figure' })
      }
      throw error
    }
    const path = join(run.outputDir, `${sanitizeDotFilename(filename)}.svg`)
    const svg = vectorFigureSvg(build.spec, vectorTitle(normalized.invention_name, toFigureType(normalized.figure_type)))
    await writeFile(path, svg, 'utf8')
    return { path, vectorLabels: build.spec.labels, vectorWarnings: [...build.warnings] }
  }
  const dotInput: StructuralFigureInput & { figure_type: DotFigureType } = { ...normalized, figure_type: normalized.figure_type }
  let dot: string
  try {
    // per-call 覆盖部署默认；四项全缺省时不输出任何布局属性（零回归）。
    const pageBundle = resolvePageBundle({
      pageSize: normalized.page_size ?? deps.pageSize,
      orientation: normalized.orient ?? deps.orientation,
      dpi: normalized.dpi ?? deps.dpi,
      marginCm: normalized.margin ?? deps.marginCm,
    })
    dot = buildFigureDot(dotInput, {
      figureNumber: run.figureNumber,
      numeralsForBuilder: run.numeralsForBuilder,
      numeralStep: normalized.numeral_step,
      style,
      fontName: run.fontName,
      pageBundle,
      leaderLinesActive: run.leaderLinesActive,
    })
  } catch (error) {
    /* v8 ignore start -- builders only throw DotBuildError; keep the rethrow loud for invariant drift */
    if (error instanceof DotBuildError) {
      throw new PatentToolError('invalid_tool_input', `附图内容校验失败：${error.message}`, { tool: 'generate_patent_figure' })
    }
    throw error
    /* v8 ignore stop */
  }
  const outcome = await deps.render({
    dot,
    filename,
    format: renderFormat,
    engine,
    outputDir: run.outputDir,
    signal,
  })
  assertRendered(outcome, 'generate_patent_figure')
  return { path: outcome.path, vectorLabels: undefined, vectorWarnings: [] }
}

/**
 * 合并各面板输出：面板句各一句 + 全部面板共用一条「图中」标号表，并写附图索引。
 * @param args - the panel outputs and plans, the top-level input, and the run parameters.
 * @returns the merged tool output.
 */
async function mergePanelOutputs(args: {
  panelOutputs: readonly { suffix: string; output: GeneratePatentFigureOutput }[]
  panelStructurals: readonly PanelPlan[]
  input: GeneratePatentFigureInput
  context: FigureContext
}): Promise<GeneratePatentFigureOutput> {
  const { panelOutputs, panelStructurals, input, context } = args
  const { deps, format, engine, style } = context
  const figureNumber = input.figure_number ?? 1
  const mergedNumerals = panelOutputs.flatMap(po => po.output.numeralMap)
  const sentences = panelOutputs.map(po => figureSentence(
    figureNumber,
    FIGURE_TYPE_NAMES[po.output.figureType],
    input.invention_name,
    po.suffix,
  ))
  const sharedNumerals = mergedNumerals.map(m => `${m.numeral}-${m.label}`).join('，')
  const figureDescription = sharedNumerals === ''
    ? `${sentences.join('；')}。`
    : `${sentences.join('；')}；图中：${sharedNumerals}。`
  const warnings = panelOutputs.flatMap(po => po.output.warnings)
  if (panelStructurals.some(ps => ps.leaderLines) && format !== 'svg') {
    warnings.push(`引线标号仅支持 SVG 矢量输出；本次 ${format} 保持内嵌标号`)
  }
  warnings.push(...figureWordingWarnings(
    panelStructurals.flatMap(ps => collectFigureWording(ps.structural)),
    mergedNumerals.map(entry => entry.numeral),
  ))
  let indexed = false
  if ((input.persist_index ?? true) && deps.upsertIndex !== undefined) {
    indexed = true
    for (const po of panelOutputs) {
      // 任一面板写入失败即整体未索引；失败原因由 upsertFigureIndex 记进 warnings。
      if (!await upsertFigureIndex({
        upsertIndex: deps.upsertIndex,
        imagePath: po.output.path,
        analysis: indexAnalysis(po.output, style, input.figure_family),
        warnings,
        label: `面板 ${po.suffix} `,
      })) {
        indexed = false
      }
    }
  }
  /* v8 ignore start -- panels is validated non-empty above, so the first panel always exists */
  return {
    path: panelOutputs[0]?.output.path ?? '',
    absolutePath: panelOutputs[0]?.output.absolutePath ?? '',
    format,
    engine,
    figureNumber,
    figureType: panelOutputs[0]?.output.figureType ?? 'unknown',
    figureDescription,
    numeralMap: mergedNumerals,
    components: panelOutputs.flatMap(po => po.output.components),
    connections: panelOutputs.flatMap(po => po.output.connections),
    warnings,
    indexed,
    panels: panelOutputs.map(po => ({
      suffix: po.suffix,
      path: po.output.path,
      absolutePath: po.output.absolutePath,
      figureType: po.output.figureType,
      ...(po.output.layout === undefined ? {} : { layout: po.output.layout }),
    })),
  }
  /* v8 ignore stop */
}

/**
 * 落版与合规核算：给定 target_office 时把图形落到该法域幅面，并把结果挂到输出上。
 * @param args - the input, the panel suffix (`''` for the single path), the rendered path, the format, the style, and the output to extend.
 */
async function layoutSubmissionPage(args: {
  input: SubmissionPlanInput
  suffix: string
  outcomePath: string
  format: DotFormat
  style: 'grayscale' | 'semantic'
  output: GeneratePatentFigureOutput
}): Promise<void> {
  const plan = resolveSubmission(args.input, args.suffix)
  if (plan === undefined) return
  const applied = await applySubmissionPage(args.outcomePath, plan, args.format, args.output.warnings)
  if (applied !== undefined) {
    args.output.layout = buildLayout(plan, applied, args.style, args.input.figure_count ?? 1, args.output.warnings)
  }
}

/**
 * 渲染复核：量测交付文件，把发现折成警告（只对直绘图型）。
 *
 * 放在落版之后、文字转路径之前：落版会改写坐标与画布，复核要量的是最终交付物；转路径
 * 之后图面已无 `<text>`，贯穿判定无从做起。只查得出「画出来才看得见」的问题（标号被
 * 线条贯穿、点划线被实线覆盖、相邻零件剖面线取向过近、内容越出画布），与输入检查互补。
 * 体量上限已由 vectorFigureSvg 按 DEFAULT_VECTOR_BODY_MAX_BYTES 卡住，复核不再按同一上限
 * 二次拦截（复核含未量测说明，超限被拒会把它整段吞掉）；调用方给的外观视图片段仍可能带上
 * 复核本身拒绝的结构，那时记一条跳过说明，不吞掉已生成的图。
 * @param args - the delivered path and the warning sink.
 */
async function checkRenderedFigure(args: { path: string; warnings: string[] }): Promise<void> {
  let svg: string
  try {
    svg = await readFile(args.path, 'utf8')
  } catch (error) {
    args.warnings.push(`渲染复核被跳过：读取 ${args.path} 失败（${error instanceof Error ? error.message : String(error)}）`)
    return
  }
  try {
    args.warnings.push(...checkFigureRendering(svg, { maxBytes: Buffer.byteLength(svg, 'utf8') }).findings
      .map(finding => `渲染复核：${finding.message}`))
  } catch (error) {
    /* v8 ignore next -- 复核只抛 SvgAnnotateError；其余异常原样上抛（不变量漂移） */
    if (!(error instanceof SvgAnnotateError)) throw error
    args.warnings.push(`渲染复核被跳过：${error.message}`)
  }
}

/**
 * 文字转路径：把已落版文件里的 `<text>` 换成轮廓路径（Config.figureTextToPath）。
 *
 * 放在落版之后：落版会改写坐标与画布，先转的路径还得再被改写一次；转完不再有
 * 步骤解析文件（索引只记路径）。只对 SVG 生效——png/pdf 由渲染器按 Config.dotFont
 * 出字，那时给出「本参数不生效」的警告而不是静默忽略。
 * @param args - the deps, the finished path, the output format, the caller's cancel signal, and the warning sink.
 */
async function outlineFigureText(args: {
  deps: GeneratePatentFigureDeps
  path: string
  format: DotFormat
  signal: AbortSignal
  warnings: string[]
}): Promise<void> {
  const outline = args.deps.outlineText
  if (outline === undefined) return
  if (args.format !== 'svg') {
    args.warnings.push(`文字转路径（Config.figureTextToPath）仅对 SVG 输出生效；本次 ${args.format} 仍由渲染器按 Config.dotFont 出字`)
    return
  }
  const outcome = await outline({ path: args.path, signal: args.signal })
  assertRendered(outcome, 'generate_patent_figure')
}

/**
 * Build the `generate_patent_figure` tool over injected renderer.
 * @param deps - renderer + optional output dir / index upsert / cwd / font resolver.
 * @returns a registry-ready tool definition.
 */
export function createGeneratePatentFigureTool(deps: GeneratePatentFigureDeps): ToolDefinition {
  return defineTool({
    name: 'generate_patent_figure',
    description: DESCRIPTION,
    parameters: {
      figure_type: {
        type: 'string',
        enum: ['flowchart', 'state_diagram', 'block_diagram', 'component_hierarchy', 'circuit', 'plot', 'cross_section', 'sequence_diagram', 'appearance_view', 'raw_dot', 'template'],
        description: '图型；缺省时从唯一结构输入推断（steps→flowchart、states→state_diagram、blocks→block_diagram、tree→component_hierarchy、circuit/plot/sections/sequence/appearance_views→同名图型、dot→raw_dot、template→template），多输入或无输入须显式指定',
      },
      steps: { type: 'array', items: STEP_SCHEMA, description: '流程图步骤（figure_type=flowchart 时必填）' },
      states: { type: 'array', items: STATE_SCHEMA, description: '状态图状态（figure_type=state_diagram 时必填）' },
      transitions: { type: 'array', items: TRANSITION_SCHEMA, description: '状态转移（state_diagram；端点必须存在于 states）' },
      circuit: { ...CIRCUIT_INPUT_SCHEMA, description: '电路图输入（figure_type=circuit 时必填）：元件按网格行列放置，连线正交走线，T 形结点画实心连接点' },
      plot: { ...PLOT_INPUT_SCHEMA, description: '曲线图/坐标图输入（figure_type=plot 时必填）：坐标轴 + 刻度 + 单位 + 多条序列（用标记形状区分，不用颜色）' },
      sections: {
        oneOf: [SECTION_INPUT_SCHEMA, { type: 'string' }],
        description: '剖视图输入（figure_type=cross_section 时必填）：零件轮廓 + 45° 剖面线（相邻件方向相反或间距不等）+ 引线标号 + 中心线 + 剖切位置符号；也可传指向含该对象的 JSON 文件的路径（工作区相对或绝对），大块坐标放文件里就不必每次重渲染都内联',
      },
      sequence: { ...SEQUENCE_INPUT_SCHEMA, description: '时序图输入（figure_type=sequence_diagram 时必填）：参与者生命线 + 消息箭线' },
      appearance_views: { ...APPEARANCE_INPUT_SCHEMA, description: '外观设计视图排布输入（figure_type=appearance_view 时必填）：把调用方提供的六面视图片段按第一角投影排布并统一比例、逐视图标注视图名称' },
      blocks: { type: 'array', items: BLOCK_SCHEMA, description: '框图块（figure_type=block_diagram 时必填）' },
      connections: {
        type: 'array',
        items: CONNECTION_SCHEMA,
        description: '框图连接（block_diagram）',
      },
      tree: {
        type: 'array',
        items: TREE_SCHEMA,
        description: '组件层级树（component_hierarchy，任意深度）',
      },
      template: {
        type: 'string',
        enum: DIAGRAM_TEMPLATE_NAMES,
        description: '内置模板（figure_type=template 时必填）：simple_flowchart/system_block/method_steps/component_hierarchy',
      },
      dot: { type: 'string', description: '原始 Graphviz DOT（figure_type=raw_dot）；须自包含：不接受 image/shapefile/fontpath 等文件引用属性' },
      panels: { type: 'array', items: PANEL_SCHEMA, description: '多面板模式：一次生成多张共享标号系列的面板（fig1A/fig1B…）；与顶层结构输入互斥，列表不可为空' },
      figure_number: { type: 'integer', description: '图号，默认 1（决定标号系列起点）' },
      invention_name: { type: 'string', description: '发明名称（附图说明模板句）' },
      numerals: { type: 'object', additionalProperties: true, description: '显式标号（组件 id → 标号；标号可为字符串或数字，其他类型会被拒绝；跨图同件同号续接）' },
      numeral_start: { type: 'integer', description: '自动标号系列起点覆盖' },
      numeral_step: { type: 'integer', description: '标号步进，默认 2' },
      figure_family: { type: 'string', description: '发明家族标识（跨图续号）：声明后同名组件沿用既有标号、新组件续接空闲号；缺省每图独立编号' },
      style: { type: 'string', enum: ['grayscale', 'semantic'], description: '色彩策略，默认 grayscale' },
      filename: { type: 'string', description: '输出文件名（不含扩展名）' },
      format: { type: 'string', enum: DOT_FORMATS, description: '输出格式，默认 svg；png/pdf 在给定 target_office（或图型只有 SVG 通路）时经本机 Inkscape 从 SVG 全链导出，缺 Inkscape 时退回渲染器直接出图' },
      engine: { type: 'string', enum: DOT_ENGINES, description: '布局引擎，默认 dot' },
      page_size: { type: 'string', enum: ['a4', 'letter'], description: '页面尺寸（提交规格）；默认取部署配置' },
      orient: { type: 'string', enum: ['portrait', 'landscape'], description: '页面方向；默认 portrait，取部署配置' },
      dpi: { type: 'integer', description: '渲染分辨率（png 栅格生效）；默认取部署配置' },
      margin: { type: 'number', description: '页边距（厘米，四边同值）；默认取部署配置' },
      leader_lines: { type: 'boolean', description: '引线标号（数字置于部件外侧并以引线相连，仅 SVG 生效）；默认框图/层级图开启、流程图关闭' },
      target_office: {
        type: 'string',
        enum: TARGET_OFFICES,
        description: '目标法域：给定时按该法域的 A4 幅面、页边距、图号写法（图1/Fig. 1/FIG. 1）把图形落版为固定幅面附图页，并核算落版字高与色彩合规；png/pdf 需经 Inkscape 全链导出才会落版',
      },
      figure_count: { type: 'integer', description: '本案附图总数（默认 1）：两幅以上才逐幅标注图号（中国指南 4.3、PCT 11.13(k)、37 CFR 1.84(u)）' },
      sheet_index: { type: 'integer', description: '附图页序号，默认 1' },
      sheet_total: { type: 'integer', description: '附图页总数，默认 1（PCT/USPTO 页码写作「序号/总数」）' },
      caption: { type: 'string', description: '图号文字覆盖（缺省按目标法域生成；panels 模式自动追加面板后缀，如 图1A / Fig. 1A）' },
      fit_to_page: { type: 'boolean', description: '默认 true：把图形落版到目标法域幅面（SVG，或经 Inkscape 全链导出的 png/pdf）；false 时只核算尺寸、不改写画布' },
      caption_font_mm: { type: 'number', description: '图号字高（毫米，默认 4）；目标法域对图面文字有最小字高要求时用它调大，须为正数' },
      caption_gap_mm: { type: 'number', description: '图号与图形之间的间距（毫米，默认 3），须为正数' },
      sheet_font_mm: { type: 'number', description: '附图页页码字高（毫米，默认 3），须为正数' },
      rotate_deg: { type: 'integer', enum: [0, 90, 180, 270], description: '落版时把图形绕绘图区中心顺时针旋转的角度（默认 0）：横长的图形配竖向版心时用 90，落版宽高随之互换；图号仍落在图形正下方' },
      require_explicit_hatch: { type: 'boolean', description: '剖视图（cross_section）专用，默认 false：true 时每个轮廓都必须显式给出 hatch（不被剖切的写 "none"），否则报错；缺省时未给的轮廓套用默认 45°/3 毫米并返回提示' },
      persist_index: { type: 'boolean', description: '默认 true：写入附图索引（供 search_patent_figure 检索）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          absolutePath: { type: 'string', required: true },
          format: { type: 'string', required: true, enum: DOT_FORMATS },
          engine: { type: 'string', required: true, enum: DOT_ENGINES },
          figureNumber: { type: 'integer', required: true },
          figureType: { type: 'string', required: true, enum: FIGURE_TYPES },
          figureDescription: { type: 'string', required: true },
          numeralMap: { type: 'array', required: true, items: NUMERAL_MAP_SCHEMA },
          components: { type: 'array', required: true, items: COMPONENT_SCHEMA },
          connections: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                source: { type: 'string', required: true },
                target: { type: 'string', required: true },
                kind: { type: 'string', required: true, enum: ['electrical', 'mechanical', 'data_flow', 'unknown'] },
                description: { type: 'string', required: true },
              },
            },
          },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
          indexed: { type: 'boolean', required: true },
          layout: { ...LAYOUT_SCHEMA, description: '落版与合规核算结果（给定 target_office 时）' },
          panels: {
            type: 'array',
            description: '多面板摘要（panels 模式）',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                suffix: { type: 'string', required: true },
                path: { type: 'string', required: true },
                absolutePath: { type: 'string', required: true },
                figureType: { type: 'string', required: true, enum: FIGURE_TYPES },
                layout: { ...LAYOUT_SCHEMA, description: '面板落版与合规核算结果（给定 target_office 时）' },
              },
            },
          },
        },
      },
      render: (_args, value) => renderGenerateFigureResult(value),
    },
    async execute(args, exec) {
      // schema 校验后的模型 JSON 边界；深层结构（层次树递归）由 build 函数校验。
      const rawInput = args as unknown as GeneratePatentFigureInput
      const cwd = deps.cwd ?? process.cwd()
      const input = await resolveSectionsFile(rawInput, cwd)
      const format = input.format ?? 'svg'
      const engine = input.engine ?? 'dot'
      const style = input.style === 'semantic' ? 'semantic' : 'grayscale'
      if (input.target_office === 'pct' && style === 'semantic') {
        throw new PatentToolError('invalid_tool_input', 'PCT 附图不得着色（PCT 实施细则 11.13(a)）：target_office="pct" 时请使用 style="grayscale"', { tool: 'generate_patent_figure' })
      }
      const context: FigureContext = { deps, cwd, format, engine, style, signal: exec.signal }
      if (input.panels !== undefined) {
        return generatePanels(input, context)
      }
      return generateSingleFigure(input, context)
    },
  })
}
