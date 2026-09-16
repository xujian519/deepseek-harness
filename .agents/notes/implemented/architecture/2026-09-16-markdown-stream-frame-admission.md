# Agent Note: Admit streaming Markdown frames through a measured budget

Status: implemented

English | [中文](2026-09-16-markdown-stream-frame-admission.zh.md)

## Problem

`MarkdownText` streams by freezing all but the trailing two top-level blocks and re-parsing only the source tail, so per-frame work tracks the tail. A reply that arrives as **one growing top-level block** — a single paragraph, a list that keeps taking items, a table — has nothing to freeze, so every frame re-parses the whole reply and rebuilds its elements: work per frame grows with the reply, and total work with its square.

Measured on macOS arm64, Node 22.22, source-resolved probe; 50 KB delivered in 16-character chunks, counting source handed to the grammar:

| Corpus | Source parsed | vs. reply | CPU |
|---|---:|---:|---:|
| Single paragraph | 78,150,000 | 1563× | 12,440 ms |
| Single list | 75,965,129 | 1542× | 52,757 ms |
| Control: many paragraphs | 617,866 | 16× | 235 ms |

The grammar's own cost is linear in the block — 0.17 ms/KB as a paragraph and 0.7 ms/KB as a list (128 KB: 29 ms and 114 ms) — so with one chunk per animation frame the streaming render's share of the main thread is `block kilobytes × 0.7 ms/KB ÷ 16.7 ms`. That share passes 100% at a ~46 KB list or a ~193 KB paragraph: from there the browser cannot keep up with the arrival at all, and the visible reply falls further behind while input waits behind the parses.

The parser cannot remove this without changing what the user sees. A cut inside a growing paragraph can split emphasis, a link, or inline code, and a cut inside a growing list can split an item or a lazy continuation, so a suffix re-parse is not equivalent to a one-shot parse; `UNSTABLE_TAIL_BLOCKS` cannot be lowered to one for the same reason.

## Decision

**Streaming frames pass a measured admission gate, and the message component retries the frames it held back.**

- `packages/client/ui-primitives/src/markdown/stream-frame-gate.ts` owns the policy. A frame is claimed before it runs and measured as it completes; a frame above `STREAM_FRAME_BUDGET_MS` (4 ms — a quarter of a 60 Hz frame) makes the following frames due only after `measured cost × STREAM_FRAME_DELAY_FACTOR` (3).
- A source shorter than `STREAM_FRAME_MIN_SOURCE_CHARS` (4096) is admitted whatever it costs. The slowest grammar here measures 0.7 ms/KB, so a reply that short cannot re-parse its way past the budget; holding one back would only let a one-off scheduler pause delay a short reply.
- A held-back frame returns the previous frame's element array, so React commits nothing and the cached tail elements are reused unchanged.
- The held-back text is never dropped: `MarkdownText` schedules `setTimeout(retryFrame, delayMs)` after any frame that did not render, and the retry re-renders the current prop. A held-back frame therefore lands on its own, without waiting for another chunk.
- Only appended frames are held back. A text that no longer starts with the last rendered text is a rewrite rather than this frame's continuation, and `streaming={false}` renders the settled full parse by contract.
- `StreamingRenderer` (moved to `src/markdown/streaming-renderer.ts` beside the parser, taking the gate as an injected dependency) is the only caller; `MarkdownText` stays the React surface.

The arithmetic is the guarantee. While frames are over budget the stream occupies `cost / (cost + 3 × cost)` — a quarter of the frame clock — whatever the open block grows to; the visible text trails the arrival by at most four times one frame's cost; and total work falls, because an admitted frame covers more arrival than a frame-by-frame pass (a 63 KB list: 1000 parses → 334, 500× the reply → 102×).

## Alternatives considered

- **Freeze part of the growing block.** Rejected: domineering cuts are not DOM-equivalent, as above, so this changes what the user sees rather than only when.
- **Render a bounded prefix and append the rest as plain text.** Rejected: it shows the user text that is not the reply's markdown.
- **Throttle on appended bytes instead of measured cost.** Rejected: a byte-proportional lag is a fixed fraction of the reply — a quarter of a 50 KB block is 12 KB, which is 15 s of a token-paced stream — while a cost-proportional lag is a few frames.
- **Hold back only after two consecutive over-budget frames.** Rejected: it delays engagement by a frame in exactly the regime the gate exists for, and the minimum source size already covers the case it would have handled.
- **Skip a fixed number of frames per over-budget frame.** Rejected: one chunk per frame and several chunks per frame are both real arrival patterns, so a frame count does not translate into main-thread time; the measured cost does.
- **Let the owner throttle instead of the renderer.** Rejected: the parse and the element rebuild are both inside one render call, so an owner that drops props cannot avoid either.

