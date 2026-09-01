# Agent Note: Environment-aware HTML→PDF rendering with graceful fallback

Status: proposed

English | [中文](2026-09-01-env-aware-rendering-graceful-fallback.zh.md)

## Problem

In the session `dsh-session-463b73d4` (a report-generation task), the agent built an HTML→PDF pipeline on Chrome DevTools Protocol (CDP) and ran it under a `workspace-write` sandbox where Chrome's debug port and DevTools websocket could not start. It retried the same impossible path about six times: a 51s CDP readiness probe, two `job_output` waits of 138s and 144s each ending in `RuntimeError: Chrome 调试端口未就绪`, and three `bash` calls killed at exactly their 60s timeout. That cluster (step 56–90) consumed about 20 min of the 72-min session before the agent pivoted.

`pandoc`, `wkhtmltopdf`, and `soffice` were present and had already been probed at step 6, yet the agent continued down CDP. The harness gave no signal that the chosen engine could not work in the current sandbox, and no cheaper route to an available engine.

## Proposal

Add an environment-aware render capability that the report/deliver tooling uses for HTML→PDF. Before rendering, it performs one cheap, bounded, cancellation-aware probe to decide whether a candidate engine can run in the current sandbox (for Chrome, that `--headless --remote-debugging-port` comes up and the DevTools endpoint answers). On failure it advances down a documented engine order — `pandoc`, `wkhtmltopdf`, `weasyprint`, LibreOffice `soffice`, then a loud error — picking the first engine whose probe succeeds. The probe verdict is cached for the session so a render does not re-pay it, and an engine confirmed unavailable is not retried within that session.

The capability records which engine produced the output and any fallback chain taken, so a build is reproducible and diagnosable. A single render that cannot use any engine fails loud at the render step, not by looping.

## Alternatives considered

- **Keep retrying CDP.** Preserves one engine but burns wall-clock on a path the sandbox forbids.
- **Hardcode a single engine.** Works only where that engine is present and allowed; breaks in other sandboxes.
- **Let each caller probe independently.** Duplicated logic and drift in availability ordering.
- **Probe every render.** Correct but re-pays the probe cost that a session cache should absorb.

## Acceptance criteria

- In a sandbox where Chrome's debug port is unavailable, one render request completes through a fallback engine within a bounded number of engine attempts; the confirmed-unavailable engine is not retried that session.
- In a sandbox where Chrome works, the preferred engine is used.
- The render result records the engine and the fallback chain.
- The probe itself is bounded and cancellation-aware and never hangs the render.
- Tests cover probe caching, fallback ordering, the all-engines-unavailable loud error, and selection matches documented availability.

## Risks

Fallback engines lay out and paginate differently; the capability must define how the caller accepts a fallback output, or keep a text-based check instead of relying on pixel-identical rendering. Probe order and availability detection must not itself become a new slow path in a sandbox with no rendering engine at all.
