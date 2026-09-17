/**
 * Graphviz 与 FreeCAD 渲染器共用的子进程样板：stdio 上限、版本探测 spawn、
 * 渲染截止期与失败原因归类。
 *
 * 两个渲染器只在可执行文件解析、argv 与产物校验上不同，共用部分必须保持同
 * 一条判定语义：探测与渲染共用同一 graceMs 与单流内存上限；渲染截止期让内部
 * 超时与调用方取消终止同一 AbortSignal；失败原因按「内部超时 → 调用方取消 →
 * 信号终止 → 退出码」归类，内部超时优先（它同时中止了子进程）。
 *
 * @module @deepseek-ai/dsh-patent-tools/figure/subprocess-render
 */

import { dirname } from 'node:path'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessRuntime,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'

/** 单流内存输出上限。 */
const MAX_OUTPUT_BYTES = 100_000

/** SIGTERM → SIGKILL 宽限（探测与渲染共用；与 patent-data subprocess-runner 一致）。 */
export const SPAWN_GRACE_MS = 3_000

/**
 * 无输入 spawn 的 stdio 配置（版本探测与 FreeCAD 渲染共用）。
 * @returns 忽略 stdin、按同一内存上限收集 stdout/stderr 的 stdio 配置。
 */
export function quietStdio(): SubprocessSpawnSpec['stdio'] {
  return {
    stdin: 'ignore',
    stdout: { maxBytes: MAX_OUTPUT_BYTES },
    stderr: { maxBytes: MAX_OUTPUT_BYTES },
  }
}

/**
 * 经 stdin 承载输入文本的 stdio 配置（Graphviz 渲染）。
 * @param data - 经 stdin 写入并关闭的文本；空串表示无输入。
 * @returns 在 {@link quietStdio} 基础上承载 `data` 的 stdio 配置。
 */
export function stdinStdio(data: string): SubprocessSpawnSpec['stdio'] {
  return { ...quietStdio(), stdin: data === '' ? 'ignore' : { data } }
}

/** 探测结果：退出事实与合并输出文本。 */
export type VersionProbeResult = {
  /** 子进程退出事实。 */
  readonly outcome: SubprocessOutcome
  /** stdout 与 stderr 的合并文本（版本号从中提取）。 */
  readonly text: string
}

/**
 * 运行一次版本探测并等待退出（argv 直传，不经 shell；cwd 取可执行文件所在目录）。
 * @param subprocess - 注入的 subprocess 服务。
 * @param executable - 已解析的可执行文件绝对路径。
 * @param versionFlag - 版本开关（dot 用 `-V`，freecadcmd 用 `--version`）。
 * @param signal - 探测截止期信号。
 * @returns 退出事实与合并输出文本。
 */
export async function spawnVersionProbe(
  subprocess: SubprocessRuntime,
  executable: string,
  versionFlag: string,
  signal: AbortSignal,
): Promise<VersionProbeResult> {
  const handle = subprocess.spawn({
    argv: [executable, versionFlag],
    cwd: dirname(executable) || process.cwd(),
    stdio: quietStdio(),
    graceMs: SPAWN_GRACE_MS,
    signal,
  })
  const outcome = await handle.done
  return {
    outcome,
    text: `${handle.collected.stdout?.readFrom(0).text ?? ''} ${handle.collected.stderr?.readFrom(0).text ?? ''}`,
  }
}

/** 渲染截止期：内部超时与调用方取消终止同一信号。 */
export type RenderDeadline = {
  /** 交给 spawn 的终止信号。 */
  readonly signal: AbortSignal
  /** 内部超时是否触发。 */
  readonly timedOut: () => boolean
  /** 清理计时器与调用方监听；必须与创建成对调用。 */
  readonly dispose: () => void
}

/**
 * 启动渲染截止期。
 * @param timeoutMs - 内部超时（毫秒）。
 * @param callerSignal - 调用方取消信号（可缺省）。
 * @returns 截止期句柄：交给 spawn 的信号、超时查询与清理函数。
 */
export function startRenderDeadline(timeoutMs: number, callerSignal?: AbortSignal): RenderDeadline {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  timer.unref()
  const onCallerAbort = (): void => { controller.abort() }
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
  if (callerSignal?.aborted === true) controller.abort()
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    },
  }
}

/**
 * 读取渲染子进程的 stderr 摘录。
 * @param handle - 渲染子进程句柄。
 * @returns 去除首尾空白的 stderr 文本；无 stderr 流或无非空输出时为空串。
 */
export function renderStderr(handle: SubprocessHandle): string {
  return (handle.collected.stderr?.readFrom(0).text ?? '').trim()
}

/**
 * 归类渲染失败原因（内部超时优先，其次是调用方取消、信号终止与退出码）。
 * @param outcome - 子进程退出事实。
 * @param timedOut - 内部超时是否触发。
 * @param callerSignal - 调用方取消信号（可缺省）。
 * @returns 面向用户的原因短语。
 */
export function describeRenderFailure(
  outcome: SubprocessOutcome,
  timedOut: boolean,
  callerSignal: AbortSignal | undefined,
): string {
  if (timedOut) return '渲染超时'
  if (callerSignal?.aborted === true) return '被调用方取消'
  if (outcome.exitCode === null) return `被信号 ${outcome.signal ?? '未知'} 终止`
  return `退出码 ${outcome.exitCode}`
}
