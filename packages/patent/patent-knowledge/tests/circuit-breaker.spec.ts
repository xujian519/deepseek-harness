import { describe, expect, it } from 'vitest'
import { CircuitBreaker } from '@deepseek-ai/dsh-patent-knowledge'

describe('CircuitBreaker', () => {
  it('starts closed and allows calls', () => {
    const breaker = new CircuitBreaker()
    expect(breaker.state).toBe('closed')
    expect(breaker.allow()).toBe(true)
  })

  it('opens and short-circuits after the failure threshold', () => {
    const t = 0
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: () => t })
    expect(breaker.allow()).toBe(true)
    breaker.failure()
    expect(breaker.state).toBe('closed')
    breaker.failure()
    expect(breaker.allow()).toBe(true)
    breaker.failure()
    expect(breaker.state).toBe('open')
    expect(breaker.allow()).toBe(false)
  })

  it('rejects while cooling down', () => {
    let t = 0
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => t })
    breaker.failure()
    t = 999
    expect(breaker.allow()).toBe(false)
  })

  it('allows one probe after cooldown and blocks a second in-flight probe', () => {
    let t = 0
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => t })
    breaker.failure()
    t = 1000
    expect(breaker.state).toBe('half-open')
    expect(breaker.allow()).toBe(true)
    expect(breaker.allow()).toBe(false)
  })

  it('resets to closed after a successful probe', () => {
    let t = 0
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => t })
    breaker.failure()
    t = 1000
    expect(breaker.allow()).toBe(true)
    breaker.success()
    expect(breaker.state).toBe('closed')
    expect(breaker.allow()).toBe(true)
  })

  it('reopens and restarts cooldown after a failed probe', () => {
    let t = 0
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => t })
    breaker.failure()
    t = 1000
    expect(breaker.allow()).toBe(true)
    breaker.failure()
    expect(breaker.state).toBe('open')
    expect(breaker.allow()).toBe(false)
    t = 1999
    expect(breaker.allow()).toBe(false)
    t = 2000
    expect(breaker.allow()).toBe(true)
  })

  it('success resets the failure count', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 })
    breaker.failure()
    breaker.failure()
    breaker.success()
    breaker.failure()
    breaker.failure()
    expect(breaker.state).toBe('closed')
  })

  it('logs a warning when it opens', () => {
    const warns: unknown[][] = []
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 1000,
      logger: { warn: (...args: unknown[]) => warns.push(args) },
    })
    breaker.failure()
    expect(warns).toHaveLength(1)
    expect(String(warns[0])).toMatch(/circuit breaker opened/)
  })
})
