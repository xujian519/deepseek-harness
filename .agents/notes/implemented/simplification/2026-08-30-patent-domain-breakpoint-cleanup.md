# Agent Note: Drop the un-wired browser-use PDF download channel

Status: implemented

English | [中文](2026-08-30-patent-domain-breakpoint-cleanup.zh.md)

## Problem

`patent-tools` re-exported `createBrowserUseDownloadRunner` from `tool/patent-pdf-download-browser-use.ts` at its package entry point, but no production code consumed it. Its only references were the public re-export, the orphan source file, and that file's own unit test. The download-path seam's design comments already stated that after the stack unified on the ego run mode the download path recognizes only the ego runner and browser-use participates in the probe matrix but not in download. Because the ego runner already carries the same "extract the CDN link, then fetch the download" fallback, the browser-use runner's behavior was fully redundant — a live export with no owner and no current need.

Separately, `resolveGateRoute` in `analyze-patent-figure.ts` documented a "caller's active model, otherwise the Config figure-model fallback" precedence, but the only call site passed `undefined` as the first argument, so the caller-supplied branch never executed; the gate verdict and the send path always derived from the Config figure-model route. The signature, the doc, and the wiring did not agree.

The same audit surfaced three smaller declaration mismatches: the registration JSDoc said 24 tools while the real count is 26; the registration test's expected set held 23 and used a loose containment assertion; and two docs named the shipped patent preset at a repo path that does not exist.

## Decision

- Remove the browser-use download channel entirely: delete the `createBrowserUseDownloadRunner` export from the package entry point, delete the orphan source file `tool/patent-pdf-download-browser-use.ts`, and delete its orphan unit test. The `patent_pdf_download` ego path is untouched.
- Rewrite `resolveGateRoute`'s JSDoc to describe shipped truth (a caller-supplied route wins only when both provider and model are set; otherwise the given fallback is used; an empty active route is not authoritative) and note at the single call site that the tool wires only the Config figure-model route, so the gate verdict and the send path always share that source. The signature and its unit tests are unchanged — the function's two branches were correct, only the prose misrepresented the wiring.
- Align the three mechanical mismatches: the registration JSDoc count (24 → 26) now matches the tool list; the registration test's expected set was completed to the real 26 and tightened to an exact (order-insensitive) match so a missing, extra, or renamed tool fails; and the two docs that named the preset at a nonexistent path now point at `packages/preset/agent-presets/presets/patent/`.

## Alternatives considered

**Wire the browser-use channel instead.** Rejected: the seam's design comments already committed to the ego stack. Wiring it would fork a second download path that duplicates the "extract CDN link → fetch download" fallback the ego runner already provides, and would add a consumer to an export that has none. Deleting is the smaller, design-consistent change.

**Keep the export and document it as public.** Rejected for the same reason: an unused public export with no owner or consumer violates the package rule "require a current owner and need"; documenting it would authorize it without a need.

**Leave `resolveGateRoute`'s JSDoc as-is and let a future caller justify the branch.** Rejected: the prose promised behavior the current wiring contradicted. Aligning the description to shipped truth needs no code change and removes a false contract; no behavior or test changed.

## Consequences

Removing `createBrowserUseDownloadRunner` removes a public symbol from `patent-tools`; any out-of-tree consumer would have to adopt the ego download path. `patent_pdf_download` behavior is unchanged. The registration test now fails on any tool-set drift the audit had been letting through, and the two corrected docs references resolve to a real directory instead of a path that did not exist.
