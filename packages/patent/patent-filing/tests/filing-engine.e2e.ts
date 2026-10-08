// Real-engine end to end: the packaged Python engine runs through the real local
// subprocess provider and produces a DOCX that the packaged verifier accepts with
// every assertion green. Runs in the no-coverage e2e lane because it needs a Python
// with python-docx. The suite skips itself through `describe.skipIf` when this host
// has none: an early `return` inside the case would report a pass for a run that
// never happened.
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { DEFAULT_ENGINE_TIMEOUT_MS, buildFiling, defaultSpecPath, defaultTemplatePath, findPython, verifyFiling } from '@deepseek-ai/dsh-patent-filing'
import type { BuildEngineOptions, VerifyEngineOptions } from '@deepseek-ai/dsh-patent-filing'

/**
 * The interpreter that can run the engine, or undefined when this host has none.
 *
 * Probed synchronously at collection time so the suite can skip itself whole. The case
 * leaves `pythonPath` unset, so the engine resolves the same interpreter through the
 * production discovery path.
 */
function enginePython(): string | undefined {
  const candidate = findPython()
  if (candidate === undefined) return undefined
  const probe = spawnSync(candidate, ['-c', 'import docx'], { timeout: 10_000 })
  return probe.status === 0 ? candidate : undefined
}

const interpreter = enginePython()

describe.skipIf(interpreter === undefined)('filing engine end to end', () => {
  let work: string | undefined

  afterAll(async () => {
    if (work !== undefined) await rm(work, { recursive: true, force: true })
    work = undefined
  })

  it('builds a filing document and verifies it against the packaged template', async () => {
    work = await mkdtemp(join(tmpdir(), 'dsh-patent-filing-e2e-'))
    const subprocess = new LocalSubprocessRuntime(new Context())
    const signal = new AbortController().signal
    const common = {
      subprocess,
      specPath: defaultSpecPath(),
      templatePath: defaultTemplatePath(),
      timeoutMs: DEFAULT_ENGINE_TIMEOUT_MS,
    }
    const buildOptions: BuildEngineOptions = {
      ...common,
      defaultOutputDir: work,
      figureScale: 1,
    }
    const content = {
      abstract: ['本发明公开了一种用于校验出件链路的装置，其包括本体与控制器。'],
      claims: [
        '1. 一种用于校验出件链路的装置，其特征在于，包括本体与控制器，所述控制器设置于所述本体。',
        '2. 根据权利要求 1 所述的装置，其特征在于，所述本体为矩形。',
      ],
      specification: [
        { kind: 'h3', text: '技术领域' },
        { kind: 'p', text: '本发明属于机械领域，具体涉及一种用于校验出件链路的装置。' },
        { kind: 'h3', text: '背景技术' },
        { kind: 'p', text: '现有装置缺少出件校验环节。' },
        { kind: 'h3', text: '发明内容' },
        { kind: 'p', text: '本发明提供一种装置，以解决上述技术问题。' },
        { kind: 'h3', text: '附图说明' },
        { kind: 'p', text: '图1为装置的立体图；图2为装置的剖视图。' },
        { kind: 'h3', text: '具体实施方式' },
        { kind: 'p', text: '下面结合附图对本发明作进一步说明。' },
        { kind: 'table', rows: [['部位', '标记'], ['本体', '1'], ['控制器', '2']] },
      ] as { kind: 'h3' | 'p' | 'table'; text?: string; rows?: string[][] }[],
      figures: [join(work, 'fig1.png'), join(work, 'fig2.png')],
    }
    // 两张 1×1 的 PNG（最小合法位图），避免依赖 Chrome 栅格化。
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    )
    for (const path of content.figures) await writeFile(path, png)

    const built = await buildFiling({ content, outputName: '链路校验', outputDir: work }, buildOptions, process.cwd(), signal)
    expect(built.sections.map(tally => tally.key)).toEqual([
      'abstract', 'abstract_figure', 'claims', 'specification', 'figures',
    ])
    expect(built.figures).toHaveLength(2)
    expect(built.templateStyle).toMatchObject({ sectionCount: 5, sizePt: 12, lineSpacing: 1.5 })
    expect(built.numberingTotal).toBeGreaterThan(0)
    await expect(readFile(built.docxPath)).resolves.toBeInstanceOf(Buffer)

    const verifyOptions: VerifyEngineOptions = { ...common }
    const verified = await verifyFiling({ docxPath: built.docxPath }, verifyOptions, signal)
    expect(verified.errors).toEqual([])
    expect(verified.passed).toBe(true)
    expect(verified.info.sections).toBe(5)
    // 附图在两节各出现一次：摘要附图 1 张 + 说明书附图 2 张。
    expect(verified.info.figures).toBe(3)
    expect(verified.info.template?.sections).toBe(5)
  }, 120_000)
})
