/**
 * `generate_structure_figure` tool: 用本机 FreeCAD 把 3D 模型投影为结构线稿附图。
 *
 * 与 `generate_patent_figure`（Graphviz 示意图）平行的独立工具：输入
 * STEP/IGES/BREP 模型（或其目录批量），经 freecad-renderer 子进程调用
 * FreeCAD TechDraw 投影出多视图黑白线稿 SVG（无边框/标题栏/图号，件号以引线
 * 锚定到真实顶点投影），返回标号映射表与「图N是…的结构示意图」附图说明，并按
 * persist_index 写入既有附图索引（figureIndexStore，figureType='structure'），
 * 使生成图可被 search_patent_figure 检索、被 analyze_patent_figure 回读核验。
 *
 * CAD 隔离、默认关闭、fail-loud：结构线稿依赖本机 FreeCAD，默认
 * `Config.structureFigureEnabled=false`，未开启或 freecadcmd 缺失均返回
 * setup_required 与配置/安装引导，绝不静默降级为示意图。风格依据《专利审查
 * 指南》第一部分第一章 4.3：黑色墨水线条、阿拉伯数字标记、图号不落在几何片段内
 * （片段本身不含图号；附图总数在两幅以上时由 target_office 落版阶段把「图N」写在
 * 图形正下方，符合该条「该编号应当标注在相应附图的正下方」）。
 * @module @deepseek-ai/dsh-patent-tools/tool/generate-structure-figure
 */

import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { PatentToolError } from '../error.ts'
import { FIGURE_TYPE_NAMES } from './analyze-patent-figure.ts'
import type { FigureAnalysisResult, FigureComponent } from './analyze-patent-figure.ts'
import type { FigureIndexEntry } from '../figure/index-store.ts'
import { DEFAULT_SVG_MAX_BYTES, assertSafeSvg } from '../figure/svg-annotate.ts'
import { figureWordingWarnings } from '../figure/wording-rules.ts'
import {
  DEFAULT_STRUCTURE_VIEWS,
  STRUCTURE_VIEWS,
  type StructureViewName,
} from '../figure/freecad-structure-script.ts'
import { SUPPORTED_MODEL_EXTENSIONS } from '../figure/freecad-renderer.ts'
import type { StructureRenderOutcome, StructureRenderSpec } from '../figure/freecad-renderer.ts'
import type { OutlineTextPort } from '../figure/inkscape-renderer.ts'
import { applyStructureLineStyle, STRUCTURE_LINE_WIDTH_SERIES } from '../figure/structure-svg-postprocess.ts'
import type { StructureHiddenLineStyle } from '../figure/structure-svg-postprocess.ts'
import { figureSentence } from '../figure/figure-description.ts'
import { TARGET_OFFICES, officeProfile, sheetNumberText } from '../figure/office-profile.ts'
import type { TargetOffice } from '../figure/office-profile.ts'
import { buildSubmissionPage } from '../figure/submission-page.ts'
import type { SubmissionLayout } from '../figure/submission-page.ts'
import { COMPONENT_SCHEMA, NUMERAL_MAP_SCHEMA } from './internal/figure-schemas.ts'
import { upsertFigureIndex } from './figure-output.ts'
import { assertRendered } from './internal/render-outcome.ts'

/** 结构线稿在索引中的模型标识（FreeCAD TechDraw 投影，无 LLM 参与）。 */
export const STRUCTURE_FIGURE_MODEL_USED = 'freecad-structure'

/** 缺省 TechDraw 投影比例。 */
const DEFAULT_STRUCTURE_SCALE = 1

/** manifest 中单个件号锚点（Python 侧投影后写回）。 */
export type StructureManifestAnchor = {
  numeral: string
  label: string
  /** 件号声明的归属零件下标；`null` 表示未声明归属（脚本未核对）。 */
  model: number | null
  /** 归属零件的绝对路径；未声明归属时为 `null`。 */
  modelPath: string | null
  point3d: number[]
  point2d: number[]
}

/** manifest 中单个视图条目。 */
export type StructureManifestView = {
  name: string
  order: number
  path: string
  bbox: number[]
  anchors: StructureManifestAnchor[]
}

/** freecad-structure-script 写出的 manifest.json 结构（渲染产物契约）。 */
export type StructureManifest = {
  figureNumber: number
  /** 该图用到的模型文件绝对路径（装配体为多个，顺序即 `callouts[].model` 的下标口径）。 */
  modelPaths: string[]
  scale: number
  showHidden: boolean
  generator: string
  views: StructureManifestView[]
}

/** 单张结构附图的渲染结果（目录批量时逐模型一条；装配体一条含多个模型）。 */
export type StructureFigureView = {
  /** 图号。 */
  figureNumber: number
  /** 该图用到的模型文件绝对路径（装配体为多个）。 */
  modelPaths: string[]
  /** 该图各视图 SVG 路径（工作区相对）。 */
  paths: string[]
  /** 解析后的 manifest。 */
  manifest: StructureManifest
}

/** 件号锚定输入（与 schema 一致）。 */
export type StructureCalloutInput = {
  /** 参考标号（阿拉伯数字字符串）。 */
  numeral: string
  /** 锚定的模型 3D 坐标（毫米）。 */
  point3d: [number, number, number]
  /** 可选部件名称（写入标号表/manifest，不进图面像素）。 */
  label?: string
  /** 该件号所属零件在输入模型列表中的下标（0 起）；给定时渲染脚本核对锚点确实落在该零件上。 */
  model?: number
}

