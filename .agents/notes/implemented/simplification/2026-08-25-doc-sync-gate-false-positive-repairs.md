# Agent Note: doc-sync gate false-positive repairs

Status: implemented

English | [中文](2026-08-25-doc-sync-gate-false-positive-repairs.zh.md)

## Problem

pnpm run doc-sync was red on five gates for reasons that were not authored documentation defects: markdown links (a spurious extra parent level in four self-evolve tracking docs), translation pairing (a bug-fix note missing its .i18n.yaml record; local desktop build output under apps/desktop scanned as if authored docs), markdown wrap (the evaluation RUNBOOK hard-wrapped), and package paths (a package content subdirectory like self-evolve/evaluation miscounted as a package leaf, so its expected artifact paths were reported as drift).

## Decision

Repair each at its owning surface. Correct the four self-evolve docs link target to two levels up; add the missing .i18n.yaml for the patent-preset bug-fix note; reflow the evaluation RUNBOOK to one physical line per paragraph; make verify-package-paths treat a directory as a package leaf only when it carries package.json; make repo file discovery exclude gitignored paths; and add the desktop dist/release/resources tree to the translation scope excludes. Document fixes live in the docs; gate fixes live in the gate.

## Alternatives considered

- Rewriting the artifact paths out of the docs. Rejected: the paths are the CLI contract the runbook documents.
- Fabricating evaluation artifacts to satisfy package paths. Rejected: the scaffold must fail honest when data is missing, never fabricate results.

## Consequences

doc-sync is green (28/28). Gates now scan the authored tree (gitignore respected) and anchor drift only on real package leaves; local build output no longer causes translation-pairing failures.
