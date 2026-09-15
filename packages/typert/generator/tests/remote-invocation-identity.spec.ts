import { describe, expect, it } from 'vitest'
import type { InvocationModel, PackageModel, RemoteBoundaryModel } from '../src/model.ts'
import { validateInvocationIdentity } from '../src/remote-analyzer.ts'

/**
 * The cross-package identity check of one face's Remote invocations. Both conflicts it reports — two
 * endpoints with the same `namespace/method`, and two invocations with the same id — were reachable
 * only by analyzing a whole fixture workspace; `remote-model.spec.ts` rewrites a fixture and runs a
 * 60-second analysis to prove the first. The check takes the analyzed packages, so the models below
 * are built by hand and the four cases below run in milliseconds.
 */

const BOUNDARY: RemoteBoundaryModel = {
  type: 'type:packages/remote/src/index.ts:17:39#1',
  codecType: 'type:packages/remote/src/index.ts:17:39#1',
  acceptsUndefined: false,
  typeSymbol: 'remote#CreateGoalResult',
  imports: [],
}

/** One direct invocation carrying the identity under test and a distinguishable source location. */
function invocation(id: string, namespace: string, method: string, line: number): InvocationModel {
  return {
    id,
    service: 'goals',
    namespace,
    method,
    invocation: { kind: 'direct' },
    parameters: [],
    result: BOUNDARY,
    location: { file: 'packages/other/src/index.ts', line, column: 3 },
  }
}

/** One analyzed package whose only content is the invocations under test. */
function packageModel(name: string, invocations: readonly InvocationModel[]): PackageModel {
  return {
    name,
    root: `packages/${name}`,
    exports: [],
    services: [],
    events: [],
    objects: [],
    schemas: [],
    invocations,
  }
}

/** The check over one invocation per package, as a thunk so a test can assert on what it throws. */
function identityCheck(first: InvocationModel, second: InvocationModel): () => void {
  return () => {
    validateInvocationIdentity('host', [packageModel('remote', [first]), packageModel('billing', [second])])
  }
}

const CREATE = invocation('@fixture/remote#goals/create', 'goals', 'create', 17)
const RENAME = invocation('@fixture/billing#goals/rename', 'goals', 'rename', 23)
/** The same endpoint as {@link CREATE} under a different id. */
const REPLICA = invocation('@fixture/billing#goals/create', 'goals', 'create', 23)
/** The same id as {@link CREATE} under a different endpoint. */
const RENAMED_ID = invocation('@fixture/remote#goals/create', 'billing', 'create', 23)
/** Both identities of {@link CREATE}, at a second source location. */
const DUPLICATE = invocation('@fixture/remote#goals/create', 'goals', 'create', 23)

describe('Remote invocation identity', () => {
  it('admits distinct endpoints and ids across packages', () => {
    expect(identityCheck(CREATE, RENAME)).not.toThrow()
  })

  it('reports a repeating endpoint at the location of the second invocation', () => {
    expect(identityCheck(CREATE, REPLICA))
      .toThrow(/index\.ts:23:3: Remote endpoint goals\/create conflicts with @fixture\/remote#goals\/create/)
  })

  it('reports a repeated id even when the endpoints differ', () => {
    expect(identityCheck(CREATE, RENAMED_ID))
      .toThrow(/Remote invocation id @fixture\/remote#goals\/create conflicts with/)
  })

  it('reports the endpoint conflict first when both identities repeat', () => {
    expect(identityCheck(CREATE, DUPLICATE))
      .toThrow(/^typert\(host\): packages\/other\/src\/index\.ts:23:3: Remote endpoint/)
  })
})
