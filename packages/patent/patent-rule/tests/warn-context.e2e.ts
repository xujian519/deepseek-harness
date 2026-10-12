import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/warn-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/patent-rule-warn.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

const MARKER = '{"type":"patent-rule-warn-observation"'

/** One event the driver projected out of the session for the probe to assert on. */
interface Observation {
  readonly type: string
  readonly seq: number
  readonly surfaceOp?: 'append' | { readonly op: string }
  readonly source?: { readonly kind?: string; readonly form?: string; readonly summary?: string }
  readonly sources?: readonly { readonly kind?: string }[]
  readonly text?: string
  readonly isError?: boolean | undefined
  readonly turn?: number
  readonly step?: number
}

function observationsFrom(stdout: string): Observation[] {
  const line = stdout.split('\n').findLast(candidate => candidate.startsWith(MARKER))
  if (line === undefined) throw new Error(`warn driver printed no observation line; stdout:\n${stdout}`)
  return (JSON.parse(line) as { observations: Observation[] }).observations
}

describe('patent-rule warn context through the production headless profile', () => {
  it('admits a warn-level hit as the next step\'s model input, with the gated result left successful', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'patent-rule warn e2e',
      tempDirPrefix: 'patent-rule-warn-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
    })
    expect(stderr).not.toContain('UNHANDLED')
    const observations = observationsFrom(stdout)

    const results = observations.filter(observation => observation.type === 'tool/result')
    expect(results).toHaveLength(1)
    // A warn-level hit leaves the gated result successful: the finding reaches
    // the model as context, not as a blocked call.
    expect(results[0]?.isError).toBe(false)

    const contexts = observations.filter(
      observation => observation.type === 'user/message' && observation.source?.kind === 'patent-rule-gate',
    )
    expect(contexts).toHaveLength(1)
    const context = contexts[0]
    expect(context?.source).toMatchObject({
      kind: 'patent-rule-gate',
      form: 'notice',
      summary: 'patent_warn_probe 命中 warn 级规则 PAT-ABS-001',
    })
    expect(context?.text).toContain('PAT-ABS-001')
    expect(context?.text).toContain('毫无疑问')

    // The splice is the durable pending input a resume replays; the
    // `user/message` above is that input admitted at the next step boundary.
    const splices = observations.filter(
      observation => observation.type === 'agent/inbox/spliced'
        && observation.sources?.some(source => source.kind === 'patent-rule-gate') === true,
    )
    expect(splices).toHaveLength(1)

    // One turn, two steps: the context is admitted inside the second one —
    // after its boundary and before the answer that step's request produced.
    const steps = observations.filter(observation => observation.type === 'step/start')
    const replies = observations.filter(
      observation => observation.type === 'assistant/message' && observation.step === 2,
    )
    expect(steps).toHaveLength(2)
    expect(replies).toHaveLength(1)
    expect(context?.seq).toBeGreaterThan(results[0]?.seq ?? 0)
    expect(context?.seq).toBeGreaterThan(steps[1]?.seq ?? 0)
    expect(context?.seq).toBeLessThan(replies[0]?.seq ?? 0)
    expect(context?.surfaceOp).toBe('append')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
