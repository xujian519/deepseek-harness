/**
 * Inkscape `inkscape` CLI 的文字转路径（子进程通道，可选）：把已生成 SVG 的图面
 * 文字换成轮廓路径，导出文件不再依赖阅读器字体。
 *
 * 为什么需要：本包的两条绘图通路（自绘 SVG 片段与 Graphviz DOT）都不声明
 * `font-family`，图形里的 `<text>` 由阅读器挑字体渲染——换一台没有中文字体的机器
 * （或印厂、审查端）就可能出豆腐块、字宽错位。开启后文字成为路径，字与画一起
 * 走矢量，任何渲染器都一样。
 *
 * 调用形状：argv 直传（不经 shell），输入按路径读（Inkscape 不改写输入文件）、
 * 输出写临时目录；产物按三个门槛放行后才替换原文件——过 {@link assertSafeSvg}、
 * 已无 `<text>`、且墨迹仍落在原图范围内（{@link geometryRegression}）——失败时原文件
 * 一字不改。写回用 {@link writeFileAtomic}（同目录临时文件 + rename），故读取方看到
 * 的要么是原图、要么是完整的转换产物。期限、取消与失败归类与 graphviz-renderer 共用
 * subprocess-render。
 *
 * 只处理 SVG：png/pdf 由渲染器用 Config.dotFont 出字，是否转换由调用方按格式决定。
 * @module @deepseek-ai/dsh-patent-tools/figure/inkscape-renderer
 */

import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { measureInkBounds } from './render-check.ts'
import type { InkBounds } from './render-check.ts'
import {
  describeRenderFailure,
  describeRenderThrow,
  findExecutable,
  quietStdio,
  renderStderr,
  spawnRenderProcess,
  startRenderDeadline,
} from './subprocess-render.ts'
import type { RenderDeadline, SubprocessSpawner } from './subprocess-render.ts'
import { DEFAULT_SVG_MAX_BYTES, SvgAnnotateError, assertSafeSvg } from './svg-annotate.ts'

/** 各平台常见 Inkscape 可执行路径。 */
export const INKSCAPE_CANDIDATES: readonly string[] = [
  '/opt/homebrew/bin/inkscape',
  '/usr/local/bin/inkscape',
  '/usr/bin/inkscape',
  '/snap/bin/inkscape',
  '/Applications/Inkscape.app/Contents/MacOS/inkscape',
  'C:\\Program Files\\Inkscape\\bin\\inkscape.exe',
  'C:\\Program Files (x86)\\Inkscape\\bin\\inkscape.exe',
]

/** 默认单次转换超时（毫秒）；Config.inkscapeRenderTimeoutMs 的默认值。 */
export const DEFAULT_INKSCAPE_RENDER_TIMEOUT_MS = 30_000

/**
 * 文字元素开标签：转换后的产物里出现它，说明文字没有转成路径。带命名空间前缀的
 * `<svg:text>` 与 `<textPath>` 同样算残留；注释里的示例文本不算。
 */
const TEXT_ELEMENT_PATTERN = /<(?:[\w.-]+:)?(?:text|textPath)[\s/>]/i

/**
 * 几何护栏的容差（毫米）：轮廓路径的墨迹允许比原图多出这么多——字形轮廓与占位框
 * 估算的差异（全角字上缘约 0.5 毫米）在这个量级内，而漏掉图层、坐标整体错位的差异
 * 远大于此。
 */
const OUTLINE_GEOMETRY_SLACK_MM = 1

/** Inkscape 转换的部署级选项（宿主 Config → 渲染器）。 */
export type InkscapeOutlineOptions = {
  /** Inkscape 可执行路径覆盖（与 Config.inkscapeExecutable 同源）；缺省走 {@link findInkscape} 自动探测。 */
  executable?: string
  /** 单次转换超时（毫秒）；由宿主 Config.inkscapeRenderTimeoutMs 解析后注入。 */
  renderTimeoutMs: number
}

/** 转换请求：就地改写这个 SVG 文件。 */
export type InkscapeOutlineSpec = {
  /** 待转换的 SVG 绝对路径（转换成功后原地替换）。 */
  path: string
  /** 调用方取消信号。 */
  signal?: AbortSignal
}

