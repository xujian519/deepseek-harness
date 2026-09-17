/**
 * Graphviz `dot` CLI 渲染器（子进程通道，无 Python/WASM 依赖）。
 *
 * 以 `ctx.subprocess.spawn` 调用系统 Graphviz 的 dot 可执行文件：argv 直传
 * （不经 shell）、DOT 输入经 stdin（无文件参数；graphviz >= 15 拒绝尾随 '-'）、
 * 输出写 `-o` 文件；为版本探测（probe）与
 * 渲染共享同一候选路径解析（Config.graphvizExecutable 覆盖 → 各平台常见
 * 安装路径 → PATH 分段），找不到时返回可安装引导（brew/apt/winget），
 * 与 patent-document/pdfRenderer 的 Chrome 候选模式一致。
 *
 * @module @deepseek-ai/dsh-patent-tools/figure/graphviz-renderer
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { DotEngine, DotFormat } from './dot-builder.ts'
import {
  SPAWN_GRACE_MS,
  describeRenderFailure,
  renderStderr,
  spawnVersionProbe,
  startRenderDeadline,
  stdinStdio,
} from './subprocess-render.ts'
import { DEFAULT_SVG_MAX_BYTES, SvgAnnotateError, assertSafeSvg } from './svg-annotate.ts'

/** 各平台常见 Graphviz dot 安装路径。 */
export const DOT_CANDIDATES: readonly string[] = [
  '/opt/homebrew/bin/dot',
  '/usr/local/bin/dot',
  '/opt/local/bin/dot',
  '/usr/bin/dot',
  'C:\\Program Files\\Graphviz\\bin\\dot.exe',
  'C:\\Program Files (x86)\\Graphviz\\bin\\dot.exe',
  'C:\\ProgramData\\chocolatey\\bin\\dot.exe',
]

/** 单次渲染超时（毫秒）。 */
const RENDER_TIMEOUT_MS = 60_000

/** 版本探测超时（毫秒）。 */
const PROBE_TIMEOUT_MS = 5_000

/**
 * 生成 Graphviz 缺失/路径失效时的安装引导文案。
 * @param executable - 解析到的路径（未找到时为 undefined）。
 * @returns 面向用户的安装与配置引导文本。
 */
export function graphvizInstallMessage(executable: string | undefined): string {
  const hint = executable === undefined
    ? '未找到 Graphviz dot 可执行文件。'
    : `已配置路径 ${executable} 不存在或不可执行。`
  return [
    hint,
    '请安装 Graphviz（macOS：brew install graphviz；Ubuntu/Debian：sudo apt install graphviz；Windows：winget install graphviz 或 choco install graphviz），',
    '或通过 Config.graphvizExecutable / DSH_GRAPHVIZ_DOT 指定 dot 路径。',
  ].join('')
}

/**
 * 解析 dot 可执行文件路径。
 * @param override - 显式覆盖路径（Config.graphvizExecutable）；提供时不存在则视为未找到，不回落自动探测。
 * @returns dot 可执行文件绝对路径，或 undefined。
 */
