import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTeamDir, findTeamByCaptain } from '../src/state.ts'
import type { TeamState } from '../src/types.ts'

describe('probe', () => {
  it('scans teams', async () => {
    const root = await mkdtemp(join(tmpdir(), 'probe-'))
    const state: TeamState = {
      name: 'Alpha', id: 'alpha', captainSessionId: 'c1', createdAt: 1,
      members: [], tasks: [], taskSeq: 0,
    }
    await createTeamDir(root, state)
    const team = await findTeamByCaptain(root, 'c1')
    expect(team?.id).toBe('alpha')
  })
})