/** 工具输入（与 schema 一致）。 */
export type GenerateStructureFigureInput = {
  /** 模型文件路径，或其目录（批量：目录内每个受支持模型生成一图，图号自 base 递增）；与 `model_paths` 二选一。 */
  model_path?: string
  /** 装配体：多个模型文件一起投影成一张图（每个文件一个零件，件号可各自声明归属）；与 `model_path` 二选一。 */
  model_paths?: string[]
  /** 请求视图；缺省 iso/front/top/right。 */
  views?: StructureViewName[]
  /** TechDraw 投影比例；缺省取 Config.structureFigureScale 或 1。 */
  scale?: number
  /** 是否绘制隐藏线；缺省 false。 */
  show_hidden?: boolean
  /**
   * 可见线线宽（毫米）；缺省保持 FreeCAD 输出的档位（FC 0.70mm 档的 0.70）。
   * 取值须属于 {@link STRUCTURE_LINE_WIDTH_SERIES}（schema 的 enum 即此收口）。
   */
  line_width_mm?: number
  /** 隐藏线线型：`solid`（缺省，FreeCAD 原始实线）或 `dashed`。 */
  hidden_line_style?: StructureHiddenLineStyle
  /** 件号锚定（可为空）。 */
  callouts?: StructureCalloutInput[]
  /** 图号，默认 1（批量时作为起始图号）。 */
  figure_number?: number
  /** 发明名称（附图说明模板句）。 */
  invention_name?: string
  /** 目标法域（cnipa/pct/uspto）：给定时把每个视图 SVG 落版到该法域的固定幅面附图页（A4 + 页边距）并核算尺寸。 */
  target_office?: TargetOffice
  /** 附图页序号与总页数（默认 1/1），写入页码。 */
  sheet_index?: number
  sheet_total?: number
  /** 图号文字（如「图1」）；缺省不落图号——一个模型的多个视图最终如何编号由调用方按整案附图顺序决定。 */
  caption?: string
  /** 默认 true：落版到目标法域幅面；false 时只核算尺寸、不改写画布。 */
  fit_to_page?: boolean
  /** 默认 true：写入附图索引（供 search_patent_figure 检索）。 */
  persist_index?: boolean
}

/** 工具输出（与 schema 一致）。 */
export type GenerateStructureFigureOutput = {
  /** 全部视图 SVG 路径（工作区相对，跨批量图合并）。 */
  paths: string[]
  /** 逐图结果（单模型一条；批量多条）。 */
  figures: StructureFigureView[]
  /** 附图说明文字（「图N是…的结构示意图」，可直接落说明书）。 */
  figureDescription: string
  /** 落版与尺寸核算结果（给定 target_office 时）。 */
  layout?: SubmissionLayout
  /** 标号映射表（件号 → 名称 → 图号）。 */
  numeralMap: { componentId: string; label: string; numeral: string; figure: number }[]
  /** 组件列表（与 analyze_patent_figure 输出同构）。 */
  components: FigureComponent[]
  /** 警告（生成方式说明、非阿拉伯数字标号等）。 */
  warnings: string[]
  /** 是否已写入附图索引。 */
  indexed: boolean
}

/** 依赖注入。render 为 FreeCAD 结构投影；enabled 为 Config.structureFigureEnabled 门禁。 */
export type GenerateStructureFigureDeps = {
  /** 结构投影渲染（freecad-renderer 的 renderStructureViews 或测试注入）。 */
  render: (spec: StructureRenderSpec) => Promise<StructureRenderOutcome>
  /** Config.structureFigureEnabled 门禁；缺省（未开启）时 execute 返回 setup_required。 */
  enabled?: boolean
  /** 输出目录（绝对路径），默认 <cwd>/patent/figures。 */
  outputDir?: string
  /** 可选 upsert 进附图索引（写入失败降级为警告）。 */
  upsertIndex?: (entry: FigureIndexEntry) => Promise<void>
  /** 工作目录（相对路径基准），默认 process.cwd()。 */
  cwd?: string
  /** 投影比例默认（Config.structureFigureScale）。 */
  defaultScale?: number
  /** 视图默认（Config.structureFigureViews）。 */
  defaultViews?: readonly StructureViewName[]
  /**
   * 可选文字转路径（Config.figureTextToPath 注入的 port）：把每个视图 SVG 的 `<text>`
   * 换成轮廓路径。Config 未开启时缺省，视为不转换。
   */
  outlineText?: OutlineTextPort
}

/** 校验并归一件号锚定：point3d 必须是恰好三个有限数（schema DSL 不支持定长数组约束，模型可能送超长/非数字）。 */
function normalizeCallouts(callouts: readonly StructureCalloutInput[] | undefined): StructureCalloutInput[] {
  return (callouts ?? []).map((callout, index) => {
    const point = callout.point3d
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- 声明类型是三元组，但模型实参只经 schema 校验为 number[]，长度必须运行时复核
    if (point.length !== 3 || point.some(n => !Number.isFinite(n))) {
      throw new PatentToolError('invalid_tool_input', `callouts[${index}].point3d 必须是恰好三个有限数 [x,y,z]`, { tool: 'generate_structure_figure' })
    }
    return callout
  })
}

