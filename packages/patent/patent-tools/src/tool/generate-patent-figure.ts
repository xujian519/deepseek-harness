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

import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { PatentToolError } from '../error.ts'
import { DIAGRAM_TEMPLATE_NAMES, DOT_ENGINES, DOT_FORMATS, DotBuildError, assignNumerals, resolvePageBundle } from '../figure/dot-builder.ts'
import type { DotEngine, DotFormat, DotPageBundle, NumeralAssignment } from '../figure/dot-builder.ts'
import { figureSentence } from '../figure/figure-description.ts'
import { sanitizeDotFilename } from '../figure/graphviz-renderer.ts'
import { TARGET_OFFICES } from '../figure/office-profile.ts'
import { buildVectorFigure, isVectorFigureType } from '../figure/vector-figure-build.ts'
import { VectorFigureError, vectorFigureSvg } from '../figure/vector-figure.ts'
import { figureWordingWarnings } from '../figure/wording-rules.ts'
import { FIGURE_TYPE_NAMES, FIGURE_TYPES } from './analyze-patent-figure.ts'
import { collectComponents, collectFigureWording, inferFigureType, presentStructuralFields, readNumerals, resolveFamilySeeds, toFigureType, vectorTitle } from './figure-input.ts'
import type { DotFigureType, GeneratePatentFigureDeps, GeneratePatentFigureInput, GeneratePatentFigureOutput, GeneratePatentFigurePanelInput, NormalizedFigureInput, StructuralFigureInput } from './figure-input.ts'
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
  '落版：给定 target_office（cnipa/pct/uspto）时，按该法域的 A4 幅面与页边距把图形落版为固定幅面附图页——图号按法域写法（图1 / Fig. 1 / FIG. 1）画在图形正下方（附图两幅以上才编号，单幅不编号），页码按法域写法（中国「2」、PCT/USPTO「2/3」）画在版心底部；同时返回落版缩放比、落版尺寸与字高（含缩小至三分之二后的字高）并核算合规项。仅 SVG 输出支持落版；fit_to_page=false 时只核算尺寸、不改写画布。',
  '',
  '引线标号：框图/层级图 SVG 默认以「数字+引线指向部件」标注（leader_lines 可关闭），流程图默认保留步骤内嵌 NNN. 前缀；非 SVG 格式不支持引线，返回警告并保持内嵌标号。引线与标号随图面一起落在画布内，并避开图内已绘的边线与箭头；无引线空间时退化为内嵌标号。',
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
  input: GeneratePatentFigureInput,
  context: FigureContext,
): Promise<GeneratePatentFigureOutput> {
  const { deps, cwd, format } = context
  const normalized = normalizeSingleFigure(input)
  const figureNumber = normalized.figure_number ?? 1
  // 引线标号默认按图型：框图/层级图开、流程图关；仅 SVG 生效。
  const leaderLines = normalized.leader_lines ?? (normalized.figure_type === 'block_diagram' || normalized.figure_type === 'component_hierarchy')
  const leaderLinesActive = leaderLines && format === 'svg'
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
  })

  const result = buildOutput(normalized, {
    cwd,
    outcomePath: rendered.path,
    figureNumber,
    format,
    engine: context.engine,
    figureType: toFigureType(normalized.figure_type),
    numeralBy,
  })
  if (leaderLines && !leaderLinesActive) {
    result.warnings.push(`引线标号仅支持 SVG 矢量输出；本次 ${format} 保持内嵌标号`)
  } else if (leaderLinesActive) {
    await annotateRenderedSvg(rendered.path, result.numeralMap, result.warnings)
  }
  result.warnings.push(...rendered.vectorWarnings)
  result.warnings.push(...figureWordingWarnings(
    rendered.vectorLabels ?? collectFigureWording(normalized),
    result.numeralMap.map(entry => entry.numeral),
  ))
  await layoutSubmissionPage({
    input: normalized,
    suffix: '',
    outcomePath: rendered.path,
    format,
    style: context.style,
    output: result,
  })
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
function normalizeSingleFigure(input: GeneratePatentFigureInput): NormalizedFigureInput {
  return {
    ...input,
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
  const leaderLinesActive = panel.leaderLines && format === 'svg'
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
    format,
    engine: run.context.engine,
    outputDir: run.outputDir,
    signal: run.context.signal,
  })
  assertRendered(outcome, 'generate_patent_figure')
  const output = buildOutput(panel.structural, {
    cwd: run.context.cwd,
    outcomePath: outcome.path,
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
  await layoutSubmissionPage({
    input: run.input,
    suffix: panel.suffix,
    outcomePath: outcome.path,
    format,
    style: run.context.style,
    output,
  })
  return { suffix: panel.suffix, output }
}

/**
 * 单图渲染：矢量图型直接绘制 SVG（无 Graphviz 依赖），其余图型构建 DOT 交渲染器。
 * @param normalized - the normalized single-figure input.
 * @param run - the render parameters resolved for this call.
 * @returns the rendered path with the vector path's labels and warnings.
 */
async function renderSingleFigure(
  normalized: NormalizedFigureInput,
  run: SingleFigureRun,
): Promise<{ path: string; vectorLabels: readonly string[] | undefined; vectorWarnings: readonly string[] }> {
  const { deps, format, engine, style, signal } = run.context
  const filename = normalized.filename ?? `fig${run.figureNumber}`
  // 两条通路：矢量图型直接绘制 SVG（无 Graphviz 依赖）；其余图型构建 DOT 交渲染器。
  if (isVectorFigureType(normalized.figure_type)) {
    if (format !== 'svg') {
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
    await writeFile(path, vectorFigureSvg(build.spec, vectorTitle(normalized.invention_name, toFigureType(normalized.figure_type))), 'utf8')
    return { path, vectorLabels: build.spec.labels, vectorWarnings: build.warnings }
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
    format,
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
      sections: { ...SECTION_INPUT_SCHEMA, description: '剖视图输入（figure_type=cross_section 时必填）：零件轮廓 + 45° 剖面线（相邻件方向相反或间距不等）+ 剖切位置符号' },
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
      format: { type: 'string', enum: DOT_FORMATS, description: '输出格式，默认 svg' },
      engine: { type: 'string', enum: DOT_ENGINES, description: '布局引擎，默认 dot' },
      page_size: { type: 'string', enum: ['a4', 'letter'], description: '页面尺寸（提交规格）；默认取部署配置' },
      orient: { type: 'string', enum: ['portrait', 'landscape'], description: '页面方向；默认 portrait，取部署配置' },
      dpi: { type: 'integer', description: '渲染分辨率（png 栅格生效）；默认取部署配置' },
      margin: { type: 'number', description: '页边距（厘米，四边同值）；默认取部署配置' },
      leader_lines: { type: 'boolean', description: '引线标号（数字置于部件外侧并以引线相连，仅 SVG 生效）；默认框图/层级图开启、流程图关闭' },
      target_office: {
        type: 'string',
        enum: TARGET_OFFICES,
        description: '目标法域：给定时按该法域的 A4 幅面、页边距、图号写法（图1/Fig. 1/FIG. 1）把图形落版为固定幅面附图页，并核算落版字高与色彩合规；仅 SVG 生效',
      },
      figure_count: { type: 'integer', description: '本案附图总数（默认 1）：两幅以上才逐幅标注图号（中国指南 4.3、PCT 11.13(k)、37 CFR 1.84(u)）' },
      sheet_index: { type: 'integer', description: '附图页序号，默认 1' },
      sheet_total: { type: 'integer', description: '附图页总数，默认 1（PCT/USPTO 页码写作「序号/总数」）' },
      caption: { type: 'string', description: '图号文字覆盖（缺省按目标法域生成；panels 模式自动追加面板后缀，如 图1A / Fig. 1A）' },
      fit_to_page: { type: 'boolean', description: '默认 true：把图形落版到目标法域幅面（仅 SVG）；false 时只核算尺寸、不改写画布' },
      persist_index: { type: 'boolean', description: '默认 true：写入附图索引（供 search_patent_figure 检索）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
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
      const input = args as unknown as GeneratePatentFigureInput
      const cwd = deps.cwd ?? process.cwd()
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
