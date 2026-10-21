---
kind: upgrade-guide
description: "`ruleGateNode` 只评估声明的来源键，来源缺失/为空/降级时判 blocked，并以单个结构化 `rule_gate` 状态替代 `rule_gate_*` 键。"
---

# patent-core 将规则门限定到声明的来源键

[English](guide.md) | 中文

## 变更

`ruleGateNode` 改为接收单个选项对象：`ruleGateNode({ domains, sourceKeys, evaluator })`。待评估文本只由 `sourceKeys` 汇总，不再扫描整个图 state。`sourceKeys` 为空属于配置错误，在构图期抛错。

三个专利性分析构建器声明各自的最终报告键：新颖性为 `novelty_report`，创造性为 `inventiveness_conclusion`，充分公开为 `enablement_conclusion`。原始输入、中间 LLM 输出与残留 state 条目不再进入规则评估器。此前用户技术描述中的违禁措辞可能让规则门失败，即使生成的报告本身干净。

任一声明来源缺失、为空、非字符串或带 `<key>__degradation` 标记时，规则门在调用评估器之前直接以 `RULE-GATE-SOURCES-UNAVAILABLE` 判 `blocked`。降级的 LLM 阶段常写入空串或诊断兜底文本，旧的文本汇总会跳过它们，规则门可能在无报告可评估时返回 `pass`。

六个扁平审计键（`rule_gate_verdict`、`rule_gate_domains`、`rule_gate_failures`、`rule_gate_evaluator`、`rule_gate_rules_evaluated`、`rule_gate_text_length`）合并为一个 `rule_gate` 状态条目：

| 字段 | 含义 |
| --- | --- |
| `status` | 门结论：`pass`、`fail`（规则失败）或 `blocked`（来源不可用或无法评估）。 |
| `verdict` | 评估器判级：`pass`、`needs_revision` 或 `blocked`。 |
| `domains` | 声明的规则领域。 |
| `failures` | 失败规则及其消息与修复建议。 |
| `evaluator` | 评估器标识。 |
| `evaluatedRules` | 实际评估的规则数；门在评估前阻断时为 `0`。 |
| `evaluatedKeys` | 纳入评估文本的来源键。 |
| `degradedSources` | 因缺失、为空、非字符串或降级而未能评估的来源键。 |

`patent_workflow_run` 以 `规则门 status: <status>` 渲染门结论，不再输出 `规则门 verdict: <verdict>`，并从键列表中省略原始 `rule_gate` 条目。

以位置参数调用 `ruleGateNode`、读取已移除的 `rule_gate_*` 键或解析旧 `patent_workflow_run` 行的仓库外代码，会编译失败、读到 `undefined` 或需要适配新标签。

## 迁移

1. 把 `ruleGateNode(domains, evaluator)` 改为 `ruleGateNode({ domains, sourceKeys, evaluator })`，只列出规则需要评估的最终输出。
2. 读取 `graphState.rule_gate`，不再读取 `rule_gate_*` 键。门结论用 `status`，评估器自身判级用 `verdict`。
3. 把 `blocked` 视为"未作判定"：检查 `degradedSources`，补齐缺失来源后重跑，不要映射为通过。
4. 若解析 `patent_workflow_run` 输出，匹配 `规则门 status:`，取值为 `pass`、`fail` 或 `blocked`。
5. 确认：`pnpm exec vitest run packages/patent/patent-core packages/patent/patent-rule packages/patent/patent-tools` 通过，且无 LLM provider 时启用的规则门以 `rule_gate.status === 'blocked'` 结束。