/** 校验并归一视图列表（非空、全部属于 STRUCTURE_VIEWS，去重保序）。 */
function normalizeViews(views: readonly string[] | undefined, fallback: readonly StructureViewName[]): StructureViewName[] {
  const requested = views === undefined || views.length === 0 ? fallback : views
  const seen = new Set<StructureViewName>()
  for (const view of requested) {
    if (!(STRUCTURE_VIEWS as readonly string[]).includes(view)) {
      throw new PatentToolError('invalid_tool_input', `不支持的视图 "${view}"；可选：${STRUCTURE_VIEWS.join('、')}`, { tool: 'generate_structure_figure' })
    }
    seen.add(view as StructureViewName)
  }
  if (seen.size === 0) {
    throw new PatentToolError('invalid_tool_input', '视图列表不能为空', { tool: 'generate_structure_figure' })
  }
  return [...seen]
}

/**
 * 解析一个模型文件路径：复核它存在、是文件、扩展名受支持，返回绝对路径。
 *
 * `model_path` 的单文件与 `model_paths` 的每个文件共用这一段——两处各写一遍必然
 * 在报错文本和收口的格式上漂移。`field` 是报错里回给模型的下标化字段名。
 * @param modelPath - the model-supplied path.
 * @param cwd - the working directory for relative paths.
 * @param field - 字段名（`model_path`，或 `model_paths[0]` 这样带下标的写法）。
 * @returns 模型文件的绝对路径。
 * @throws PatentToolError when the path is missing (file_not_found) or is not a supported file.
 */
async function resolveModelFile(modelPath: string, cwd: string, field: string): Promise<string> {
  const absolute = resolve(cwd, modelPath)
  const info = await stat(absolute).catch(() => undefined)
  if (info === undefined) {
    throw new PatentToolError('file_not_found', `${field} 不存在：${modelPath}`, { tool: 'generate_structure_figure' })
  }
  if (!info.isFile()) {
    throw new PatentToolError('invalid_tool_input', `${field} 不是文件：${modelPath}`, { tool: 'generate_structure_figure' })
  }
  if (!SUPPORTED_MODEL_EXTENSIONS.includes(extname(absolute).toLowerCase())) {
    throw new PatentToolError('invalid_tool_input', `${field} 的格式不受支持 "${extname(absolute)}"；可选：${SUPPORTED_MODEL_EXTENSIONS.join('、')}`, { tool: 'generate_structure_figure' })
  }
  return absolute
}

/** 解析 model_path：文件（单模型）或目录（批量），返回受支持模型的绝对路径列表（升序）。 */
async function resolveModelPaths(modelPath: string, cwd: string): Promise<string[]> {
  const absolute = resolve(cwd, modelPath)
  const info = await stat(absolute).catch(() => undefined)
  if (info === undefined) {
    throw new PatentToolError('file_not_found', `模型路径不存在：${modelPath}`, { tool: 'generate_structure_figure' })
  }
  if (info.isFile()) return [await resolveModelFile(modelPath, cwd, 'model_path')]
  if (!info.isDirectory()) {
    throw new PatentToolError('invalid_tool_input', `model_path 既不是文件也不是目录：${modelPath}`, { tool: 'generate_structure_figure' })
  }
  const entries = await readdir(absolute)
  const models = entries
    .filter(name => SUPPORTED_MODEL_EXTENSIONS.includes(extname(name).toLowerCase()))
    .sort()
    .map(name => join(absolute, name))
  if (models.length === 0) {
    throw new PatentToolError('invalid_tool_input', `目录内未找到受支持模型（${SUPPORTED_MODEL_EXTENSIONS.join('、')}）：${modelPath}`, { tool: 'generate_structure_figure' })
  }
  return models
}

/**
 * 解析装配体输入（`model_paths`）：逐个文件复核存在、受支持且不重复，返回绝对路径。
 *
 * 保持给定顺序：`callouts[].model` 的下标口径就是这个顺序，重排会让件号指错零件。
 * 不接受目录——目录语义已经是「逐模型出多张图」（见 {@link resolveModelPaths}），
 * 两种语义共用一个入参只会让调用方猜。
 * @param paths - the model-supplied file paths.
 * @param cwd - the working directory for relative paths.
 * @returns 绝对路径列表（与入参同序）。
 * @throws PatentToolError when the list is empty, a path is missing/not a file/unsupported, or repeats.
 */
async function resolveAssemblyPaths(paths: readonly string[], cwd: string): Promise<string[]> {
  if (paths.length === 0) {
    throw new PatentToolError('invalid_tool_input', 'model_paths 不能为空：装配体至少要有一个模型文件', { tool: 'generate_structure_figure' })
  }
  const resolved: string[] = []
  for (const [index, modelPath] of paths.entries()) {
    const absolute = await resolveModelFile(modelPath, cwd, `model_paths[${index}]`)
    if (resolved.includes(absolute)) {
      throw new PatentToolError('invalid_tool_input', `model_paths[${index}] 与前面的模型重复：${modelPath}`, { tool: 'generate_structure_figure' })
    }
    resolved.push(absolute)
  }
  return resolved
}

/**
 * 解析模型输入：`model_path`（单文件或目录批量）与 `model_paths`（装配体）二选一。
 * @param input - the model-supplied arguments.
 * @param cwd - the working directory for relative paths.
 * @returns 绝对路径列表与「是否装配体（多文件投影成一张图）」。
 * @throws PatentToolError when neither or both are given, or a path is missing/unsupported/duplicated.
 */
