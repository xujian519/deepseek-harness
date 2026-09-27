# Agent Note: Malformed provider streams are retryable

Status: implemented

English | [中文](2026-09-28-malformed-provider-streams-are-retryable.zh.md)
## Problem

A provider can violate the wire format it streams: unparsable SSE JSON, an out-of-order or repeated block, or a tool call whose `arguments` JSON is cut off mid-value. `dsh-llm-deepseek` classifies each of those as `MALFORMED_RESPONSE` and throws before the terminal finish, so the attempt commits no Assistant message and no tool side effect.

That classification is right; treating the failure as terminal was not. On 2026-09-27 the `deepseek-official` route closed a `bash` tool call after 3,971 of its characters while reporting a stop reason other than `max-tokens`, so the translator validated that JSON instead of leaving the truncated call for the assembler to drop. The session log retains every delta the provider sent and the failure reproduces from it — `JSON.parse` reports an unterminated string. Under [bounded recovery](2026-06-21-bounded-llm-request-recovery.md) a protocol failure was not transient, so one truncated response failed the turn at step 38 and discarded the steps before it, including work the agent had already written to disk.

## Decision

`MALFORMED_RESPONSE` is transient by default. `@deepseek-ai/dsh-llm` exports `MALFORMED_RESPONSE_CODE`, `DEFAULT_RETRYABLE_CODES` lists it beside `EMPTY_RESPONSE`, and a provider that omits `retryPolicy` therefore re-runs the request up to five times with bounded backoff before the turn fails with that code.

Classification is unchanged: every wire violation still ends the attempt with `MALFORMED_RESPONSE`, a `max-tokens` finish still keeps truncated tool calls for the block assembler to drop, and an exhausted budget still surfaces the failure as the turn error. Only recovery changed.

## Alternatives considered

**Drop the truncated tool call and continue the turn.** The assembler already drops tool calls for a `max-tokens` finish, so this needed no new code. It lost because a response whose only block is that tool call assembles to an Assistant message with nothing for the loop to act on: the turn completes, the intended tool never runs, and no surface tells the user why.

**Add a truncated-response code.** A distinct code would repeat this case without repeating every other malformed stream. It lost because no consumer routes on that difference — both classes commit nothing durable and recover the same way — so it would add runtime vocabulary for one recovery path.

**Leave protocol failures terminal.** It lost because a provider hiccup then costs a whole turn of completed work, and the user's only remedy is to re-run the request without knowing which step was lost.

## Consequences

One undecodable response no longer costs the turn's earlier steps; the repeat is visible in the session log as a durable `llm/retry` event, and `retryableCodes` still lets a provider or deployment remove the code.

A deterministic malformation now spends up to five extra requests before the turn fails, each one re-sending the request and reading its input from cache. That cost is real at a large context, and it is the price of keeping a transient provider defect from discarding finished work.

## Testing

`packages/llm/llm/tests/retry-policy.spec.ts` pins the default set, `packages/llm/llm-retry/tests/retry.spec.ts` retries a `MALFORMED_RESPONSE` thrown after staged blocks under it, `packages/llm/llm-deepseek/tests/stream.spec.ts` keeps the adapter's classification fixtures, and the `empty-response-retry`, `empty-response-retry-current`, and `transport-failure-retry` recorded sessions carry the widened policy key.
