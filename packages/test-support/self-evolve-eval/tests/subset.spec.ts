import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SUBSET_SIZE, decodeTestIds, loadTaskManifest, normalizeSwebenchInstances, selectSubset } from '../src/subset.ts'
import type { EvalTask } from '../src/types.ts'

function tasks(count: number, offset = 0): EvalTask[] {
  return Array.from({ length: count }, (_, index) => ({
    instanceId: `repo__pkg-${String(index + offset).padStart(5, '0')}`,
    repo: 'repo/pkg',
    baseCommit: 'abcdef',
    failToPass: ['test_a'],
    passToPass: [],
  }))
}

describe('normalizeSwebenchInstances', () => {
  it('maps dataset rows to EvalTask and filters non-string test ids', () => {
    const rows = [
      { instance_id: 'django__django-1', repo: 'django/django', base_commit: 'abc', FAIL_TO_PASS: ['a', 1], PASS_TO_PASS: ['b'] },
      { instance_id: 'sympy__sympy-2', repo: 'sympy/sympy', base_commit: 'def', FAIL_TO_PASS: [], PASS_TO_PASS: [] },
    ]
    expect(normalizeSwebenchInstances(rows)).toEqual([
      { instanceId: 'django__django-1', repo: 'django/django', baseCommit: 'abc', failToPass: ['a'], passToPass: ['b'] },
      { instanceId: 'sympy__sympy-2', repo: 'sympy/sympy', baseCommit: 'def', failToPass: [], passToPass: [] },
    ])
  })

  it('drops rows without an instance id', () => {
    const rows = [{ repo: 'x' }, { instance_id: 'a__b-1', repo: 'a/b', base_commit: 'c' }]
    expect(normalizeSwebenchInstances(rows)).toHaveLength(1)
  })

  it('fails loud when repo or base_commit is missing', () => {
    expect(() => normalizeSwebenchInstances([{ instance_id: 'a__b-1' }])).toThrow(/missing repo or base_commit/)
  })

  it('skips non-object rows', () => {
    const rows = [null, 'nope', 42, { instance_id: 'a__b-1', repo: 'a/b', base_commit: 'c' }]
    expect(normalizeSwebenchInstances(rows)).toHaveLength(1)
  })

  it('decodes the JSON-array strings the dataset actually ships', () => {
    const rows = [{
      instance_id: 'django__django-13158',
      repo: 'django/django',
      base_commit: 'abc',
      FAIL_TO_PASS: '["queries/test_qs.py::test_a"]',
      PASS_TO_PASS: '["queries/test_qs.py::test_b","queries/test_qs.py::test_c"]',
    }]
    expect(normalizeSwebenchInstances(rows)).toEqual([{
      instanceId: 'django__django-13158',
      repo: 'django/django',
      baseCommit: 'abc',
      failToPass: ['queries/test_qs.py::test_a'],
      passToPass: ['queries/test_qs.py::test_b', 'queries/test_qs.py::test_c'],
    }])
  })

  it('accepts an empty JSON-array string, as rows with no PASS_TO_PASS ship', () => {
    const rows = [{
      instance_id: 'a__b-1',
      repo: 'a/b',
      base_commit: 'c',
      FAIL_TO_PASS: '["x.py::test_a"]',
      PASS_TO_PASS: '[]',
    }]
    expect(normalizeSwebenchInstances(rows)[0]?.passToPass).toEqual([])
  })
})

describe('decodeTestIds', () => {
  it('fails loud on a string that is not JSON', () => {
    expect(() => decodeTestIds('FAIL_TO_PASS', 'not-an-array')).toThrow(/is not valid JSON/)
  })

  it('fails loud on a JSON value that is not an array', () => {
    expect(() => decodeTestIds('PASS_TO_PASS', '{"a":1}')).toThrow(/got a JSON object/)
  })

  it('fails loud on a number', () => {
    expect(() => decodeTestIds('PASS_TO_PASS', 7)).toThrow(/must be a JSON array string or an array, got number/)
  })

  it('names the task in the failure so a bad manifest row is locatable', () => {
    expect(() => decodeTestIds('django__django-1 FAIL_TO_PASS', 'oops')).toThrow(/django__django-1 FAIL_TO_PASS/)
  })

  it('keeps string ids and drops non-string entries inside a real array', () => {
    expect(decodeTestIds('FAIL_TO_PASS', ['tests/x.py::test_1', 7])).toEqual(['tests/x.py::test_1'])
  })

  it('keeps string ids and drops non-string entries inside a JSON-array string', () => {
    expect(decodeTestIds('FAIL_TO_PASS', '["tests/x.py::test_1", 7]')).toEqual(['tests/x.py::test_1'])
  })
})

describe('selectSubset', () => {
  it('is deterministic for the same manifest and seed', () => {
    const source = tasks(12, 100)
    const first = selectSubset(source, 20260821, 5).map(task => task.instanceId)
    const second = selectSubset([...source].reverse(), 20260821, 5).map(task => task.instanceId)
    expect(first).toEqual(second)
    expect(first).toHaveLength(5)
  })

  it('input order never influences the subset (sorts before sampling)', () => {
    const source = tasks(12, 0)
    const forward = selectSubset(source, 42, 5).map(task => task.instanceId)
    const reversed = selectSubset([...source].reverse(), 42, 5).map(task => task.instanceId)
    expect(forward).toEqual(reversed)
  })

  it('defaults to 60 tasks and clamps to the manifest size', () => {
    expect(DEFAULT_SUBSET_SIZE).toBe(60)
    expect(selectSubset(tasks(100), 1, 60)).toHaveLength(60)
    expect(selectSubset(tasks(10), 1, 60)).toHaveLength(10)
  })

  it('yields unique instance ids', () => {
    const subset = selectSubset(tasks(50), 7, 20)
    expect(new Set(subset.map(task => task.instanceId)).size).toBe(20)
  })

  it('fails loud when a selected task has no FAIL_TO_PASS ids', () => {
    const source: EvalTask[] = [
      { instanceId: 'a__b-1', repo: 'a/b', baseCommit: 'c', failToPass: [], passToPass: [] },
    ]
    expect(() => selectSubset(source, 1, 1)).toThrow(/no FAIL_TO_PASS ids/)
  })
})

describe('loadTaskManifest', () => {
  const tempDirs: string[] = []
  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  async function fixture(content: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-eval-'))
    tempDirs.push(dir)
    const path = join(dir, 'manifest.jsonl')
    await writeFile(path, content)
    return path
  }

  it('loads a JSON array manifest', async () => {
    const path = await fixture(JSON.stringify([{ instance_id: 'a__b-1', repo: 'a/b', base_commit: 'c' }]))
    expect(await loadTaskManifest(path)).toHaveLength(1)
  })

  it('loads a JSONL manifest (swebench dataset export shape)', async () => {
    const path = await fixture('{"instance_id":"a__b-1","repo":"a/b","base_commit":"c"}\n{"instance_id":"d__e-2","repo":"d/e","base_commit":"f"}\n')
    expect((await loadTaskManifest(path)).map(task => task.instanceId)).toEqual(['a__b-1', 'd__e-2'])
  })
})