async function resolveStructureModels(
  input: GenerateStructureFigureInput,
  cwd: string,
): Promise<{ modelPaths: string[]; assembly: boolean }> {
  if (input.model_path !== undefined && input.model_paths !== undefined) {
    throw new PatentToolError('invalid_tool_input', 'model_path 与 model_paths 二选一：model_path 是单模型或目录批量，model_paths 是装配体（多文件投影成一张图）', { tool: 'generate_structure_figure' })
  }
  if (input.model_paths !== undefined) {
    return { modelPaths: await resolveAssemblyPaths(input.model_paths, cwd), assembly: true }
  }
  if (input.model_path === undefined) {
    throw new PatentToolError('invalid_tool_input', '必须给 model_path（单模型/目录批量）或 model_paths（装配体）', { tool: 'generate_structure_figure' })
  }
  return { modelPaths: await resolveModelPaths(input.model_path, cwd), assembly: false }
}

/** 解析并轻校验 manifest.json（渲染产物契约；非法 JSON 同样归入 tool_execution_failed）。 */
async function readManifest(manifestPath: string): Promise<StructureManifest> {
  let parsed: StructureManifest
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as StructureManifest
  } catch (error) {
    throw new PatentToolError('tool_execution_failed', `读取 manifest 失败：${error instanceof Error ? error.message : String(error)}`, { tool: 'generate_structure_figure' })
  }
  if (!Array.isArray(parsed.views) || parsed.views.length === 0) {
    throw new PatentToolError('tool_execution_failed', 'manifest 未包含任何视图（渲染可能未产生投影几何）', { tool: 'generate_structure_figure' })
  }
  return parsed
}

/** 逐视图读回 SVG 并过安全校验（拒绝 ENTITY/CDATA、大小上限、根元素）。 */
async function assertViewSvgs(manifest: StructureManifest): Promise<void> {
  for (const view of manifest.views) {
    let text: string
    try {
      text = await readFile(view.path, 'utf8')
    } catch (error) {
      throw new PatentToolError('tool_execution_failed', `读取视图 ${view.name} SVG 失败：${error instanceof Error ? error.message : String(error)}`, { tool: 'generate_structure_figure' })
    }
    try {
      assertSafeSvg(text, DEFAULT_SVG_MAX_BYTES)
    } catch (error) {
      throw new PatentToolError('tool_execution_failed', `视图 ${view.name} SVG 校验失败：${error instanceof Error ? error.message : String(error)}`, { tool: 'generate_structure_figure' })
    }
  }
}

const CALLOUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    numeral: { type: 'string', required: true, description: '参考标号（阿拉伯数字字符串）' },
    point3d: {
      type: 'array',
      required: true,
      description: '锚定的模型 3D 坐标 [x,y,z]（毫米，与模型单位一致）',
      items: { type: 'number' },
    },
    label: { type: 'string', description: '可选部件名称（写入标号表/manifest，不进图面像素）' },
    model: { type: 'integer', description: '该件号所属零件在输入模型列表中的下标（0 起）；给定时核对锚点确实落在该零件上（偏离超过 0.5 毫米即报错）。装配体（model_paths）下必填' },
  },
} as const

const DESCRIPTION = [
  '从 3D 模型生成专利结构线稿附图：用本机 FreeCAD（TechDraw）把 STEP/IGES/BREP 投影为多视图黑白线稿 SVG（等轴测/三视图等），件号以引线锚定到真实顶点投影，输出到工作区 patent/figures/，返回标号映射表与「图N是…的结构示意图」附图说明。需要机械结构真实投影（而非示意框图）时使用。',
  '',
  '默认关闭：结构线稿依赖本机 FreeCAD，需先设 Config.structureFigureEnabled=true；未开启或未安装 freecadcmd 时返回 setup_required 与配置/安装引导。',
  '',
  '视图：views 缺省 iso/front/top/right，可选 iso/front/rear/top/bottom/left/right；scale 为 TechDraw 投影比例；show_hidden 开启时绘制隐藏线（细实线，FreeCAD 1.1.3 实测隐藏线 0.35 毫米、可见线 0.7 毫米，输出不含 stroke-dasharray，不是虚线）。',
  '',
  '线宽与线型：line_width_mm 取 GB/T 4457.4 线宽系列之一改写可见线线宽，hidden_line_style="dashed" 把隐藏线画成虚线；缺省两者都不改写，输出与 FreeCAD 原始投影一致。',
  '',
  '件号锚定：callouts 传 [{numeral, point3d:[x,y,z], label?, model?}]，把参考标号绑定到模型 3D 坐标，脚本投影到每个视图的真实 2D 位置并以引线标注；标号应为阿拉伯数字，非数字标号与部件名会触发图面用语告警。',
  '',
  '装配体：model_paths 传多个模型文件时，所有零件投影到同一张图（TechDraw 一次投影处理零件之间的遮挡），callouts[].model 指明该件号属于第几个零件（0 起，对应 model_paths 的顺序），脚本按该零件的真实几何核对锚点确实落在它上面，偏离超过 0.5 毫米即报错；装配体下每个件号都必须写明归属，以免标号指错零件。',
  '',
  '批量：model_path 传目录时，对目录内每个受支持模型各出一图，图号自 figure_number 起递增；批量模式不支持 callouts（件号 3D 锚点仅对单个模型有效），多个零件要合成一张图时改用 model_paths。',
  '',
  '产物为纯几何片段，不含模板边框、标题栏与图号，符合《专利审查指南》第一部分第一章 4.3 对线条与版面的要求；给定 target_office 时按该法域的 A4 幅面与页边距落版，并可在图形正下方落图号。',
].join('\n')

