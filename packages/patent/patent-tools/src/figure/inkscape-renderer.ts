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
 * 输出写临时目录，产物先过 {@link assertSafeSvg} 并确认已无 `<text>`，再写回原路径
 * ——转换失败不会留下半个文件，也不会把不安全的结构带进附图。期限、取消与失败
 * 归类与 graphviz-renderer 共用 subprocess-render。
 *
 * 只处理 SVG：png/pdf 由渲染器用 Config.dotFont 出字，是否转换由调用方按格式决定。
 * @module @deepseek-ai/dsh-patent-tools/figure/inkscape-renderer
 */

import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  describeRenderFailure,
  describeRenderThrow,
  findExecutable,
  quietStdio,
  renderStderr,
  spawnRenderProcess,
  startRenderDeadline,
} from './subprocess-render.ts'
import type { SubprocessSpawner } from './subprocess-render.ts'
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

/** 文字元素开标签：转换后的产物里出现它，说明文字没有转成路径。 */
const TEXT_ELEMENT_PATTERN = /<text[\s>]/i

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
  const deadline = startRenderDeadline(options.renderTimeoutMs, spec.signal)
  let workDir: string | undefined
  try {
    workDir = await mkdtemp(join(tmpdir(), 'dsh-outline-'))
    const outputPath = join(workDir, 'outlined.svg')
    const { handle, outcome } = await spawnRenderProcess(subprocess, deadline, {
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
      const cause = describeRenderFailure(outcome, deadline.timedOut(), spec.signal)
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
    if (TEXT_ELEMENT_PATTERN.test(outlined)) {
      return { ok: false, code: 'render_failed', error: 'Inkscape 转换产物仍含 `<text>` 元素，文字未转成路径' }
    }
    await writeFile(spec.path, outlined, 'utf8')
    return { ok: true }
  } catch (error) {
    return { ok: false, ...describeRenderThrow('Inkscape 文字转路径', error, spec.signal) }
  } finally {
    deadline.dispose()
    if (workDir !== undefined) await rm(workDir, { recursive: true, force: true })
  }
}
