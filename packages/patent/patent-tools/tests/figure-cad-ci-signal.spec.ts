/**
 * 真实 CAD 渲染链路的 CI 信号。
 *
 * `figure-freecad-real-render.spec.ts` 与 `figure-inkscape-real-render.spec.ts`
 * 在没有对应可执行文件时整组跳过。`.github/workflows/ci-fork.yml` 的
 * `node-cad-render` job 用 `scripts/prepare-ci-cad.sh` 装上两者并设置
 * `DSH_CAD_CI_SIGNAL=1`；本文件在该环境中断言两件可执行文件真的能被工具侧的
 * 探测函数找到，因此删掉安装步骤会让这个 job 变红，而不是退回静默跳过。
 *
 * 其他 lane（包括单测与覆盖率）不装 CAD 渲染器，所以断言只在专用 job 里生效；
 * 非 CI 环境由开发者自己决定装不装。
 */

import { describe, expect, it } from 'vitest'
import { findFreeCadCmd } from '../src/figure/freecad-renderer.ts'
import { findInkscape } from '../src/figure/inkscape-renderer.ts'

/** 专用 job 用这个变量声明「本 lane 已装上 CAD 渲染器」，其他 lane 不设。 */
const provisioned = process.env.DSH_CAD_CI_SIGNAL === '1' && process.platform === 'linux'

describe.skipIf(!provisioned)('real CAD render CI signal (the workflow installs both)', () => {
  it('finds the FreeCAD console command the workflow installed', () => {
    expect(findFreeCadCmd()).toBeDefined()
  })

  it('finds the Inkscape binary the workflow installed', () => {
    expect(findInkscape()).toBeDefined()
  })
})
