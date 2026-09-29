---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-22-fork-source-attribution

English | [中文](2026-09-22-fork-source-attribution.zh.md)

## Summary

Qualifies self-evolve, sidechat, and patent-teams-report as attribution-only source kinds in the recorded session-source policy, so the three additions to the accepted format 4 baseline stay same-version instead of requiring format 5. Merging upstream `dsh-v0.2.0-rc.2` re-based this acknowledgement onto [2026-09-21-user-question-reply](2026-09-21-user-question-reply.md), so the merged schema also carries upstream's `user-question-reply` attribution kind.

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
    previous: "2026-09-21-user-question-reply"
    after: "db54cc04ba2cb7603630dfde2c1a5d479de8217deabde0c06a370ecee19922ee"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-21-user-question-reply"
    after: "6b6ac01d2684845a20d8ace37d0b08fff13f27ed5e077bda5edc88a3e02a845e"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-21-user-question-reply"
    after: "99a7dde2199675a3b2b3e12fd5bc26977a827bc669bd401eba2728259f9d456a"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-21-user-question-reply"
    after: "65413309bd7e40004a5852115a882aa1ecfabe842ec1e07e4d77037a99134cee"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The accepted format 4 baseline records neither kind, and each one is declared by a producer that only this tree ships. Before qualification the classifier read every addition as an unqualified union alternative, which the compatibility rules treat as breaking. Qualification states the reader promise these producers already meet: a reader without the producing plugin keeps the recorded message content and every source JSON property, and the kind imposes no validation, replay, or authority requirement. Behavior that inspects the kind stays inside the producer — the self-evolve loop judges its own prompts, better-sidebar renders the side-conversation boundary structurally, and patent-teams renders the sending session from senderSessionId — so no other reader loses information. Every other source kind keeps its existing qualification, the additive rule therefore applies, and the accepted 3 to 4 transition, the writer version, and all existing records stay unchanged.

<a id="verification"></a>
## Verification

pnpm run verify-persistence-catalog reports the catalog, both language pages, the known-event-types module, and the schema inventory up to date. pnpm exec vitest run scripts/persistence-changes.spec.ts scripts/persistence-schema.spec.ts: 161 tests passed. pnpm run persistence-changes --check accepts the four recorded transitions with no unacknowledged change. The rc.2 merge re-derived the acknowledged digests from the merged tree with `pnpm exec tsx scripts/persistence-changes.ts --update 2026-09-22-fork-source-attribution`; `pnpm run verify-persistence-changes` reports 82 roots matching 12 history records.

<a id="dev-note"></a>
## Dev Note

None.
