/**
 * CLI entry of the P1-10 evaluation scaffold.
 *
 *   pnpm eval:self-evolve subset  --manifest m.jsonl --seed 20260821 --count 60 --out subset.json
 *   pnpm eval:self-evolve score   --results results.json
 *   pnpm eval:self-evolve decide  --results results.json --write
 *
 * `score` prints the paired summary and bootstrap confidence interval;
 * `decide --write` persists the continue/rollback record that arms the
 * `verify-self-evolve-eval` gate. Running from the repository root is
 * required (default artifact paths are repo-relative).
 *
 * @module @deepseek-ai/dsh-self-evolve-eval/cli
 */

import { dirname, join, resolve } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { decide, recordDecision } from './decision.ts'
import { bootstrapCi, summarize, validateResults } from './score.ts'
import { DEFAULT_SUBSET_SIZE, loadTaskManifest, selectSubset } from './subset.ts'
import type { EvalResults } from './types.ts'

/** Default artifact directory, relative to the repository root. */
export const DEFAULT_EVAL_DIR = join('packages', 'self-evolve', 'evaluation')
/** Default decision record file inside the artifact directory. */
export const DEFAULT_DECISION_PATH = join(DEFAULT_EVAL_DIR, 'eval-decision.json')

function usage(): void {
  console.log('self-evolve-eval: P1-10 evaluation scaffold')
  console.log('  subset  --manifest <json|jsonl> --seed <n> [--count 60] --out <subset.json>')
  console.log('  score   --results <results.json> [--seed <n>]')
  console.log('  decide  --results <results.json> [--seed <n>] [--write] [--out <path>]')
}

/** Extract one `--key value` argument; null when absent. */
function arg(name: string): string | null {
  const index = process.argv.indexOf(name)
  if (index < 0 || index + 1 >= process.argv.length) return null
  const raw = process.argv[index + 1]
  if (raw === undefined) return null
  return raw.startsWith('--') ? null : raw
}

function has(name: string): boolean {
  return process.argv.includes(name)
}

function requireArg(name: string): string {
  const value = arg(name)
  if (value === null) {
    console.error(`self-evolve-eval: missing ${name} argument`)
    usage()
    process.exit(2)
  }
  return value
}

async function main(): Promise<void> {
  const command = process.argv[2]
  switch (command) {
    case 'subset': {
      const manifest = requireArg('--manifest')
      const seed = Number(requireArg('--seed'))
      const count = Number(arg('--count') ?? String(DEFAULT_SUBSET_SIZE))
      const out = requireArg('--out')
      if (!Number.isInteger(seed) || seed < 0) throw new Error('self-evolve-eval: --seed must be a non-negative integer')
      if (!Number.isInteger(count) || count < 1) throw new Error('self-evolve-eval: --count must be a positive integer')
      const tasks = await loadTaskManifest(resolve(manifest))
      const subset = selectSubset(tasks, seed, count)
      await writeJson(resolve(out), subset)
      console.log(`self-evolve-eval: selected ${subset.length} task(s) from ${tasks.length} with seed ${seed} → ${out}`)
      return
    }
    case 'score': {
      const results = validateResults(JSON.parse(await readFile(resolve(requireArg('--results')), 'utf8')))
      const ci = bootstrapCi(results, { seed: Number(arg('--seed') ?? 0) })
      printScore(results, ci.low, ci.high, ci.resamples)
      return
    }
    case 'decide': {
      const results = validateResults(JSON.parse(await readFile(resolve(requireArg('--results')), 'utf8')))
      const decision = decide(results, { seed: Number(arg('--seed') ?? 0) })
      printScore(results, decision.ci.low, decision.ci.high, decision.ci.resamples)
      console.log(`self-evolve-eval: crossesZero=${decision.crossesZero} recommended=${decision.recommended}`)
      if (has('--write')) {
        const out = resolve(arg('--out') ?? DEFAULT_DECISION_PATH)
        await recordDecision(out, decision)
        console.log(`self-evolve-eval: recorded decision → ${out}`)
      }
      return
    }
    default:
      usage()
      process.exit(2)
  }
}

function printScore(results: EvalResults, low: number, high: number, resamples: number): void {
  const summary = summarize(results)
  console.log('self-evolve-eval:')
  console.log(`  tasks=${summary.n} wins=${summary.wins} losses=${summary.losses} netWin=${summary.netWin}`)
  console.log(`  baselineRate=${summary.baselineRate} evolvedRate=${summary.evolvedRate} winRateDelta=${summary.winRateDelta}`)
  console.log(`  ci95=[${low.toFixed(4)}, ${high.toFixed(4)}] (${resamples} resamples)`)
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function entry(): Promise<void> {
  try {
    await main()
  } catch (error: unknown) {
    console.error(`self-evolve-eval: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

// Run the CLI only when executed directly; importing the module stays side-effect free.
if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  void entry()
}
