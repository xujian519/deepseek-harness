---
kind: upgrade-guide
description: "@deepseek-ai/dsh-patent-law records the three confirmed 2026 guideline sections as revision overrides and lets a citation select a guideline revision."
---

# Guideline index gains 2026 section overrides

English | [中文](guide.zh.md)

## Change

`LawBaseline` gained `versions`, a list of revision-specific section overrides. The shipped guideline index now carries one version, `2026 年修订版（2026-01-01 施行）`, with the three sections the 2025-11-13 change table (局令第84号) confirms it changed: 第二部分第一章4.4, 第四部分第三章2.1, and 第四部分第三章3.3. Their text was transcribed from the new column of the official change table, dropping the wording its colour marks as deleted. The other 61 named sections keep the 2023 text and are not claimed to have been updated.

`verifyCitation` gained `VerifyOptions.revision`. Without it, the verifier uses the latest transcribed override when the current revision is among the transcribed ones, and keeps the base text for sections the override does not name. When `supersededBy` names a revision the index has not transcribed, the base text and its stale marks decide. Versions are declared oldest first; when several are declared, the last one is the default. Naming the base revision (`2023 年修订版（2024-01-20 施行）`) decides those three sections against the 2023 text and reports them `unverified` through `staleSections`. Naming a revision the index does not carry reports `unverified` instead of falling back.

`law_verify` has no revision argument and therefore uses the latest override: a citation to one of the three sections now reports `valid` (or a proposition decision) against the 2026 text instead of `unverified`.

## Migration

1. If you construct a `LawBaseline` directly, add `versions: []` when the index has no later revision. The shipped loader fills it from the asset; only hand-built fixtures and tools need the field.

2. If a test expected one of the three sections to be `unverified`, either update it to the 2026 decision or pass `{ revision: '2023 年修订版（2024-01-20 施行）' }` to keep the old decision.

3. Do not treat the index as a complete 2026 edition. Only these three sections have 2026 text; the remaining sections are still the 2023 revision, and the index's paths have not been renumbered for the 2026 revision.

4. Confirm with `pnpm exec vitest run packages/patent/patent-law/tests`.
