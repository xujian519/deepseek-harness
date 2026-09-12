# Agent Note: repairing the keyless recorded-session corpus

Status: implemented

English | [中文](2026-09-12-snapshot-corpus-repair.zh.md)

## Problem

`pnpm run test:snapshot`, the keyless replay tier, was red on master: 14 cases across 4 files. Nothing surfaced it because the fork's CI job runs `vitest run`, which excludes `vitest.snapshot.config.ts`. Four independent drifts had accumulated, each a merged change to model- or protocol-visible output whose fixture was never updated:

- `todo_write` grew a `tags` property (`daebc0e82f`) while the tool-schema sidecars of `sdk/system-prompt-in-history`, `session/subagent-tool-filter`, and `session/macos-tools-validation` kept the old schema.
- `SESSION_FORMAT_VERSION` moved to 3 (`f7a6221158`) while the `macos-tools-validation` directory held only a v2 generation, so the corpus policy rejected the selected generation.
- `str_replace_editor` left the default tool set (`36a4665144`) while the `macos-tools-validation` sidecar still listed it.
- The client surface began re-exporting the host `ToolCallId` (Issue #83) and the ACP handshake began advertising the package version (Issue #84), which `session/cordis-inspect-jsdoc` and every `snapshots/acp` stdout expectation still pinned to their old values.

Repairing the fixtures exposed two defects underneath the drift:

- `macos-tools-validation` configured the system-prompt plugin with `persona`, but the field is `personaPrefix`. The schema is not strict, so the unknown key was stripped and the scenario had been asserting a persona its composition never assembled.
- The ACP session-creation transcript is racy. A session announces its config options through a `config_option_update` queued off the `session/new` response and dropped once the session closes, so a scenario whose last step is that response captures the announcement or not depending on scheduling; a refresh run wrote a two-line expectation one time and a three-line one the next.

## Decision

- Regenerate the drifted expectations through the sanctioned keyless path, `pnpm run test:snapshot:refresh`, which replays and rewrites stdout expectations and comparable session fixtures. `macos-tools-validation` gains a `session.v3.jsonl` beside the retained v2 generation; every other change is a value or line-count update that the drift table above explains.
- Fix the scenario's config key so its composition assembles the persona it declares.
- Make the ACP session transcript deterministic by construction: the `newSession` input step accepts `waitForConfigOptionUpdate`, which arms a wait for the announcement *before* sending the request and awaits it after the response. Arming before the request is what makes it work — a wait registered after the response can miss an announcement that already arrived, because the client does not replay earlier updates. All seven session-creating ACP scenarios arm it; `reject-extra-dirs` rejects `session/new`, so it has no announcement to await.
- Keep the retained v2 generation: replay selects the numerically highest, and the corpus policy counts the scenario as current-writer.

## Alternatives considered

- **Commit the refresh's rewrites of `writer.expected.jsonl`.** Rejected: those diffs only re-stamp timing fields (`time`, `time0`, `dt`) that the comparison normalizes; the committed values are the reviewed fixed points and re-stamping them is unrelated churn.
- **Let the bridge announce config options before answering `session/new`.** Rejected: the bridge deliberately resolves topology off the response path, and the race only affects a transcript that stops at the response; serializing it would change production timing for every client to stabilize a test.
- **Accept both orderings as stdout variants.** Rejected: `stdoutExpectedVariants` supports only the canonical expectation plus an optional Windows-native one, and the observed difference was presence, not order.
- **Arm the wait inside the harness for every `newSession`.** Rejected in favour of the explicit scenario field: an ACP scenario whose composition announces nothing would then fail on a hidden timeout instead of declaring what it waits for.

## Consequences

The keyless tier is green and stable (three consecutive replays, 132 passed / 2 skipped), and refreshes are reproducible (two refresh runs produced byte-identical ACP expectations). The tier still sits outside fork CI, so the same class of drift can accumulate again: every one of the four drifts was a legitimate product change that shipped without its fixture. The two defects found underneath are now pinned by the tier but not by any gate of their own — a non-strict plugin config still swallows a misspelled key, and a new ACP scenario must remember the announcement wait.

## Testing

`pnpm run test:snapshot` three times (132 passed / 2 skipped each), `pnpm run test:snapshot:refresh` twice with byte-identical ACP expectations, and `pnpm exec vitest run packages/test-support/session-snapshot` (68 passed, including the new step assertion).

## Related

- [declared type dependencies, branded bridge ids, and the published agent version](../bug-fix/2026-09-12-cross-boundary-declarations.md) — the batch whose ACP version change this repair updates an expectation for.
- [tech-debt tracking in same-repository Issues](../process/2026-09-11-tech-debt-issue-tracking.md) — the audit that recorded the red tier, which Issue #92 tracks as test reliability.
