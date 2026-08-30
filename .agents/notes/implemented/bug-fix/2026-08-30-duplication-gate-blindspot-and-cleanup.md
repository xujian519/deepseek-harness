# Agent Note: Duplication gate blind spot and the full-scan cleanup batch

Status: implemented

English | [中文](2026-08-30-duplication-gate-blindspot-and-cleanup.zh.md)

## Problem

A full-repo scan (2026-08-30, report in `.agents/audits/2026-08-30-full-scan.md`) found `pnpm run duplication` red on master with 28 clones while CI stayed green: the fork workflow's main job ran lint, typecheck, tests, and docs but never duplication, so the failure had no witness. The clones split into 24 structural duplicates inside better-sidebar, a forked copy of the client-connection trust fence whose header still claimed "behaviorally identical" although the two copies had drifted, and one platform-command helper pair shared between browser-backend and patent-data. The scan also surfaced a model-visible defect in the DeepSeek stream translator: a tool-call block whose wire id never arrived closed into a `ContentBlock` with an empty branded id, silently poisoning tool-result correlation downstream, and two tests pinned that behavior in place.

## Decision

- The main CI job now runs `pnpm run duplication` after lint, closing the blind spot without changing the job name the master ruleset pins.
- All 24 better-sidebar clones were removed by extracting local helpers, one shared props type, and three pure modules (`src/client/drag-clear.ts`, `src/loopback-allowlist.ts`, `src/tool-result-text.ts`); behavior, exports, and copy are unchanged, guarded by the package's 152 spec files.
- The trust-fence copies stay in their own packages. Their cloned regions carry `jscpd:ignore` markers and the fork header now records the deliberate drift: the sidebar Origin fence compares hostname (Edge 151 serializes a non-default-port loopback Origin without the port), the /api fence compares host:port. The same treatment marks the browser-backend/patent-data command helpers, whose shared home is a future util-group extraction.
- `translate.ts` now fails a closed tool-call block with `MALFORMED_RESPONSE` when the wire id is absent or empty. Delta-level absence stays lenient — only the assembled block is judged. The two tests that pinned empty-id assembly now assert the rejection, one of them also pinning that the delta stream itself still tolerates the absence.
- Smaller scan findings landed with it: the seven reason-less non-null-assertion suppressions in `compaction-basic/region.ts` gained justifications, the 24 unused oxlint-disable directives in the openviking specs were removed (keeping the directives that still bite), `gatesForMode` ends in `satisfies never`, the package-group table gained desktop/mcp/patent/self-evolve, the util row no longer claims zero dependencies, and `pty-manager.ts` now credits the spawn-helper mirror to `dsh-subprocess-local`, the package that actually owns the postinstall.

## Consequences

Every PR and master push now runs the duplication gate, and master is back to a zero-clone baseline; the two documented forks remain as marked exceptions rather than silent debt. A provider response whose tool-call id never arrives now fails at translation time with `MALFORMED_RESPONSE`, so no empty branded id can reach the session log or tool-result correlation; the delta stream and every well-formed response behave exactly as before. Lint returns to zero warnings, and the scan's registration gaps — suppressions without reasons, a stale comment, a stale note premise, four missing group-table rows — are closed at the source.

## Alternatives considered

**Merge the trust fences back into one exported helper.** Rejected for now: the packages do not depend on each other, and the Origin-comparison difference is a security-semantics choice (hostname comparison admits same-host cross-port pages; that trade is what fixed Edge 151). Unifying it is a policy decision that must cover both fences, not a refactor of one.

**Extract the platform-command helpers into a util-group package now.** Deferred: it adds workspace dependencies to browser-backend and patent-data and belongs with the wider M1 small-helper sink; the ignore markers keep the gate honest until then.

**Keep the translator's empty-id fallback and add a validation elsewhere.** Rejected: the empty branded id crosses into the session log and tool-result correlation where nothing else can recover the identity; the assembler and the replay fixture both consume the assembled block, so close time is the only point where the fact is still decidable.
