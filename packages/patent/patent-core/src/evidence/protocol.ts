/**
 * 工具执行证据观测接口（通用层，无领域知识）。
 *
 * SatiEvidenceCollector 由 ToolRuntime 在每次工具执行后调用（成功/失败均记录），
 * 实现方（如专利域 EvidenceExtension）把它转成证据账本（Ledger）——
 * 证据闭环"自动收集"阶段的基础。设计对齐 Mady agentcore/evidence/receipt.go。
 */

import { isRecord } from '@deepseek-ai/dsh-value'

/** One evidence receipt produced by a SATI tool call, keyed by its tool-call id. */
export type SatiEvidenceReceipt = {
  /** 工具调用 id（与 SatiToolResult.toolCallId 对应） */
  toolCallId: string
  turnId: string
  toolName: string
  /** 工具入参（原始） */
  args: unknown
  success: boolean
  startedAt: string
  /** 涉及的文件路径（可定位证据来源；无则省略） */
  path?: string
  /** 是否写操作（write/edit 及其带前缀的变体、带写入意图的 shell）；false = 读/检索 */
  write: boolean
  /** 工具结果文本摘录（供证据 snippet 复用） */
  resultText?: string
}

/** 工具执行证据观测接口：每次工具执行后接收一条收据。 */
export type SatiEvidenceCollector = {
  recordReceipt(receipt: SatiEvidenceReceipt): void
}

/** 写入型工具的精确名（本 harness 的 `@deepseek-ai/dsh-tool-fs` 工具）。 */
const WRITE_TOOL_NAMES = new Set(['write', 'edit'])
/** 写入型工具的前缀族：覆盖 `write_file` 这类带后缀的命名（含 MCP 服务器发布的名字）。 */
const WRITE_TOOL_PREFIXES = [
  'write_',
  'edit_',
  'append_',
  'create_',
  'delete_',
  'move_',
  'copy_',
  'rename_',
  'mkdir_',
  'patch_',
]
const PATH_KEYS = ['path', 'file_path', 'file', 'target_path', 'destination', 'output_path']

function extractPath(args: Record<string, unknown>): string | undefined {
  for (const key of PATH_KEYS) {
    const v = args[key]
    if (typeof v === 'string' && v.trim().length > 0) return v
  }
  return undefined
}

/**
 * 取用于写入判定的名字段：MCP 工具名形如 `mcp__<server>__<name>`，动作名在最后一段，
 * 因此按最后一段匹配，`write` 与 `mcp__fs__write_file` 都能识别。
 * @param toolName - 注册的工具名。
 * @returns 用于写入判定的名字段。
 */
function writeName(toolName: string): string {
  return toolName.includes('__') ? toolName.slice(toolName.lastIndexOf('__') + 2) : toolName
}

function isWriteTool(toolName: string, args: Record<string, unknown>): boolean {
  const name = writeName(toolName)
  if (WRITE_TOOL_NAMES.has(name) || WRITE_TOOL_PREFIXES.some(prefix => name.startsWith(prefix))) return true
  // bash 等执行类工具：仅当带写入意图时标记（保守判定，避免误标检索）
  if (name === 'bash' || name === 'execute_code') {
    const cmd = args['command'] ?? args['code'] ?? ''
    if (typeof cmd === 'string' && /(>|>>|tee|sed\s+-i|mv|cp|rm|mkdir|touch)/.test(cmd)) return true
  }
  return false
}

/**
 * 从工具执行上下文构造 Receipt（通用适配器，无领域知识）。
 * - path：从常见路径字段提取（可定位证据来源）
 * - write：按写工具白名单/写入意图判定
 * - resultText：结果摘录（截断至 2000 字符）
 * @param input - 工具执行上下文（调用 id、turn、工具名、入参、成败、时间戳、结果摘录）。
 * @returns 构造出的证据收据。
 */
export function receiptFromToolExecution(input: {
  toolCallId: string
  turnId: string
  toolName: string
  args: unknown
  success: boolean
  startedAt: string
  resultText?: string
}): SatiEvidenceReceipt {
  const args = input.args ?? {}
  const record = isRecord(args) ? args : {}
  const path = extractPath(record)
  return {
    toolCallId: input.toolCallId,
    turnId: input.turnId,
    toolName: input.toolName,
    args,
    success: input.success,
    startedAt: input.startedAt,
    ...(path !== undefined ? { path } : {}),
    write: isWriteTool(input.toolName, record),
    ...(input.resultText !== undefined && input.resultText.length > 0
      ? { resultText: input.resultText.slice(0, 2000) }
      : {}),
  }
}
