# Agent Note: Extracting the python runtime's fd-3 frame reader (Issue #86)

Status: implemented

English | [中文](2026-09-14-code-runtime-python-frame-reader.zh.md)

## Problem

`packages/experimental/code-runtime-python/src/index.ts` kept the fd-3 frame reader — the byte buffering, both oversized-frame rejections, and the hostile-frame drops — inline in `PythonCodeRuntime.execute`'s promise executor, between the ledger wiring and the frame handlers. Every decode outcome was reachable only by driving a real CPython child to write the exact bytes, so the illegal-UTF-8 case, the unsafe-integer token, malformed JSON, both oversized paths, and the fragment-count seal each cost a 40–120 s subprocess case in `tests/runtime.spec.ts`. No surface existed that a test could hand a byte sequence to.

[The split plan](../../proposed/simplification/2026-09-14-god-file-split-plan.md) names this cut as batch 2's first item, and predicted it would need "a frame callback protocol carrying the raw line length".

## Decision

`src/frame-reader.ts` owns the reader behind one factory. `src/index.ts` keeps the `if (settled) return` guard, the post-batch outstanding-call check, `handleFrame`, `finish`, and the ledger wiring, and now constructs the reader and calls `reader.push(chunk)` as the last statement of the `data` listener.

| Export | Owns |
| --- | --- |
| `FrameReaderOptions` | `frameParseCapBytes`, `onFrame`, `onOversized` |
| `FrameReader` | the single `push(chunk: Buffer)` operation |
| `createFrameReader(options)` | the unframed buffer, the pre-join byte cap, the first-frame measurement, the newline loop and its three drop reasons, and the fragment-count seal |

### Both callbacks are arrow wrappers, and the compiler enforces it

`handleFrame` and `finish` are `const`s declared later in the same executor scope, so `createFrameReader({ onFrame: handleFrame, onOversized: finish })` does not compile (TS2448/2454). The wrappers keep the reader's construction above the consumers it names, and the error is what holds that order. The runtime premise is independent: `proto.on('data')` only registers a listener, and Node cannot emit before `execute()`'s synchronous body returns.

### No raw line length crosses the callback

The plan's predicted parameter has no consumer. Both oversized messages interpolate the CAP value and are built by the `onOversized` callback; `log` frames are priced by the ledger's serialized-text cost; and the frame envelope is subtracted from the cap at configuration time. `onFrame` receives the rebuilt `ChildToHost` and nothing else — an unused parameter would violate the package rule requiring a current owner and need.

### Three mechanical constraints the moved code carries

- **`Buffer.concat` stays a property call.** `tests/runtime.spec.ts` assigns to the global `Buffer.concat` and `tests/stray-fragments.spec.ts` spies on it, both to distinguish sealing from re-joining by measured copy volume. A module-load destructure of `concat` would silently disarm those assertions: they would still pass.
- **Both oversized paths keep their early `return`.** They are sequential `if`s broken by `return`, not an `if`/`else` chain. Falling through would run the first-frame scan, `Buffer.concat`, and `detachResidual` over buffers that were just cleared — invisible in behavior, since `finish` is idempotent and the run is already settled, which is why the unit tests spy on `Buffer.concat` and assert it is never reached on a rejected frame.
- **No `try`/`catch` wraps `onFrame`.** A throw from `handleFrame` is an uncaught exception in the `data` callback; catching it would silently change that.

The newline loop still processes the rest of a batch after a frame that settles the run, and neither implementation can observe the difference (`handleFrame` returns immediately once `settled`). The reader referencing no settlement state is what preserves it.

### Testing

`tests/frame-reader.spec.ts` feeds byte sequences straight to `push` and covers fragment accumulation, the carried residual, the seal, both oversized paths, and the three hostile-frame drop reasons. The real-subprocess cases stay: they are the evidence for the wire contract, and the unit tests are additive.

The move also deleted the `/* v8 ignore next */` above the empty-line `continue`. Its stated reason — that an empty line could only come from a forged `\n\n` write — was a limitation of the old test rig, not an unreachable branch; `push(Buffer.from('\n\n'))` covers it.

## Alternatives considered

- **Passing `handleFrame` and `finish` by reference.** Rejected: it does not compile, and the arrow wrappers are what keep the declaration order the executor needs.
- **A terminal flag inside the reader.** Rejected: `onOversized` settles the run through `finish`, and the host's own `if (settled) return` guard stops feeding the reader afterwards, so a reader-side flag is unreachable and would fail the per-file coverage gate.
- **Extracting `handleFrame` in the same cut.** Rejected: it closes over the executor's per-run state (`settled`, `bootAckGate`, `ledger`, `nextCallId`, `bindings`, `pendingCalls`, `config`, `sendReply`, `finish`, `checkDoneValue`, and the child), so the cut would invent a context object — and the plan keeps the ledger's contract with the `log` frame branch, which that function's `log` arm is half of, for its own batch-2 item.
- **Moving `MAX_PENDING_CHUNKS` and `detachResidual` into the reader.** Rejected: `src/output-ledger.ts` documents them as shared by both readers, which is why neither owns them.
- **A class instead of a factory.** Rejected: the reader has one operation and no readable state, so a `class FrameReader` would add only a constructor; the ledger's class form is justified by the state a test reads out of it (`lines`), which the reader has none of.

## Consequences

`index.ts` loses 163 lines (178 removed, 15 of them the wiring the call site now carries) and the reader's six decode outcomes become reachable in milliseconds instead of minutes: the new spec runs in 206 ms against the 40–120 s the subprocess cases take. The cut adds one module and one spec file; no snapshot, fixture, or existing test needed an edit.

Two fragile points stay with the subprocess suite and are worth naming. The seal's true side rests on `tests/runtime.spec.ts:4696` and one pipe-timing-dependent case, so the former is the only case designed to make a seal happen — reducing its write count would drop the branch's coverage. And `/* v8 ignore next */` ignores the NEXT line: the annotation that travelled with the `settled` guard must stay immediately above it, since no gate checks that correspondence.

## Related

- [Splitting the seven god files](../../proposed/simplification/2026-09-14-god-file-split-plan.md) (the plan; this is its batch-2 first item)
- [Extracting the python runtime's cost and log-ledger modules](2026-09-14-code-runtime-python-cost-and-ledger.md) (batch 1 of the same package)
- `packages/experimental/code-runtime-python/tests/runtime.spec.ts` (the subprocess cases that stay)
