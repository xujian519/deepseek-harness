/** Verify the self-evolve P1-10 evaluation decision: the CI stop switch. */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const decisionPath = resolve(root, 'packages/self-evolve/evaluation/eval-decision.json')

async function main(): Promise<void> {
  let text: string
  try {
    text = await readFile(decisionPath, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // No campaign has settled yet: the switch is dormant, not tripped.
      console.log('verify-self-evolve-eval: no evaluation decision recorded; switch dormant.')
      return
    }
    throw error
  }
  let record: unknown
  try {
    record = JSON.parse(text)
  } catch {
    console.error(`verify-self-evolve-eval: decision file is not valid JSON (${decisionPath})`)
    process.exit(1)
  }
  if (typeof record !== 'object' || record === null) {
    console.error('verify-self-evolve-eval: decision record must be a JSON object')
    process.exit(1)
  }
  const recommended = (record as Record<string, unknown>).recommended
  if (recommended !== 'continue' && recommended !== 'rollback') {
    console.error(`verify-self-evolve-eval: decision record must carry recommended "continue" or "rollback", got ${String(recommended)}`)
    process.exit(1)
  }
  if (recommended === 'rollback') {
    // The CI stop switch: the evaluation could not exclude randomness or found
    // harm. Keep CI red until the maintainers act on the recorded decision
    // (disabling the self-evolve bundle or re-running the campaign).
    console.error('verify-self-evolve-eval: recorded decision is rollback (95% CI not strictly positive); the self-evolve switch is tripped.')
    process.exit(1)
  }
  console.log('verify-self-evolve-eval: recorded decision is continue; self-evolve switch stays on.')
}

await main()
