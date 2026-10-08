import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PatentFilingError, PRIMARY_RUNTIME_REL, findPython, requirePython } from '@deepseek-ai/dsh-patent-filing'

/** Environment keys these cases rewrite; every case restores the previous values. */
const KEYS = ['HOME', 'PATH', 'DSH_PYTHON_PATH', 'DSH_PRIMARY_RUNTIME', 'DSH_HOME'] as const
const saved: Record<string, string | undefined> = {}
const dirs: string[] = []

function saveEnv(): void {
  for (const key of KEYS) saved[key] = process.env[key]
}

afterEach(() => {
  restore('HOME')
  restore('PATH')
  restore('DSH_PYTHON_PATH')
  restore('DSH_PRIMARY_RUNTIME')
  restore('DSH_HOME')
  while (dirs.length > 0) rmSync(dirs.pop() ?? '', { recursive: true, force: true })
})

/** Put one environment key back to what it held before the case. */
function restore(key: (typeof KEYS)[number]): void {
  const value = saved[key]
  if (value === undefined) Reflect.deleteProperty(process.env, key)
  else process.env[key] = value
}

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

/** A temp dir holding a fake interpreter at the packaged-runtime layout. */
function fakeRuntime(): string {
  const root = tempDir('dsh-filing-runtime-')
  const bin = join(root, 'dependencies', 'python', 'bin')
  mkdirSync(bin, { recursive: true })
  const interpreter = join(bin, 'python3')
  writeFileSync(interpreter, '#!/bin/sh\n')
  return root
}

/** A temp dir laid out as a Harness home carrying the packaged runtime. */
function fakeHome(): string {
  const root = tempDir('dsh-filing-home-runtime-')
  const bin = join(root, PRIMARY_RUNTIME_REL, 'dependencies', 'python', 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'python3'), '#!/bin/sh\n')
  return root
}

/** Close every discovery route but the default home, set to a temp dir; blank env values count as unset. */
function onlyDefaultHome(): void {
  saveEnv()
  process.env.DSH_PYTHON_PATH = ''
  process.env.DSH_PRIMARY_RUNTIME = ''
  process.env.DSH_HOME = ''
  process.env.PATH = ''
  process.env.HOME = tempDir('dsh-filing-home-')
}

describe('findPython', () => {
  it('prefers an explicit override that exists', () => {
    const dir = tempDir('dsh-filing-py-')
    const interpreter = join(dir, 'python3')
    writeFileSync(interpreter, '#!/bin/sh\n')
    expect(findPython(interpreter)).toBe(interpreter)
  })

  it('reports a configured interpreter that does not exist as this package\'s own error', () => {
    expect(() => findPython(join(tempDir('dsh-filing-py-'), 'absent')))
      .toThrow(PatentFilingError)
  })

  it('prefers DSH_PYTHON_PATH over the packaged runtime', () => {
    saveEnv()
    const dir = tempDir('dsh-filing-py-')
    const interpreter = join(dir, 'python3')
    writeFileSync(interpreter, '#!/bin/sh\n')
    process.env.DSH_PYTHON_PATH = interpreter
    process.env.DSH_PRIMARY_RUNTIME = fakeRuntime()
    expect(findPython()).toBe(interpreter)
  })

  it('ignores a DSH_PYTHON_PATH that does not exist and falls through to the runtime', () => {
    saveEnv()
    const runtime = fakeRuntime()
    process.env.DSH_PYTHON_PATH = join(tempDir('dsh-filing-py-'), 'absent')
    process.env.DSH_PRIMARY_RUNTIME = runtime
    expect(findPython()).toBe(join(runtime, 'dependencies', 'python', 'bin', 'python3'))
  })

  it('finds the packaged runtime under DSH_HOME', () => {
    saveEnv()
    Reflect.deleteProperty(process.env, 'DSH_PYTHON_PATH')
    Reflect.deleteProperty(process.env, 'DSH_PRIMARY_RUNTIME')
    process.env.PATH = ''
    const home = fakeHome()
    process.env.DSH_HOME = home
    expect(findPython()).toBe(join(home, PRIMARY_RUNTIME_REL, 'dependencies', 'python', 'bin', 'python3'))
  })

  it('ignores an empty DSH_PYTHON_PATH and an empty runtime root', () => {
    onlyDefaultHome()
    expect(findPython()).toBeUndefined()
  })

  it('treats a blank override as no override', () => {
    onlyDefaultHome()
    expect(findPython('')).toBeUndefined()
  })

  it('treats an absent PATH as no PATH at all', () => {
    onlyDefaultHome()
    Reflect.deleteProperty(process.env, 'PATH')
    expect(findPython()).toBeUndefined()
  })

  it('falls back to PATH when neither the override nor the runtime has an interpreter', () => {
    saveEnv()
    const dir = tempDir('dsh-filing-path-')
    const interpreter = join(dir, 'python')
    writeFileSync(interpreter, '#!/bin/sh\n')
    Reflect.deleteProperty(process.env, 'DSH_PYTHON_PATH')
    Reflect.deleteProperty(process.env, 'DSH_PRIMARY_RUNTIME')
    process.env.DSH_HOME = ''
    process.env.HOME = tempDir('dsh-filing-home-')
    // 前导空项模拟 `PATH=:/bin` 这类写法，必须以空目录项跳过而不是拼成相对路径。
    process.env.PATH = `${dir}${process.platform === 'win32' ? ';' : ':'}`
    const found = findPython()
    expect(found).toBe(process.platform === 'win32' ? undefined : interpreter)
  })
})

describe('requirePython', () => {
  it('returns the interpreter it found', () => {
    const dir = tempDir('dsh-filing-py-')
    const interpreter = join(dir, 'python3')
    writeFileSync(interpreter, '#!/bin/sh\n')
    expect(requirePython(interpreter)).toBe(interpreter)
  })

  it('names every way to provide an interpreter when this host has none', () => {
    onlyDefaultHome()
    expect(() => requirePython()).toThrow(PatentFilingError)
    expect(() => requirePython()).toThrow(/自带 python-docx 的解释器/)
  })
})
