/**
 * CNIPR（中国知识产权网）通道：在注入的 ego 会话上运行脚本，把收据映射成号码级结果。
 *
 * 通道只做三件事——可用性检查、脚本运行、收据映射；页面交互在 `cnipr-script.ts` 生成的
 * 脚本里，解析在 `cnipr-receipt.ts` 的纯函数里。号码级失败（某个号检索不到、解析不出
 * 申请号）按条目回报，不中断同批其余号；通道级失败（ego 不可用、超时、脚本没回执、
 * 登录态失效）抛 {@link CniprChannelError}，由调用方决定是否按号回退到别的通道。
 * @module @deepseek-ai/dsh-patent-data/cnipr-channel
 */

import { CNIPR_LEGAL_TAG, CNIPR_PDF_TAG, buildCniprLegalScript, buildCniprPdfLinksScript } from './cnipr-script.ts'
import {
  alignCniprResults,
  planCniprLegalQueries,
  planCniprPdfRequests,
  readCniprLegalPayload,
  readCniprPdfLinksPayload,
} from './cnipr-receipt.ts'
import type {
  CniprCallOptions,
  CniprChannelOptions,
  CniprEgoSession,
  CniprFailureCode,
  CniprLegalStatusItem,
  CniprPdfLinkItem,
} from './types.ts'

/** 脚本没有回传收据时附在原因里的输出长度（诊断用，避免把整段输出塞进错误）。 */
const OUTPUT_TAIL_LENGTH = 400

/** 请求过但脚本没有回报的号：按缺失处理，不静默丢弃。 */
function cniprPdfMissing(number: string): CniprPdfLinkItem {
  return { number, urls: [], unexamined: false, authorized: false, error: '脚本未回报该号' }
}

/** 请求过但脚本没有回报的号（法律状态）。 */
function cniprLegalMissing(number: string): CniprLegalStatusItem {
  return { number, appNumber: '', total: null, records: [], error: '脚本未回报该号' }
}

/**
 * CNIPR 通道的失败。分类让调用方按码路由（`login_required` 要用户去登录，`setup_required`
 * 要装 ego lite，`page_state`/`receipt_missing` 是站点或运行时变化），`detail` 保留原样原因。
 */
export class CniprChannelError extends Error {
  /** 失败分类。 */
  readonly code: CniprFailureCode
  /** 原样原因（脚本回报的消息或会话给出的原因）。 */
  readonly detail: string

  /**
   * @param code - 失败分类。
   * @param detail - 原样原因。
   */
  constructor(code: CniprFailureCode, detail: string) {
    super(`CNIPR 通道失败（${code}）：${detail}`)
    this.name = 'CniprChannelError'
    this.code = code
    this.detail = detail
  }
}

/**
 * CNIPR 通道：按名复用同一个 ego 任务空间，因此登录态由 ego lite 提供、本通道不做登录。
 */
export class CniprChannel {
  private readonly session: CniprEgoSession
  private readonly timeoutMs: number | undefined
  private readonly cwd: string

  /**
   * @param options - 注入的 ego 会话、单次运行的期限与工作目录。
   */
  constructor(options: CniprChannelOptions) {
    this.session = options.session
    this.timeoutMs = options.timeoutMs
    this.cwd = options.cwd ?? process.cwd()
  }

  /**
   * 按公开(公告)号取全文 PDF 直链。非公开号形态的号不发给脚本，按条目报错。
   * @param numbers - 公开(公告)号列表（调用方已归一去重）。
   * @param options - 本次调用的取消信号与期限覆盖。
   * @returns 与请求顺序一一对应的每条号结果。
   */
  async pdfLinks(numbers: readonly string[], options: CniprCallOptions = {}): Promise<CniprPdfLinkItem[]> {
    const { requested, unsupported } = planCniprPdfRequests(numbers)
    if (requested.length === 0) return alignCniprResults(numbers, unsupported, cniprPdfMissing)
    const payload = await this.run(buildCniprPdfLinksScript(requested), CNIPR_PDF_TAG, options)
    const read = readCniprPdfLinksPayload(payload)
    if (read.failure !== undefined) throw new CniprChannelError(read.failure.code, read.failure.message)
    return alignCniprResults(numbers, [...read.items, ...unsupported], cniprPdfMissing)
  }

  /**
   * 查询 CN 号的法律状态：申请号直接查，公开(公告)号先解析申请号；非中国号形态的号
   * 不发给脚本，按条目报错。
   * @param numbers - 申请号或公开(公告)号列表（调用方已归一去重）。
   * @param options - 本次调用的取消信号与期限覆盖。
   * @returns 与请求顺序一一对应的每条号结果。
   */
  async legalStatus(numbers: readonly string[], options: CniprCallOptions = {}): Promise<CniprLegalStatusItem[]> {
    const { queries, unsupported } = planCniprLegalQueries(numbers)
    if (queries.length === 0) return alignCniprResults(numbers, unsupported, cniprLegalMissing)
    const payload = await this.run(buildCniprLegalScript(queries), CNIPR_LEGAL_TAG, options)
    const read = readCniprLegalPayload(payload)
    if (read.failure !== undefined) throw new CniprChannelError(read.failure.code, read.failure.message)
    return alignCniprResults(numbers, [...read.items, ...unsupported], cniprLegalMissing)
  }

  /** 运行一个脚本并取回未校验的载荷；通道级失败在这里分类。 */
  private async run(script: string, tag: string, options: CniprCallOptions): Promise<unknown> {
    const availability = this.session.checkAvailability()
    if (!availability.ok) {
      throw new CniprChannelError('setup_required', availability.reason ?? 'ego-browser 不可用；请先安装 ego lite 并完成首次引导。')
    }
    const timeoutMs = options.timeoutMs ?? this.timeoutMs
    const result = await this.session.runScript(script, {
      cwd: this.cwd,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    if (result.timedOut) {
      throw new CniprChannelError('timeout', `CNIPR 脚本超出期限（exit ${result.exitCode ?? 'null'}）`)
    }
    const payload = this.session.extractTaggedJson(result.output, tag)
    if (payload === null || payload === undefined) {
      throw new CniprChannelError(
        'receipt_missing',
        `脚本未回传 ${tag} 收据（exit ${result.exitCode ?? 'null'}）：${result.output.slice(-OUTPUT_TAIL_LENGTH)}`,
      )
    }
    return payload
  }
}
