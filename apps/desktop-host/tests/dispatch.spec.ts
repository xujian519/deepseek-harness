import { describe, expect, it } from 'vitest'
import { API_PATH } from '@deepseek-ai/dsh-client-connection'
import { desktopRequestOwner } from '../src/index.ts'

describe('desktopRequestOwner', () => {
  it('serves the push stream path before any route the table claims', () => {
    expect(desktopRequestOwner('/.dsh/remote-stream', { kind: 'exact', path: '/.dsh/remote-stream' })).toBe('stream')
  })

  it('serves a plugin route that claims a path under the gateway prefix', () => {
    // Regression: the dispatch sent every /api path to the gateway before
    // consulting the table, so these routes answered 404.
    expect(desktopRequestOwner('/api/workbench/bootstrap', {
      kind: 'exact',
      path: '/api/workbench/bootstrap',
    })).toBe('portless')
    expect(desktopRequestOwner('/api/workbench/tasks', {
      kind: 'prefix',
      path: '/api/workbench/tasks',
    })).toBe('portless')
  })

  it('serves the gateway for its own prefix registration and for unclaimed /api paths', () => {
    expect(desktopRequestOwner(API_PATH, { kind: 'prefix', path: API_PATH })).toBe('gateway')
    expect(desktopRequestOwner(`${API_PATH}/session.list`, { kind: 'prefix', path: API_PATH })).toBe('gateway')
    expect(desktopRequestOwner(`${API_PATH}/session.list`, undefined)).toBe('gateway')
  })

  it('leaves paths outside the gateway and the table to the packaged assets', () => {
    expect(desktopRequestOwner('/index.html', undefined)).toBe('assets')
    expect(desktopRequestOwner('/apiary/session.list', undefined)).toBe('assets')
    expect(desktopRequestOwner('/sidebar/api', { kind: 'prefix', path: '/sidebar' })).toBe('portless')
  })
})
