---
kind: upgrade-guide
description: "The disclosure manifest merges its problem and insight extractions into one paired call, so stage counts drop to 21/9 and run records no longer carry extract_insight."
---

# Disclosure extraction pairs problems with insights in one call

English | [中文](guide.zh.md)

## Change

`patent_disclosure_v1` no longer has an `extract_insight` stage. `extract_problem` runs `extract` with `output_mode: problem_insight`, and that one call returns `{"problem_insight": [{"id", "problem", "insight"}]}`. The handler writes the pairs plus the derived `problems` list; `merge` builds each PFIE group from one entry, so an insight can no longer attach to a different problem through array order.

The manifest has 21 stages and 9 model-calling stages, down from 22 and 10. Both rewind targets still point at `extract_problem`, so a retry re-extracts problems and insights in one call.

`merge_result` now ends with `（配对: problem_insight）` or `（配对: index）`. `flexible_plan`'s atom description names the new `output_mode`; `output_key: 'insight'` still runs the standalone slot extraction.

## Migration

1. `patent_workflow_run` callers need no argument change. Expect one fewer model call per disclosure run; confirm through the persisted record: `stages` no longer contains `extract_insight`, the three extraction stages and `merge` are not degraded, and no extraction stage appears in `degradedSteps`.
2. Recap callers that assemble stage outputs themselves drop the `extract_insight` entry and supply `extract_problem` as before. A record that still reports `extract_insight` was produced before this change and remains readable; the manifest does not schedule that stage.
3. Assertions on this manifest's stage or model-stage count move to 21 and 9. No recorded disclosure run exists under `snapshots/session`; the only pinned session snapshot touched is `snapshots/session/patent-oa-response/tool-schemas.expected.json`, updated for the `flexible_plan` atom description.
4. If you parse `merge_result`, accept the pairing suffix. `（配对: problem_insight）` states that the paired extraction produced the groups; `（配对: index）` means the state came from per-key extraction.
