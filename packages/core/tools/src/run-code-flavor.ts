/**
 * The language-specific `run_code` schema text. A language's tool
 * `description` and `code` parameter description are kept together so both
 * model-facing strings share one source of truth, and the emitter resolves the
 * flavor from the mounted runtime at schema-emission time.
 * @module @deepseek-ai/dsh-tools/src/run-code-flavor
 */

import type { PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime'

/**
 * The language-specific `run_code` schema text: the tool `description` and its
 * `code` parameter description, kept together so a language's two model-facing
 * strings share one source of truth. Keyed by `PtcRuntime.language`, mirroring
 * `SDK_RENDERERS` in {@link ./index.ts}. The emitted flavor MUST match the
 * semantics the same language's SDK instructions promise, so the model never
 * receives a TypeScript schema beside a Python SDK (or vice versa).
 */
export interface RunCodeFlavor {
  /** The tool `description` the model sees for this language. */
  readonly description: string
  /** The `code` parameter's description for this language. */
  readonly codeDescription: string
}

/**
 * Build one language's flavor text. It names only the call rules this package
 * owns: the runtime supplies evaluation syntax and state retention through
 * {@link PtcRuntime.executionInstructions}, which the transport appends to this
 * description. A language whose SDK promises a different program format
 * overrides the wording through `execution`.
 * @param language - the runtime's language name, as `PtcRuntime.language` spells it.
 * @param execution - the program-format wording for this flavor; defaults to the whole-program phrasing shared by every language.
 * @returns that language's schema text.
 */
function runCodeFlavor(language: string, execution = {
  programDescription: 'the program to execute',
  outputInstruction: 'Curate the program output.',
  codeDescription: `The ${language} program to execute, following this tool's execution instructions.`,
}): RunCodeFlavor {
  return {
    description: `Execute a ${language} program against the available tools. Takes two required arguments: `
      + `\`code\`, ${execution.programDescription}, and \`description\`, a short summary of what the program does. `
      + 'Call tools as `await tools.name(args)` per the declarations in the system prompt. '
      + `${execution.outputInstruction} Image-bearing subtool results are attached after the run.`,
    codeDescription: execution.codeDescription,
  }
}

/**
 * The TypeScript flavor: the fallback for a schema read with no runtime
 * mounted ({@link resolveFlavor} owns which readers reach that). A real
 * assembly always resolves a runtime first, so the model never sees this
 * fallback outside its own language.
 */
export const TYPESCRIPT_FLAVOR = runCodeFlavor('TypeScript')

/**
 * The TypeScript flavor for a runtime whose `programFormat` is
 * `function-body`: the `code` parameter carries the body of an async function
 * rather than a whole program, so both model-facing strings say so.
 */
const TYPESCRIPT_FUNCTION_FLAVOR = runCodeFlavor('TypeScript', {
  programDescription: 'the BODY of an async function (erasable syntax only; top-level `await` and `return` work)',
  outputInstruction: 'Only what you print or return is program output — curate it.',
  codeDescription: 'The program: the body of an async TypeScript function.',
})

/** The Python flavor, matching {@link ./py-types.ts}'s SDK instructions. */
const PYTHON_FLAVOR = runCodeFlavor('Python')

/**
 * The languages PTC mode ships a presentation for. Both per-language tables —
 * {@link RUN_CODE_FLAVORS} here and `SDK_RENDERERS` in {@link ./index.ts} — are
 * checked against this union with `satisfies`, so a language added to one and
 * not the other fails `typecheck` instead of waiting for a runtime that reports
 * it. The tables stay declared `Record<string, …>` because `PtcRuntime.language`
 * is an unconstrained `string`: this union pins what the harness ships, while the
 * `Object.hasOwn` guards reject what a mounted runtime may report.
 */
export type PtcSdkLanguage = 'typescript' | 'python'

/** Per-language `run_code` schema flavors (see {@link RunCodeFlavor}); one entry per {@link PtcSdkLanguage}. */
const RUN_CODE_FLAVORS: Record<string, RunCodeFlavor> = {
  typescript: TYPESCRIPT_FLAVOR,
  python: PYTHON_FLAVOR,
} satisfies Record<PtcSdkLanguage, RunCodeFlavor>

/**
 * Resolve the {@link RunCodeFlavor} for the loaded runtime's language, read at
 * schema-emission time so the model-visible `run_code` schema always matches
 * the SDK section's language. `peekRuntime` returns `undefined` only when no
 * runtime is mounted, which reaches this function through definition readers
 * and `schemas()` — the doc-catalog harvest is the only shipped one, and none
 * of them feeds a model, because `wireSchemas` calls `requirePtcRuntime`
 * before projecting — so that path degrades to {@link TYPESCRIPT_FLAVOR}. A
 * mounted runtime whose language has no flavor entry fails loud, exactly as
 * `requirePtcRuntime` rejects it at assembly. Keeping this table in step with
 * `SDK_RENDERERS` is the compiler's job ({@link PtcSdkLanguage}); what this
 * guard owns is the runtime-supplied language neither table knows, which never
 * yields a wrong-language schema for a real runtime.
 * @param peekRuntime - reads the mounted code runtime without throwing.
 * @returns the flavor for that runtime's language, or the TypeScript fallback when none is mounted.
 * @throws Error when a mounted runtime reports a language neither table declares.
 */
export function resolveFlavor(peekRuntime: () => PtcRuntime | undefined): RunCodeFlavor {
  const runtime = peekRuntime()
  if (runtime === undefined) {
    // No runtime mounted: reached by definition readers and `schemas()`, of
    // which the doc-catalog harvest is the only shipped one. None feeds a
    // model — `wireSchemas` calls `requireCodeRuntime` before projecting, so
    // the assembly path never arrives here. Degrade to the TS default.
    return TYPESCRIPT_FLAVOR
  }
  // Own-property read: a language like `toString`/`constructor` would otherwise
  // resolve an inherited Object.prototype member as a flavor.
  const flavor = RUN_CODE_FLAVORS[runtime.language]
  if (!Object.hasOwn(RUN_CODE_FLAVORS, runtime.language) || flavor === undefined) {
    const known = Object.keys(RUN_CODE_FLAVORS).map(name => JSON.stringify(name)).join(', ')
    throw new Error(`dsh-tools: no run_code schema flavor registered for runtime language ${JSON.stringify(runtime.language)} (known: ${known})`)
  }
  return runtime.language === 'typescript' && runtime.programFormat === 'function-body'
    ? TYPESCRIPT_FUNCTION_FLAVOR : flavor
}
