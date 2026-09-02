// Real-service test: mounts the patent-workflow service on a real Context with a
// real approval provider (dsh-user-approval + a fake answerer) and a real
// Session, drives a plantask run, and asserts the approval_pending -> approve
// -> resume flow and the patent/* session events on the real session log.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { registerBuiltinAtoms } from '@deepseek-ai/dsh-patent-core'
import PatentWorkflow, { patentNoveltyManifest } from '@deepseek-ai/dsh-patent-workflow'

// 镜像生产装配（B1）：内置原子注册进全局注册表，novelty 等 manifest 的 atom 阶段才能通过 fail-fast。
registerBuiltinAtoms()

function makeAgent(id: string): { session: Session } {
  const session = Session.create(SessionId(id))
  session.append('turn/start', { turn: 1 })
  return { session }
}

function okExecutor(stage: { id: string }): Promise<string> {
  return Promise.resolve('[' + stage.id + '] 完成')
}

describe('PatentWorkflow service', () => {
  it('drives a plantask run through approval_pending -> approve -> resume', async () => {
    const ctx = new Context()
    await ctx.plugin(ApprovalService)
    await ctx.plugin(PatentWorkflow)
    try {
      const agent = makeAgent('plantask-approve')
      ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))

      const result = await ctx.patentWorkflow.runPlantask(agent, 'case-1', ['解析交底书', '检索现有技术'])

      expect(result.state).toBe('executing')
      expect(result.approvalOutcome).toBe('allowed-once')
      expect(result.tasks).toHaveLength(2)

      const states = agent.session.snapshotEvents()
        .filter(e => e.type === 'patent/plantask')
        .map(e => e.data.state)
      expect(states).toEqual(['awaiting_approval', 'executing'])

      expect(agent.session.snapshotEvents().some(e => e.type === 'approval/asked')).toBe(true)
      expect(agent.session.snapshotEvents().some(e => e.type === 'approval/decided')).toBe(true)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('fails closed (replanning) when no approval answerer is composed', async () => {
    const ctx = new Context()
    await ctx.plugin(ApprovalService)
    await ctx.plugin(PatentWorkflow)
    try {
      const agent = makeAgent('plantask-no-answerer')
      const result = await ctx.patentWorkflow.runPlantask(agent, 'case-2', ['步骤A'])

      expect(result.state).toBe('replanning')
      expect(result.approvalOutcome).toBe('unavailable')
      const states = agent.session.snapshotEvents()
        .filter(e => e.type === 'patent/plantask')
        .map(e => e.data.state)
      expect(states).toEqual(['awaiting_approval', 'replanning'])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('supports an out-of-band approve/reject decision entry', async () => {
    const ctx = new Context()
    await ctx.plugin(ApprovalService)
    await ctx.plugin(PatentWorkflow)
    try {
      const agent = makeAgent('plantask-oob')
      const pending = await ctx.patentWorkflow.runPlantask(agent, 'case-3', ['步骤A', '步骤B'], { autoApprove: false })
      expect(pending.state).toBe('awaiting_approval')

      const approved = ctx.patentWorkflow.approve('case-3')
      expect(approved.state).toBe('executing')
      expect(approved.approvalOutcome).toBe('allowed-once')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('records a workflow run as a patent/workflow-run session event', async () => {
    const ctx = new Context()
    await ctx.plugin(PatentWorkflow)
    try {
      const agent = makeAgent('workflow-run')
      const result = await ctx.patentWorkflow.runWorkflow(patentNoveltyManifest, { input: '一种装置' }, okExecutor, { approvalGrants: ['approval'] }, agent)

      expect(result.completed).toBe(true)
      const events = agent.session.snapshotEvents().filter(e => e.type === 'patent/workflow-run')
      expect(events).toHaveLength(1)
      expect(events[0]!.data.manifestId).toBe('patent_novelty_v1')
      expect(events[0]!.data.summary).toContain('专利新颖性分析')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('runWorkflow without an agent records no session event; runId travels with the event', async () => {
    const ctx = new Context()
    await ctx.plugin(PatentWorkflow)
    try {
      const noAgent = await ctx.patentWorkflow.runWorkflow(
        patentNoveltyManifest, { input: '一种装置' }, okExecutor, { approvalGrants: ['approval'] },
      )
      expect(noAgent.completed).toBe(true)

      const agent = makeAgent('workflow-run-id')
      const withRunId = await ctx.patentWorkflow.runWorkflow(
        patentNoveltyManifest, { input: '一种装置' }, okExecutor,
        { runId: 'run-42', approvalGrants: ['approval'] }, agent,
      )
      expect(withRunId.completed).toBe(true)
      const events = agent.session.snapshotEvents().filter(e => e.type === 'patent/workflow-run')
      expect(events).toHaveLength(1)
      expect(events[0]!.data.runId).toBe('run-42')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('runPlantask rejects a duplicate pending caseId (no overwrite)', async () => {
    const ctx = new Context()
    await ctx.plugin(PatentWorkflow)
    try {
      const agent = makeAgent('plantask-duplicate')
      await ctx.patentWorkflow.runPlantask(agent, 'case-dup', ['步骤A'], { autoApprove: false })
      await expect(ctx.patentWorkflow.runPlantask(agent, 'case-dup', ['步骤B'], { autoApprove: false }))
        .rejects.toThrow(/已有挂起的 plantask/)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('fails closed to replanning when no approval service is composed at all', async () => {
    const ctx = new Context()
    await ctx.plugin(PatentWorkflow)
    try {
      const agent = makeAgent('plantask-no-service')
      const result = await ctx.patentWorkflow.runPlantask(agent, 'case-none', ['步骤A'])
      expect(result.state).toBe('replanning')
      expect(result.approvalOutcome).toBe('unavailable')
      // 拒绝反馈未显式传入 → 结果不含 feedback 字段（驱动迁移的默认文案不进结果）。
      expect(result.feedback).toBeUndefined()
      const states = agent.session.snapshotEvents()
        .filter(e => e.type === 'patent/plantask')
        .map(e => e.data.state)
      expect(states).toEqual(['awaiting_approval', 'replanning'])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('a cancelled approval decision replans with the cancellation feedback', async () => {
    const ctx = new Context()
    await ctx.plugin(PatentWorkflow)
    try {
      ctx.provide('approval', { request: async () => 'cancelled' as const })
      const agent = makeAgent('plantask-cancelled')
      const result = await ctx.patentWorkflow.runPlantask(agent, 'case-cancel', ['步骤A'])
      expect(result.state).toBe('replanning')
      expect(result.approvalOutcome).toBe('cancelled')
      expect(result.feedback).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('reject with and without feedback drives the replanning transition', async () => {
    const ctx = new Context()
    await ctx.plugin(PatentWorkflow)
    try {
      const agent = makeAgent('plantask-reject')
      await ctx.patentWorkflow.runPlantask(agent, 'case-reject', ['步骤A'], { autoApprove: false })

      const blank = ctx.patentWorkflow.reject('case-reject', '   ')
      expect(blank.state).toBe('replanning')
      expect(blank.approvalOutcome).toBe('rejected')
      // 空白反馈原样透传（驱动迁移的反馈由 rejectionFeedback 兜底为默认文案）。
      expect(blank.feedback).toBe('   ')

      await ctx.patentWorkflow.runPlantask(agent, 'case-reject-2', ['步骤A'], { autoApprove: false })
      const withFeedback = ctx.patentWorkflow.reject('case-reject-2', '对比文件不足')
      expect(withFeedback.state).toBe('replanning')
      expect(withFeedback.feedback).toBe('对比文件不足')

      await ctx.patentWorkflow.runPlantask(agent, 'case-reject-3', ['步骤A'], { autoApprove: false })
      const silent = ctx.patentWorkflow.reject('case-reject-3')
      expect(silent.state).toBe('replanning')
      expect(silent.feedback).toBeUndefined()
      expect(silent.approvalOutcome).toBe('rejected')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('approve/reject on a case without a pending plantask throw', async () => {
    const ctx = new Context()
    await ctx.plugin(PatentWorkflow)
    try {
      expect(() => ctx.patentWorkflow.approve('ghost-case')).toThrow(/no pending plantask/)
      expect(() => ctx.patentWorkflow.reject('ghost-case')).toThrow(/no pending plantask/)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('runPlantask cleans up the pending entry when approval.request throws (caseId stays retryable)', async () => {
    const ctx = new Context()
    await ctx.plugin(PatentWorkflow)
    // 抛错的 approval 服务：runPlantask 必须先落 pending 再请求，抛错后必须清掉。
    ctx.provide('approval', { request: async () => { throw new Error('approval unavailable') } })
    try {
      const agent = makeAgent('plantask-throw')
      await expect(ctx.patentWorkflow.runPlantask(agent, 'case-throw', ['解析交底书']))
        .rejects.toThrow('approval unavailable')
      // pending 已清理：同 caseId 可再次发起（不会被"已有挂起 plantask"锁死）。
      const again = await ctx.patentWorkflow.runPlantask(agent, 'case-throw', ['解析交底书'], { autoApprove: false })
      expect(again.state).toBe('awaiting_approval')
      expect(again.caseId).toBe('case-throw')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('removes ctx.patentWorkflow when its fiber disposes (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(ApprovalService)
    const fiber = ctx.plugin(PatentWorkflow)
    await fiber
    expect(ctx.patentWorkflow).toBeInstanceOf(PatentWorkflow)
    await fiber.dispose()
    expect(ctx.get('patentWorkflow')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
