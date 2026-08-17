import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  APPROVAL_GRANTED_KEY,
  GraphBuilder,
  GraphInterruptError,
  InMemoryCheckpointStore,
  JsonFileCheckpointStore,
  grantApproval,
  runGraphWithCheckpoints,
  type GraphCheckpoint,
  type GraphState,
} from '@deepseek-ai/dsh-patent-core'

const node = (key: string, value: unknown) => async (): Promise<GraphState> => ({ [key]: value })

it('InMemoryCheckpointStore: save/load/loadLatest/list', async () => {
  const store = new InMemoryCheckpointStore()
  const cp1: GraphCheckpoint = {
    id: 'g-0',
    graphId: 'g',
    stepIndex: 0,
    state: { a: 1 },
    activeNodes: ['b'],
    createdAt: 1,
  }
  const cp2: GraphCheckpoint = {
    id: 'g-1',
    graphId: 'g',
    stepIndex: 1,
    state: { a: 1, b: 2 },
    activeNodes: ['c'],
    createdAt: 2,
  }
  await store.save(cp1)
  await store.save(cp2)
  expect((await store.load('g-0'))?.state).toEqual({ a: 1 })
  expect(await store.load('missing')).toBeUndefined()
  // loadLatest 取 stepIndex 最大者。
  expect((await store.loadLatest('g'))?.id).toBe('g-1')
  expect(await store.list('g')).toEqual(['g-0', 'g-1'])
})

it('JsonFileCheckpointStore: 序列化 round-trip', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sati-cp-'))
  try {
    const store = new JsonFileCheckpointStore(dir)
    const cp: GraphCheckpoint = {
      id: 'g-3',
      graphId: 'g',
      stepIndex: 3,
      state: { features: ['F1'], nested: { deep: true } },
      activeNodes: ['next'],
      createdAt: 42,
    }
    await store.save(cp)
    const loaded = await store.load('g-3')
    expect(loaded).toEqual(cp)
    expect((await store.loadLatest('g'))?.id).toBe('g-3')
    expect(await store.list('g')).toEqual(['g-3'])
    expect(await store.list('other')).toEqual([])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

it('runGraphWithCheckpoints: 中断后 resume 从正确超步继续', async () => {
  let shouldInterrupt = true
  const builder = new GraphBuilder()
  builder
    .addNode('a', node('a', 1))
    .addNode('gate', async () => {
      if (shouldInterrupt) {
        shouldInterrupt = false
        throw new GraphInterruptError('审批暂停', { review_context: '确认' })
      }
      return { gate_passed: true }
    })
    .addNode('c', node('c', 3))
    .addEdge('a', 'gate')
    .addEdge('gate', 'c')
  const graph = builder.compile('a')
  const store = new InMemoryCheckpointStore()

  // 第一次：gate 中断。
  const first = await runGraphWithCheckpoints(graph, {}, { store, graphId: 'g1' })
  expect(first.result.completed).toBe(false)
  expect(first.result.interrupted?.node).toBe('gate')
  expect(first.checkpointId).toBeTruthy()

  // resume：从最新检查点继续，gate 放行，c 执行。
  const latest = await store.loadLatest('g1')
  expect(latest).toBeTruthy()
  const second = await runGraphWithCheckpoints(graph, {}, { store, graphId: 'g1', resumeFrom: latest! })
  expect(second.result.completed).toBe(true)
  expect(second.result.state.a).toBe(1)
  expect(second.result.state.gate_passed).toBe(true)
  expect(second.result.state.c).toBe(3)
})

it('grantApproval：写入放行标记后 resume 通过审批门（HITL 闭环）', async () => {
  const builder = new GraphBuilder()
  builder
    .addNode('a', node('a', 1))
    .addNode('gate', async ({ state }) => {
      if (!state[APPROVAL_GRANTED_KEY]) {
        throw new GraphInterruptError('审批暂停', { review_context: '确认' })
      }
      return { gate_passed: true }
    })
    .addNode('c', node('c', 3))
    .addEdge('a', 'gate')
    .addEdge('gate', 'c')
  const graph = builder.compile('a')
  const store = new InMemoryCheckpointStore()

  // 第一次：审批门中断，拿到 checkpointId。
  const first = await runGraphWithCheckpoints(graph, {}, { store, graphId: 'g2' })
  expect(first.result.completed).toBe(false)
  expect(first.result.interrupted?.node).toBe('gate')
  expect(first.checkpointId).toBeTruthy()

  // 人工批准：grantApproval 把放行标记写入检查点 state。
  const granted = await grantApproval(store, first.checkpointId!)
  expect(granted).toBeTruthy()
  expect(granted!.state[APPROVAL_GRANTED_KEY]).toBeTruthy()

  // 幂等：重复批准无副作用，放行语义不变。
  const grantedAgain = await grantApproval(store, first.checkpointId!)
  expect(grantedAgain).toBeTruthy()
  expect(grantedAgain!.state[APPROVAL_GRANTED_KEY]).toBe(true)

  // 审批后 resume：审批门放行，后续节点执行（真正通过审批门）。
  const second = await runGraphWithCheckpoints(graph, {}, { store, graphId: 'g2', resumeFrom: granted! })
  expect(second.result.completed).toBe(true)
  expect(second.result.state.gate_passed).toBe(true)
  expect(second.result.state.c).toBe(3)
})

it('grantApproval：检查点不存在返回 undefined', async () => {
  const store = new InMemoryCheckpointStore()
  expect(await grantApproval(store, 'missing')).toBeUndefined()
})

it('runGraphWithCheckpoints: 完成路径亦保存最终态检查点', async () => {
  const builder = new GraphBuilder()
  builder.addNode('a', node('done', true)).addEdge('a', '__end__')
  const graph = builder.compile('a')
  const store = new InMemoryCheckpointStore()
  const { result, checkpointId } = await runGraphWithCheckpoints(graph, {}, { store, graphId: 'g2' })
  expect(result.completed).toBe(true)
  expect(checkpointId).toBeTruthy()
  const cp = await store.load(checkpointId!)
  expect(cp?.activeNodes[0]).toBe('a')
})
