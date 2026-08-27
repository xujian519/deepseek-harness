# Agent Note: Harden stream-chunk folding against malformed deltas

Status: implemented

English | [中文](2026-08-27-hardening-stream-chunk-folding.zh.md)

## Problem

A session whose assistant stream carried a malformed chunk crashed the whole conversation tree instead of degrading. Three cases reached the renderer: a stream-chunk block index that was negative, fractional, or absurdly large; a `text-delta`/`reasoning-delta`/`tool-call-delta` whose payload was not a string; and a `block-end` whose `block` was not an object. The partial accumulator (`packages/client/runtime/src/client/sessions/partial.ts`) wrote the index straight into a sparse `blocks` array, the projector (`packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts`) did the same on the conversation-node side, and `AssistantMarkdown` fed `block.text` into the markdown renderer unchanged. A null `block-end` payload throws in `toAssistantBlock`; a non-string text later reaches `MarkdownText`. On a long-running team task this surfaced as a white screen when the conversation panel was opened.

## Decision

Both the `PartialAccumulator` and the conversation-node `updateChunk` now validate the block index and payload before writing a block:

- A `block-start`/`text-delta`/`reasoning-delta`/`tool-call-delta`/`block-end` requires an integer index `>= 0` (`isBlockIndex`); deltas additionally require a string payload.
- A `block-end` requires a non-null object (`isBlockPayload`) so `toAssistantBlock` only sees a real `ContentBlock`.
- `AssistantMarkdown` coerces a block body through `textOf`, mapping any non-string to `''`, so the markdown renderer never receives a non-string.

A malformed chunk is skipped: the accumulated blocks stay as-is instead of either writing an out-of-range slot or throwing. `isVisibleAssistantChunk` and the push contract are unchanged, so a skipped chunk simply does not count as a visible change. A new client spec (`stream-chunk-resilience.client.spec.tsx`) projects malformed and extreme chunks and renders their blocks without throwing.

## Alternatives considered

**Feed the renderer a string at render time only.** Rejected because it leaves the out-of-range/sparse slot and the `toAssistantBlock` throw in place — the crash is in the projector, not the renderer alone.

**Validate only the index, not the payload.** Rejected because a non-string delta or a null `block-end` still reaches `toAssistantBlock`/`MarkdownText`.

## Consequences

A malformed assistant chunk now degrades to a skipped block instead of crashing the conversation tree; the white screen on opening a team-task conversation panel no longer reproduces. Because the defensive checks run on both the accumulator and the projector, the projection survives whichever path the chunk arrives through. The cost is a per-chunk index/payload check, negligible next to the render work.
