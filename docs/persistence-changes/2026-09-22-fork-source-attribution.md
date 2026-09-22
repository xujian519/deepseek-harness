---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-22-fork-source-attribution

English | [中文](2026-09-22-fork-source-attribution.zh.md)

## Summary

Qualifies self-evolve, sidechat, and patent-teams-report as attribution-only source kinds in the recorded session-source policy, so the three additions to the accepted format 4 baseline stay same-version instead of requiring format 5.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-22-fork-source-attribution
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-16-session-format-v4"
    after: "f4f2424597df0567cd59b35e60684e967deb30803600d7e34dc11d86c298880a"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-16-session-format-v4"
    after: "d8eae0dc0feb5d96561d9388d2d0b7cecbc130f0a5f01bcb49e910bd21d7a871"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-16-session-format-v4"
    after: "b11448027a364e518726379f5692fbcb3459abae999975dfb5b24a29836c030e"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-16-session-format-v4"
    after: "bca411f41b35050229d6515ed5a3c22aa0326694275521c018f3e272a7c136b3"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The accepted format 4 baseline records neither kind, and each one is declared by a producer that only this tree ships. Before qualification the classifier read every addition as an unqualified union alternative, which the compatibility rules treat as breaking. Qualification states the reader promise these producers already meet: a reader without the producing plugin keeps the recorded message content and every source JSON property, and the kind imposes no validation, replay, or authority requirement. Behavior that inspects the kind stays inside the producer — the self-evolve loop judges its own prompts, better-sidebar renders the side-conversation boundary structurally, and patent-teams renders the sending session from senderSessionId — so no other reader loses information. Every other source kind keeps its existing qualification, the additive rule therefore applies, and the accepted 3 to 4 transition, the writer version, and all existing records stay unchanged.

<a id="verification"></a>
## Verification

pnpm run verify-persistence-catalog reports the catalog, both language pages, the known-event-types module, and the schema inventory up to date. pnpm exec vitest run scripts/persistence-changes.spec.ts scripts/persistence-schema.spec.ts: 161 tests passed. pnpm run persistence-changes --check accepts the four recorded transitions with no unacknowledged change.

<a id="dev-note"></a>
## Dev Note

None.
