---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-10-fork-attribution-resync

English | [中文](2026-10-10-fork-attribution-resync.zh.md)

## Summary

The v0.2.1-alpha.2 sync merged two attribution-only source-kind sets that each acknowledged the same predecessor. The fork's record (2026-09-22-fork-source-attribution) added `self-evolve`, `sidechat`, and `patent-teams-report`; the release's record (2026-10-05-working-directory-attribution) added the working-directory notice attribution. The two chains both named 2026-09-21-user-question-reply as their predecessor, which forked the history for `event:agent/inbox/spliced`, `event:developer/message`, `event:session/title-llm-request`, and `event:user/message`. The release's record now follows the fork's, and this record acknowledges the union the merged tree actually carries.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-10-fork-attribution-resync
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-05-working-directory-attribution"
    after: "0301e3760af7d7b861307251541c66628f38cb5262f1a8c9c82c17371806f106"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "bd7509f598012013bdb94741ff9986e75d53fcc81f024b8cd9152b4d69ce6a36"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-07-title-reasoning-effort"
    after: "d6688ca27df5baaffd4afeb0546ad20c7dde5213c712b6455c92140e634cc9e4"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "08021596969fdb8642e489e078da36fc75bc4ad7dc1e0a1a709926daa5d36ff3"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid. Every source kind this record adds is attribution only, and the declared source policy preserves unknown attribution without interpreting it. The Session format remains at version 4.

<a id="verification"></a>
## Verification

pnpm run verify-persistence-changes: 4 roots match the acknowledged history, and the recorded after digests equal the schemas the current tree derives.

<a id="dev-note"></a>
## Dev Note

None.
