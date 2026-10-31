/**
 * 带 key 的 `patent-oas` 实测采集器:跑一次真实运行,写出 run 记录并按门槛判定。
 *
 * 每次调用起一个 `dsh --profile` 进程(与 `self-evolve-eval` 的 campaign 运行器同形),
 * 每轮一个执行者、每轮每个 rubric 维度一个评估者。没有 key 时如实跳过并以 0 退出:这个脚本是
 * 证据生产者,不是门禁本身;门禁是 `verify-patent-oas-gold`。
 *
 * 采集到的分数测的是「调用方选定的 profile 与被测面下的模型 + 作业规范」,因此只有在同一
 * profile、同一被测面下采集的记录之间才可比;记录里的 `provider`/`modelId` 与
 * `execution`/`workflowId` 就是为这条留的。
 *
 * `--execution workflow` 换的是被测面而不是提示词:执行者经 `patent_workflow_run` 跑问题空间为
 * 该 case 声明的 manifest,答复经 `matter_log_append` 留档,记录多带 `workflowId` 与逐轮
 * `claimVersions`。该设置自动带上 `patent-workflow.patch.yml`,把 patent 工具行挂进 headless 组合
 * ——agent preset 是 agent 平面,headless 组合挂不上它(见该 overlay 的抬头说明)。
 *
 * headless profile 用 `--json` 事件流承载每步 usage,因此记录能写出 `tokens`;`cost` 需要
 * 调用方同时给出 `--input-usd-per-mtok`/`--output-usd-per-mtok`(provider 不直接报告成本)。
 *
 * 用法:
 *   tsx scripts/run-patent-oas.ts [--profile headless] [--execution prompt|workflow]
 *                                 [--case <id>]... [--runs 1]
 *                                 [--patch <overlay>]... [--out <run.json>] [--work-dir <dir>]
 *                                 [--timeout-ms 600000] [--budget-ms 3600000]
 *                                 [--provider <p>] [--model <m>]
 *                                 [--input-usd-per-mtok <n> --output-usd-per-mtok <n>]
 *                                 [--dry-run]
 *
 * 采集完成后把记录交给门禁提升为基线:
 *   tsx scripts/verify-patent-oas-gold.ts --accept <run.json>
 */

import { join, resolve } from 'node:path'
import {
  GATE_FILE,
  PATENT_OAS_EXAMPLE_DIR,
  PROBLEM_SPACE_FILE,
  comparisonSettingProblems,
  evaluateRun,
  findBaselineDeclaration,
  formatVerdict,
  isOutsideRoot,
  loadBaselineRecord,
  loadGateConfig,
  loadGold,
  loadProblemSpace,
  surfaceOf,
  verdictPassed,
} from './patent-oas-gate-core.ts'
import {
  collectRunRecord,
  credentialEnvFiles,
  formatRunPlan,
  hasCredentialSignal,
  parseRunnerOptions,
  planRun,
  spawnAgentProcess,
  writeRunRecord,
  WORKFLOW_PATCH_FILE,
  type RunAgents,
} from './patent-oas-run-core.ts'
import { formatConcision } from './patent-oas-concision.ts'

const root = resolve(import.meta.dirname, '..')
const exampleDir = resolve(root, PATENT_OAS_EXAMPLE_DIR)
const dshBinPath = resolve(root, 'apps/cli/src/bin.ts')
const tsxImport = 'tsx/esm'

/**
 * 解析命令行并执行一次采集;`--dry-run` 只打印计划。
 *
 * @param args 命令行参数(不含 `node` 与脚本路径)。
 * @returns 进程退出码:成功或跳过为 0,未过门槛或设置不可比为 1。
 */
