/**
 * 带 key 的 `patent-oas` 实测采集器:跑一次真实运行,写出 run 记录并按门槛判定。
 *
 * 每次调用起一个 `dsh --profile` 进程(与 `self-evolve-eval` 的 campaign 运行器同形),
 * 执行者一次、每个 rubric 维度一次评估者。没有 key 时如实跳过并以 0 退出:这个脚本是
 * 证据生产者,不是门禁本身;门禁是 `verify-patent-oas-gold`。
 *
 * 采集到的分数测的是「调用方选定的 profile 下的模型 + 作业规范」,因此只有在同一个 profile
 * 下采集的记录之间才可比;记录里的 `provider`/`modelId` 就是为这条留的。
 *
 * 用法:
 *   tsx scripts/run-patent-oas.ts [--profile headless] [--case <id>]... [--runs 1]
 *                                 [--patch <overlay>]... [--out <run.json>] [--work-dir <dir>]
 *                                 [--timeout-ms 600000] [--budget-ms 3600000]
 *                                 [--provider <p>] [--model <m>] [--dry-run]
 *
 * 采集完成后把记录交给门禁提升为基线:
 *   tsx scripts/verify-patent-oas-gold.ts --accept <run.json>
 */

import { join, resolve } from 'node:path'
import {
  GATE_FILE,
  PATENT_OAS_EXAMPLE_DIR,
  PROBLEM_SPACE_FILE,
  evaluateRun,
  formatVerdict,
  isOutsideRoot,
  loadGateConfig,
  loadGold,
  loadProblemSpace,
  loadRunRecord,
  verdictPassed,
} from './patent-oas-gate-core.ts'
import {
  collectRunRecord,
  credentialEnvFiles,
  hasCredentialSignal,
  parseRunnerOptions,
  planRun,
  spawnAgentProcess,
  writeRunRecord,
  type RunAgents,
} from './patent-oas-run-core.ts'

const root = resolve(import.meta.dirname, '..')
const exampleDir = resolve(root, PATENT_OAS_EXAMPLE_DIR)
const dshBinPath = resolve(root, 'apps/cli/src/bin.ts')
const tsxImport = 'tsx/esm'

async function main(args: string[]): Promise<number> {
  const stamp = new Date().toISOString().replaceAll(':', '-')
  const options = parseRunnerOptions(args, { root, cwd: process.cwd(), stamp })
  const gold = await loadGold(exampleDir)
  const space = await loadProblemSpace(resolve(root, PROBLEM_SPACE_FILE))
  const config = await loadGateConfig(resolve(root, GATE_FILE))
  const plan = planRun({
    space,
    gold,
    ...(options.caseIds.length === 0 ? {} : { caseIds: options.caseIds }),
    runsPerCase: options.runs,
  })
  const perCase = plan.cases.map(entry => `${entry.caseId}:${entry.dimensions}`).join(' ')
  console.log(
    `run-patent-oas: 计划 ${plan.cases.length} case × ${plan.runsPerCase} 次 = ${plan.calls} 次 agent 调用(${perCase});profile=${options.profile}`,
  )
  if (options.dryRun) {
    console.log(`run-patent-oas: --dry-run 只打印计划,未做任何模型调用;产物会落在 ${options.workDir},记录写出到 ${options.outPath}`)
    return 0
  }
  if (isOutsideRoot(root, config.baselinePath)) {
    console.error(`run-patent-oas: gate.yaml 的 baselinePath "${config.baselinePath}" 落在仓库之外,拒绝采集`)
    return 1
  }
  if (!(await hasCredentialSignal(process.env, credentialEnvFiles(root, process.env)))) {
    console.log(
      'run-patent-oas: 未发现模型凭据(环境变量 DEEPSEEK_API_KEY 或 .env 声明);跳过实测——本脚本是证据生产者,没有 key 时不做任何模型调用。',
    )
    return 0
  }

  const baseline = await loadRunRecord(resolve(root, config.baselinePath)).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })
  const deadline = Date.now() + options.budgetMs
  const runAgents: RunAgents = async (invocation) => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error(`${invocation.label}: 总预算 ${options.budgetMs}ms 已耗尽,停止后续调用`)
    await spawnAgentProcess({
      invocation,
      launcher: {
        binPath: dshBinPath,
        tsxImport,
        profile: options.profile,
        ...(options.patchPaths.length === 0 ? {} : { patchPaths: options.patchPaths }),
      },
      timeoutMs: Math.min(options.timeoutMs, remaining),
      env: { DSH_TELEMETRY_DISABLED: '1' },
    })
  }
  const record = await collectRunRecord({
    space,
    gold,
    agentStateDir: join(exampleDir, 'patent-state'),
    workDir: options.workDir,
    runAgents,
    ...(options.caseIds.length === 0 ? {} : { caseIds: options.caseIds }),
    runsPerCase: options.runs,
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    ...(options.modelId === undefined ? {} : { modelId: options.modelId }),
  })
  await writeRunRecord(options.outPath, record)
  console.log(`run-patent-oas: 已写出 ${options.outPath}(产物与日志在 ${options.workDir})`)

  const verdict = evaluateRun(space, config, record, baseline)
  console.log(formatVerdict(verdict))
  for (const line of [
    `记录/替换基线:tsx scripts/verify-patent-oas-gold.ts --accept ${options.outPath}`,
    `只判定不落基线:tsx scripts/verify-patent-oas-gold.ts --run ${options.outPath}`,
  ]) {
    console.log(`run-patent-oas: ${line}`)
  }
  if (!verdictPassed(verdict)) {
    console.error('run-patent-oas: 本次运行未通过门槛(产物已保留,便于定位)。')
    return 1
  }
  return 0
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`run-patent-oas: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  })
}
