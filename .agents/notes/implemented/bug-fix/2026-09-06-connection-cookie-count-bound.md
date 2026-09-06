# Agent Note: Bound browser-session cookie count to keep the request head under the HTTP limit

Status: implemented

English | [中文](2026-09-06-connection-cookie-count-bound.zh.md)

## Problem

Browser-session cookies named `dsh-auth-<sha256(authority)>` accumulate without bound. The name hashes the authority `host:port`, and every launch of a `dsh` web/desktop process binds a fresh random port and mints a new cookie, but HTTP cookies are keyed by domain and path, not by port. So every old `dsh-auth-*` cookie on the origin is sent with every later request regardless of which port the current process bound. After enough launches the jar's cookie head grows until, combined with a long request line such as the client-modules bundle URL (`/plugins/??…`), it exceeds Node's 16 KB default `maxHeaderSize`, and the server returns 431 (header too large) for that request.

The desktop shell's startup cookie reset (see the desktop client-modules 431 note in this same `<bug-fix>` folder) removes the accumulation for that shell, but it does not help a browser that keeps using `dsh web` across launches, and it is a per-surface reset rather than a bound on the cause.

## Decision

Cap the `dsh-auth-*` cookies the browser keeps. In `packages/client/connection/src/browser-auth.ts`:

- `MAX_BROWSER_COOKIES` is 32. Thirty-two cookies stay well under the 16 KB header ceiling even when the bundle request line grows.
- On the token-exchange (minting) path, `excessCookieNames` parses the request `Cookie` header, collects prefixed cookies, decodes each signed payload to recover its `issuedAt` (using the activation secret), and returns the oldest surplus names when the jar would exceed the bound. The current authority's cookie and non-prefixed cookies are never evicted; undecodable prefixed cookies are treated as oldest so excess bytes are shed first.
- Each surplus name is cleared with a same-name, `Max-Age=0` `Set-Cookie`, sent alongside the newly minted cookie.
- `ConnectionIndexResponse.writeHead` header values widen from `string` to `string | string[]` so repeated `Set-Cookie` headers can be expressed.

The bound is enforced at every mint, and a mint is what adds a cookie, so the jar never exceeds the cap between launches.

## Alternatives considered

**No bound, rely on the desktop shell's startup reset.** Rejected as the only fix: the browser `dsh web` path never resets its jar, so it still drifts toward 431, and a per-surface reset does not address the cause. The desktop reset remains as defense-in-depth for that shell.

**Raise Node's `maxHeaderSize`.** Masks the accumulation instead of removing it; the header still grows without bound.

**Evict every non-current `dsh-auth-*` cookie on each mint.** Keeps the bound at one, but breaks multi-instance browser use, where a user runs several processes on distinct ports in tabs of the same browser. A bounded keep preserves the recent instances.

**Reject or hard-fail past the bound.** Turns a recoverable accumulation into a user-visible failure; eviction is transparent.

## Consequences

- The request head stays bounded (~7 KB at 32 cookies) on every surface served by the same origin, so no number of launches can reintroduce a 431 on a long URL.
- Multi-instance browsers keep the most recent `MAX_BROWSER_COOKIES` cookies and shed the oldest, rather than failing or logging the user out of the current instance.
- The eviction is a one-time fix-up on the minting response; ordinary cookie-authenticated requests are unchanged and do not re-mint.
- The desktop shell reset and this bound are independent changes in separate packages, and remain complementary rather than redundant.
