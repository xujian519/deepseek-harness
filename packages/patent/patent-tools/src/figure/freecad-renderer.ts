/**
 * FreeCAD `freecadcmd` headless 渲染器（子进程通道，CAD 隔离）。
 *
 * 以 `ctx.subprocess.spawn` 调用本机 FreeCAD 的 console 可执行文件，运行
 * {@link buildStructureScript} 生成的 Python 脚本，把 STEP/IGES/BREP 模型投影
 * 为多视图黑白结构线稿 SVG + manifest.json。与 graphviz-renderer 同构：argv
 * 直传（不经 shell）、候选路径解析（Config.freecadExecutable 覆盖 →
 * DSH_FREECAD_CMD env → 各平台常见安装路径 → PATH 分段）、版本探测（probe）与
 * 渲染共享同一解析、SIGTERM→SIGKILL graceMs 一致。
 *
 * 判定只依赖「退出码 0 + manifest.json 存在」：freecadcmd 对
 * `~/Library/Preferences`、`~/Library/Caches` 的写失败仅告警、非致命（本机实测
 * STEP 载入/投影/导出均成功），故 stderr 文本不作为失败依据。子进程 HOME/临时
 * 目录 best-effort 指向 outputDir 内子目录以隔离副作用（Linux 生效；macOS 下
 * FreeCAD 缓存路径不随 HOME 迁移，属已知无害局限）。
 *
 * @module @deepseek-ai/dsh-patent-tools/figure/freecad-renderer
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import type { SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  STRUCTURE_MANIFEST_FILENAME,
  buildStructureScript,
  type StructureCallout,
  type StructureViewName,
} from './freecad-structure-script.ts'

/** 各平台常见 FreeCAD console 可执行文件安装路径。 */
export const FREECAD_CMD_CANDIDATES: readonly string[] = [
  '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd',
  '/Applications/FreeCAD.app/Contents/MacOS/FreeCADCmd',
  '/usr/bin/freecadcmd',
  '/usr/local/bin/freecadcmd',
  '/opt/homebrew/bin/freecadcmd',
  '/snap/bin/freecadcmd',
  'C:\\Program Files\\FreeCAD 1.1\\bin\\FreeCADCmd.exe',
  'C:\\Program Files\\FreeCAD\\bin\\FreeCADCmd.exe',
]

/** 单次渲染超时（毫秒；FreeCAD 冷启动比 dot 慢，放宽头寸）。 */
const RENDER_TIMEOUT_MS = 120_000

/** 版本探测超时（毫秒；freecadcmd --version 需加载运行时，较 dot -V 慢）。 */
const PROBE_TIMEOUT_MS = 20_000

/** SIGTERM → SIGKILL 宽限（与 graphviz-renderer 一致）。 */
const GRACE_MS = 3_000

/** 单流内存输出上限。 */
const MAX_OUTPUT_BYTES = 100_000

/** 渲染脚本临时文件名（写入 outputDir，与 SVG/manifest 同目录）。 */
const STRUCTURE_RENDER_SCRIPT_FILENAME = '.freecad-structure-render.py'

/** 子进程 HOME/临时目录名（写入 outputDir 内，隔离 FreeCAD 副作用）。 */
const STRUCTURE_HOME_DIRNAME = '.freecad-home'

/** 渲染 spawn 的 stdio 配置（无输入，仅收集 stdout/stderr）。 */
function renderStdio(): SubprocessSpawnSpec['stdio'] {
  return {
    stdin: 'ignore',
    stdout: { maxBytes: MAX_OUTPUT_BYTES },
    stderr: { maxBytes: MAX_OUTPUT_BYTES },
  }
}

/**
 * 生成 FreeCAD 缺失/路径失效时的安装引导文案。
 * @param executable - 解析到的路径（未找到时为 undefined）。
 * @returns 面向用户的安装与配置引导文本。
 */
export function freecadInstallMessage(executable: string | undefined): string {
  const hint = executable === undefined
    ? '未找到 FreeCAD freecadcmd 可执行文件。'
    : `已配置路径 ${executable} 不存在或不可执行。`
  return [
    hint,
    '结构线稿需要本机安装 FreeCAD 1.1+（macOS：brew install --cask freecad 或官网下载；Ubuntu/Debian：sudo apt install freecad；Windows：官网安装包），',
    '或通过 Config.freecadExecutable / DSH_FREECAD_CMD 指定 freecadcmd 路径。',
  ].join('')
}

