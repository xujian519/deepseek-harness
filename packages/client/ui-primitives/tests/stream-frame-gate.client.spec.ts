/**
 * Streaming frame admission: a frame that outruns the parse budget buys the
 * following frames a cool-down proportional to its measured cost, an in-budget
 * frame buys none, a short reply is admitted whatever it costs, and a held-back
 * frame reports the wait its owner schedules.
 */
import { describe, expect, it } from 'vitest'
import {
  StreamFrameGate, STREAM_FRAME_BUDGET_MS, STREAM_FRAME_DELAY_FACTOR, STREAM_FRAME_MIN_SOURCE_CHARS,
} from '../src/markdown/stream-frame-gate.ts'

/** A source long enough for admission to apply. */
const SOURCE = STREAM_FRAME_MIN_SOURCE_CHARS * 10

/** A clock the test reads and advances explicitly. */
function scriptedClock(start = 1_000): { now: () => number; spend: (ms: number) => void } {
  let current = start
  return {
    now: () => current,
    spend: (ms: number): void => { current += ms },
  }
}

describe('StreamFrameGate', () => {
  it('admits every frame while the frames stay inside the budget', () => {
    const clock = scriptedClock()
    const gate = new StreamFrameGate(clock.now)
    expect(gate.claim(SOURCE)).toBe(true)
    expect(gate.measure(() => {
      clock.spend(STREAM_FRAME_BUDGET_MS)
      return 'frame'
    })).toBe('frame')
    // A frame at the budget is not over it, so the next frame is admitted at once.
    expect(gate.delayMs()).toBeNull()
    clock.spend(2)
    expect(gate.claim(SOURCE)).toBe(true)
  })

  it('holds the frames after an over-budget frame back for a multiple of its cost', () => {
    const clock = scriptedClock()
    const gate = new StreamFrameGate(clock.now)
    gate.measure(() => { clock.spend(10) })
    const readyAt = clock.now() + 10 * STREAM_FRAME_DELAY_FACTOR
    clock.spend(10 * STREAM_FRAME_DELAY_FACTOR - 1)
    expect(gate.claim(SOURCE)).toBe(false)
    expect(gate.delayMs()).toBe(1)
    clock.spend(1)
    expect(clock.now()).toBe(readyAt)
    expect(gate.claim(SOURCE)).toBe(true)
  })

  it('scales the cool-down with the measured cost', () => {
    const clock = scriptedClock()
    const gate = new StreamFrameGate(clock.now)
    gate.measure(() => { clock.spend(20) })
    clock.spend(20 * STREAM_FRAME_DELAY_FACTOR)
    expect(gate.claim(SOURCE)).toBe(true)
  })

  it('admits a short reply whatever it costs', () => {
    const clock = scriptedClock()
    const gate = new StreamFrameGate(clock.now)
    gate.measure(() => { clock.spend(10) })
    // A one-off slow frame on a reply too short to re-parse past the budget
    // must not delay it.
    expect(gate.claim(STREAM_FRAME_MIN_SOURCE_CHARS - 1)).toBe(true)
    expect(gate.delayMs()).toBeNull()
    expect(gate.claim(SOURCE)).toBe(false)
  })

  it('stops waiting once the held-back frame is released', () => {
    const clock = scriptedClock()
    const gate = new StreamFrameGate(clock.now)
    gate.measure(() => { clock.spend(10) })
    expect(gate.claim(SOURCE)).toBe(false)
    expect(gate.delayMs()).toBe(10 * STREAM_FRAME_DELAY_FACTOR)
    gate.release()
    expect(gate.delayMs()).toBeNull()
  })

  it('measures against the monotonic clock by default', () => {
    const gate = new StreamFrameGate()
    expect(gate.claim(SOURCE)).toBe(true)
    expect(gate.measure(() => {
      const until = performance.now() + 20
      while (performance.now() < until) {
        // Spin so the frame's measured cost clears the budget on any machine.
      }
      return 'rendered'
    })).toBe('rendered')
    expect(gate.claim(SOURCE)).toBe(false)
    expect(gate.delayMs()).toBeGreaterThan(0)
  })
})
