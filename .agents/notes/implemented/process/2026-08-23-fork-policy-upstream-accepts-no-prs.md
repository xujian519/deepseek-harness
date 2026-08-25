# Agent Note: Fork policy — upstream accepts no PRs

Status: implemented

English | [中文](2026-08-23-fork-policy-upstream-accepts-no-prs.zh.md)

## Problem

This repository is a fork: `origin` is `xujian519/deepseek-harness` and `upstream` is `deepseek-ai/deepseek-harness`. Upstream accepts no PRs, so fork-only work cannot flow back and the fork must carry everything it adds or fixes above the upstream base for as long as that work stays useful. The fork owns its own surfaces (desktop, patent, self-evolve, synapse, plugin-market, openviking, the `dsh-timeout-guard` rename), its own free-tier CI layout, and one workspace-wide version family aligned with the upstream release line, while upstream releases keep arriving and are merged forward one by one ([rc.1 sync](2026-08-21-upstream-v0-1-1-rc-1-sync.md), [rc.2 sync](2026-08-23-upstream-v0-1-1-rc-2-sync.md)). Without one standing rule, a fix's destination and the synchronization direction each have a plausible but wrong default: contributing upstream, or rebuilding the fork's history onto upstream master.

## Decision

The fork is the deliverable repository. All decisions, fixes, features, and gate work land here: contributors open PRs against this repository's own branches and `master`, and never open or propose a PR upstream. A defect or gap upstream still has is fixed here, in whichever package it belongs — including upstream-owned code, where the fork carries the diff as a local change that each sync's conflict resolution re-applies by category ([rc.2 sync](2026-08-23-upstream-v0-1-1-rc-2-sync.md) records the procedure). Fixes that would have been upstream contributions are committed on the fork with their fork ownership stated; they are not staged for an upstream channel and are not assumed to ever land upstream.

Upstream synchronization is one-directional merge-forward only: fetch `upstream`, merge `upstream/master` into the fork's `master` in one merge commit per release behind a fork-side PR, resolve conflicts by category, regenerate catalogs, graphs, and translation-pairing records against the merged tree, and bump the fork's version family to the upstream version. Never rebase or cherry-pick the fork onto upstream — rewriting the fork's published history is off the table. The fork shares the `dsh-v*` tag space with upstream, so no tags are pushed from the fork. Upstream workflow changes arrive archived under `workflows-disabled/`; the fork's CI layout stays its own.

## Alternatives considered

- **Proposing fixes upstream first.** Rejected because upstream accepts no PRs; waiting on a channel that does not exist leaves fork defects open and duplicates the fix once the fork carries it anyway.
- **Rebasing the fork onto upstream master.** Rejected because it rewrites the fork's published commit history, disrupts open branches and stacked PRs, and hides the sync boundary; a merge commit records each sync as one reviewable unit on the fork's `master`.
- **Cherry-picking upstream changes instead of merging.** Rejected because it loses the release boundary, churns conflicts commit by commit, and cannot reconcile the fork's version family and CI layout in one pass.
- **Keeping fork patches over upstream code as a separately re-applied patch set.** Rejected because conflicts are already resolved by category at each merge; a patch set would duplicate that state and drift from the merged tree.

## Consequences

Upstream fixes reach the fork only at the next merge-forward, so an upstream defect continues to travel in the fork until then unless the fork carries its own fix for the same defect. Fork-owned fixes never reach upstream users; when upstream later fixes the same defect independently, the sync merge resolves the duplication. Every upstream release deepens the divergence and requires another conflict-review pass, with the rc.1 and rc.2 sync notes recording the accumulated cost. Fork feature branches keep tracking the fork's own `master`, and open fork PRs merge normally.
