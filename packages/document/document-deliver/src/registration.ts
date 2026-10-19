/**
 * Registration helpers for `document_deliver`: the quality-gate P0 checklist,
 * the format a declared path is read as, the reasons an unreadable file must
 * carry, and the brief reference probe.
 *
 * These run inside the tool's execute path and read the contract types from
 * {@link ./tool.ts}; keeping them here leaves the tool factory to the schema
 * and the orchestration of one registration.
 * @module @deepseek-ai/dsh-document-deliver/registration
 */

import { extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { errorMessage } from '@deepseek-ai/dsh-value'
import type { DeliverableCheckReport, DeliverableFormat, DocumentDeliverSpec } from './tool.ts'

/** One quality-gate P0 item: the stable id a call reports and the label it stands for. */
export interface P0ChecklistEntry {
  /** Stable id written in `gate.p0` and named back in a diagnostic. */
  readonly id: string
  /** Chinese label the delivery checklist and every diagnostic use. */
  readonly label: string
}

/**
 * The delivery quality gate's P0 checklist, in the order the skill prints it.
 *
 * These ids are a product constant, not a deployment tunable: they mirror the
 * list `packages/bundle/web-app/skills/document/document-quality-gate/SKILL.md`
 * prints, and `tests/document-deliver.spec.ts` fails when the two sets drift
 * apart. A registration naming one of them is compared against the whole set so
 * the result can name what the call left out; a name outside the set is
 * reported as unknown rather than refused, which keeps a transcript recorded
 * before the ids existed replayable.
 */
export const P0_CHECKLIST: readonly P0ChecklistEntry[] = [
  { id: 'P0-1', label: '命名' },
  { id: 'P0-2', label: '自包含' },
  { id: 'P0-3', label: '无占位残留' },
  { id: 'P0-4', label: '断链' },
  { id: 'P0-5', label: '来源' },
  { id: 'P0-6', label: '语言' },
]

/**
 * Extension to the format the checker reads that file with, lowercased.
 *
 * Only extensions whose reading is not in doubt appear here. A claimed format
 * the extension contradicts is read the way the extension says: the bytes on
 * disk decide what a reader is able to do with them, and the caller's label is
 * a claim about those bytes.
 */
const FORMAT_BY_EXTENSION: Readonly<Record<string, DeliverableFormat>> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.html': 'html',
  '.htm': 'html',
  '.docx': 'docx',
  '.pdf': 'pdf',
  '.pptx': 'pptx',
}

/** The format one report reads a file as, plus the contradiction when the declaration disagrees. */
export interface ResolvedCheckFormat {
  /** Format the checks read the file as. */
  readonly format: DeliverableFormat
  /** Declaration-versus-extension text, absent when the two agree. */
  readonly mismatch?: string
}

/**
 * Resolve the format a declared path is checked as.
 *
 * A declaration of `other` keeps today's behaviour: the call says the file has
 * no reading, so no extension is allowed to contradict it (a `.dat` attachment
 * is the caller's call to make). Otherwise a known extension wins over the
 * declaration and says so, and an unknown or absent extension leaves the
 * declaration standing.
 * @param path - the registered path, as the call declared it.
 * @param declared - the format the call declared.
 * @returns the format to read the file as, and the mismatch text when the declaration was contradicted.
 */
export function resolveCheckFormat(path: string, declared: DeliverableFormat): ResolvedCheckFormat {
  if (declared === 'other') return { format: declared }
  const extension = extname(path).toLowerCase()
  const expected = FORMAT_BY_EXTENSION[extension]
  if (expected === undefined || expected === declared) return { format: declared }
  return {
    format: expected,
    mismatch: `声明格式 ${declared} 与扩展名 ${extension} 不一致，已按 ${expected} 核验`,
  }
}