/** 一次结构线稿调用的归一化参数：依赖、工作目录、视图、比例、显示与件号锚定。 */
type StructureRun = {
  deps: GenerateStructureFigureDeps
  input: GenerateStructureFigureInput
  cwd: string
  outputDir: string
  views: StructureViewName[]
  scale: number
  showHidden: boolean
  /** 可见线线宽（毫米）；缺省不改写。 */
  lineWidthMm?: number
  /** 隐藏线线型。 */
  hiddenLineStyle: StructureHiddenLineStyle
  baseFigure: number
  callouts: StructureCalloutInput[]
  modelPaths: string[]
  /** 是否装配体（`model_paths`）：所有模型投影成一张图，否则逐模型一图。 */
  assembly: boolean
}

/**
 * 归一化并校验调用参数。schema 只约束 JSON 形状，模型实参与部署默认值在这里复核：
 * 比例必须正有限、图号必须正整数、目录批量不得带件号锚点。
 * @param args - the model-supplied arguments.
 * @param deps - the injected renderer, gate, defaults, and index writer.
 * @returns the resolved run parameters.
 * @throws PatentToolError when a value is out of range or batch mode meets callouts.
 */
async function resolveStructureRun(args: unknown, deps: GenerateStructureFigureDeps): Promise<StructureRun> {
  // schema 校验后的模型 JSON 边界：调用方传来的实参在这里窄化为领域类型。
  const input = args as GenerateStructureFigureInput
  const cwd = deps.cwd ?? process.cwd()
  /* v8 ignore next -- apply() always injects outputDir; the cwd-relative default stays for standalone library callers */
  const outputDir = deps.outputDir ?? resolve(cwd, 'patent/figures')
  const views = normalizeViews(input.views, deps.defaultViews ?? DEFAULT_STRUCTURE_VIEWS)
  const scale = input.scale ?? deps.defaultScale ?? DEFAULT_STRUCTURE_SCALE
  // scale 来自模型 JSON 或 Config：schema 只约束为 number，正有限性须运行时复核
  // （与 normalizeCallouts 同一理由：模型实参/部署值必须在此 fail-loud）。
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new PatentToolError('invalid_tool_input', `scale 必须是正有限数，收到 ${String(scale)}`, { tool: 'generate_structure_figure' })
  }
  const showHidden = input.show_hidden ?? false
  const lineWidthMm = input.line_width_mm
  const hiddenLineStyle = input.hidden_line_style ?? 'solid'
  const baseFigure = input.figure_number ?? 1
  if (!Number.isInteger(baseFigure) || baseFigure < 1) {
    throw new PatentToolError('invalid_tool_input', `figure_number 必须是正整数，收到 ${String(input.figure_number)}`, { tool: 'generate_structure_figure' })
  }
  const callouts = normalizeCallouts(input.callouts).map(callout => ({
    numeral: callout.numeral,
    point3d: callout.point3d,
    ...(callout.label === undefined ? {} : { label: callout.label }),
    ...(callout.model === undefined ? {} : { model: callout.model }),
  }))
  const { modelPaths, assembly } = await resolveStructureModels(input, cwd)
  for (const [index, callout] of callouts.entries()) {
    // 装配体的判据是「件号锚点落在所声明的零件上」，归属不明就无从核对；而目录批量
    // 是「一个模型一张图」，件号必然属于该图唯一的模型，故只对装配体收口。
    if (assembly && callout.model === undefined) {
      throw new PatentToolError('invalid_tool_input', `callouts[${index}].model 必填：装配体（model_paths）下每个件号都要写明所属零件在 model_paths 中的下标`, { tool: 'generate_structure_figure' })
    }
    if (callout.model === undefined) continue
    // schema 只把 model 约束为 integer；模型实参的取值域必须在这里复核（同 scale 的理由）。
    if (!Number.isInteger(callout.model) || callout.model < 0 || callout.model >= modelPaths.length) {
      throw new PatentToolError('invalid_tool_input', `callouts[${index}].model 必须是 0 到 ${String(modelPaths.length - 1)} 之间的整数（对应第几个输入模型），收到 ${String(callout.model)}`, { tool: 'generate_structure_figure' })
    }
  }
  // 目录批量逐模型出图，但 callouts 的 point3d 是某个模型的专属坐标：把同一组
  // 3D 锚点套到目录内其余模型会落到错误位置，故 fail-loud 拒绝而非静默误标。
  if (!assembly && modelPaths.length > 1 && callouts.length > 0) {
    throw new PatentToolError('invalid_tool_input', '批量（model_path 为目录）不支持 callouts：件号 3D 锚点仅对单个模型有效，请对单个模型生成结构线稿，或用 model_paths 把多个零件投影成一张装配图', { tool: 'generate_structure_figure' })
  }
  return {
    deps,
    input,
    cwd,
    outputDir,
    views,
    scale,
    showHidden,
    ...(lineWidthMm === undefined ? {} : { lineWidthMm }),
    hiddenLineStyle,
    baseFigure,
    callouts,
    modelPaths,
    assembly,
  }
}

