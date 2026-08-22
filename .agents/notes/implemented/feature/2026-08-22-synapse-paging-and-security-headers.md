# Agent Note: Synapse canvas paging, CSP headers, and asset test policy

Status: implemented

English | [中文](2026-08-22-synapse-paging-and-security-headers.zh.md)

## Problem

The ported Synapse session map (the `packages/web/synapse` host row plus `packages/client/synapse` `dsh.client` row) shipped covering its happy path but left four gaps. The `/synapse/api/sessions/:id/history` endpoint returned the whole session log, so a long conversation made the detail view load and render everything at once. The `/synapse` page and API relied only on the Host-header DNS-rebinding fence, with no Content-Security-Policy or MIME-sniffing response headers. The canvas's bridge (the requestId RPC primitives `post`/`dshRpc`/`settleRpc` and the bottom-of-file `message` listener that routes host-to-canvas events) had no test coverage, so a broken bridge would silently disable create/fork/send. And the web-surface extension point was absent from `docs/architecture.md`'s "Where new behavior goes" map and the `web-app` bundle README roster.

## Decision

The history endpoint now pages. `projectHistory(events, options?)` projects the full denoised list first (so tool folding completes around the boundary), then filters by an exclusive `beforeSeq` (`sourceSeq < beforeSeq`, so the boundary message is never duplicated) and keeps the most recent `limit` messages. The route parses `limit`/`beforeSeq` (invalid values → 400), and returns `{ messages, hasMore }` where `hasMore` is `filtered total > returned count`. The canvas `loadThreadHistory` always sends a `limit` (200 by default), and a "加载更早" button requests the next older page with `beforeSeq = oldest loaded sourceSeq` and prepends it, keeping the list ascending; `state.historyHasMore` tracks whether the button renders. The default (no options) still returns the full list, so existing callers are unchanged.

`/synapse/` (the HTML document) now carries a restrictive `Content-Security-Policy` — `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'` — plus `Referrer-Policy: no-referrer`. Every `/synapse` response (HTML, JS, CSS, API) carries `X-Content-Type-Options: nosniff`. The CSP is deliberately pinned to the document: browsers ignore CSP on non-document responses. The asset is compatible because `app.js` has no `eval`/`new Function`/`blob:`/WebSocket and the page loads script and style by external same-origin URL (no inline script); `styles.css` references only the same-origin `/synapse/deepseek-mark.svg`, and the map uses inline `style` attributes which `style-src 'unsafe-inline'` allows.

`docs/architecture.md`'s "Where new behavior goes" table gains a row mapping a web-surface session map/view to the host + `dsh.client` rows, and the `web-app` README roster names `synapse` and `synapse-client`.

The snapshot-policy decision is recorded rather than silently expanded: the canvas UI remains a static asset outside the client snapshot gates (its READMEs already declare this). The bridge contract is instead pinned by a new jsdom integration test, `packages/web/synapse/tests/canvas-bridge.client.spec.ts`, which evaluates the whole committed `assets/app.js` into the jsdom window and asserts the post envelope, RPC settle/route, and message routing. A live curl against the built server confirmed the emitted headers; the CSP-compatibility claims were confirmed statically.

## Alternatives considered

- **Page by re-projecting twice in the route** (once for the page, once for the count). Rejected: `projectHistory` is the single semantic source and one projection per event list is cheap and bounded, so `hasMore` is computed from a second page of the same function rather than a hand-rolled filter copy.
- **Reuse `state.historyBySession` to store `{ messages, hasMore }`.** Rejected: `persistedMessagesFor` reads the session value as a plain array, so an object would break the detail view; a parallel `historyHasMore` map keeps the array contract intact.
- **Serve the map inline as one document.** Rejected: it is a committed static asset served from `/synapse/app.js`, which is what makes the browser surface reproducible and cache-friendly; the CSP only has to permit same-origin external scripts.
- **Extend the snapshot harness to cover the canvas UI.** Rejected for this change: the map is an iframe self-contained static script with its own markdown renderer, not a snapshot-harness transcript; the jsdom bridge regression is the honest, cheaper contract test (recorded here so the decision is not re-litigated silently).

## Consequences

- Long sessions no longer load in full: the detail view opens with the most recent 200 messages and loads earlier pages on request, so a very long conversation stays responsive.
- The `/synapse` surface gains a real CSP defense-in-depth layer on top of the Host fence, and non-document responses are MIME-sniffed; the `frame-ancestors 'self'` directive keeps the DSH same-origin iframe working while blocking frames from elsewhere.
- Paging and header behavior change the shipped API surface, so the two READMEs' "known limitations" are updated and the bilingual pairs re-recorded.
- The canvas bridge, previously untested, is pinned by a jsdom full-load regression; the snapshot gates continue to exclude the iframe UI.
