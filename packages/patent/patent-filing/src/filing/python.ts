/**
 * Python 解释器定位：显式覆盖 → `DSH_PYTHON_PATH` → `DSH_PRIMARY_RUNTIME` → 随包运行时 → PATH。
 *
 * 引擎需要 `python-docx`（随包运行时已带；解释器只按存在性判定，不预跑导入探测，
 * 因此部署应指向一个自带 python-docx 的解释器）；显式覆盖路径不存在时不回落自动探测，
 * 避免"配错了却悄悄换了解释器"——那是部署自洽的错误，加载期即报。
 *
 * 随包运行时由 `DSH_PRIMARY_RUNTIME` 或 Harness home（`DSH_HOME`，缺省 `~/.dsh`）决定。
 *
 * 平台差异（解释器文件名与 PATH 上的候选名）走纯函数，两个分支在任一主机上都可测。
 * @module @deepseek-ai/dsh-patent-filing/filing/python
 */

import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { PatentFilingError } from '../types.ts'

/**
 * 随包运行时相对 Harness home 的安装位置
 * （`@deepseek-ai/dsh-tool-workspace-dependencies` 的落点）。
 */
export const PRIMARY_RUNTIME_REL = join('dsh-runtimes', 'dsh-primary-runtime')

/**
 * 相对运行时根目录的解释器路径。
 * @param platform - 目标平台。
 * @returns 该平台上的解释器相对路径。
 */
export function interpreterRel(platform: NodeJS.Platform): string {
  return platform === 'win32'
    ? join('dependencies', 'python', 'python.exe')
    : join('dependencies', 'python', 'bin', 'python3')
}

/**
 * PATH 上要探测的解释器文件名。
 * @param platform - 目标平台。
 * @returns 候选文件名，按优先顺序。
 */
export function pathNames(platform: NodeJS.Platform): string[] {
  return platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python3', 'python']
}

/**
 * 解析一个可用的 Python 解释器。
 *
 * 随包运行时按 Harness home 解析（`DSH_HOME`，缺省 `~/.dsh`），与运行时安装包写在
 * 同一处规则上。
 * @param override - 显式解释器路径（来自部署配置）；提供时若不存在即报错，不回落。
 * @returns 解释器绝对路径，找不到返回 undefined。
 */
export function findPython(override?: string): string | undefined {
  if (override !== undefined && override !== '') {
    if (existsSync(override)) return override
    throw new PatentFilingError(`配置的 Python 解释器不存在：${override}`)
  }
  const explicit = process.env.DSH_PYTHON_PATH
  if (explicit !== undefined && explicit !== '' && existsSync(explicit)) return explicit

  const roots = [process.env.DSH_PRIMARY_RUNTIME, join(resolveDshHome(), PRIMARY_RUNTIME_REL)]
    .filter((root): root is string => root !== undefined && root !== '')
  for (const root of roots) {
    const candidate = join(root, interpreterRel(process.platform))
    if (existsSync(candidate)) return candidate
  }

  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue
    for (const name of pathNames(process.platform)) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * 解析一次调用要用的解释器，缺解释器时以可处置的消息报错。
 *
 * 解释器是主机能力，不是部署配置：装配期探测不到不该挡住整份组合的挂载，因此解析发生
 * 在每次引擎调用前（{@link findPython} 的探测结果不缓存，好让后装上的解释器被用上）。
 * @param override - 显式解释器路径（来自部署配置）。
 * @returns 解释器绝对路径。
 * @throws PatentFilingError 本机没有可用解释器时。
 */
export function requirePython(override?: string): string {
  const found = findPython(override)
  if (found === undefined) {
    throw new PatentFilingError(
      '未找到可用的 Python 解释器（引擎需要自带 python-docx 的解释器）：请在配置里指定 pythonPath，'
      + '或设置 DSH_PYTHON_PATH，或让随包运行时（DSH_PRIMARY_RUNTIME 或 Harness home 下的 dsh-runtimes）可用',
    )
  }
  return found
}