/** 转换错误码（与两个渲染器同形，工具层按同一张表映射）。 */
export type InkscapeOutlineErrorCode = 'not_installed' | 'render_failed' | 'aborted'

/** 转换结果：成功，或按码分类的失败。 */
export type InkscapeOutlineOutcome =
  | { ok: true }
  | { ok: false; code: InkscapeOutlineErrorCode; error: string }

/**
 * 文字转路径端口：宿主按 Config.figureTextToPath 注入（不开启时不接线），
 * 附图生成工具只依赖这个签名，不直接依赖 Inkscape。
 */
export type OutlineTextPort = (spec: InkscapeOutlineSpec) => Promise<InkscapeOutlineOutcome>

/**
 * 生成 Inkscape 缺失/路径失效时的安装引导文案。
 * @param executable - 解析到的路径（未找到时为 undefined）。
 * @returns 面向用户的安装与配置引导文本。
 */
export function inkscapeInstallMessage(executable: string | undefined): string {
  const hint = executable === undefined
    ? '未找到 Inkscape 可执行文件。'
    : `已配置路径 ${executable} 不存在或不可执行。`
  return [
    hint,
    '文字转路径需要 Inkscape（macOS：brew install --cask inkscape；Ubuntu/Debian：sudo apt install inkscape；Windows：winget install Inkscape.Inkscape），',
    '或通过 Config.inkscapeExecutable / DSH_INKSCAPE 指定可执行文件路径；不需要字体无关的 SVG 时把 Config.figureTextToPath 关掉即可。',
  ].join('')
}

/**
 * 解析 Inkscape 可执行文件路径。
 * @param override - 显式覆盖路径（Config.inkscapeExecutable）；提供时不存在则视为未找到，不回落自动探测。
 * @returns 可执行文件绝对路径，或 undefined。
 */
export function findInkscape(override?: string): string | undefined {
  return findExecutable({
    ...(override === undefined ? {} : { override }),
    envVar: 'DSH_INKSCAPE',
    candidates: INKSCAPE_CANDIDATES,
    names: ['inkscape', 'inkscape.exe'],
  })
}

/**
 * 转换产物的几何护栏：逐边比较转换前后的墨迹包围盒。
 *
 * 转路径只该把 `<text>` 换成字形轮廓，图面范围不应变化；Inkscape 版本差异（整层丢失、
 * 坐标错位、画布被改写）会在这里暴露，宁可失败也不交出一张走样的附图。只判「向外越界」：
 * 文字占位框本就是上界，字形轮廓比它略小是正常的，故向内收缩不作为拒收依据。
 * @param before - 转换前的 SVG 文本。
 * @param outlined - 转换产物文本。
 * @returns 违规说明；几何一致时 undefined。
 */
function geometryRegression(before: string, outlined: string): string | undefined {
  const original = measureInkBounds(before)
  const converted = measureInkBounds(outlined)
  if (converted === undefined) {
    return original === undefined ? undefined : '转换产物里没有可量测的图形'
  }
  if (original === undefined) return undefined
  const outside = (['minX', 'minY'] as const).some(
    side => converted[side] < original[side] - OUTLINE_GEOMETRY_SLACK_MM,
  ) || (['maxX', 'maxY'] as const).some(
    side => converted[side] > original[side] + OUTLINE_GEOMETRY_SLACK_MM,
  )
  if (!outside) return undefined
  const range = (box: InkBounds): string =>
    `(${fmtMm(box.minX)}, ${fmtMm(box.minY)})-(${fmtMm(box.maxX)}, ${fmtMm(box.maxY)})`
  return `转换产物的墨迹范围 ${range(converted)} 超出原图 ${range(original)}`
}