/**
 * 逐图投影渲染并读回 manifest。
 *
 * 装配体把所有模型投到同一张图（TechDraw 一次 HLR 处理全部零件）；目录批量逐模型
 * 出图。两种情况都按「图号 = base + 序号」编号，故整案附图顺序与输入顺序一致。
 * @param run - the resolved run parameters.
 * @param signal - the tool call's cancellation signal.
 * @returns one view record per figure, in model-path order.
 */
async function renderStructureFigures(run: StructureRun, signal: AbortSignal): Promise<StructureFigureView[]> {
  const batches = run.assembly ? [run.modelPaths] : run.modelPaths.map(modelPath => [modelPath])
  const figures: StructureFigureView[] = []
  for (const [index, modelPaths] of batches.entries()) {
    const figureNumber = run.baseFigure + index
    // 每图独立子目录：manifest.json/临时脚本/模板/隔离子目录名固定，避免批量互相覆盖。
    const renderDir = join(run.outputDir, `fig${figureNumber}`)
    const outcome = await run.deps.render({
      modelPaths,
      views: run.views,
      scale: run.scale,
      showHidden: run.showHidden,
      callouts: run.callouts,
      figureNumber,
      outputDir: renderDir,
      signal,
    })
    assertRendered(outcome, 'generate_structure_figure')
    const manifest = await readManifest(outcome.manifestPath)
    await assertViewSvgs(manifest)
    figures.push({
      figureNumber,
      modelPaths,
      paths: manifest.views.map(view => relative(run.cwd, view.path)),
      manifest,
    })
  }
  return figures
}

/**
 * 线宽与线型后处理：逐视图改写 TechDraw 投影片段的线宽分组，并可把隐藏线改成虚线。
 *
 * 放在渲染之后、落版之前：落版只加外层变换组，不改线宽属性；越晚改写，越少步骤
 * 再动同一份文本。缺省参数时该步骤不改写文件（输出与不传参数逐字节一致）。
 * @param args - the run parameters, the rendered figures, and the warning sink.
 */
async function applyViewLineStyles(args: {
  run: StructureRun
  figures: readonly StructureFigureView[]
  warnings: string[]
}): Promise<void> {
  const { lineWidthMm, hiddenLineStyle, cwd } = args.run
  if (lineWidthMm === undefined && hiddenLineStyle === 'solid') return
  for (const figure of args.figures) {
    for (const viewPath of figure.paths) {
      const path = resolve(cwd, viewPath)
      const styled = applyStructureLineStyle(await readFile(path, 'utf8'), { ...(lineWidthMm === undefined ? {} : { lineWidthMm }), hiddenLineStyle })
      args.warnings.push(...styled.warnings.map(w => `线宽/线型：${viewPath} ${w}`))
      await writeFile(path, styled.svg, 'utf8')
    }
  }
}

/** 由 callouts 还原组件列表（件号 → 名称）；无 callouts 则为纯几何线稿。 */
function structureComponents(callouts: readonly StructureCalloutInput[]): FigureComponent[] {
  return callouts.map((callout): FigureComponent => ({
    refNumber: callout.numeral,
    name: callout.label ?? '',
    kind: 'mechanical',
    description: callout.label ?? '',
  }))
}

/** 标号表逐图展开：同一标号在每张图各占一行。 */
function structureNumeralMap(
  figures: readonly StructureFigureView[],
  callouts: readonly StructureCalloutInput[],
): GenerateStructureFigureOutput['numeralMap'] {
  return figures.flatMap(figure =>
    callouts.map(callout => ({
      componentId: callout.numeral,
      label: callout.label ?? '',
      numeral: callout.numeral,
      figure: figure.figureNumber,
    })),
  )
}

/**
 * 组装附图说明（「图N是…；图中：…」）与去重后的标号文本。
 * @param args - the rendered figures, their numeral map, and the invention name.
 * @returns the description sentence and the numeral text the index analysis reuses.
 */
function describeStructureFigures(args: {
  figures: readonly StructureFigureView[]
  numeralMap: GenerateStructureFigureOutput['numeralMap']
  inventionName: string | undefined
}): { figureDescription: string; numeralText: string } {
  const sentences = args.figures.map(figure => figureSentence(figure.figureNumber, FIGURE_TYPE_NAMES.structure, args.inventionName))
  const numeralText = [...new Map(args.numeralMap.filter(m => m.label !== '').map(m => [m.numeral, `${m.numeral}-${m.label}`])).values()].join('，')
  const figureDescription = numeralText === ''
    ? `${sentences.join('；')}。`
    : `${sentences.join('；')}；图中：${numeralText}。`
  return { figureDescription, numeralText }
}

/**
 * 落版：给定目标法域时把每个视图 SVG 落到该法域幅面，并按 fit_to_page 决定是否改写画布。
 * @param args - the resolved run parameters, the rendered figures, and the warning sink.
 * @returns the layout of the last placed view; undefined without target_office.
 * @throws PatentToolError when the sheet numbering is outside what the office writes.
 */
