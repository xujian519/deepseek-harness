---
description: "Legal-domain capability family: the ctx.legalKnowledge query service over case law, regulations, judicial interpretations, and guiding cases, plus the legal_law_verify citation gate and the evaluate_legal_evidence triple-attribute scorer."
kind: "package-group"
---

# legal/ — legal-domain capability family

English | [中文](README.zh.md)

## Summary

The legal group carries the legal-domain packages over the harness seams the patent domain uses: a knowledge-base query service, a citation verifier backed by the shipped legal-law index, and a deterministic evidence scorer. The table below maps each package's half, and child READMEs own each package contract.

## Packages

| Package | Role | ctx key |
|---|---|---|
| [`legal-knowledge/`](legal-knowledge/README.md) | Legal knowledge-base queries: case law, regulations, judicial interpretations, and guiding cases over SQLite FTS5 with an in-memory fallback. | `legalKnowledge` |
| [`legal-law/`](legal-law/README.md) | Legal-law index and citation checking: reference parsing, per-article decisions, the `legal_law_verify` tool. | (registers on `ctx.tools`) |
| [`legal-evidence/`](legal-evidence/README.md) | Legal evidence triple-attribute assessment: rule-driven scoring of relevance, legality, and authenticity, the `evaluate_legal_evidence` tool. | (registers on `ctx.tools`) |

Child READMEs own each package contract.

## Related documentation

- [Legal domain subsystem](../../docs/subsystems/legal.md) — the service seam, the citation gate, and the evidence scorer.