/** 毫米数值（至多三位小数，与落版页的写法一致）。 */
function fmtMm(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

/**
 * 用 Inkscape 把 SVG 里的文字转成轮廓路径（就地改写文件）。
 *
 * 转换命令固定为 `--export-type=svg --export-plain-svg --export-text-to-path`：
 * 纯 SVG 导出去掉 Inkscape 专有属性，文字转路径去掉字体依赖；画布尺寸、坐标与
 * 线宽原样保留（本机 Inkscape 1.4.4 实测：66×40mm 画布与 `stroke-width="0.25"`
 * 的输出与输入逐值一致）。
 * @param subprocess - 注入的 subprocess 服务（本模块只用 spawn）。
 * @param spec - 待转换的 SVG 路径与取消信号。
 * @param options - Inkscape 路径覆盖与转换超时。
 * @returns 成功，或分类错误（not_installed / render_failed / aborted）。
 */
export async function outlineSvgText(
  subprocess: SubprocessSpawner,
  spec: InkscapeOutlineSpec,
  options: InkscapeOutlineOptions,
): Promise<InkscapeOutlineOutcome> {
  const executable = findInkscape(options.executable)
  if (executable === undefined) {
    return { ok: false, code: 'not_installed', error: inkscapeInstallMessage(undefined) }
  }
  let original: string
  try {
    original = await readFile(spec.path, 'utf8')
  } catch (error) {
    return { ok: false, code: 'render_failed', error: `读取待转换的 SVG 失败：${error instanceof Error ? error.message : String(error)}` }
  }
  let workDir: string | undefined
  let deadline: RenderDeadline | undefined
  try {
    // 期限自子进程启动前开始计，不含建临时目录的时间（与 freecad-renderer 同序）：
    // 预算极小时报的应是「渲染超时」，而不是建目录失败式的「调用失败」。
    workDir = await mkdtemp(join(tmpdir(), 'dsh-outline-'))
    const started = startRenderDeadline(options.renderTimeoutMs, spec.signal)
    deadline = started
    const outputPath = join(workDir, 'outlined.svg')
    const { handle, outcome } = await spawnRenderProcess(subprocess, started, {
      argv: [
        executable,
        '--export-type=svg',
        '--export-plain-svg',
        '--export-text-to-path',
        `--export-filename=${outputPath}`,
        spec.path,
      ],
      cwd: workDir,
      stdio: quietStdio(),
    })
    if (outcome.exitCode !== 0) {
      const cause = describeRenderFailure(outcome, started.timedOut(), spec.signal)
      return {
        ok: false,
        code: spec.signal?.aborted === true ? 'aborted' : 'render_failed',
        error: `Inkscape 文字转路径失败（${cause}）：${renderStderr(handle) || '无 stderr 输出'}`,
      }
    }
    if (!existsSync(outputPath)) {
      return { ok: false, code: 'render_failed', error: `Inkscape 未生成输出文件：${outputPath}` }
    }
    const outlined = await readFile(outputPath, 'utf8')
    try {
      assertSafeSvg(outlined, DEFAULT_SVG_MAX_BYTES)
    } catch (error) {
      const reason = error instanceof SvgAnnotateError ? error.message : String(error)
      return { ok: false, code: 'render_failed', error: `Inkscape 转换产物 SVG 校验失败：${reason}` }
    }
    // 导出开关失效时（版本差异）Inkscape 可能原样返回带文字的文件；那时「不依赖
    // 字体」这个承诺不成立，必须报错而不是静默交出一个仍有字体依赖的图。
    // 注释里的 `<text>` 示例不算残留：先整段去掉注释再判。
    if (TEXT_ELEMENT_PATTERN.test(outlined.replace(/<!--[\s\S]*?-->/g, ''))) {
      return { ok: false, code: 'render_failed', error: 'Inkscape 转换产物仍含 `<text>` 元素，文字未转成路径' }
    }
    const regression = geometryRegression(original, outlined)
    if (regression !== undefined) {
      return { ok: false, code: 'render_failed', error: `Inkscape 转换产物几何走样：${regression}` }
    }
    // 子进程退出与写回之间仍可能被调用方取消：先查一次，再原子替换（同目录临时文件 +
    // rename），读取方看到的要么是原图、要么是完整产物。
    spec.signal?.throwIfAborted()
    await writeFileAtomic(spec.path, outlined, { mode: 0o644 })
    return { ok: true }
  } catch (error) {
    return { ok: false, ...describeRenderThrow('Inkscape 文字转路径', error, spec.signal) }
  } finally {
    deadline?.dispose()
    // 临时目录清理失败只会留下系统临时区里的残留目录，不能把已经分类的转换结果顶掉。
    if (workDir !== undefined) await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
