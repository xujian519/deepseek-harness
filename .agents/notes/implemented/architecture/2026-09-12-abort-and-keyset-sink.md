# Agent Note: M1 third sink — the abort and key-set predicates

Status: implemented

English | [中文](2026-09-12-abort-and-keyset-sink.zh.md)

## Problem

The 2026-09-11 re-measurement refuted M1's "0 remaining" claims and named two predicate families the ledger had never recorded. `isAbortError` existed five times in two shapes: inspector and the three `web-search-*` providers tested `instanceof DOMException`, while `fs-local` tested `instanceof Error` — one question answered from two different runtime assumptions. `hasExactKeys` existed three times with three signatures: `schedule` compared sorted key lists, `llm-replay` compared a count plus presence, and `subprocess-local` carried the richest form (`required` plus `optional`). Every copy re-derived a boundary check its package could take from `@deepseek-ai/dsh-value`.

## Decision

- `dsh-value` gains `isAbortError` and `hasExactKeys`.
- `isAbortError` keeps the strict form: a real `Error` whose `name` is `AbortError`. An aborted `AbortSignal` carries exactly that value, `fetch` rejects with it, and the `DOMException` behind it extends `Error` in every supported runtime (Node 22+ and current browsers), so the predicate subsumes the `instanceof DOMException` copies rather than re-classifying what they saw. A non-`Error` lookalike carrying the name surfaces to the caller, matching the `isENOENT`/`isEEXIST` contract.
- `hasExactKeys` adopts `subprocess-local`'s signature — `required` plus `optional`, own keys only. The other two copies are call sites of that form with no optional keys.
- `subprocess-local`'s local `isRecord`, in the same file as its `hasExactKeys`, collapses onto the authority as well.
- Each consumer declares `@deepseek-ai/dsh-value` in `dependencies` and adds the missing TypeScript project reference. The three web providers keep their local `isPositiveInteger`; the ledger now records that family and its missing owner.

## Consequences

Nine local definitions disappear: five `isAbortError`, three `hasExactKeys`, and one `isRecord`. The predicate and its failure text now have one owner, so the next correction lands once. The only semantic delta is the tightening `isAbortError`: a `DOMException` named `AbortError` classified as an abort before and still does, while a non-`Error` lookalike that used to classify now surfaces.

The M1 ledger table states the re-measured residuals instead of "0 remaining", records this convergence, and records `sleep` as evaluated and deferred: its copies fork on `unref` (the worker-thread dispose grace must not hold the process open) and on abortability, and neither shared package owns a timer wait that may be unref'd and aborted. Issue #87 stays open for the residual families.

## Alternatives considered

**Keep the web providers' predicates local.** Rejected: their comment defends not exporting a generic internal from the public web seam, which importing the shared predicate does not do — the providers' public API is unchanged.

**A duck-typed `value.name === 'AbortError'` check.** Rejected: it classifies a lookalike object as a cancellation, silently turning a real failure into an "aborted" outcome; `isENOENT` already set the strict precedent.

**Sink `sleep` in the same change.** Rejected: the copies are not one function. Converging them requires choosing a contract for `unref` and abort that no existing consumer justifies yet.
