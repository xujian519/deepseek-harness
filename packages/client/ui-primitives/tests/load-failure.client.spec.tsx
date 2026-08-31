// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LoadFailure } from '@deepseek-ai/dsh-client-ui-primitives'

describe('LoadFailure', () => {
  it('renders the message as an alert and the localized retry label', () => {
    render(<LoadFailure message="加载失败" retryLabel="重试" onRetry={() => {}} />)
    expect(screen.getByRole('alert').textContent).toBe('加载失败')
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined()
  })

  it('invokes onRetry when the retry button is clicked', () => {
    const onRetry = vi.fn()
    render(<LoadFailure message="boom" retryLabel="retry" onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