export function findDot(override?: string): string | undefined {
  if (override !== undefined && override !== '') {
    return existsSync(override) ? override : undefined
  }
  const env = process.env.DSH_GRAPHVIZ_DOT
  if (env !== undefined && env !== '' && existsSync(env)) return env
  for (const candidate of DOT_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  for (const name of ['dot', 'dot.exe']) {
    for (const segment of (process.env.PATH ?? '').split(delimiter)) {
      if (segment === '') continue
      const candidate = join(segment, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/** 探测结果。 */
export type GraphvizProbeResult = {
  /** Graphviz 可用（executable 找到且 `dot -V` 成功）。 */
  ready: boolean
  /** 解析到的可执行路径（未找到时缺省）。 */
  executable?: string
  /** dot -V 输出的版本号（如 12.2.1）。 */
  version?: string
  /** 未就绪时的安装/配置引导。 */
  message?: string
}

/**
 * 探测 Graphviz 可用性（执行 `dot -V`，约数十毫秒）。
 * @param subprocess - 注入的 subprocess 服务。
 * @param executableOverride - 可选路径覆盖。
 * @returns 就绪状态与版本/引导信息。
 */
export async function probeGraphviz(
  subprocess: SubprocessRuntime,
  executableOverride?: string,
): Promise<GraphvizProbeResult> {
  const executable = findDot(executableOverride)
  if (executable === undefined) {
    return { ready: false, message: graphvizInstallMessage(executable) }
  }
  const controller = new AbortController()
  /* v8 ignore start -- probe is fast and the 5s timer is always cleared before its callback can run */
  const timer = setTimeout(() => { controller.abort() }, PROBE_TIMEOUT_MS)
  timer.unref()
  /* v8 ignore stop */
  try {
    const { outcome, text } = await spawnVersionProbe(subprocess, executable, '-V', controller.signal)
    if (outcome.exitCode !== 0) {
      return { ready: false, executable, message: `dot -V 失败（退出码 ${outcome.exitCode ?? '未知'}）：${text.trim()}` }
    }
    const version = text.match(/version (\d+(?:\.\d+)*)/)?.[1]
    return { ready: true, executable, ...(version === undefined ? {} : { version }) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ready: false, executable, message: `dot -V 调用失败：${message}` }
  } finally {
    clearTimeout(timer)
  }
}

/** 渲染错误码。 */
export type GraphvizRenderErrorCode = 'not_installed' | 'render_failed' | 'aborted'

/** 渲染结果：成功路径或分类错误。 */
export type GraphvizRenderOutcome =
  | { ok: true; path: string }
  | { ok: false; code: GraphvizRenderErrorCode; error: string }

/** 渲染请求。 */
export type GraphvizRenderSpec = {
  /** DOT 文本（经 stdin 传入）。 */
  dot: string
  /** 输出文件名（不含扩展名；非法字符替换为下划线）。 */
  filename: string
  /** 输出格式白名单（由工具层校验）。 */
  format: DotFormat
  /** 布局引擎白名单（由工具层校验）。 */
  engine: DotEngine
  /** 输岀目录（绝对路径，必须已存在）。 */
  outputDir: string
  /** 调用方取消信号。 */
  signal?: AbortSignal
}

/**
 * 清洗输出文件名（非法字符替换为下划线）。
 * @param filename - 原始文件名（不含扩展名）。
 * @returns 可安全用作文件名的字符串（空输入回退 'diagram'）。
 */
export function sanitizeDotFilename(filename: string): string {
  const cleaned = filename.replace(/[^\w\-]/g, '_')
  return cleaned === '' ? 'diagram' : cleaned
}

/**
 * 校验渲染产物内容：dot 退出码 0 不保证产物完整（可能截断/空文件）。
 * svg 复用 {@link assertSafeSvg}（统一安全入口）；png/pdf 校验非空 + magic bytes。
 * @param outputPath - 已存在的产物路径。
 * @param format - 输出格式（决定校验方式）。
 * @returns 产物无效时的原因文本；合规时 undefined。
 */
async function validateRenderedFile(outputPath: string, format: DotFormat): Promise<string | undefined> {
  let bytes: Buffer
  try {
    bytes = await readFile(outputPath)
  } catch (error) {
    return `读取渲染产物失败：${error instanceof Error ? error.message : String(error)}`
  }
  if (bytes.length === 0) return '渲染产物为空文件'
  if (format === 'svg') {
    try {
      assertSafeSvg(bytes.toString('utf8'), DEFAULT_SVG_MAX_BYTES)
      return undefined
    } catch (error) {
      return `渲染产物 SVG 校验失败：${error instanceof SvgAnnotateError ? error.message : String(error)}`
    }
  }
  if (format === 'png') {
    // PNG 签名：89 50 4E 47（\x89PNG）；仅查前 4 字节即可判定非截断的空/错格式产物。
    const valid = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    return valid ? undefined : '渲染产物不是合法 PNG（magic bytes 不符，可能截断）'
  }
  // PDF 以 %PDF 头开始；容忍前置字节，只在首 1KB 内查找。
  return bytes.subarray(0, 1024).toString('latin1').includes('%PDF')
    ? undefined
    : '渲染产物不是合法 PDF（缺 %PDF 头，可能截断）'
}

/**
 * 用 Graphviz 渲染 DOT 为图片文件。
 * @param subprocess - 注入的 subprocess 服务。
 * @param spec - 渲染请求。
 * @param executableOverride - 可选路径覆盖。
 * @returns 成功路径或分类错误（not_installed / render_failed / aborted）。
 */
export async function renderWithGraphviz(
  subprocess: SubprocessRuntime,
  spec: GraphvizRenderSpec,
  executableOverride?: string,
): Promise<GraphvizRenderOutcome> {
  const executable = findDot(executableOverride)
  if (executable === undefined) {
    return { ok: false, code: 'not_installed', error: graphvizInstallMessage(undefined) }
  }
  const filename = sanitizeDotFilename(spec.filename)
  const outputPath = join(spec.outputDir, `${filename}.${spec.format}`)
  const deadline = startRenderDeadline(RENDER_TIMEOUT_MS, spec.signal)
  try {
    const handle = subprocess.spawn({
      // graphviz >= 15 rejects a trailing '-' as an unknown option; stdin input needs no file argument.
      argv: [executable, `-T${spec.format}`, `-K${spec.engine}`, '-o', outputPath],
      cwd: spec.outputDir,
      stdio: stdinStdio(spec.dot),
      graceMs: SPAWN_GRACE_MS,
      signal: deadline.signal,
    })
    const outcome = await handle.done
    if (outcome.exitCode !== 0) {
      const cause = describeRenderFailure(outcome, deadline.timedOut(), spec.signal)
      return { ok: false, code: spec.signal?.aborted === true ? 'aborted' : 'render_failed', error: `Graphviz 渲染失败（${cause}）：${renderStderr(handle) || '无 stderr 输出'}` }
    }
    if (!existsSync(outputPath)) {
      return { ok: false, code: 'render_failed', error: `Graphviz 未生成输出文件：${outputPath}` }
    }
    const invalid = await validateRenderedFile(outputPath, spec.format)
    if (invalid !== undefined) {
      return { ok: false, code: 'render_failed', error: `Graphviz 渲染产物无效：${invalid}` }
    }
    return { ok: true, path: outputPath }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, code: spec.signal?.aborted === true ? 'aborted' : 'render_failed', error: `Graphviz 渲染调用失败：${message}` }
  } finally {
    deadline.dispose()
  }
}
