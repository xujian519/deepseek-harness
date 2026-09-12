import { describe, expect, it } from 'vitest'
import { groupReadmePackageErrors } from './verify-group-readme-packages.ts'

function row(name: string): string {
  return `| [\`${name}/\`](${name}/README.md) | Role |`
}

function readme(body: string): string {
  return `---\nkind: "package-group"\n---\n\n# example/\n\n## Packages\n\n${body}\n\n-----\n\n## Related documentation\n\n- [Root package map](../README.md)\n`
}

describe('group README package inventory', () => {
  it('accepts a Packages table that lists every package', () => {
    expect(groupReadmePackageErrors('packages/example/README.md', readme(row('alpha')), ['alpha'])).toEqual([])
  })

  it('reports each package the table omits', () => {
    expect(groupReadmePackageErrors('packages/example/README.md', readme(row('alpha')), ['alpha', 'beta']))
      .toEqual(['packages/example/README.md: no Packages row for `beta/`'])
  })

  it('counts rows in every family table of the Packages section', () => {
    const body = `### First\n\n| Package | Role |\n|---|---|\n${row('alpha')}\n\n### Second\n\n| Package | Role |\n|---|---|\n${row('beta')}`

    expect(groupReadmePackageErrors('packages/example/README.md', readme(body), ['alpha', 'beta'])).toEqual([])
  })

  it('reads only the Packages section, so a later table cannot satisfy the check', () => {
    const source = `${readme(row('alpha'))}\n## Related documentation\n\n| Package | Role |\n|---|---|\n${row('beta')}\n`

    expect(groupReadmePackageErrors('packages/example/README.md', source, ['alpha', 'beta']))
      .toEqual(['packages/example/README.md: no Packages row for `beta/`'])
  })

  it('ignores rows pointing into another group', () => {
    const body = `${row('alpha')}\n| [\`beta/\`](../other-group/beta/README.md) | Role |`

    expect(groupReadmePackageErrors('packages/example/README.md', readme(body), ['alpha', 'beta']))
      .toEqual(['packages/example/README.md: no Packages row for `beta/`'])
  })

  it('reads the Chinese heading and `.zh.md` link targets', () => {
    const source = '# example/\n\n## 包\n\n| 包 | 职责 |\n|---|---|\n| [`alpha/`](alpha/README.zh.md) | 职责 |\n\n-----\n\n## 相关文档\n'

    expect(groupReadmePackageErrors('packages/example/README.zh.md', source, ['alpha'])).toEqual([])
  })

  it('rejects a README with no Packages section instead of silently passing it', () => {
    expect(groupReadmePackageErrors('packages/example/README.md', '# example/\n', ['alpha']))
      .toEqual(['packages/example/README.md: missing `## Packages`'])
  })
})
