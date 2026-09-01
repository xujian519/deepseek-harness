# Agent Note: Parallel independent tool calls within a step

Status: proposed

English | [中文](2026-09-01-parallel-tool-calls-per-step.zh.md)

## Problem

In `dsh-session-463b73d4`, 107 of 140 tool-bearing steps issued exactly one tool call; 173 calls stand against 141 steps. Each step pays a fixed time-to-first-token (TTFT) before any output arrives — median 9.1s, p90 17.5s — and that 141-step TTFT alone accounted for about 24.6 min of the 72-min session. Many of those single-tool steps were independent reads or short commands that did not need the previous result, yet they each waited a full step round-trip.

## Proposal

Let a step dispatch several independent tool calls concurrently. The model emits multiple tool-call blocks in one assistant message; the harness resolves which calls are independent (none depends on another's result), dispatches those in parallel, and returns all results in call order before the next model turn. Calls that share a dependency — a later call must read an earlier call's output — still serialize. This note is scoped to the tool-dispatch seam.

The result mapping must stay deterministic regardless of which call finishes first, so the session log and replay see a stable order.

## Alternatives considered

- **Keep one call per step.** Bounded and simple, but pays TTFT per call and is the source of the 24.6 min.
- **Add a batch read tool.** New surface, but only covers reads and does not generalize to mixed commands and edits.
- **Ask the model to fold work into a single `bash` one-liner.** Unstructured, hard to type-check, and disconnected from typed tool schemas.
- **Parallelize only reads, leave everything else serial.** Narrow win; edits and mixed work still serialize.

## Acceptance criteria

- Two independent tool calls in one assistant message are dispatched concurrently and both results are returned before the next turn.
- Two dependent calls still serialize so the second sees the first's result.
- The step timeline shows overlap (combined wall-clock less than the sum), pinned by a runnable snapshot.
- A failure in one independent call does not cancel its siblings, and result ordering stays deterministic.
- Tests cover independence detection, mixed dependent/independent batches, concurrency limit, and replay ordering.

## Risks

Independent calls can still share mutable state — two writes to the same file is not safely parallel. The harness must detect or annotate such calls (or require an explicit look at the original file) so the model does not introduce races. Concurrency is also bounded by provider and sandbox limits, and interleaved output must render readably in the transcript.
