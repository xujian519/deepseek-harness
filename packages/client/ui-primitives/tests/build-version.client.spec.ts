import { afterEach, describe, expect, it, vi } from 'vitest'
import { localBuildVersion } from '../src/build-version.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('localBuildVersion', () => {
  it('reports nothing when the build carried no version', () => {
    vi.stubEnv('DSH_CLIENT_VERSION', undefined)
    expect(localBuildVersion()).toBeUndefined()
  })

  it('reports the version alone when the build named no commit', () => {
    vi.stubEnv('DSH_CLIENT_VERSION', '1.2.3-rc.4')
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', undefined)
    expect(localBuildVersion()).toBe('1.2.3-rc.4')
  })

  it('appends the commit and the dirty marker the build reported', () => {
    vi.stubEnv('DSH_CLIENT_VERSION', '1.2.3')
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', 'abcdef0')
    vi.stubEnv('DSH_CLIENT_GIT_DIRTY', 'true')
    expect(localBuildVersion()).toBe('1.2.3-abcdef0-dirty')
  })

  it('leaves a clean build unmarked', () => {
    vi.stubEnv('DSH_CLIENT_VERSION', '1.2.3')
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', 'abcdef0')
    vi.stubEnv('DSH_CLIENT_GIT_DIRTY', 'false')
    expect(localBuildVersion()).toBe('1.2.3-abcdef0')
  })
})