export async function main(args: string[]): Promise<number> {
  const stamp = new Date().toISOString().replaceAll(':', '-')
  const options = parseRunnerOptions(args, { root, cwd: process.cwd(), stamp })
  const workflowPatch = resolve(root, WORKFLOW_PATCH_FILE)
  const patchPaths = options.execution === 'workflow' && !options.patchPaths.includes(workflowPatch)
    ? [...options.patchPaths, workflowPatch]
    : options.patchPaths
  const gold = await loadGold(exampleDir)
  const space = await loadProblemSpace(resolve(root, PROBLEM_SPACE_FILE))
  const config = await loadGateConfig(resolve(root, GATE_FILE))
  const plan = planRun({
    space,
    gold,
    execution: options.execution,
    ...(options.caseIds.length === 0 ? {} : { caseIds: options.caseIds }),
    runsPerCase: options.runs,
  })
  console.log(formatRunPlan(plan, options.profile))
  if (options.dryRun) {
    console.log(
      `run-patent-oas: 总预算 ${options.budgetMs}ms,单次调用上限 ${options.timeoutMs}ms;--dry-run 只打印计划,`
      + `未做任何模型调用;产物会落在 ${options.workDir},记录写出到 ${options.outPath}`,
    )
    return 0
  }
  for (const declaration of config.baselines) {
    if (!isOutsideRoot(root, declaration.path)) continue
    console.error(`run-patent-oas: gate.yaml 为 ${surfaceOf(declaration)} 声明的基线路径 "${declaration.path}" 落在仓库之外,拒绝采集`)
    return 1
  }
  if (!(await hasCredentialSignal(process.env, credentialEnvFiles(root, process.env)))) {
    console.log(
      'run-patent-oas: 未发现模型凭据(环境变量 DEEPSEEK_API_KEY 或 .env 声明);跳过实测——本脚本是证据生产者,没有 key 时不做任何模型调用。',
    )
    return 0
  }

  const workflowId = plan.cases.find(entry => entry.workflow !== undefined)?.workflow?.manifestId
  const declaration = findBaselineDeclaration(config, plan.execution, workflowId)
  if (declaration === undefined) {
    console.error(
      `run-patent-oas: gate.yaml 没有为 ${surfaceOf({ execution: plan.execution, ...(workflowId === undefined ? {} : { workflowId }) })} 声明基线;`
      + '本次记录只按绝对下限判定。采集通过后在 gate.yaml 的 baselines 追加一条声明,再用 --accept 落基线。',
    )
  }
  const baseline = declaration === undefined
    ? undefined
    : await loadBaselineRecord(resolve(root, declaration.path))
  const deadline = Date.now() + options.budgetMs
  const runAgents: RunAgents = async (invocation) => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error(`${invocation.label}: 总预算 ${options.budgetMs}ms 已耗尽,停止后续调用`)
    return await spawnAgentProcess({
      invocation,
      launcher: {
        binPath: dshBinPath,
        tsxImport,
        profile: options.profile,
        ...(patchPaths.length === 0 ? {} : { patchPaths }),
        // 只有 headless app 认识 `--json`;其它 profile 不带这个参数,usage 就按未报告处理。
        json: options.profile === 'headless',
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
    execution: plan.execution,
    ...(options.caseIds.length === 0 ? {} : { caseIds: options.caseIds }),
    runsPerCase: options.runs,
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    ...(options.modelId === undefined ? {} : { modelId: options.modelId }),
    ...(options.pricing === undefined ? {} : { pricing: options.pricing }),
  })
  await writeRunRecord(options.outPath, record)
  console.log(`run-patent-oas: 已写出 ${options.outPath}(产物与日志在 ${options.workDir})`)
  // 篇幅读数与分数分开打印:它不进分数,但读一次采集就能看到「这份答复有多长」,
  // 不必再去 open 每份 deliverable.md 逐字数。
  const concision = formatConcision(record)
  if (concision !== undefined) console.log(concision)

  const comparisonProblems = baseline === undefined
    ? []
    : comparisonSettingProblems(record, baseline, options.outPath)
  if (comparisonProblems.length > 0) {
    for (const problem of comparisonProblems) console.error(`run-patent-oas: ${problem}`)
    console.error('run-patent-oas: 本次记录与基线不是同一设置,跳过门槛判定;记录已保留,可在同设置下重录基线后比较。')
    return 1
  }

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
