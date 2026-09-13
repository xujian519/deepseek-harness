import { describe, expect, it } from 'vitest'
import { scanRepository, scanSuppressions } from './verify-suppression-reasons.ts'

const FILE = 'packages/core/tools/tests/probe.spec.ts'

function unexplained(source: string, file = FILE): string[] {
  return scanSuppressions(file, source).unexplained.map(finding => finding.text)
}

describe('suppression reason check', () => {
  it('accepts an inline reason', () => {
    expect(unexplained('// oxlint-disable-next-line typescript/no-console -- the probe writes to stderr on purpose.\n')).toEqual([])
  })

  it('rejects a directive with no reason', () => {
    expect(unexplained('// oxlint-disable-next-line typescript/no-non-null-assertion\nconst first = nodes[0]!\n'))
      .toEqual(['oxlint-disable-next-line typescript/no-non-null-assertion'])
  })

  it('accepts the trailing text TypeScript parses for `@ts-expect-error`', () => {
    expect(unexplained("// @ts-expect-error the fixture ships without declarations\nimport fixture from './probe.mjs'\n")).toEqual([])
  })

  it('rejects a bare `@ts-expect-error`', () => {
    expect(unexplained("// @ts-expect-error\nimport fixture from './probe.mjs'\n")).toEqual(['@ts-expect-error'])
  })

  it('accepts a reason on the line directly above', () => {
    expect(unexplained('// The loop bound keeps index in range.\n// oxlint-disable-next-line typescript/no-non-null-assertion\nconst node = nodes[index]!\n')).toEqual([])
  })

  it('accepts one heading covering the statements beneath it', () => {
    expect(unexplained([
      '// Object literals never read `this`; retaining these references is safe.',
      '// oxlint-disable-next-line typescript/unbound-method',
      'const execute = options.execute',
      '// oxlint-disable-next-line typescript/unbound-method',
      'const render = options.render',
      '',
    ].join('\n'))).toEqual([])
  })

  it('rejects a directive separated from the heading by a blank line', () => {
    expect(unexplained('// Object literals never read `this`.\n\n// oxlint-disable-next-line typescript/unbound-method\nconst execute = options.execute\n'))
      .toEqual(['oxlint-disable-next-line typescript/unbound-method'])
  })

  it('rejects a JSDoc block as the reason', () => {
    expect(unexplained('/** Defines the fixture. */\n// oxlint-disable-next-line typescript/unbound-method\nconst execute = options.execute\n'))
      .toEqual(['oxlint-disable-next-line typescript/unbound-method'])
  })

  it('accepts a multi-line block directive whose reason ends its first line', () => {
    expect(unexplained([
      '/* oxlint-disable-next-line typescript/no-explicit-any --',
      ' * the implementation signature admits every inject tuple. */',
      'inject?: ((...args: any) => Record<string, unknown>) | undefined',
      '',
    ].join('\n'))).toEqual([])
  })

  it('accepts the `-line` form however it is indented', () => {
    expect(unexplained("  return Promise.reject('offline') // oxlint-disable-line typescript/prefer-promise-reject-errors -- a string rejection is the case under test.\n")).toEqual([])
  })

  it('reports the directive line and text', () => {
    const scan = scanSuppressions(FILE, 'const a = 1\n\n// oxlint-disable-next-line no-console\n')
    expect(scan.directives).toBe(1)
    expect(scan.unexplained).toEqual([{ line: 3, text: 'oxlint-disable-next-line no-console' }])
  })

  it('ignores directive text inside literals, which the lint-contract probes write on purpose', () => {
    expect(unexplained("await writeFile(path, '// oxlint-disable-next-line no-console\\nexport const value = 1\\n')\n")).toEqual([])
    expect(unexplained('const probe = `// oxlint-disable-next-line no-console\n${value}`\n')).toEqual([])
  })

  it('ignores prose that names a directive without being one', () => {
    expect(unexplained('// Prefer an oxlint-disable comment over a rule-wide exception here.\nconst value = 1\n')).toEqual([])
  })

  it('ignores `oxlint-enable`, which restores a rule', () => {
    expect(unexplained('/* oxlint-enable typescript/no-console */\nconst value = 1\n')).toEqual([])
  })

  it('passes on the current tree', () => {
    expect(scanRepository().findings).toEqual([])
  })
})
