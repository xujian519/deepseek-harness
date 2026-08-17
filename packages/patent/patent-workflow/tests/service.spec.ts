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

      const states = agent.session.events
        .filter(e => e.type === 'patent/plantask')
        .map(e => e.data.state)
      expect(states).toEqual(['awaiting_approval', 'executing'])

      expect(agent.session.events.some(e => e.type === 'approval/asked')).toBe(true)
      expect(agent.session.events.some(e => e.type === 'approval/decided')).toBe(true)
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
      const states = agent.session.events
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
      const events = agent.session.events.filter(e => e.type === 'patent/workflow-run')
      expect(events).toHaveLength(1)
      expect(events[0]!.data.manifestId).toBe('patent_novelty_v1')
      expect(events[0]!.data.summary).toContain('专利新颖性分析')
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