async function applyStructureLayout(args: {
  run: StructureRun
  figures: readonly StructureFigureView[]
  warnings: string[]
}): Promise<SubmissionLayout | undefined> {
  const { input, cwd } = args.run
  if (input.target_office === undefined) return undefined
  const profile = officeProfile(input.target_office)
  let sheetNumber: string
  try {
    sheetNumber = sheetNumberText(profile, input.sheet_index ?? 1, input.sheet_total ?? 1)
  } catch (error) {
    throw new PatentToolError('invalid_tool_input', `落版参数非法：${error instanceof Error ? error.message : String(error)}`, { tool: 'generate_structure_figure' })
  }
  let layout: SubmissionLayout | undefined
  for (const figure of args.figures) {
    for (const viewPath of figure.paths) {
      const page = buildSubmissionPage({
        drawingSvg: await readFile(resolve(cwd, viewPath), 'utf8'),
        profile,
        caption: input.caption,
        sheetNumber,
      })
      args.warnings.push(...page.warnings.map(w => `落版：${w}`))
      if (input.fit_to_page ?? true) await writeFile(resolve(cwd, viewPath), page.svg, 'utf8')
      layout = {
        office: profile.office,
        pageScale: page.metrics.pageScale,
        placedWidthMm: page.metrics.placedWidthMm,
        placedHeightMm: page.metrics.placedHeightMm,
        ...(page.metrics.charHeightMm === undefined ? {} : { charHeightMm: page.metrics.charHeightMm }),
        ...(page.metrics.reducedCharHeightMm === undefined ? {} : { reducedCharHeightMm: page.metrics.reducedCharHeightMm }),
        ...(input.caption === undefined ? {} : { caption: input.caption }),
        sheetNumber,
      }
    }
  }
  return layout
}


/**
 * 文字转路径：把每个视图 SVG 里的 `<text>` 换成轮廓路径（Config.figureTextToPath）。
 *
 * 放在落版之后：落版会改写坐标与画布，先转的路径还得再被改写一次；转完不再有步骤解析
 * 文件（索引只记路径）。结构线稿只有 SVG 产物，故不需要按格式分支——图面文字的字体依赖
 * 与 `generate_patent_figure` 的两条绘图通路同理。
 * @param args - the run parameters, the rendered views, and the caller's cancel signal.
 * @throws PatentToolError 转换失败时（not_installed → setup_required，其余 → tool_execution_failed）。
 */
async function outlineStructureViews(args: {
  run: StructureRun
  figures: readonly StructureFigureView[]
  signal: AbortSignal
}): Promise<void> {
  const outline = args.run.deps.outlineText
  if (outline === undefined) return
  for (const figure of args.figures) {
    for (const viewPath of figure.paths) {
      assertRendered(await outline({ path: resolve(args.run.cwd, viewPath), signal: args.signal }), 'generate_structure_figure')
    }
  }
}

/**
 * Build the `generate_structure_figure` tool over the injected FreeCAD renderer.
 * @param deps - renderer + gate/outputDir/index/cwd/scale/views defaults.
 * @returns a registry-ready tool definition.
 */
