import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorkspaceAnalyzer } from '../src/analyzer.ts'
import type { FaceModel, TypeNodeModel } from '../src/model.ts'

const typeModelRoot = resolve(import.meta.dirname, 'fixtures/type-model')
const remoteModelRoot = resolve(import.meta.dirname, 'fixtures/remote-model')

/**
 * `WorkspaceAnalyzer` mints `type:<file>:<line>:<column>#<ordinal>`, and the ordinal comes from a
 * counter per start location: an id is a function of the order the analyzer visits nodes at one
 * source position, not of the type it names. That happens where several nodes share a start column —
 * an outer form and the node it recurses into (a union and its first member, a conditional and its
 * check type, `Payload['name']` and `Payload`), and one authored Remote boundary whose codec
 * resolution runs several compiler types through the same node.
 *
 * The committed face-model snapshots record these ids, but a reordering arrives there as a snapshot
 * diff rather than as a failure. The tables below pin the same positions by hand, so a change to the
 * conversion order — the precondition the split plan sets for cutting `analyzer.ts` — fails here
 * naming the source position, the ordinal, and the type that took it.
 */

/** Compact identity of one node: its kind, plus the name or literal text that distinguishes it. */
function describeNode(node: TypeNodeModel): string {
  if (node.kind === 'keyword' || node.kind === 'reference') return `${node.kind}:${node.name}`
  if (node.kind === 'literal') return `${node.kind}:${node.text}`
  return node.kind
}

/** Every ordinal minted at a location where the model visited more than one node, as `<file>:<line>:<column>#<ordinal>:<node>`. */
function sharedStartIds(face: FaceModel | undefined): string[] {
  const grouped = new Map<string, string[]>()
  for (const node of face?.graph.nodes ?? []) {
    const [location, ordinal] = node.id.replace(/^type:/, '').split('#') as [string, string]
    grouped.set(location, [...grouped.get(location) ?? [], `${ordinal}:${describeNode(node)}`])
  }
  return [...grouped]
    .filter(([, ids]) => ids.length > 1)
    .sort(([left], [right]) => compareLocations(left, right))
    .map(([location, ids]) => `${location}#${ids.join(',')}`)
}

/** Order two `file:line:column` keys by file, then line, then column. */
function compareLocations(left: string, right: string): number {
  const [leftFile, leftLine, leftColumn] = parseLocation(left)
  const [rightFile, rightLine, rightColumn] = parseLocation(right)
  return leftFile.localeCompare(rightFile) || leftLine - rightLine || leftColumn - rightColumn
}

/** Split `file:line:column` from the right, so a path containing `:` still parses. */
function parseLocation(key: string): [file: string, line: number, column: number] {
  const match = /^(.*):(\d+):(\d+)$/.exec(key)
  if (match === null) throw new Error(`node id location ${JSON.stringify(key)} is not file:line:column`)
  return [match[1]!, Number(match[2]), Number(match[3])]
}

describe('node id allocation', { timeout: 60_000 }, () => {
  it('numbers nested syntactic forms at a shared start column in visit order', () => {
    const host = new WorkspaceAnalyzer({ root: typeModelRoot }).analyze()
      .faces.find(face => face.face === 'host')

    // Each row is one start column with its ordinals in visit order. The outer form holds the lower
    // ordinal because `convertType` allocates before it recurses into the node it wraps, and the
    // wrapped node starts at the same column as the form around it.
    expect(sharedStartIds(host)).toEqual([
      'packages/host/src/models.ts:8:26#1:conditional,2:reference:T',
      'packages/host/src/models.ts:8:36#1:union,2:literal:null',
      'packages/host/src/models.ts:48:29#1:conditional,2:reference:Value',
      'packages/host/src/models.ts:48:59#1:array,2:keyword:never',
      'packages/host/src/models.ts:51:35#1:conditional,2:reference:Value',
      'packages/host/src/models.ts:61:25#1:indexed-access,2:reference:Value',
      'packages/host/src/models.ts:66:53#1:intersection,2:keyword:string',
      'packages/host/src/models.ts:66:73#1:indexed-access,2:reference:Value',
      'packages/host/src/models.ts:71:37#1:indexed-access,2:reference:Value',
      'packages/host/src/models.ts:115:19#1:union,2:reference:Entity',
      'packages/host/src/models.ts:116:13#1:union,2:literal:1',
      'packages/host/src/models.ts:118:17#1:intersection,2:reference:Entity',
      'packages/host/src/models.ts:119:10#1:array,2:keyword:string',
      'packages/host/src/models.ts:120:50#1:array,2:keyword:boolean',
      'packages/host/src/models.ts:121:30#1:array,2:keyword:number',
      'packages/host/src/models.ts:134:14#1:array,2:keyword:number',
      'packages/host/src/models.ts:136:48#1:array,2:keyword:string',
      'packages/host/src/models.ts:139:12#1:indexed-access,2:reference:Payload',
    ])
  })

  it('numbers the compiler types resolved from one Remote boundary in cache-miss order', () => {
    const host = new WorkspaceAnalyzer({ root: remoteModelRoot }).analyze()
      .faces.find(face => face.face === 'host')

    // `resolvedRemoteCodecType` allocates one id per compiler type it converts through the SAME
    // authored node: the alias as written, the object type it resolves to, then that object's first
    // member. A row therefore runs past #2, and its ordinals name the types the walk reached.
    expect(sharedStartIds(host)).toEqual([
      'packages/domain/src/index.ts:11:32#1:reference:AgentId,2:keyword:string,3:reference:AgentId,4:keyword:string',
      'packages/domain/src/index.ts:15:26#1:reference:AgentId,2:keyword:string,3:reference:AgentId,4:keyword:string,5:reference:AgentId,6:keyword:string',
      'packages/remote/src/index.ts:17:39#1:reference:CreateGoalRequest,2:object,3:keyword:string',
      'packages/remote/src/index.ts:17:88#1:reference:CreateGoalResult,2:object,3:keyword:string',
      'packages/remote/src/index.ts:23:19#1:reference:RenameGoalRequest,2:object,3:keyword:string',
      'packages/remote/src/index.ts:23:39#1:reference:RenameGoalResult,2:object,3:keyword:boolean',
      'packages/remote/src/index.ts:28:66#1:reference:CreateGoalResult,2:object,3:keyword:string',
    ])
  })
})
