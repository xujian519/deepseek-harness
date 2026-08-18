import { expect, it } from 'vitest'
import { GraphMergeError, mergeWithSchema, type GraphState } from '@deepseek-ai/dsh-patent-core'

const results = (entries: Array<[string, GraphState]>): Array<{ node: string; delta: GraphState }> =>
  entries.map(([node, delta]) => ({ node, delta }))

it('mergeWithSchema LWW: 节点名字典序后者覆盖（确定性）', () => {
  const state: GraphState = {}
  // "a_node" < "b_node"：字典序后者 b_node 胜出。
  mergeWithSchema(
    state,
    results([
      ['b_node', { key: 'b' }],
      ['a_node', { key: 'a' }],
    ]),
    {},
  )
  expect(state.key).toBe('b')
})

it('mergeWithSchema LWW: 未注册 key 回落 last_write_wins', () => {
  const state: GraphState = { k: 1 }
  mergeWithSchema(state, results([['n1', { k: 2 }]]), { other: 'append' })
  expect(state.k).toBe(2)
})

it('mergeWithSchema append: 追加到已有数组', () => {
  const state: GraphState = { list: ['a'] }
  mergeWithSchema(state, results([['n1', { list: 'b' }]]), { list: 'append' })
  expect(state.list).toEqual(['a', 'b'])
})

it('mergeWithSchema append: 非数组既有值视为空数组', () => {
  const state: GraphState = { list: 'x' }
  mergeWithSchema(state, results([['n1', { list: 'b' }]]), { list: 'append' })
  expect(state.list).toEqual(['b'])
})

it('mergeWithSchema union: 数组合并去重保持顺序', () => {
  const state: GraphState = { list: ['a', 'b'] }
  mergeWithSchema(
    state,
    results([
      ['n1', { list: ['b', 'c'] }],
      ['n2', { list: 'a' }],
    ]),
    { list: 'union' },
  )
  expect(state.list).toEqual(['a', 'b', 'c'])
})

it('mergeWithSchema merge_map: map 浅合并', () => {
  const state: GraphState = { m: { x: 1 } }
  mergeWithSchema(state, results([['n1', { m: { y: 2 } }]]), { m: 'merge_map' })
  expect(state.m).toEqual({ x: 1, y: 2 })
})

it('mergeWithSchema fail_on_conflict: 同 key 重复写入抛错', () => {
  const state: GraphState = { k: 1 }
  expect(() => { mergeWithSchema(state, results([['n1', { k: 2 }]]), { k: 'fail_on_conflict' }) }).toThrow(GraphMergeError)
})

it('mergeWithSchema fail_on_conflict: 首次写入不冲突', () => {
  const state: GraphState = {}
  mergeWithSchema(state, results([['n1', { k: 2 }]]), { k: 'fail_on_conflict' })
  expect(state.k).toBe(2)
})

it('mergeWithSchema: 未知 reducer 抛错', () => {
  const state: GraphState = {}
  expect(() => { mergeWithSchema(state, results([['n1', { k: 1 }]]), { k: 'bogus' as never }) }).toThrow(/未知 Reducer/)
})