export function createGenerateStructureFigureTool(deps: GenerateStructureFigureDeps): ToolDefinition {
  return defineTool({
    name: 'generate_structure_figure',
    description: DESCRIPTION,
    parameters: {
      model_path: { type: 'string', description: '模型文件路径（STEP/IGES/BREP），或其目录（批量：目录内每个受支持模型各出一图）；与 model_paths 二选一' },
      model_paths: { type: 'array', items: { type: 'string' }, description: '装配体：多个模型文件一起投影成一张图（每个文件一个零件）；与 model_path 二选一' },
      views: { type: 'array', items: { type: 'string', enum: STRUCTURE_VIEWS }, description: '请求视图，缺省 iso/front/top/right' },
      scale: { type: 'number', description: 'TechDraw 投影比例（正数）；缺省取部署配置或 1' },
      show_hidden: { type: 'boolean', description: '绘制隐藏线（细实线，实测 0.35 毫米；不是虚线），默认 false' },
      line_width_mm: { type: 'number', enum: STRUCTURE_LINE_WIDTH_SERIES, description: '可见线线宽（毫米），须取 GB/T 4457.4 线宽系列之一；缺省保持 FreeCAD 输出的 0.7 毫米档' },
      hidden_line_style: { type: 'string', enum: ['solid', 'dashed'], description: '隐藏线线型，默认 solid（FreeCAD 原始细实线）；dashed 时按线宽加 stroke-dasharray 画成虚线' },
      callouts: { type: 'array', items: CALLOUT_SCHEMA, description: '件号锚定 [{numeral, point3d:[x,y,z], label?, model?}]；model 为所属零件下标，装配体下必填；目录批量不支持' },
      figure_number: { type: 'integer', description: '图号（正整数），默认 1（批量时作为起始图号）' },
      invention_name: { type: 'string', description: '发明名称（附图说明模板句）' },
      target_office: { type: 'string', enum: TARGET_OFFICES, description: '目标法域：给定时把每个视图 SVG 落版到该法域的 A4 幅面与页边距，并返回落版尺寸（仅 SVG 产物生效）' },
      sheet_index: { type: 'integer', description: '附图页序号，默认 1' },
      sheet_total: { type: 'integer', description: '附图页总数，默认 1' },
      caption: { type: 'string', description: '图号文字（如「图1」）；缺省不落图号——多视图如何编号由调用方按整案附图顺序决定' },
      fit_to_page: { type: 'boolean', description: '默认 true：落版到目标法域幅面；false 时只核算尺寸' },
      persist_index: { type: 'boolean', description: '默认 true：写入附图索引（供 search_patent_figure 检索）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          paths: { type: 'array', required: true, items: { type: 'string' } },
          figures: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                figureNumber: { type: 'integer', required: true },
                modelPaths: { type: 'array', required: true, items: { type: 'string' } },
                paths: { type: 'array', required: true, items: { type: 'string' } },
                manifest: { type: 'object', required: true, additionalProperties: true },
              },
            },
          },
          figureDescription: { type: 'string', required: true },
          layout: {
            type: 'object',
            description: '落版与尺寸核算结果（给定 target_office 时）',
            additionalProperties: false,
            properties: {
              office: { type: 'string', required: true, enum: TARGET_OFFICES },
              pageScale: { type: 'number', required: true },
              placedWidthMm: { type: 'number', required: true },
              placedHeightMm: { type: 'number', required: true },
              charHeightMm: { type: 'number' },
              reducedCharHeightMm: { type: 'number' },
              caption: { type: 'string' },
              sheetNumber: { type: 'string', required: true },
            },
          },
          numeralMap: { type: 'array', required: true, items: NUMERAL_MAP_SCHEMA },
          components: { type: 'array', required: true, items: COMPONENT_SCHEMA },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
          indexed: { type: 'boolean', required: true },
        },
      },
      // value 由输出 schema 推断（manifest 宽化为 Record）；execute 恒返回该领域类型，此处收窄回 presentation 用类型。
      render: (_args, value) => renderStructureResult(value as unknown as GenerateStructureFigureOutput),
    },
    async execute(args, exec) {
      // 门禁：结构线稿默认关闭，未显式开启即 fail-loud（不静默降级为示意图）。
      if (deps.enabled !== true) {
        throw new PatentToolError('setup_required', '结构线稿默认关闭，设 Config.structureFigureEnabled=true 后重试（需本机安装 FreeCAD 1.1+）。', { tool: 'generate_structure_figure' })
      }
      const run = await resolveStructureRun(args, deps)
      const warnings: string[] = ['由 3D 模型（FreeCAD TechDraw）投影生成的结构线稿']
      const figures = await renderStructureFigures(run, exec.signal)
      await applyViewLineStyles({ run, figures, warnings })
      // 组件列表只派生一次，不随图数累加，否则每个索引条目会被其他图的组件重复污染。
      const components = structureComponents(run.callouts)
      const numeralMap = structureNumeralMap(figures, run.callouts)
      const { figureDescription, numeralText } = describeStructureFigures({
        figures,
        numeralMap,
        inventionName: run.input.invention_name,
      })
      warnings.push(...figureWordingWarnings(
        run.callouts.flatMap(callout => (callout.label === undefined ? [] : [callout.label])),
        run.callouts.map(callout => callout.numeral),
      ))
      const layout = await applyStructureLayout({ run, figures, warnings })
      await outlineStructureViews({ run, figures, signal: exec.signal })
      let indexed = false
      if ((run.input.persist_index ?? true) && deps.upsertIndex !== undefined) {
        indexed = true
        for (const figure of figures) {
          if (!await upsertFigureIndex({
            upsertIndex: deps.upsertIndex,
            imagePath: figure.paths[0] ?? '',
            analysis: structureAnalysis(figure, components, numeralText, warnings),
            warnings,
            label: `图${figure.figureNumber} `,
          })) {
            indexed = false
          }
        }
      }
      return {
        paths: figures.flatMap(figure => figure.paths),
        figures,
        figureDescription,
        ...(layout === undefined ? {} : { layout }),
        numeralMap,
        components,
        warnings,
        indexed,
      }
    },
  })
}

/** 构造索引用 analysis（确定性投影：组件由 callouts 还原，置信度 1）。 */
function structureAnalysis(
  figure: StructureFigureView,
  components: FigureComponent[],
  numeralText: string,
  warnings: string[],
): FigureAnalysisResult {
  return {
    imagePath: figure.paths[0] ?? '',
    figureNumber: figure.figureNumber,
    figureType: 'structure',
    overallDescription: `由 generate_structure_figure 生成（FreeCAD TechDraw 投影，模型 ${figure.modelPaths.join('、')}）。${numeralText}`,
    components,
    connections: [],
    figureDescription: `图${figure.figureNumber}是${FIGURE_TYPE_NAMES.structure}`,
    confidence: 1,
    warnings,
    usable: figure.manifest.views.length > 0,
    modelUsed: STRUCTURE_FIGURE_MODEL_USED,
  }
}

/** 简单文本渲染：标号表 + 附图说明 + 路径。 */
function renderStructureResult(value: GenerateStructureFigureOutput): { type: 'text'; text: string }[] {
  const lines = [
    `已生成结构线稿附图（${value.figures.length} 张图，${value.paths.length} 个视图）：`,
    ...value.figures.map(figure => `- 图${figure.figureNumber}（${figure.manifest.views.map(v => v.name).join('/')}）：${figure.paths.join('、')}`),
    '',
    value.figureDescription,
    ...(value.layout === undefined
      ? []
      : ['', `## 落版（${value.layout.office}）`, `- 缩放 ${value.layout.pageScale}，图形 ${value.layout.placedWidthMm}×${value.layout.placedHeightMm} 毫米`, `- 页码 ${value.layout.sheetNumber}`]),
    ...(value.numeralMap.length > 0 ? ['', '## 参考标号', ...value.numeralMap.map(m => `- ${m.numeral} ${m.label}`.trimEnd())] : []),
    ...(value.warnings.length > 0 ? ['', '## 警告', ...value.warnings.map(w => `- ${w}`)] : []),
  ]
  return [{ type: 'text', text: lines.join('\n') }]
}