/** One declared reason for registering a file the checker could not read. */
export interface UnreadableAckInput {
  /** Path the reason belongs to; must match a registered file. */
  path: string
  /** Why the file still ships unread; kept in the result beside the check outcome. */
  reason_text: string
}

/**
 * Compare the P0 ids a call reported with the gate's checklist.
 *
 * A name outside the checklist is reported as unknown rather than refused: a
 * transcript recorded before the ids existed still replays, and a model that
 * guessed a wording learns the id without losing the registration. Every id
 * the call left out is named, because "one of six" and "six of six" are the
 * same count in a transcript and different claims about the delivery.
 * @param p0 - the P0 items the call reported.
 * @returns one warning line per unknown id and one naming the ids the call left out.
 */
export function p0ChecklistWarnings(p0: readonly string[]): string[] {
  const known = new Set(P0_CHECKLIST.map(entry => entry.id))
  const reported = new Set(p0)
  const warnings: string[] = []
  for (const item of p0) {
    if (known.has(item)) continue
    warnings.push(`未知的 P0 项 ${JSON.stringify(item)}：本技能 P0 清单用稳定 id（${P0_CHECKLIST.map(entry => `${entry.id} ${entry.label}`).join('、')}）`)
  }
  const missing = P0_CHECKLIST.filter(entry => !reported.has(entry.id))
  const present = P0_CHECKLIST.filter(entry => reported.has(entry.id))
  if (missing.length > 0 && present.length > 0) {
    warnings.push(`缺少 P0 项：${missing.map(entry => `${entry.id} ${entry.label}`).join('、')}`)
  }
  return warnings
}

/**
 * Report a brief reference that names no readable file.
 *
 * The brief is context, not a deliverable: a session may legitimately deliver
 * after its brief was cleaned up, so a missing brief never refuses the
 * registration — the result reports it and the delivery summary is the place
 * to correct it.
 * @param ctx - plugin context carrying `ctx.fs`.
 * @param exec - the current tool execution (signal, agent).
 * @param briefRef - the brief path the call declared.
 * @returns one warning line, or none when the brief exists.
 */
export async function briefReferenceWarnings(
  ctx: Context, exec: ToolRunContext, briefRef: string,
): Promise<string[]> {
  try {
    const target = await resolveTarget(ctx, exec, briefRef)
    const info = await ctx.fs.stat(target, exec.signal)
    if (info !== undefined) return []
  } catch (error) {
    return [`brief 参考文件无法读取，登记继续但要修正或省略：${briefRef}（${errorMessage(error)}）`]
  }
  return [`brief 参考文件不存在，登记继续但要修正或省略：${briefRef}`]
}

/**
 * Prefix this tool writes into a reason when the read stopped at `maxCheckBytes`.
 *
 * The cap is a deployment budget rather than a defect in the document, so that
 * reason needs no declared explanation; detecting it here by this tool's own
 * marker keeps the decision independent of any backend's error wording.
 */
export const READ_CAP_REASON_PREFIX = '超过读取上限（too-large）：'

/** The DOCX reader's code for a package that exceeds this deployment's archive budgets. */
const DOCX_BUDGET_PROBLEM = 'too-large'

/**
 * Whether the checker refused a file at a deployment budget rather than failing on its content.
 *
 * Both budgets are `Config` values: the byte cap this tool passes to
 * `ctx.fs.readBytes`, and the DOCX archive budgets it passes to
 * `extractDocxText`. Hitting either says nothing about the document, so the
 * file registers with the budget named in its reason; `not-a-zip`,
 * `malformed-xml`, and `no-text` are properties of the document and still need
 * a declared reason.
 * @param report - the check report of one unreadable file.
 * @returns true when a deployment budget, not the document, stopped the check.
 */
