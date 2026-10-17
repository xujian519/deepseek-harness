/**
 * nuo 引擎的请求通道开关。
 *
 * nuo 的 `fetchHtml` 在 macOS 上只要 PATH 里有 `ego-browser` 就经浏览器发请求——
 * **不设 `NUO_PATENT_EGO_BROWSER` 并不等于关闭**，只有显式取值 `"0"` 才走原生 fetch。
 * 浏览器里的 JSON 查看器扩展会把搜索 XHR 的 `application/json` 响应渲染成 HTML 页面，
 * 于是 `parseSearchResultsJson` 拿不到 JSON、回退的 HTML 搜索页也解析不出命中，
 * `patent_search` 以一个非致命告警静默返回零命中：调用记录里看到的是「检索成功、0 条
 * 结果」，而不是失败。
 *
 * 2026-10-03 实测（同一查询、同一代理）：浏览器路径 3/3 零命中且无网络错误；走原生
 * fetch 3/3 各 10 条命中，同批 `scrapePatent` 也从 1.3–2.3 秒降到 0.8–1.6 秒。
 *
 * nuo 只提供环境变量这一种开关，所以部署的选择只能以进程级环境变量表达；本模块是该
 * 写入的唯一入口，服务在构造时按 Config 调用一次。
 * @module @deepseek-ai/dsh-patent-data/nuo-channel
 */

import { resetEgoBrowserCache } from '@deepseek-ai/nuo-patent'
import type { NuoRequestChannel } from './types.ts'

/** nuo 读取的通道环境变量名（`"0"` 强制原生 fetch，`"1"` 强制浏览器路径）。 */
export const NUO_EGO_BROWSER_ENV = 'NUO_PATENT_EGO_BROWSER'

/**
 * Apply the deployment's nuo request channel to the process environment.
 *
 * `native` and `browser` write the environment variable and drop nuo's cached
 * availability probe, because that cache is read once and would otherwise keep
 * the previous answer for the rest of the process. `auto` keeps nuo's own
 * detection and leaves the environment untouched. The variable is process-wide,
 * so an explicit choice is last-writer-wins across mounts; each mount restores
 * the value it replaced when its service disposes, unless another writer changed
 * the variable in the meantime.
 * @param channel - `native` forces the plain fetch, `browser` forces the ego-browser path, `auto` keeps nuo's own detection.
 * @returns a disposer restoring the previous value, or undefined for `auto`.
 */
export function applyNuoRequestChannel(channel: NuoRequestChannel): (() => void) | undefined {
  if (channel === 'auto') return undefined
  const value = channel === 'native' ? '0' : '1'
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
