# Agent Note: A deliverable's identity is its resolved path, not its spelling

Status: implemented

English | [中文](2026-10-24-deliverable-identity-is-the-resolved-path.zh.md)

## Problem

`document_deliver` accepts `path` as a workspace-relative or absolute path, and the delivery studio (`packages/client/ui-document-studio`) used that string — exactly as the call wrote it — as the identity of a deliverable. Two spellings of one file therefore became two rows, and a rewrite under one spelling could not withdraw a verdict recorded under the other.

The measured failure: a `write` of `out/report.html` followed by a `document_deliver` registration of `/Users/me/work/out/report.html` rendered as two entries, the second carrying `format`, `gate`, and `checks` and the first carrying nothing. A user could see the file twice and had no way to tell which row described the bytes on disk.

The gap was in two places, and only fixing both closes it:

- **The client keyed on the raw string.** `producedFromTimeline` deduplicated with `seen.get(entry.path)` and matched registration metadata by the same string, while `mutationPath`/`pathValue` preserved the caller's spelling and `workspace-probe`'s `samePath` compared after stripping only a leading `./`.
- **The Host keyed check reports by the declared path.** Even a perfectly normalized client could not join a `checks` report to a deliverable recorded under a different spelling, because `checksMeta()` projected reports keyed by `entry.path`.

## Decision

**A deliverable's identity is the Host-resolved canonical path; its declared spelling is display text.**

`DeliverableCheckReport` and the studio's `DocumentDeliverable` both carry an optional `identity`, set to `ctx.fs.processPath(resolveTarget(...))` — the same canonical absolute path the file-mutation tools already record in their `tool/result` `meta.path`. `path` keeps the spelling the call wrote.

Every consumer that asks "is this the same file" answers with `identity`, and every consumer that shows a path shows `path`:

- `producedFromTimeline` keys the fold on the identity, so one file is one row.
- A row claims **both** keys — its identity and the spelling it was first seen with. This is a deliberate union rather than identity-only keying: a log recorded across this change has mutations that resolved an identity and registrations that recorded none, and identity-only keying would split that file back into two rows. Claiming both makes the fold never join less than the declared path alone already did.
- `unreadable_ack` entries match their file by the same canonical identity, so a reason written in one spelling explains a file declared in the other, and the "points at an unregistered path" warning stays quiet for one file spelled twice.
- The empty-state probe matches a listed workspace path against either key, resolving both sides so a workspace-relative listing and an absolute identity compare in one space.

**A withdrawn verdict is recorded, not merely dropped.** `augmented()` already refused to inherit a check report across a rewrite (the declaration was renewed, the verification was not), but the badge simply disappeared, which reads the same as a file that was never checked. The entry now records `checksWithdrawn` when the fold observes the withdrawal, and the studio renders the existing "file changed, not re-checked" badge for it. Because the fact is derived in the fold rather than from a workspace stat, a reloaded session reports it too.

**`identity` is optional everywhere.** Results recorded before the field existed must still parse, and the studio then falls back to the declared spelling. A present-but-malformed `identity` rejects the whole check payload, like every other field: a badge is never computed from a half-read record.

The Host half normalized the `unreadable_ack` paths *before* `resolveUnreadableReports` rather than threading `ctx`/`exec` into it. That function stays pure and synchronous, which is what its existing callers rely on, and the async `resolveAckIdentities` does the filesystem work. Observable behavior is identical either way.

## Alternatives considered

**Normalize by string manipulation on the client.** Stripping `./`, collapsing `..`, and comparing suffixes would have needed no Host change and no wire field. It cannot work: the client does not know the session's workspace root at fold time, so it cannot decide that `out/report.html` and `/Users/me/work/out/report.html` are the same file without guessing — and a wrong guess merges two genuinely different files, which is worse than the duplicate it fixes. It also cannot see through a symlink, which the Host's `realpath`-based target key does.

**Key the fold on identity only.** Cleaner to state, and it is what "identity is the key" suggests. It regresses the mixed log described above: a mutation that recorded a canonical target plus a registration whose result predates `identity` would render as two rows again. A test pins that case, and the single-key version fails it.

**Record only the canonical path and drop the declared spelling.** The studio would then show an absolute path where the user recognises `out/report.html`, and every existing snapshot and test keyed on the declared path would need rewriting. Identity and display are different jobs; carrying both costs one optional field.

**Have the studio re-resolve paths through the workspace Remote instead of the Host recording them.** That makes the fold asynchronous and stat-dependent, and the fold is a pure function over the event window that must produce the same answer on replay. Recording the resolved path once, where the tool already resolves it, keeps the derivation deterministic.

## Consequences

- One file is one row however it was spelled, and the row keeps the spelling the user first saw.
- A rewrite withdraws the verdict on the same row, and the withdrawal survives a reload.
- `identity` is a wire commitment: it rides `gate.checks[]` in the `document_deliver` presentation metadata, present for every status (`checked`, `unchecked`, `unreadable`) so a `pdf` deliverable that is never read still keys as one file. It is deliberately absent from the model-facing receipt, which reports identity only as news — the declared path the model wrote.
- The recorded `document-deliver` snapshot gains `"identity":"{{cwd}}/out/final.md"` on its next refresh, because the fixture captures the durable check metadata this change extends. The `tool-schemas` sidecar does not change: header pins carry tool `parameters`, not `output`.
- The studio's freshness-token comparison and the fold's withdrawal now agree on what "the same file" means, which is the reason both could be stated as one badge.
- This decision does not supersede [Document delivery studio](../feature/2026-08-23-document-delivery-studio.md), which settled the studio's architecture (conversation view, self-owned produced-file vocabulary, bounded read RPC); this one corrects the identity key within it, and both stand.

## Testing

- Host: two spellings produce one identity while each report keeps its declared path; identity is present on an `unchecked` format; the presentation metadata carries it beside `path` and omits the key for a legacy report; the output schema rejects an undeclared field; an `unreadable_ack` attaches across spellings, and one naming no registered file is still warned.
- Client: a relative write plus an absolute registration (and the reverse) fold to one entry; a rewrite under the other spelling withdraws the verdict and records the withdrawal; two genuinely different files stay apart; a legacy registration with no identity still folds with a resolved mutation by declared spelling; a malformed identity rejects the payload.
