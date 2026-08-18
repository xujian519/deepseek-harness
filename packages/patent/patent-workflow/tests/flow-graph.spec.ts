import { describe, expect, it } from 'vitest'
import { FlowGraph, type FlowNode } from '@deepseek-ai/dsh-patent-workflow'

function node(id: string, name = id): FlowNode {
  return { id, type: 'agent', name }
}

describe('FlowGraph', () => {
  it('addNode/hasNode/outgoing/incoming expose the built structure', () => {
    const graph = new FlowGraph()
    graph.addNode(node('a'))
    graph.addNode(node('b'))
    expect(graph.hasNode('a')).toBe(true)
    expect(graph.hasNode('ghost')).toBe(false)
    graph.addEdge({ from: 'a', to: 'b' })
    expect(graph.outgoing('a').map(e => e.to)).toEqual(['b'])
    expect(graph.outgoing('b')).toEqual([])
    expect(graph.incoming('b').map(e => e.from)).toEqual(['a'])
    expect(graph.incoming('a')).toEqual([])
  })

  it('addEdge rejects edges referencing unknown nodes (fail-closed)', () => {
    const graph = new FlowGraph()
    graph.addNode(node('a'))
    expect(() => { graph.addEdge({ from: 'a', to: 'ghost' }) }).toThrow(/references an unknown node/)
    expect(() => { graph.addEdge({ from: 'ghost', to: 'a' }) }).toThrow(/references an unknown node/)
  })

  it('detectCycle reports the cycle path for a back edge', () => {
    const graph = new FlowGraph()
    graph.addNode(node('a'))
    graph.addNode(node('b'))
    graph.addNode(node('c'))
    graph.addEdge({ from: 'a', to: 'b' })
    graph.addEdge({ from: 'b', to: 'c' })
    graph.addEdge({ from: 'c', to: 'a' })
    const cycle = graph.detectCycle()
    expect(cycle).not.toBeNull()
    expect(cycle!.join('->')).toBe('a->b->c->a')
    expect(new Set(cycle).size).toBe(3)
  })

  it('detectCycle returns null on a diamond and reuses visited nodes', () => {
    const graph = new FlowGraph()
    graph.addNode(node('a'))
    graph.addNode(node('b'))
    graph.addNode(node('c'))
    graph.addEdge({ from: 'a', to: 'b' })
    graph.addEdge({ from: 'a', to: 'c' })
    graph.addEdge({ from: 'b', to: 'c' })
    expect(graph.detectCycle()).toBeNull()
    expect(graph.topologicalLevels()).toEqual([['a'], ['b'], ['c']])
  })

  it('topologicalLevels throws when a cycle makes nodes unschedulable', () => {
    const graph = new FlowGraph()
    graph.addNode(node('a'))
    graph.addNode(node('b'))
    graph.addEdge({ from: 'a', to: 'b' })
    graph.addEdge({ from: 'b', to: 'a' })
    expect(() => graph.topologicalLevels()).toThrow(/cycle detected/)
  })

  it('topologicalLevels defaults desynced edge endpoints instead of crashing', () => {
    const graph = new FlowGraph()
    graph.addNode(node('a'))
    // 模拟内部状态被破坏：边引用了一个不存在的节点（API 层不可能产生）。
    // to getter 先后返回两个幽灵节点：第一个在入度累计时可见，第二个在出边遍历时可见，
    // 覆盖 `?? 0` / `?? 1` / `?? []` 三条防御默认值，并最终以 cycle-detected 收尾。
    let reads = 0
    const ghostEdge = {
      get from() { return 'a' },
      get to() {
        reads += 1
        return reads === 1 ? 'ghostA' : 'ghostB'
      },
    }
    const desynced = new Proxy(graph, {
      get(target, prop, receiver) {
        if (prop === 'edges') return [ghostEdge]
        return Reflect.get(target, prop, receiver) as unknown
      },
    })
    expect(() => desynced.topologicalLevels()).toThrow(/cycle detected/)
  })

  it('validate reports cycles and orphan nodes', () => {
    const graph = new FlowGraph()
    graph.addNode(node('a'))
    graph.addNode(node('b'))
    graph.addNode(node('c'))
    graph.addEdge({ from: 'a', to: 'b' })
    graph.addEdge({ from: 'b', to: 'a' })
    // c 是孤儿：无入边无出边。
    const problems = graph.validate()
    expect(problems.some(p => p.startsWith('Cycle:'))).toBe(true)
    expect(problems).toContain('Orphan node: c')
  })

  it('validate treats a lone node as a valid (non-orphan) graph', () => {
    const graph = new FlowGraph()
    graph.addNode(node('solo'))
    expect(graph.validate()).toEqual([])
  })

  it('formatMermaid renders flowchart TD with nodes and edges', () => {
    const graph = new FlowGraph()
    graph.addNode(node('a', '节点A'))
    graph.addNode(node('b', '节点B'))
    graph.addEdge({ from: 'a', to: 'b' })
    const mermaid = graph.formatMermaid()
    expect(mermaid.split('\n')).toEqual([
      'flowchart TD',
      '  a["节点A"]',
      '  b["节点B"]',
      '  a --> b',
    ])
  })

  it('formatMermaid renders an empty graph as just the header', () => {
    const graph = new FlowGraph()
    expect(graph.formatMermaid()).toBe('flowchart TD')
  })
})
