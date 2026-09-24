/**
 * 真实 Graphviz 链路的 CI 信号。
 *
 * `figure-graphviz-real-render.spec.ts` 在没有 `dot` 时整组跳过，而托管 CI 镜像
 * 既没有 `dot` 也没有中文字体，于是「DOT 构建 → dot CLI → SVG 标注」这条链路在
 * CI 上从来只是 5 条跳过、日志读起来是绿的。`.github/workflows/ci-fork.yml` 在跑
 * 单测前装上 `graphviz` 与 `fonts-noto-cjk`；本文件在 CI 上断言这两样东西真的在，
 * 因此删掉工作流里的安装步骤会变红，而不是退回静默跳过。
 *
 * 非 CI 环境由开发者自己决定装不装，这里不代为假设。
 */

import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { findDot } from '../src/figure/graphviz-renderer.ts'

/** 是否跑在工作流提供的环境上：断言只对 CI 的 Linux runner 成立。 */
const onCi = process.env.CI !== undefined && process.env.CI !== '' && process.env.CI !== 'false'
/** 工作流用 apt 装 Graphviz 与中文字体，所以这两条断言只对 CI 的 Linux runner 成立。 */
const provisioned = onCi && process.platform === 'linux'

/** `fc-match` 解析出的字族；该命令随 `fontconfig` 提供，工作流与字体一起安装。 */
function matchedFamily(pattern: string): string {
  return execFileSync('fc-match', ['-f', '%{family}', pattern], { encoding: 'utf8' }).trim()
}

describe.skipIf(!provisioned)('real-render CI signal (the workflow installs both)', () => {
  it('finds the Graphviz binary the workflow installed', () => {
    expect(findDot()).toBeDefined()
  })

  it('resolves the CJK face the smoke requests', () => {
    expect(matchedFamily('Noto Sans CJK SC')).toContain('Noto Sans CJK')
  })
})
