# Agent Note: M1 second sink — `isPlainObject`, the errno tests, and `deepFreeze`

Status: implemented

English | [中文](2026-08-30-m1-plainobject-errno-deepfreeze-sink.zh.md)

## Problem

Three mechanical rows remained in the M1 small-helper ledger. `isENOENT` was copied five times — four lenient `(error as NodeJS.ErrnoException)?.code` casts and one strict `instanceof` check — with the same-shape `isEEXIST` copied three times alongside it. `isPlainObject` existed three times (the ledger counted two): two `unknown`-typed guards and one `object`-typed copy in api/gateway, plus an uncounted exported copy in inspector's `shared/json.ts` feeding fourteen in-package import sites. `deepFreeze` was worse than a copy count shows: besides the private settings copy, nine packages imported it from `@deepseek-ai/dsh-llm` — a heavyweight LLM package serving as an accidental home for a value primitive.

## Decision

- `dsh-value` gains four primitives: `isPlainObject` (the prototype-strict record guard), `isENOENT`/`isEEXIST`, and `deepFreeze` — the llm implementation verbatim: iterative, cycle-safe, deliberately skipping `AbortSignal` because freezing a live cancellation channel breaks abort.
- The errno tests adopt fs-local's strict form: only real `Error` instances carrying the code classify, so a non-error lookalike surfaces instead of being read as absence or as an existing target. This is the batch's only semantic delta — the four lenient copies would have swallowed such a lookalike.
- `deepFreeze` left `dsh-llm`'s public export face. Its nine workspace importers (session-title, session-title-llm, compaction-basic, compaction-tool-result-pruner, token-meter, core/session, agent-loop, tools, webhook) now import from `dsh-value`, and the moved tests live with the primitive in `value.spec.ts`.
- inspector's `shared/json.ts` re-exports the shared `isPlainObject` (the sdk/client precedent), so its fourteen import sites keep one import source while the duplicate implementation disappears.
- settings' naive recursive copy is replaced by the shared iterative version. Settings values are JSON-merged config data with no signals, so observable behavior is unchanged; a future signal-bearing value would now keep its abort channel working instead of freezing.

## Consequences

M1's mechanical rows close at zero remaining copies; each row records its closure and the retention notes in the ledger. What stays open is the semantic remainder: `toError`/`errorMessage` (consolidation changes observable placeholder text in logs) and the five abort-race wrappers (three semantics awaiting one chosen contract), each tracked as its own reviewed change.

## Alternatives considered

**Parameterize one errno test as `hasErrorCode(error, code)`.** Rejected: named predicates read plainly at call sites, and a code parameter turns the primitive into a dispatch surface for exactly two fixed errno values.

**Keep `deepFreeze` re-exported from `dsh-llm` for compatibility.** Rejected: routing a value primitive through the LLM package keeps nine value-classification imports coupled to a heavyweight runtime dependency; the pre-release stance prefers updating every reference.

**Leave inspector's copy as the owner and share from there.** Rejected: inspector is an experimental surface; a zero-dependency util package is the home every other consumer can reach without inheriting inspector's dependency graph.