/**
 * 解析 freecadcmd 可执行文件路径。
 * @param override - 显式覆盖路径（Config.freecadExecutable）；提供时不存在则视为未找到，不回落自动探测。
 * @returns freecadcmd 可执行文件绝对路径，或 undefined。
 */
export function findFreeCadCmd(override?: string): string | undefined {
  if (override !== undefined && override !== '') {
    return existsSync(override) ? override : undefined
  }
  const env = process.env.DSH_FREECAD_CMD
  if (env !== undefined && env !== '' && existsSync(env)) return env
  for (const candidate of FREECAD_CMD_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  for (const name of ['freecadcmd', 'FreeCADCmd', 'freecadcmd.exe', 'FreeCADCmd.exe']) {
    for (const segment of (process.env.PATH ?? '').split(delimiter)) {
      if (segment === '') continue
      const candidate = join(segment, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/** 探测结果。 */
export type FreeCadProbeResult = {
  /** FreeCAD 可用（executable 找到且 `freecadcmd --version` 成功）。 */
  ready: boolean
  /** 解析到的可执行路径（未找到时缺省）。 */
  executable?: string
  /** --version 输出的版本号（如 1.1.3）。 */
  version?: string
  /** 未就绪时的安装/配置引导。 */
  message?: string
}

/**
 * 探测 FreeCAD 可用性（执行 `freecadcmd --version`）。
 * @param subprocess - 注入的 subprocess 服务。
 * @param executableOverride - 可选路径覆盖。
 * @returns 就绪状态与版本/引导信息。
 */
export async function probeFreeCad(
  subprocess: SubprocessRuntime,
  executableOverride?: string,
): Promise<FreeCadProbeResult> {
  const executable = findFreeCadCmd(executableOverride)
  if (executable === undefined) {
    return { ready: false, message: freecadInstallMessage(executable) }
  }
  const controller = new AbortController()
  /* v8 ignore start -- probe timer is cleared before its callback can run on a healthy host */
  const timer = setTimeout(() => { controller.abort() }, PROBE_TIMEOUT_MS)
  timer.unref()
  /* v8 ignore stop */
  try {
    const handle = subprocess.spawn({
      argv: [executable, '--version'],
      cwd: dirname(executable) || process.cwd(),
      stdio: renderStdio(),
      graceMs: GRACE_MS,
      signal: controller.signal,
    })
    const outcome = await handle.done
    const text = `${handle.collected.stdout?.readFrom(0).text ?? ''} ${handle.collected.stderr?.readFrom(0).text ?? ''}`
    if (outcome.exitCode !== 0) {
      return { ready: false, executable, message: `freecadcmd --version 失败（退出码 ${outcome.exitCode ?? '未知'}）：${text.trim()}` }
    }
    const version = text.match(/(\d+\.\d+\.\d+)/)?.[1]
    return { ready: true, executable, ...(version === undefined ? {} : { version }) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ready: false, executable, message: `freecadcmd --version 调用失败：${message}` }
  } finally {
    clearTimeout(timer)
  }
}

/** 渲染错误码（与 graphviz-renderer 同形）。 */
export type StructureRenderErrorCode = 'not_installed' | 'render_failed' | 'aborted'

/** 渲染结果：成功 manifest 路径或分类错误（与 GraphvizRenderOutcome 同形）。 */
export type StructureRenderOutcome =
  | { ok: true; manifestPath: string }
  | { ok: false; code: StructureRenderErrorCode; error: string }

/** 结构线稿渲染请求。 */
export type StructureRenderSpec = {
  /** 模型文件绝对路径（STEP/IGES/BREP）。 */
  modelPath: string
  /** 请求视图（顺序即输出与 manifest 顺序）。 */
  views: readonly StructureViewName[]
  /** TechDraw 投影比例。 */
  scale: number
  /** 是否绘制隐藏线。 */
  showHidden: boolean
  /** 件号锚定（可为空）。 */
  callouts: readonly StructureCallout[]
  /** 图号（决定输出文件名与 manifest）。 */
  figureNumber: number
  /** 输出目录绝对路径（渲染器负责创建）。 */
  outputDir: string
  /** 调用方取消信号。 */
  signal?: AbortSignal
}

/**
 * 用 FreeCAD headless 把模型投影为多视图结构线稿 SVG + manifest.json。
 *
 * 流程：解析可执行文件 → 写脚本与隔离子目录 → spawn `freecadcmd <script.py>`
 * （cwd=outputDir）→ 按退出码 + manifest 存在判定成功。stderr 的 cfg/transcoder
 * 告警非致命（实测），不参与判定。
 * @param subprocess - 注入的 subprocess 服务。
 * @param spec - 渲染请求。
 * @param executableOverride - 可选路径覆盖。
 * @returns 成功 manifest 路径或分类错误（not_installed / render_failed / aborted）。
 */
export async function renderStructureViews(
  subprocess: SubprocessRuntime,
  spec: StructureRenderSpec,
  executableOverride?: string,
): Promise<StructureRenderOutcome> {
  const executable = findFreeCadCmd(executableOverride)
  if (executable === undefined) {
    return { ok: false, code: 'not_installed', error: freecadInstallMessage(undefined) }
  }
  const homeDir = join(spec.outputDir, STRUCTURE_HOME_DIRNAME)
  const scriptPath = join(spec.outputDir, STRUCTURE_RENDER_SCRIPT_FILENAME)
  const manifestPath = join(spec.outputDir, STRUCTURE_MANIFEST_FILENAME)
  const script = buildStructureScript({
    modelPath: spec.modelPath,
    views: spec.views,
    scale: spec.scale,
    showHidden: spec.showHidden,
    callouts: spec.callouts,
    figureNumber: spec.figureNumber,
    outputDir: spec.outputDir,
  })
  try {
    mkdirSync(spec.outputDir, { recursive: true })
    mkdirSync(homeDir, { recursive: true })
    // 同步写入脚本（体积小）：使 spawn 前的准备全部同步完成，超时计时器与
    // 子进程启动之间无 await，保证 abort 能命中已启动的子进程。
    writeFileSync(scriptPath, script, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, code: 'render_failed', error: `准备 FreeCAD 脚本失败：${message}` }
  }
  const controller = new AbortController()
  const state: { timedOut: boolean } = { timedOut: false }
  const timer = setTimeout(() => {
    state.timedOut = true
    controller.abort()
  }, RENDER_TIMEOUT_MS)
  timer.unref()
  const onCallerAbort = (): void => { controller.abort() }
  spec.signal?.addEventListener('abort', onCallerAbort, { once: true })
  if (spec.signal?.aborted === true) controller.abort()
  try {
    const handle = subprocess.spawn({
      argv: [executable, scriptPath],
      cwd: spec.outputDir,
      stdio: renderStdio(),
      graceMs: GRACE_MS,
      signal: controller.signal,
      // 隔离 FreeCAD 副作用：HOME/临时/缓存指向 outputDir 内子目录（best-effort）。
      env: {
        HOME: homeDir,
        XDG_CONFIG_HOME: join(homeDir, '.config'),
        XDG_CACHE_HOME: join(homeDir, '.cache'),
        XDG_DATA_HOME: join(homeDir, '.local'),
        TEMP: homeDir,
        TMP: homeDir,
        TMPDIR: homeDir,
      },
    })
    const outcome = await handle.done
    if (outcome.exitCode !== 0) {
      const stderr = (handle.collected.stderr?.readFrom(0).text ?? '').trim()
      let cause: string
      if (state.timedOut) {
        cause = '渲染超时'
      } else if (spec.signal?.aborted === true) {
        cause = '被调用方取消'
      } else if (outcome.exitCode === null) {
        cause = `被信号 ${outcome.signal ?? '未知'} 终止`
      } else {
        cause = `退出码 ${outcome.exitCode}`
      }
      return {
        ok: false,
        code: spec.signal?.aborted === true ? 'aborted' : 'render_failed',
        error: `FreeCAD 结构投影失败（${cause}）：${stderr || '无 stderr 输出'}`,
      }
    }
    if (!existsSync(manifestPath)) {
      return { ok: false, code: 'render_failed', error: `FreeCAD 未生成 manifest：${manifestPath}` }
    }
    return { ok: true, manifestPath }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      code: spec.signal?.aborted === true ? 'aborted' : 'render_failed',
      error: `FreeCAD 结构投影调用失败：${message}`,
    }
  } finally {
    clearTimeout(timer)
    spec.signal?.removeEventListener('abort', onCallerAbort)
  }
}
