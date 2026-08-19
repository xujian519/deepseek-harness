# Agent Note: Tool-call timeout plugin renamed `timeout-guard`

Status: implemented

English | [中文](2026-08-19-tool-call-timeout-rename.zh.md)

## Problem

The [repository naming contract](2026-08-11-repository-naming-contract-and-rename-ledger.md) named the plugin `@deepseek-ai/dsh-tool-call-timeout-policy` in directory `packages/guard/timeout-policy/` with Cordis plugin id `timeout-policy`. That name claims a role the plugin does not have. The role-word table reserves `Policy` for the object that decides what is allowed, selected, limited, or observed, and explicitly keeps policy separate from the mechanism that performs the decision. This plugin performs the mechanism: it arms a deadline, swaps `exec.signal`, and substitutes the `TOOL_TIMEOUT` result when its own timer wins. It decides nothing — each tool declares its own `timeoutMs` budget.

The name also re-raised the `packages/*/tool-*` catalog question the `tool-call` qualifier was added to answer: the plugin registers no model-facing tool, so a `tool-*` directory collides with the `gen-tool-catalog` completeness glob. The source carried a release-blocking `FIXME` naming this exact rename, recording that `timeout-guard` was the intended name ("aligning the name with its `guard/` home") and that the decision was deferred to resolution time.

## Decision

The plugin is renamed to `@deepseek-ai/dsh-timeout-guard` in directory `packages/guard/timeout-guard/`, with Cordis plugin name and id `timeout-guard` and invariant companion `timeout-guard-invariant`. `guard` names the role that exists: it watches the deadline and blocks the late result, without claiming policy authority over budgets.

This decision supersedes the package-name row of the ledger (`@deepseek-ai/dsh-timeout-policy` → `@deepseek-ai/dsh-tool-call-timeout-policy`) in the [repository naming contract](2026-08-11-repository-naming-contract-and-rename-ledger.md) and the package-name rationale in the [tool-call timeout policy](2026-07-07-tool-call-timeout-policy.md) — names only. The timeout mechanism, the `TOOL_TIMEOUT` classification, the `tools/execute` wrapper semantics, the `guard/` home, and the `@deepseek-ai/dsh-timeout` deadline library are unchanged; the 2026-07-07 note remains the owner of the mechanism. The package-regrouping note records the `guard/` group inventory and the old `timeout/` merge as history.

Every current reference uses the new name: the bundle `cordis.patch.yml`, examples and test fixtures, generated catalogs (module graph, config catalog), documentation, and the factual names in implemented Agent Notes. No alias, compatibility package, or fallback id remains, and the repository rejects the old name. Packaged desktop backend trees rebuild with the new name at the next `package:desktop:prepare`; the pre-rename tree under `apps/desktop/resources/mac/backend/` is gitignored build output.

## Alternatives considered

**Keep `dsh-tool-call-timeout-policy`.** The `tool-call` qualifier already answered the tool-catalog glob collision, so keeping the name would have removed only the `FIXME`. The `-policy` suffix would still claim a deciding role the plugin does not have, and the role-word contract ("keep policy and executor names separate") would stay violated.

**Use a `tool-*` name such as `tool-timeout`.** The tool-catalog completeness glob requires every `packages/*/tool-*` directory to register a model-facing tool; this plugin registers none, so the name would either fail `verify-tool-catalog` or force a misleading boot entry. The 2026-07-07 note recorded the same rejection.

**Drop the qualifier to plain `timeout`.** `@deepseek-ai/dsh-timeout` already owns the deadline-and-classification library, so an unqualified `timeout` would be indistinguishable from the primitive the plugin consumes, and the `guard/` group name would no longer align with the package.

## Consequences

- Bought: the name matches the role that exists — a guard performs the mechanism a policy decides; the release-blocking `FIXME` is removed; the plugin id, package name, and directory now agree; the `tool-*` catalog workaround disappears from the naming rationale.
- Cost: the old names stay in git history and in the historical prose of the ledger, regroup, and alternatives records; five implemented notes carry updated facts and cross-link to this decision.
- Verified: `verify-translation-pairing` (988 pairs), `verify-agent-note-format` (566 notes), and `verify-md-links` pass; the rename fixed the broken `packages/guard/timeout-policy/...` link in the [cooperative tool cancellation](2026-07-19-cooperative-tool-cancellation.md) note.
