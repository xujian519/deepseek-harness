# Agent Note: A local helper copy survives only on a contract of its own

Status: implemented

English | [中文](2026-09-14-local-helper-copy-rulings.zh.md)

## Problem

The 2026-08-28 sweep collapsed the cross-package helper families into `@deepseek-ai/dsh-value`, `@deepseek-ai/dsh-util-values`, and `@deepseek-ai/dsh-timeout`, and the 2026-09-12 batches (#110–#114) converged the copies that came back. Issue #87 asked for the families to be re-measured against the current tree, because the ledger twice recorded "converged / 0 remaining" while copies were still live, and because four families it did measure (`sleep`, abort races, `hasExactKeys`, `isAbortError`) had drifted from what it said.

Re-measured on 2026-09-14 against `7a031dcbe8`, three real copies remained inside `packages/*/*/src`, each contradicting the ledger: `isRecord` in [`ask-question-row.tsx`](../../../../packages/client/ui-tool/src/client/tool/toolviews/ask-question-row.tsx) (missed by the 09-12 sweep), `asRecord` in [`ContextBody.tsx`](../../../../packages/client/ui-chat/src/client/chat/ContextBody.tsx) (in a package that already imported the shared one from a sibling file), and `isDeepEqualJson` in [`core/session/src/surface.ts`](../../../../packages/core/session/src/surface.ts), whose recorded reason for staying — "replaces `node:util`'s `isDeepStrictEqual` to keep this module browser-safe" — no longer described anything: the module already imports `isRecord` from `dsh-value`, and `dsh-util-values` is a dependency of that package with no `node:` import anywhere in it.

Reading the two copies side by side also exposed a defect in the shared one. `deepEqualJson` decided key presence with `key in right`, which sees inherited names. `JSON.parse('{"__proto__":{}}')` creates an *own* `__proto__` data property, so comparing it against `{"other":1}` reads `right['__proto__']` as `Object.prototype` (one key, no enumerable keys of its own), recurses into an empty key set, and reports the two records equal. The local copy used `Object.hasOwn` and did not have the bug.

## Decision

- **The three copies converge into the shared packages.** Two are client packages, so `dsh-value` enters their `devDependencies` beside a tsconfig reference, the same treatment [`ui-chat`](../../../../packages/client/ui-chat/package.json) and [`file-upload`](../../../../packages/client/file-upload/package.json) already give it; `core/session` already declares `dsh-util-values`, which is where `deepEqualJson` lives.
- **The shared `deepEqualJson` compares own enumerable keys.** `key in right` becomes `Object.hasOwn(right, key)`, and the JSDoc states the guarantee. This is not a cosmetic difference: [`settings`](../../../../packages/settings/settings/src/index.ts) and [`settings-file`](../../../../packages/settings/settings-file/src/index.ts) use the function as the gate on "did this configuration change", so a false equality silently drops a write.
- **A surviving copy must carry a contract the shared version does not.** The kept ones, each recorded in the ledger table with its reason: the four `abortable` variants (classified abort value, a post-race re-check of the signal, a `WEB_ABORTED` domain error, and a value-or-promise input), the three `waitWithAbort` variants (an `Error`-escape adapter, a `SessionQueryError`, an `Error` normalizer), `sleep`'s two divergent forms (an `unref`'d timer for a dispose grace, one that accepts an `AbortSignal`), `dsh-subagent`'s exported three-parameter `assertPositiveFinite` (prefix carried separately, throws `Error`), and `session-query-sqlite`'s domain-error wrapper.
- **Copies outside the published surface are not in scope.** `apps/` and `scripts/` hold ten `isRecord` copies each, plus a two-parameter `hasExactKeys` in `scripts/client-build-environment.ts`. They are one-line narrowing predicates inside an application shell and repository tooling; converging them would add workspace dependencies and build prerequisites to those trees for no shared behavior.
- **The 188 inline `instanceof Error ? <expr>.message` sites stay.** Each renders a thrown value in the `catch` block that caught it, so converging them would add a dependency and a project reference to roughly a hundred files to gain one semantic step (an object with a string `message` renders as that message rather than `[object Object]`) plus the hostile-proxy guard.

## Alternatives considered

- **Sink `sleep` into `dsh-timeout` to close the family.** Rejected: the bodies share nothing to keep in sync — no deadline, no cancellation, no upper bound — while two of the four differ by `unref` and by accepting a signal, so one signature would need options that exist for a single caller. `dsh-timeout`'s identity is deadline arithmetic and timeout-versus-cancel classification; a bare wait would sit beside `deadline` without either.
- **Converge `dsh-subagent`'s three-parameter helper in this batch.** Deferred: it is a public export consumed by three providers, and converging it changes their thrown type from `Error` to `TypeError`. That is a mechanical change, but of a different blast radius than deleting private locals, and it belongs in its own reviewable batch.
- **Keep the local `isDeepEqualJson` and leave the shared comparator alone.** Rejected: it is the copy that is right, so keeping it would preserve the false equality for the settings gate, which is the higher-blast-radius consumer of the two.
- **Drop the redundant local copy without hardening the shared one.** Rejected for the same reason — it would have moved `core/session` onto the buggy comparison.
- **Converge the inline ternaries family.** Rejected: see the Decision; the ledger now records the ruling instead of deferring it to the issue.

## Consequences

`core/session`, `settings`, `settings-file`, `llm-pi-ai`, `llm-deepseek`, and `session-format-v1-to-v2` compare records by own keys from now on. For values in the JSON domain the two predicates agree everywhere except the case above, where the previous answer was wrong; nothing else about comparison changes. The three converged packages lose one local function each and gain one import.

`.agents/notes/rejected/simplification/2026-07-26-dependency-swaps-rejected-by-nih-audit.md` rejected swapping this same copy for `fast-deep-equal` because it would have introduced a core package's first *external* runtime dependency. This ruling points the copy at an in-repository package that `core/session` already depends on, so it does not reopen that decision.

## Testing

`packages/util/values/tests/values.spec.ts` pins the `__proto__` case and the ordinary record path. Against the previous `key in right` the case fails with `expected true to be false`; with `Object.hasOwn` it passes, and the file is the first test suite that package owns. The changed packages' suites, both compiler faces, lint, `duplication`, the documentation aggregates, and the translation pairing are the checks this change must keep green.

## Related

[Published dependency faces](../process/2026-08-26-published-dependency-faces.md) owns the dependency-section policy the two client packages follow. [Dependency swaps rejected by NIH audit](../../rejected/simplification/2026-07-26-dependency-swaps-rejected-by-nih-audit.md) is the standing rejection this ruling stays consistent with.