## Consequences

A long single-block reply no longer starves the main thread, and the package's streaming specs keep asserting DOM equality with a fresh mount on every frame: the admission floor keeps content under 4096 characters on the path it had, and every corpus in `markdown-incremental.client.spec.tsx` is below it.

The visible cost is the documented lag: the streaming text can sit behind the arrival by up to four times one frame's parse cost (24 ms at a 6 ms frame, 175 ms for a 44 ms list frame), and the frame that releases it shows the text accumulated since the previous render. Nothing else changes: folding, fence highlighting, footnote numbering, and the settled swap all run in the same frames as before.

The gate is per-message state. Re-settling, a new label identity, and a rewritten document all reset or bypass it, and the retry timer is cleared with its effect.

## Testing

- `pnpm exec vitest run packages/client/ui-primitives` — 875 passed across 42 files, with `src/markdown` at 100% statements, branches, functions, and lines.
- `pnpm exec vitest run packages/client apps/web` — 7326 passed; the one failure (`keeps every bundled license in the packed client artifact`) fails identically at the parent commit, because the packed artifact is not built in the working tree.
- `stream-frame-gate.client.spec.ts` drives the policy on a scripted clock: an in-budget frame buys no wait, at-budget is in-budget, an over-budget frame buys exactly `cost × 3`, a short source is admitted despite an armed cool-down, and a released frame stops reporting a wait.
- `markdown-stream-frames.client.spec.tsx` drives `StreamingRenderer` with a clock that advances per read, so frame costs are scripted rather than machine-timed: a held-back frame returns the previous element array, the retry renders the accumulated text, a rewritten document is never held back, and the component's retry tick delivers the held-back text with no further chunk. It also asserts the settled render runs in full while a frame is held back.
- `markdown-incremental.client.spec.tsx` adds `holds a stream of one unclosable block to a bounded share of the frame clock`: with the grammar's measured cost (0.7 ms/KB) and one chunk per 16 ms frame modelled, admission keeps parses under half the frames, keeps the duty cycle under 30%, and keeps the lag under 250 ms. Without admission the same workload parses every frame and runs above 100% duty, which is what the assertion rejects.
- `pnpm run test:bench` — 9 files, 49 cases pass, including the new browser case below.
- Negative controls, run and reverted: raising `STREAM_FRAME_BUDGET_MS` to 1,000,000 fails seven cases across the three spec files (the gate's own budget cases, the renderer's held-back frame, both component cases, and the bounded-duty case); removing the gate claim from `StreamingRenderer.render` fails three of the four coalescing cases.

## Browser measurement

[`benchmarks/markdown-stream-reply`](../../../../benchmarks/markdown-stream-reply/markdown-stream-reply.bench.ts) streams one 408 KB paragraph — 1202 chunks of 340 characters at 2 ms pacing, four arrivals per 60 Hz frame — through the shipped Web composition in headless Chromium, and reports shared `TaskDuration`, tasks over 50 ms, and whether the complete reply reached the transcript. Same case, same machine, with the admission removed and the Client bundle rebuilt:

| | TaskDuration | share of stream | tasks > 50 ms | longest task | transcript |
|---|---:|---:|---:|---:|---|
| Without admission | 2512 ms of 2949 ms | 85% | 13 | 91 ms | complete (408,042 chars) |
| With admission | 1724 ms of 3013 ms | 57% | 5 | 86 ms | complete (408,042 chars) |

At a gentler arrival (the same 80 KB block at 8 ms pacing) the same case reports 58% → 52%, so the gate is worth what the arrival outruns the frame rate. The share stays well above the gate's own quarter of the frame clock because `TaskDuration` counts the whole chunk pipeline — SSE handling, the session projection, React's render and commit — and admission bounds only the Markdown frame body inside it.

The case reports rather than enforces a timing budget: `benchmarks/AGENTS.md` adopts a budget only after repeated measurements on CI hardware, and CI hardware has not run it. Its one assertion is that the complete reply reaches the transcript, which is the guarantee admission must not break.

## Related

- [Streaming markdown](../../../../packages/client/ui-primitives/README.md) — the package README's description of the incremental pipeline this gate admits frames into.
