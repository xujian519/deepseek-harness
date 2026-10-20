/**
 * Diagnostic benchmark for knowledge-graph keyword search. It is not part of the
 * CI suite (Vitest only collects `*.spec.ts`/`*.test.ts`); run it against a real
 * knowledge.db to compare the trigram fast path with the LIKE fallback.
 *
 *   DSH_KNOWLEDGE_BENCH_DB=~/.dsh/knowledge/knowledge-lite.db \
 *     npx tsx packages/patent/patent-knowledge/tests/kg-search.perf.ts
 */

import { performance } from 'node:perf_hooks'
import { KgStore } from '../src/shared/kg-store.ts'

const dbPath = process.env.DSH_KNOWLEDGE_BENCH_DB
if (dbPath === undefined || dbPath === '') {
  console.log('kg-search.perf: set DSH_KNOWLEDGE_BENCH_DB to a knowledge.db path; skipped.')
} else {
  const store = new KgStore(dbPath)
  const queries: Array<[string, () => Array<{ id: string }>]> = [
    ['phrase: 创造性', () => store.searchByKeyword('创造性', 10)],
    ['phrase: 专利侵权赔偿标准', () => store.searchByKeyword('专利侵权赔偿标准', 10)],
    ['or: 创造性判断标准', () => store.searchByKeyword('创造性判断标准', 10, { mode: 'or' })],
    ['or: 无此词汇xyz', () => store.searchByKeyword('无此词汇xyz', 10, { mode: 'or' })],
  ]
  for (const [name, run] of queries) {
    run()
    const start = performance.now()
    const hits = run()
    console.log(`${name.padEnd(28)} ${(performance.now() - start).toFixed(2)} ms  hits=${hits.length}`)
  }
  store.close()
}