function stoppedAtDeploymentBudget(report: DeliverableCheckReport): boolean {
  const reason = report.reason ?? ''
  // The cap marker is this tool's own prefix on any format's read failure. The
  // DOCX archive code is matched only for a DOCX report: that reason is the
  // reader's problem list, while a text report's reason quotes the source path,
  // where the word could occur in a file name that failed for another reason.
  return reason.includes(READ_CAP_REASON_PREFIX)
    || (report.format === 'docx' && reason.includes(DOCX_BUDGET_PROBLEM))
}

/** What to do about one file the checker could not read, chosen from its reason. */
function unreadableAdvice(report: DeliverableCheckReport): string {
  const reason = report.reason ?? ''
  if (reason.includes('not-a-zip')) return '这不是有效的 docx 包：重新渲染或检查写盘方式'
  if (reason.includes('no-text')) return '包内没有可读正文：检查是否只写了页眉、图片或空正文'
  if (reason.includes('malformed-xml')) return '包内 XML 无法解析：重新渲染该文件'
  return '修复文件后重新登记'
}

/**
 * Require a declared reason for every file the checker could not read.
 *
 * "Not checked" must not read as "checked": an unreadable file is refused
 * unless the call says why it still ships, and the reason is kept beside the
 * check outcome so a reader of the log sees the trade the caller made. The one
 * exception is the deployment's own read cap, which says nothing about the
 * document; an oversized file registers with the cap named in its reason.
 * @param spec - the validated registration, carrying any declared reasons.
 * @param reports - one check report per declared file, in declaration order.
 * @returns the reports with their declared reasons attached, plus warnings for reasons that matched nothing.
 * @throws Error naming every file that needs a reason and what to do about it.
 */
export function resolveUnreadableReports(
  spec: DocumentDeliverSpec, reports: readonly DeliverableCheckReport[],
): { reports: DeliverableCheckReport[]; warnings: string[] } {
  const ackByPath = new Map((spec.unreadableAck ?? []).map(entry => [entry.path, entry.reasonText]))
  const resolved: DeliverableCheckReport[] = []
  const needed: DeliverableCheckReport[] = []
  for (const report of reports) {
    if (report.status !== 'unreadable') {
      resolved.push(report)
      continue
    }
    const ack = ackByPath.get(report.path)
    if (ack !== undefined) {
      resolved.push({ ...report, ack })
      continue
    }
    if (stoppedAtDeploymentBudget(report)) {
      resolved.push(report)
      continue
    }
    needed.push(report)
    resolved.push(report)
  }
  if (needed.length > 0) {
    throw new Error([
      'document_deliver: 以下交付文件无法核验，且没有 unreadable_ack 说明原因：',
      ...needed.map(report => `- ${report.path}：${report.reason ?? '读取失败'} → ${unreadableAdvice(report)}`),
      '给每个文件补一条 unreadable_ack（path + reason_text）说明为什么仍要交付；修复文件后重新登记也可以。',
    ].join('\n'))
  }
  const unreadablePaths = new Set(reports.filter(report => report.status === 'unreadable').map(report => report.path))
  const declaredPaths = new Set(reports.map(report => report.path))
  const warnings: string[] = []
  for (const path of ackByPath.keys()) {
    if (!declaredPaths.has(path)) {
      warnings.push(`unreadable_ack 指向未登记的路径：${path}`)
      continue
    }
    if (!unreadablePaths.has(path)) warnings.push(`unreadable_ack 的 ${path} 不是无法核验状态，不需要说明原因`)
  }
  return { reports: resolved, warnings }
}


/**
 * Resolve one registered path against the calling session's workspace.
 * @param ctx - plugin context carrying `ctx.fs`.
 * @param exec - the current tool execution (signal, agent).
 * @param path - the path as the call declared it.
 * @returns the resolved target.
 */
export async function resolveTarget(
  ctx: Context, exec: ToolRunContext, path: string,
): Promise<FsTarget> {
  const cwd = exec.agent?.session.header.cwd
  return ctx.fs.resolve(path, {
    ...cwd !== undefined ? { cwd } : {},
    signal: exec.signal,
  })
}
