/**
 * CLI entry point for the legal knowledge import pipeline.
 *
 * Usage:
 *   tsx scripts/legal-knowledge-import/index.ts [options]
 *
 * Options:
 *   --input <dir>     Data source directory (default: ~/projects/宝宸知识库_Raw/Laws-1.0.0)
 *   --output <path>   Output SQLite database path (default: ./legal.db)
 *   --skip-cases      Skip case import
 *   --skip-regulations Skip regulation import (cases only)
 *   --verbose         Enable progress logging
 * @module legal-knowledge-import/index
 */

import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { importRegulations } from './import-to-sqlite.ts'
import { importCases } from './import-cases.ts'

interface CliOptions {
  inputDir: string
  outputPath: string
  skipCases: boolean
  skipRegulations: boolean
  verbose: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const defaults: CliOptions = {
    inputDir: join(homedir(), 'projects', '宝宸知识库_Raw', 'Laws-1.0.0'),
    outputPath: resolve('legal.db'),
    skipCases: false,
    skipRegulations: false,
    verbose: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ''
    if (arg === '--input' && argv[i + 1]) {
      defaults.inputDir = resolve(argv[++i] ?? '')
    } else if (arg === '--output' && argv[i + 1]) {
      defaults.outputPath = resolve(argv[++i] ?? '')
    } else if (arg === '--skip-cases') {
      defaults.skipCases = true
    } else if (arg === '--skip-regulations') {
      defaults.skipRegulations = true
    } else if (arg === '--verbose' || arg === '-v') {
      defaults.verbose = true
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: tsx scripts/legal-knowledge-import/index.ts [options]

Options:
  --input <dir>     Data source directory
  --output <path>   Output SQLite database path
  --skip-cases      Skip case import
  --skip-regulations Skip regulation import
  --verbose, -v     Enable progress logging
  --help, -h        Show this help`)
      process.exit(0)
    }
  }

  return defaults
}

// oxlint-disable-next-line typescript/require-await -- the CLI entry returns a Promise so the top-level catch reports failures
async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const log = opts.verbose ? (msg: string) => { console.log(msg) } : () => {}

  console.log('=== 法律法规数据导入工具 ===')
  console.log(`数据源: ${opts.inputDir}`)
  console.log(`输出: ${opts.outputPath}`)
  console.log()

  const startTime = Date.now()

  if (!opts.skipRegulations) {
    console.log('--- 导入法律法规 ---')
    const regResult = importRegulations(opts.inputDir, opts.outputPath, {
      skipCases: true,
      onProgress: log,
    })
    console.log('\n法规导入结果:')
    console.log(`  扫描文件: ${regResult.filesScanned}`)
    console.log(`  解析法律: ${regResult.lawsParsed}`)
    console.log(`  去重后: ${regResult.lawsAfterDedup}`)
    console.log(`  插入条文: ${regResult.articlesInserted}`)
    console.log(`  解析失败: ${regResult.parseErrors}`)
    console.log()
  }

  if (!opts.skipCases) {
    console.log('--- 导入案例 ---')
    const caseResult = importCases(opts.inputDir, opts.outputPath, {
      onProgress: log,
    })
    console.log('\n案例导入结果:')
    console.log(`  扫描文件: ${caseResult.filesScanned}`)
    console.log(`  导入成功: ${caseResult.casesImported}`)
    console.log(`  解析失败: ${caseResult.parseErrors}`)
    console.log()
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`=== 导入完成 (${elapsed}s) ===`)
  console.log(`数据库: ${opts.outputPath}`)
}

main().catch((err: unknown) => {
  console.error('导入失败:', err)
  process.exit(1)
})
