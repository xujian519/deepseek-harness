---
description: "法律域能力族：在案例、法规、司法解释与指导案例上提供 ctx.legalKnowledge 查询服务，并提供 legal_law_verify 引用门禁与 evaluate_legal_evidence 三性评分工具。"
kind: "package-group"
---

# legal/ — 法律域能力族

[English](README.md) | 中文

## 概述

法律组沿用专利域使用的 harness 接缝来承载法律域能力：一个知识库查询服务、一个以随包法条索引为后端的引用核验器，以及一个确定性的证据评分器。下表列出各包的分工，每个包的契约由其子 README 负责。

## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`legal-knowledge/`](legal-knowledge/README.zh.md) | 法律知识库查询：案例、法规、司法解释与指导案例，基于 SQLite FTS5，并以内存检索降级。 | `legalKnowledge` |
| [`legal-law/`](legal-law/README.zh.md) | 法条索引与引用核验：引用解析、逐条判定、`legal_law_verify` 工具。 | （注册到 `ctx.tools`） |
| [`legal-evidence/`](legal-evidence/README.zh.md) | 法律证据三性判定：按规则对关联性、合法性与真实性评分，提供 `evaluate_legal_evidence` 工具。 | （注册到 `ctx.tools`） |

每个包的契约由其子 README 负责。

## 相关文档

- [法律域子系统](../../docs/subsystems/legal.zh.md) — 服务接缝、引用门禁与证据评分器。
