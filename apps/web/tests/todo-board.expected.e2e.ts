// @vitest-environment jsdom
// Assembled board snapshot: boots the real built `packages/client/*/lib/
// client.js` bundles through AppWebEntry's ModuleLoader path against the
// keyless fixture Connection RPC, opens the fixture session, switches the
// view ring to the Board tab, and pins the cross-session board the fixture's
// todo/write turn reaches — three counted columns whose cards carry the
// session badge back to the fixture session.
//
// The board reads the `todosLatest` projection column (whole-log, never
// cleared), so this file also pins the key's fixture/host parity: a fixture
// or host fold that drops or clears the list changes this file.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const EXPECTED = join(process.cwd(), 'apps/web/tests/expected/todo-board/board.expected.txt')

installAssembledBootEnv()

/** Normalize the board to stable text fields: the tag filter options, then
 * each column's label and count, then every card with its badge session
 * title. The filter bar renders only when a card carries tags. */
function boardShape(region: Element): string {
  const children = [...region.children]
  const bar = children.find(el => el.getAttribute('role') === 'group')
  const grid = children.find(el => el.getAttribute('role') !== 'group')
  const filter = bar === undefined
    ? '<no tags>'
    : [...bar.querySelectorAll('button')].map(button => button.textContent?.trim() ?? '').join(',')
  const columns = grid === undefined
    ? []
    : [...grid.children].map((column) => {
      const head = column.children[0]?.textContent?.trim().replace(/\s+/g, ' ') ?? '<absent>'
      const body = column.children[1]
      const cards = body === undefined
        ? []
        : [...body.querySelectorAll('button')].map(card => `card=${card.textContent?.trim() ?? ''}`)
      return [head, ...cards].join('\n')
    })
  return [`filter=${filter}`, ...columns].join('\n---\n') + '\n'
}

describe('assembled todo board', () => {
  it('renders the fixture session todos as three counted columns with session badges', async () => {
    mountAssembledApp()

    const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
    fireEvent.click(await within(tree).findByText('Fixture 历史会话'))
    // The view strip only mounts once more than one view is registered; the
    // Board tab is the board plugin's conversation.view entry. The assembled
    // environment pins English, so locators use the en dictionary.
    const boardTab = await screen.findByRole('tab', { name: 'Board' }, { timeout: 10_000 })
    fireEvent.click(boardTab)
    const region = await waitFor(() => {
      const found = document.querySelector('[aria-label="Todo board"]')
      expect(found).not.toBeNull()
      return found!
    }, { timeout: 10_000 }) as HTMLElement

    const shape = boardShape(region)
    if (REFRESHING_GOLDEN) {
      mkdirSync(dirname(EXPECTED), { recursive: true })
      writeFileSync(EXPECTED, shape)
    }
    await expect(shape).toMatchFileSnapshot(EXPECTED)

    // The fixture todos carry a demo/planning tag mix; the demo filter keeps
    // its two cards and drops the untagged and planning ones.
    fireEvent.click(screen.getByRole('button', { name: 'Filter by tag demo' }))
    await waitFor(() => {
      expect(within(region).queryByText('跑后台构建')).toBeNull()
    })
    expect(within(region).getByText('浏览器验收')).toBeTruthy()
    expect(within(region).getByText('实现 fixture 样本')).toBeTruthy()
    fireEvent.click(within(region).getByRole('button', { name: 'All' }))
    expect(within(region).getByText('跑后台构建')).toBeTruthy()
  })
})
