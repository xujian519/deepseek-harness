/**
 * nuo 引擎的请求通道开关。
 *
 * nuo 2.3.2 起浏览器通道在同一站点的普通页面里用 `fetch` 读取原始响应体，
 * 不再读取会被 JSON 查看器扩展改写的 `outerHTML`，因此 `browser` 与 `fallback`
 * 都能拿到搜索 XHR 的原始 JSON。`fallback` 让有直连能力的部署保持原生 fetch
 * 的速度，只在连接层失败（如 `UND_ERR_CONNECT_TIMEOUT`）时才启动浏览器。
 *
 * nuo 只提供环境变量这一种开关，所以部署的选择只能以进程级环境变量表达；本模块是该
 * 写入的唯一入口，服务在构造时按 Config 调用一次。
 * @module @deepseek-ai/dsh-patent-data/nuo-channel
 */

import { resetEgoBrowserCache } from '@deepseek-ai/nuo-patent'
import type { NuoRequestChannel } from './types.ts'

/** nuo 读取的通道环境变量名（`"0"` 原生 fetch、`"1"` 浏览器优先、`"fallback"` 原生优先且连接失败回退浏览器）。 */
export const NUO_EGO_BROWSER_ENV = 'NUO_PATENT_EGO_BROWSER'

/**
 * Apply the deployment's nuo request channel to the process environment.
 *
 * `native`, `browser`, and `fallback` write the environment variable and drop
 * nuo's cached availability probe, because that cache is read once and would
 * otherwise keep the previous answer for the rest of the process. `auto` keeps
 * nuo's own detection and leaves the environment untouched. The variable is
 * process-wide, so an explicit choice is last-writer-wins across mounts; each
 * mount restores the value it replaced when its service disposes, unless another
 * writer changed the variable in the meantime.
 * @param channel - `native` forces the plain fetch, `browser` forces the
 * ego-browser path, `fallback` keeps the plain fetch first and retries
 * connection failures through the browser, `auto` keeps nuo's own detection.
 * @returns a disposer restoring the previous value, or undefined for `auto`.
 */
export function applyNuoRequestChannel(channel: NuoRequestChannel): (() => void) | undefined {
  if (channel === 'auto') return undefined
  const value = channel === 'native' ? '0' : channel === 'browser' ? '1' : 'fallback'
  const previous = process.env[NUO_EGO_BROWSER_ENV]
  process.env[NUO_EGO_BROWSER_ENV] = value
  resetEgoBrowserCache()
  return () => {
    if (process.env[NUO_EGO_BROWSER_ENV] !== value) return
    if (previous === undefined) Reflect.deleteProperty(process.env, NUO_EGO_BROWSER_ENV)
    else process.env[NUO_EGO_BROWSER_ENV] = previous
    resetEgoBrowserCache()
  }
}
