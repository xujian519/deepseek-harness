# Agent Note: Issue lifecycle credential guard

Status: implemented

English | [中文](2026-08-18-issue-lifecycle-credential-guard.zh.md)

## Problem

The [Issue lifecycle](../../../../.github/workflows/issue-lifecycle.yml) job uses a GitHub App token to write ProjectV2 status and issue audit comments. It reads the App client ID and private key from `vars.DSH_ISSUE_APP_CLIENT_ID` and `secrets.DSH_ISSUE_APP_PRIVATE_KEY`. When these values are absent — for example on a fork that has not installed the same App — `actions/create-github-app-token` fails before any lifecycle logic runs, turning every Issue and pull-request event into a CI failure.

The [event-directed PR review status](../../../../.agents/notes/implemented/process/2026-08-10-event-directed-pr-review-status.md) decision assumes a working App token but does not itself describe how to provide or detect one.

## Decision

The `lifecycle` job now skips itself when either the App client ID or private key is empty. The skip is a job-level `if` guard evaluated before the checkout step, so the workflow reports success without attempting token creation. The existing event filter for `pull_request_review.submitted` with `changes_requested` remains nested inside the credential guard and is unchanged in behavior.

## Alternatives considered

**Fail with a clearer error message.** A dedicated step could detect missing credentials and emit a human-readable annotation, but that still marks every event-driven run as failed on forks. The credential variables are repository-scoped configuration, not a code defect, so failing loudly is the wrong default for a reusable workflow.

**Use `GITHUB_TOKEN` as a fallback.** The default token lacks the organization ProjectV2 and cross-repository scopes the lifecycle script needs, and elevating its permissions would broaden the blast radius for all forks. Keeping the GitHub App as the sole write path preserves the least-privilege design.

**Move the guard to the `Create project token` step only.** That would leave the job running with no usable token and force every subsequent step to branch on whether the token exists. A job-level skip keeps the workflow readable and avoids partial-run ambiguity.

## Consequences

Forks and repositories without the `DSH_ISSUE_APP_CLIENT_ID` / `DSH_ISSUE_APP_PRIVATE_KEY` pair no longer see failing Issue lifecycle runs; they simply do not run lifecycle automation. The canonical repository must still configure these values, or the intended automation is silently disabled. The guard is pinned by [workflow tests](../../../../scripts/ci-workflow.spec.ts) so future edits cannot accidentally remove it.
