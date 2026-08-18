# Agent Note: Issue management repository parameterization

Status: implemented

English | [中文](2026-08-18-issue-management-repository-parameterization.zh.md)

## Problem

The [Issue lifecycle](../../../../.github/workflows/issue-lifecycle.yml) workflow and the [Issue policy](../../../../.github/workflows/issue-policy.yml) workflow both delegate to [policy.mjs](../../../../.github/issue-management/policy.mjs). Previously:

- `issue-lifecycle.yml` hardcoded `owner: deepseek-harness` and `repositories: deepseek-harness` when creating the GitHub App token.
- `policy.mjs` hardcoded the repository owner and name via [config.json](../../../../.github/issue-management/config.json).

Together these meant that even if a fork configured the same App, the token and API calls would still target the canonical upstream repository instead of the fork. This caused 404 failures on forks and made the issue-management automation non-portable.

## Decision

Read the repository identity from the `GITHUB_REPOSITORY` environment variable (`owner/repo`) and use it for all REST API calls, GraphQL issue lookups, and issue/PR reference parsing. Keep `config.json` as the source of truth only for the GitHub Project organization (`projectOrganization`) and project number, because the Project is a separate organization-level resource that the lifecycle automation writes to.

`issue-lifecycle.yml` now passes `github.repository_owner` and `github.event.repository.name` to `actions/create-github-app-token`, so the token is scoped to the current repository rather than the upstream one.

## Alternatives considered

**Remove `config.json` entirely.** The project number, title, priority field, lifecycle actor, and statuses still need a shared config file. Keeping `config.json` and adding `projectOrganization` makes the repository-vs-project split explicit.

**Use `github.repository` everywhere in `policy.mjs`.** That works in Actions but breaks local testing and manual invocation where `GITHUB_REPOSITORY` is not set. Falling back to `config.organization`/`config.repository` preserves the ability to run the script outside Actions.

**Split GraphQL variables only when running in a fork.** Adding conditional logic for fork detection would couple the script to `GITHUB_REPOSITORY_OWNER` comparisons and make testing harder. Using distinct `$projectOrganization`, `$repoOwner`, and `$repoName` variables is unconditional and self-documenting.

## Consequences

The issue-management scripts now follow the repository they run in. The canonical repository (`deepseek-harness/deepseek-harness`) continues to use its own Project because `projectOrganization` still points at `deepseek-harness`. Forks that install the same App no longer need to edit source code to target their own issues and pull requests; they only need the credential guard from the [Issue lifecycle credential guard](2026-08-18-issue-lifecycle-credential-guard.md) note to be disabled or satisfied.
