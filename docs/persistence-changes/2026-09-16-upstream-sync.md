---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-16-upstream-sync

English | [中文](2026-09-16-upstream-sync.zh.md)

## Summary

The synchronized tree carries nineteen persisted event roots and one optional event-body property that upstream's baseline never recorded: agent/request-error, patent/plantask, patent/workflow-run, the nine patent-teams/* events (member-added, member-removed, message-sent, task-created, task-gated, task-updated, task-validated, team-created, team-deleted), the seven self-evolve/* events (commit, end, mined, proposed, reflection, start, validated), and data.todos[].tags on todo/write. The recorded history only acknowledged upstream's roots, so every one of these now reads as an unacknowledged addition.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-16-upstream-sync
baseline: false
changes:
  - root: "event:agent/request-error"
    previous: null
    after: "3ce68f22dbe500044770c3e747ecb29ff058f9be23b20cfb433b5115b14687fb"
    decision: same-version
  - root: "event:patent-teams/member-added"
    previous: null
    after: "f12d2b6080a4b7dee55ebea0fdea0070909b7e5976cd6e022e72a28fd97ffe18"
    decision: same-version
  - root: "event:patent-teams/member-removed"
    previous: null
    after: "3b2f4b5d180cf4afa508cbc700d078341e4847611ecc60b80f6a9486a20e000a"
    decision: same-version
  - root: "event:patent-teams/message-sent"
    previous: null
    after: "f7952fb11e7169b6558dd1b2dfb976b9ae100d3b202492c99a12f3f6c863d4d3"
    decision: same-version
  - root: "event:patent-teams/task-created"
    previous: null
    after: "85631eca17553f2b7d209edc198f285f106a01eff88220cdda729513595d5b4c"
    decision: same-version
  - root: "event:patent-teams/task-gated"
    previous: null
    after: "02e1998cf81c86b9eb92d048ad9994f2f8bc36bdc26e1e16dc7aa30eccf1ffb7"
    decision: same-version
  - root: "event:patent-teams/task-updated"
    previous: null
    after: "98d71d18d263fbc1a38e1a314d243e4bcb350b11f419f31c0c42c0a03d1adc09"
    decision: same-version
  - root: "event:patent-teams/task-validated"
    previous: null
    after: "3de55eacf0f371e68d78f99aad63fd0a8b72e6f64d1acc1c1392f0e30dd475c8"
    decision: same-version
  - root: "event:patent-teams/team-created"
    previous: null
    after: "d3403e99eac7930bea2f320fece4f5170255ed812c6bdb5c0b2057e5c8d47010"
    decision: same-version
  - root: "event:patent-teams/team-deleted"
    previous: null
    after: "6ccaff85d31459a300c449653602514c34489d856e2e1bc31d9a27b77e634d95"
    decision: same-version
  - root: "event:patent/plantask"
    previous: null
    after: "21031fbcbdff405ad47179a7acc9fb7bcf70e838ee106d70f7aa26604fb61ce5"
    decision: same-version
  - root: "event:patent/workflow-run"
    previous: null
    after: "81664fc5119d57f14ba526b8480c4264e98f716e12bf717aa01e7d9fac6c76da"
    decision: same-version
  - root: "event:self-evolve/commit"
    previous: null
    after: "4ec3446a838614d12c506302b6c9cb6eb59e9b478840ab4ac7fba0e78bf66016"
    decision: same-version
  - root: "event:self-evolve/end"
    previous: null
    after: "1388c9a96fb4f7bb44ff675188121659b3d8714369eb761db1fbd51a7ceeb2d9"
    decision: same-version
  - root: "event:self-evolve/mined"
    previous: null
    after: "f4e68d27424e4bee890165330db6ac45cbfcd3c8fedf4f05b53931f3e614cb4b"
    decision: same-version
  - root: "event:self-evolve/proposed"
    previous: null
    after: "99588ecf33e317788daf0cb0c6c59c7398b1edb16db31ab0ea5c7062b2e5161c"
    decision: same-version
  - root: "event:self-evolve/reflection"
    previous: null
    after: "65a9d813bdd59744577a5e1301cd107df818197ad7768dd859a2d6a69a413db7"
    decision: same-version
  - root: "event:self-evolve/start"
    previous: null
    after: "3941545fcf511ea09245d6327c6b58dac7462d98f9d3e71c80293605e42414dd"
    decision: same-version
  - root: "event:self-evolve/validated"
    previous: null
    after: "b34fa6922bab30f7cd3dd40653128741936986f3de1258eae1741c1e78c8498b"
    decision: same-version
  - root: "event:todo/write"
    previous: "2026-09-11-initial"
    after: "df5b1fe42a0660d1a3c4beb7c4f20a6a8b5d2857b9efaeb554c9dde9ea75e8b2"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Each new event root is an ordinary event type added to the persisted log vocabulary, and data.todos[].tags is an optional property on an existing event body. Records written before the addition simply omit them, and a reader that predates them ignores unknown event types and an absent optional property, so replay of older records is unchanged. No existing event body gained or lost a required property, no property changed type, and neither the Session header nor the event envelope moved, so the change stays inside the same Session format version.

<a id="verification"></a>
## Verification

The record's after-schema snapshots are extracted from the same source inventory that produces docs/persistence-schema.json, so each affected root's recorded digest equals the current inventory digest, and pnpm run verify-persistence-changes then reports the current roots matching the recorded history with exit code 0. pnpm run verify-persistence-catalog and pnpm run verify-persistence-formats remain clean over the same inventory.

<a id="dev-note"></a>
## Dev Note

None.
