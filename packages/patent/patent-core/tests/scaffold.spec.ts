import { describe, expect, it } from 'vitest'
import * as Pkg from '@deepseek-ai/dsh-patent-core'

describe('@deepseek-ai/dsh-patent-core surface', () => {
  it('exports the atoms registry + builtin handler vocabulary', () => {
    expect(typeof Pkg.registerBuiltinAtoms).toBe('function')
    expect(typeof Pkg.AtomRegistry).toBe('function')
    expect(typeof Pkg.StageHandlerRegistry).toBe('function')
    expect(typeof Pkg.InterruptStageError).toBe('function')
    expect(typeof Pkg.LookupStageHandler).toBe('function')
  })

  it('exports the ModelPort adapter', () => {
    expect(typeof Pkg.createLlmModelPort).toBe('function')
    expect(typeof Pkg.collectPortText).toBe('function')
  })

  it('exports the rule protocol + text utilities', () => {
    expect(typeof Pkg.hasNegationContext).toBe('function')
    expect(typeof Pkg.parseCnNumber).toBe('function')
    expect(typeof Pkg.tryParseJson).toBe('function')
  })

  it('exports the IPC classifier + standards loader', () => {
    expect(typeof Pkg.classifyIpc).toBe('function')
    expect(typeof Pkg.classifyIpcTop).toBe('function')
    expect(typeof Pkg.loadIpcStandards).toBe('function')
    expect(typeof Pkg.queryIpcStandards).toBe('function')
  })

  it('exports the claim-chart + persistence helpers', () => {
    expect(typeof Pkg.validateElements).toBe('function')
    expect(typeof Pkg.detectGaps).toBe('function')
    expect(typeof Pkg.JsonFileStore).toBe('function')
    expect(typeof Pkg.atomicWriteJson).toBe('function')
    expect(typeof Pkg.caseOutputsDir).toBe('function')
  })
})
