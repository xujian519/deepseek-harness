# Agent Note: Handle provider rate limits in the tool layer, not by model sleep

Status: proposed

English | [中文](2026-09-01-tool-layer-rate-limit-backoff.zh.md)

## Problem

In `dsh-session-b300a460` the researcher member (the first critical-path step) issued `sleep` commands 11 times for a total of 15.8 min — `sleep 20` through `sleep 300`, mostly annotated "Wait for Google Patents rate limit". Direct `curl` calls to `patents.google` hit HTTP 429 throttling, and the model answered by hand-rolling exponential backoff inside a `bash` call. First-class tools that already exist for this work — `patent_search` (avg 2.3s), `patent_metadata` (avg 0.9s), `patent_pdf_download` — were used, but the download path still fell back to raw `curl` seven times.

The result is a throttling recovery strategy invented by the model and written as wall-clock sleeps, costing roughly 40% of the critical-path member's total time, independent of the provider's own `Retry-After` signal.

## Proposal

The tool layer owns rate-limit handling. When a provider returns a throttle signal (HTTP 429 and a `Retry-After`, or a provider-specific throttle marker), the tool surfaces a typed outcome carrying that retry-after, and the runtime retries with a bounded exponential-plus-jitter backoff — or returns an explicit "throttled, retry-after" result — instead of yielding a raw error the model then answers with a `sleep` command. The recovery wait is bounded and cancellation-aware, and the caller receives the final result or the typed throttle outcome. Where a first-class tool covers the operation, the runtime does not encourage a raw HTTP workaround that would reintroduce throttling.

## Alternatives considered

- **Return the raw error and let the model sleep.** The current behavior; non-deterministic, ignores `Retry-After`, and spends model-authored wall-clock.
- **Model-level retry loop.** Same drift and non-determinism as sleeping, plus prompt cost.
- **Fixed wait per provider.** Ignores the provider's own retry-after and over-waits or under-waits.
- **Blocking retry inside the tool with no bound.** Can hang the caller on a sustained throttle and is not cancellation-aware.

## Acceptance criteria

- A throttled provider call returns a typed outcome with the retry-after, or a bounded retry completes without involving the model.
- Total backoff is bounded; the caller is not blocked indefinitely and can be cancelled.
- No throttling recovery requires the model to issue a `sleep` command.
- Different provider throttle signals are detected per provider, and a non-throttle error is not misclassified as retryable.
- Tests cover the 429/`Retry-After` path, backoff bound, cancellation, and per-provider signal detection.

## Risks

Retrying inside the tool delays the caller and must stay within a documented bound. Detection must distinguish a genuine throttle from a transient network or a hard quota, so an error is not silently retried forever or permanently masked as "throttled".
