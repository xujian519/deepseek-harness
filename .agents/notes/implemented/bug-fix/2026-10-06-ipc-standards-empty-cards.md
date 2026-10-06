# Agent Note: Backfill the empty IPC examination-standard cards and gate their source

Status: implemented

English | [中文](2026-10-06-ipc-standards-empty-cards.zh.md)

## Problem

Twenty-one of the 138 IPC examination-standard cards in `packages/patent/patent-core/assets/ipc-standards.yaml` carried neither `keyPoints` nor `tips`, and three more carried `keyPoints` without `tips`. An empty card was not inert: `formatStandardsAsContext` fell back to empty strings for both arrays and still emitted the bare title line `- [A61] 创造性-三步法-A61医药 (patent-law-a22.3)` into `<memory-context>`. The card claimed to supply the inventive-step examination standard for its IPC section and supplied nothing, spending context budget while inviting the model to read the entry as a covered section. `ipcStandardsByArticle('patent-law-a22.3')` returns 56 cards at once, 24 of which were empty.

The source material was never missing. The extraction had read only each source file's main page, and the main pages had been split into sub-pages: `创造性-审查标准-门窗.md` is 1894 bytes and contains no `###` point section at all, with its content moved to `创造性-审查标准-门窗-拆分-01-决定要点.md`. The payload sat one directory level away from where the extractor looked.

Nothing would have caught the result. `tests/ipc-standards-loader.spec.ts` asserted only `Array.isArray` and inspected the first ten cards, all of them complete, so an edit that emptied a card, or a source refactor that emptied the page behind one, stayed invisible. The asset's own `source` field and its header comment both omitted the `Wiki/` path element, so locating a source file by the recorded path returned nothing.

## Decision

Backfill all 24 empty cards of the inventiveness domain (`article: patent-law-a22.3`) from `宝宸知识库/Wiki/复审无效/`, one `keyPoints` judgement rule plus five `tips` practical notes each, matching the format of the 43 cards that were already complete. Cards whose main page carries no point section draw on their split sub-pages; that is where the payload for eleven of them lives. The remaining 71 cards with empty `tips` belong to the novelty, description, claims and design domains and are out of scope here.

`formatStandardsAsContext` skips cards whose `keyPoints` and `tips` are both empty and returns an empty string when no card has substance, so a card can no longer reach the model as a title with nothing under it.

Three mechanisms keep the state from regressing. A non-empty assertion covers every card in the shipped asset, and a second assertion holds each `source` to the `宝宸知识库/Wiki/` prefix. `scripts/verify-ipc-standards-source.ts` is a new gate that reads the asset, resolves each `source` against the knowledge library, accepts the main page or any split sub-page as the carrier, and fails on a source that is missing, malformed, or carrying no extractable point section; it takes the library root from `DSH_IPC_STANDARDS_SOURCE_ROOT` and is registered in the hygiene gate group. The `Wiki/` element is corrected in the header comment and in all 138 `source` values, which is what makes the gate's lookup and the manual round-trip work at all.

## Alternatives considered

**An override file beside the asset, the shape used for `nuo-*.yaml`.** The precedent does not transfer. `nuo-*.yaml` carries an active upstream re-sync that would overwrite a hand edit, and [the field-level activation patch note](../feature/2026-09-20-field-level-activation-patches.md) exists to survive that. This asset has no generator in either repository, so nothing overwrites it; the live problem is three drifting copies (one here, two in Mady) rather than a resync, which is the opposite hazard. The loader also has no field-level overlay to extend: `loadIpcStandards` accepts only a whole-file `overridePath`.

**Leave the data and make the loader warn.** Treats the symptom. The card would still claim a coverage it does not have, and the model would still be the one drawing the conclusion.

**Backfill all 95 cards with empty `tips`.** Roughly four times the work, and 71 of them sit in other domains whose cards are not part of this defect; most already carry a usable `keyPoints`.

**Let the gate pass silently when the source library is absent.** The library is not self-contained, so the check belongs at the earliest resolvable point: with no library configured the gate reports that the payload check did not run, and an explicitly configured path that does not exist fails as a configuration error rather than reading green.

**Backfill without any guard.** The library is an active repository whose files keep moving; the empty state would return unnoticed.

## Consequences

Double-empty cards are gone and all 56 inventiveness-domain cards are complete. The wider gap is only partly closed: 71 cards outside this domain still have empty `tips`, and 21 of the 138 cards have both fields empty in the source library itself, so their content cannot be recovered from it.

The gate adds a local dependency on a path outside the repository. Without `DSH_IPC_STANDARDS_SOURCE_ROOT` and without a sibling library it validates the 138 `source` prefixes and prints that the payload check did not run; in that configuration it cannot detect a source refactor.

Copy drift is unchanged: Mady holds two byte-identical copies of this asset, and neither a gate nor a shared generator keeps them aligned with the copy here. [The Mady import assessment](../architecture/2026-10-06-mady-import-assessment-empty.md) found the same asset byte-identical across the repositories; this backfill changed one of three copies.

## Testing

`tests/ipc-standards-loader.spec.ts` asserts that no shipped card has both arrays empty, that every `source` starts with `宝宸知识库/Wiki/`, and that `formatStandardsAsContext` drops an empty card from a mixed list and returns an empty string when every card is empty. `scripts/verify-ipc-standards-source.spec.ts` covers the three rejection forms — a main page carrying only a core-standard section, a source missing the `Wiki/` element, and a missing file — plus the case where a split sub-page carries the payload and must pass.

`packages/patent/patent-core` reports 798 tests across 53 files, the `patent-` recorded-session snapshots report 11 passing, and the changed files pass oxlint and `tsc -b tsconfig.host.json`. Run against the real library the gate reports all 138 cards verified, and it exits non-zero against an explicitly configured path that does not exist.

`ipc-standards-coverage.spec.ts` previously reached its no-`ipcDetail` formatting branch through a card with no content, which pinned the bare-title behaviour this change removes; that fixture now carries a `keyPoints` entry and covers the branch it was written for.