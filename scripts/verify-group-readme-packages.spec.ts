import { describe, expect, it } from 'vitest'
import { groupReadmePackageErrors, packageGroupTableErrors } from './verify-group-readme-packages.ts'

function row(name: string): string {
  return `| [\`${name}/\`](${name}/README.md) | Role |`
}

function readme(body: string): string {
  return `---\nkind: "package-group"\n---\n\n# example/\n\n## Packages\n\n${body}\n\n-----\n\n## Related documentation\n\n- [Root package map](../README.md)\n`
}

function groupMap(body: string): string {
  return `---\nkind: "package-group"\n---\n\n# Packages\n\n## Package groups\n\n${body}\n\n-----\n\n## Release expectations\n\nText\n`
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

  it('reports a Packages row whose directory holds no package', () => {
    expect(groupReadmePackageErrors('packages/example/README.md', readme(`${row('alpha')}\n${row('ghost')}`), ['alpha']))
      .toEqual(['packages/example/README.md: Packages row for `ghost/`, which the directory does not hold'])
  })

  it('tolerates a package listed twice, which the root group table alone rejects', () => {
    expect(groupReadmePackageErrors('packages/example/README.md', readme(`${row('alpha')}\n${row('alpha')}`), ['alpha']))
      .toEqual([])
  })
})

describe('root package map group table', () => {
  it('accepts a group table that lists every group once', () => {
    expect(packageGroupTableErrors('packages/README.md', groupMap(row('alpha')), ['alpha'])).toEqual([])
  })

  it('reports a group listed twice', () => {
    expect(packageGroupTableErrors('packages/README.md', groupMap(`${row('alpha')}\n${row('alpha')}`), ['alpha']))
      .toEqual(['packages/README.md: duplicate group row for `alpha/`'])
  })

  it('reports one diagnostic per extra row when a group appears three times', () => {
    expect(packageGroupTableErrors('packages/README.md', groupMap(`${row('alpha')}\n${row('alpha')}\n${row('alpha')}`), ['alpha']))
      .toEqual([
        'packages/README.md: duplicate group row for `alpha/`',
        'packages/README.md: duplicate group row for `alpha/`',
      ])
  })

  it('ignores a group the section prose links without listing it', () => {
    const source = groupMap(`New groups update this table; see [\`alpha/\`](alpha/README.md) for an example.\n\n${row('alpha')}`)

    expect(packageGroupTableErrors('packages/README.md', source, ['alpha'])).toEqual([])
  })

  it('reports a group row whose directory holds no group README', () => {
    expect(packageGroupTableErrors('packages/README.md', groupMap(row('ghost')), ['alpha']))
      .toEqual([
        'packages/README.md: group row for `ghost/`, which holds no group README',
        'packages/README.md: no group row for `alpha/`',
      ])
  })

  it('reports a group the table omits', () => {
    expect(packageGroupTableErrors('packages/README.md', groupMap(row('alpha')), ['alpha', 'beta']))
      .toEqual(['packages/README.md: no group row for `beta/`'])
  })

  it('reads the Chinese heading and `.zh.md` link targets', () => {
    const source = '# 包\n\n## 包分组\n\n| 组 | 职责 |\n|---|---|\n| [`alpha/`](alpha/README.zh.md) | 职责 |\n\n-----\n\n## 发布预期\n'

    expect(packageGroupTableErrors('packages/README.zh.md', source, ['alpha'])).toEqual([])
  })

  it('rejects a map with no group table instead of silently passing it', () => {
    expect(packageGroupTableErrors('packages/README.md', '# Packages\n', ['alpha']))
      .toEqual(['packages/README.md: missing `## Package groups`'])
  })
})
