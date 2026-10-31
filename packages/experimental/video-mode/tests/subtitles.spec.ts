/**
 * SubRip rendering: cue numbering, blank-line separation, and millisecond
 * timestamps including offsets past one hour and negative inputs.
 */

import { describe, expect, it } from 'vitest'
import { formatSrt } from '../src/subtitles.ts'

describe('SubRip formatting', () => {
  it('renders numbered cues separated by a blank line', () => {
    expect(formatSrt([
      { text: '第一句。', startSec: 0, endSec: 2.12 },
      { text: '第二句。', startSec: 2.12, endSec: 4.5 },
    ])).toBe(
      '1\n00:00:00,000 --> 00:00:02,120\n第一句。\n'
      + '\n'
      + '2\n00:00:02,120 --> 00:00:04,500\n第二句。\n',
    )
  })

  it('renders an empty document for no cues', () => {
    expect(formatSrt([])).toBe('')
  })

  it('clamps negative offsets and carries minutes and hours', () => {
    expect(formatSrt([{ text: 'x', startSec: -1.5, endSec: 3661.2345 }])).toBe(
      '1\n00:00:00,000 --> 01:01:01,235\nx\n',
    )
  })
})
