# Agent Note: Compact large tool results to bound prompt size

Status: proposed

English | [中文](2026-09-01-large-tool-result-compaction.zh.md)

## Problem

In `dsh-session-463b73d4` the per-step prompt averaged 132K tokens and grew to about 188K by the last step, with a 97% cache-hit rate. Large tool results persisted across many later steps: patent text excerpts returned 10–16K characters each at steps 13 and 14, and a directory listing returned 7.8K characters at step 2. Because every later step preflits over the same accumulated context, prompt size and step latency rise together.

The harness already keeps the full tool result in append-only history, so compacting the model-visible form does not lose evidence — but nothing today caps what a step must read back.

## Proposal

Automatically project large tool results into a bounded model-visible form before they enter the next request. Above a configurable threshold, the result is truncated to its leading window plus a deterministic tail marker and a short summary of what was trimmed; the full result stays in the session log and is reachable by re-reading the referenced file or a narrower `offset`/`limit` slice. The projection is deterministic and reconstructable from the log, consistent with the model-visible-⟺-logged invariant. The threshold is a validated `Config` field, not a constant or test hook; the user can raise or disable it from cordis.yml.

## Alternatives considered

- **Keep every result fully.** Unbounded prompt growth; the session shows the cost.
- **Re-read in slices, never auto-compact.** Fewer bytes per read but more steps, which is exactly the TTFT problem the session hit.
- **Let the actor truncate manually.** No automatic bound; still grows.
- **Summarize with a model call.** Extra token cost and non-deterministic, so replay differs.

## Acceptance criteria

- A tool result above the threshold is delivered to later requests in compacted form while the full result remains recoverable from the log.
- The threshold is configurable via cordis.yml and can be disabled.
- Restart and fork reconstruct the same compacted projection from the log.
- Tests cover the threshold boundary, deterministic projection, re-read of a trimmed result, and the disabled case.

## Risks

A truncated view can hide a detail the model needed, so the projection must keep a faithful summary and the ability to re-read precisely. Compaction must be deterministic to preserve replay, and it must not silently drop content the model already began relying on mid-task.
