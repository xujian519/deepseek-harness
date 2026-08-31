# Agent Note: Sink the Settings load-failure row into dsh-client-ui-primitives

Status: implemented

English | [中文](2026-08-31-sink-load-failure-row.zh.md)

## Problem

Two Settings tabs rendered the same load-failure row. `PluginMarketTab` and `PluginInventorySettingsTab` each kept an identical five-line JSX block — an alert paragraph with the error text plus a plain retry button — and each package's CSS module carried an identical `.failure` ruleset (flex row, error color, shared type metrics, button chrome). The tabs shipped in different packages, so nothing tied the two copies together, and the zero-clone `jscpd` gate flagged the JSX pair as the only clone in the repository, blocking CI.

## Decision

`@deepseek-ai/dsh-client-ui-primitives` owns one `LoadFailure` component: a `message`, a `retryLabel`, and an `onRetry` callback. Copy arrives through props because the package is cordis-free and client copy is locale-owned; each tab keeps passing its own dictionary keys (`t('error')`, `t('retry')`). The shared `.failure` CSS moves into the component's CSS module verbatim, and both tabs delete their local copies. A component spec pins the alert role, the localized retry label, and the retry click.

## Alternatives considered

**Adjust one tab's markup so the detector stops matching.** Rejected: it hides a real duplicate behind a cosmetic difference and leaves future tabs to copy whichever variant predates them.

**Raise the duplication threshold or ignore this pair.** Rejected: the gate's zero-clone budget is the mechanical form of the no-copy rule for client surfaces; a standing exception trains the next contributor to ignore the gate.

**Fold the whole loading/error/ready phase machine into the primitive.** Rejected: only the failure row is shared today. The two tabs disagree on the loading and ready shapes (a source selector plus catalog versus a filterable entry list), so a phase component would be speculative surface with one real consumer per branch.

## Consequences

`LoadFailure` is a new public export of `dsh-client-ui-primitives`; its contract (three props, copy via props) follows `ConnectionBanner`. The failure row's appearance is now defined in one CSS module, so a token or layout change reaches every consumer without per-package edits. Tab behavior is unchanged: both component specs still pass the failure-then-retry flow through the same roles and locale keys.
