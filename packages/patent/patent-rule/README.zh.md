---
description: "函数插件，将 Sati 宪法规则引擎原生移植进 DeepSeek Harness：随包分发 YAML 规则包资产，对文本做确定性评估，将 EVI-011 证据合规守卫注册为单调 deny，并把 RuleOutputGate 接线到 tools/post-execute，review 经 ctx.approval 路由。"
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-rule

[English](README.md) | 中文

## 概述

函数插件，将 Sati 宪法规则引擎原生移植进 DeepSeek Harness：随包分发 YAML 规则包资产，对文本做确定性评估，将 EVI-011 证据合规守卫注册为单调 deny，并把 RuleOutputGate 接线到 tools/post-execute，review 经 ctx.approval 路由。

## 目录

- [输出门禁](#output-gate)
- [EVI-011 证据守卫](#evi-011-evidence-guards)
- [规则引擎（库 API）](#rule-engine-library-api)
- [规则资产](#rule-assets)
- [适用前提与引述范围](#applicability-premises-and-quoted-text)
- [配置](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="output-gate"></a>
## 输出门禁

对 `gateToolNames` 中每个交付物工具（默认 `render_patent_document`、`draft_claims`、`draft_specification`、`validate_specification`）的结果，插件将 `keyword_blocklist` 规则子集（`selectGateRules`，含 compliance 的 PAT-RISK-001 / PAT-APPROVAL-001 / PAT-ABS-001）经 `RuleOutputGate` 评估。block 级违规返回 block 决策。review 级违规发起 `ctx.get('approval')` 请求，仅在 `allowed-once` 时放行；无答案者、无 agent 或 `approvalDisabled` 开启时 fail-closed。warn/log 违规原样放行。非匹配工具经 `next()` 委托。

已加载的门禁同时以 `ctx.get('patentRuleGate')` 暴露（Context merge，可选——仅在本插件挂载时存在），使 patent-teams 等团队消费者能以与 post-execute 路径一致的规则门禁任务完成。

<a id="evi-011-evidence-guards"></a>
## EVI-011 证据守卫

当域外或外文证据记录缺失其必需的公证、认证或中文译本声明时，两条单调守卫拒绝 `evaluate_evidence` 调用。守卫条件字段派生自随包的 `evidence-rules.yaml`，资产缺失时回退到硬编码集合。每条守卫返回拒绝原因字符串，无 allow 结果可覆盖。

<a id="rule-engine-library-api"></a>
## 规则引擎（库 API）

包再导出移植的规则引擎：`evaluateText`、`evaluateRule`、`groupByAction`、`parseRuleSetFromYaml`、`loadRuleSetFromFile`、`loadRuleSetDir`、`mergeRuleSets`、`applyRuleOverrides`、`loadPatentComplianceRuleSet`、`loadPatentElectricalRuleSet`、`loadPatentFullRuleSet`、`loadActivationOverrides`、`selectGateRules`、`PATENT_CASE_DOMAINS`、`patentCaseDomains`、`loadRulePack`、`loadSynonymsAsset`、`RuleOutputGate`。

<a id="rule-assets"></a>
## 规则资产

`assets/rules/patent/` 下有三族资产，按归属与加载方式区分。

| 族 | 文件 | 加载方式 |
| --- | --- | --- |
| 手写合规规则 | `compliance.yaml`、`electrical-section-h.yaml` | 各自固定文件名，由 `loadPatentComplianceRuleSet` / `loadPatentElectricalRuleSet` 加载 |
| 上游生成物镜像 | `nuo-*.yaml` | 由 `loadPatentFullRuleSet` 经显式清单 `NUO_RULE_FILES` 加载 |
| 手写并入的现行口径与缺口规则 | `current-law.yaml`、`mady-gap-rules.yaml`、`oa-response-form.yaml` | 由 `loadPatentFullRuleSet` 经显式清单 `MERGED_RULE_FILES` 加载 |

`current-law.yaml` 针对输出文本中已废止的法条口径：两年侵权诉讼时效、以已被替换的司法解释作为等同依据、把实用新型客体写成第 2 条第 2 款。其检查为 `pattern_analysis`，因此不进入输出门禁。`mady-gap-rules.yaml` 是上游规则转换到本引擎各类检查的子集——关键词为字面词串的禁令，与要素为字面词串的完整性检查——上游的 `block` 一律评审降为 `warn`（上游 `info` 级降为 `log`）。其中两条禁令是 `keyword_blocklist`，输出门禁与镜像规则一并取用。`oa-response-form.yaml` 是答复文书的**形式**检查（计数式论证、重复引证、答复必须论证的充分公开判准），全部为 `warn`。`activation-overrides.yaml` 作用于合并结果，故评审结论可指向任一族的规则。

`activation-overrides.yaml` 按规则 id 打补丁。`action` 与 `premise` 整字段替换；`addKeywords`、`negationContext`、`additionalNegationWords` 为 check 级**增补**，不重声明既有 check——评审结论因此不会造出生成物的第二份副本。`premise-vocab` 以 YAML 锚点集中维护各主题词表，同一主题只有一份。未命中的补丁（未知键、未知 id、空前提或非法正则前提、开了关闭开关却留着放行词）在加载期告警，而不是静默不生效。

<a id="applicability-premises-and-quoted-text"></a>
### 适用前提与引述范围

`ConstitutionalRule.premise` 是规则级的正则 OR 表：一条都不命中时该规则不评估、不产生违规。完整性检查（`structural_analysis`，「缺失即违规」）只在文本**触及该主题**时才有意义，故评审后的资产给它们补上主题词前提——只讨论 26.3 的审查意见答复不再收到新颖性、创造性、权利要求撰写等无关主题的命中。两条性质是有意的：前提不满足是**沉默**而非降级（降级只压低级别、不消除噪音）；前提取**主题词汇**而非规则自身要素的复述——单元素 期望模式 规则的 pattern 与主题词表重合时，加前提后恒不命中，该类规则逐条在补丁 reason 里记录。

`keyword_blocklist` 支持 `quoteImmune: true`：配对引号（`「」`、`『』`、`“”`）内的命中不算作者本人的表述，审查员原话里的「一定」不再被读成本模型的绝对化断言。引号未闭合不豁免任何命中——失败方向指向检出，不指向静默。`quote_repetition`（默认 `minLength` 12、`minOccurrences` 2）报出同一引文反复出现，比较前归一空白与省略号：靠复述原文增长篇幅而不是增加论证的答复因此可见。以这两类检查写成的答复形式规则在 `oa-response-form.yaml`，不进输出门禁（门禁只取 `keyword_blocklist`）。

<a id="job-scopes"></a>
### 作业 scope

`PATENT_CASE_DOMAINS` 把四个作业 scope——`patent-oa-response`、`patent-invalidation`、`patent-reexamination`、`patent-infringement`，名称取自四类作业 manifest，经 `rule_check` 工具对模型开放——映射到各自评估的规则 `domain` 列表。一个 scope 评估通用域（`patent`、`patent_general`）加上本作业的文书域与程序域，以及本作业必须答复或论证的条款所在的域。四者并集覆盖合并结果里的全部域，故任一资产域都有对应的作业入口。答复与复审共用一个域集合：复审理由表 = 无效理由表 + 实用新型客体缺陷，而该缺陷规则在通用域；无效不带答复实践域，侵权只带侵权域。`evaluateText` 的 `domain` 选项接受单个域或域列表。

<a id="configuration"></a>
## 配置

Schemastery 配置。

| 键 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `rulesDir` | string | 随包资产 | 规则资产根覆盖，布局镜像随包的 `assets/rules/`。 |
| `gateToolNames` | string[] | 交付物工具 | 结果经输出门禁评估的工具名。 |
| `approvalDisabled` | boolean | `false` | 对 review 级违规直接拦截，不经审批往返。 |

<a id="model-experience"></a>
## Model Experience

None, as 本插件不注册工具 schema、提示段或结果投影；其 EVI-011 守卫与 post-execute 门禁拒绝或拦截既有工具调用，dsh-tools 将拒绝/拦截反馈渲染为普通错误结果。

#### KV Cache effect

独立；插件不在请求前缀追加任何内容，启用或禁用均不使 KV 缓存复用失效。

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **资产定位与 Sati 不同** — 规则经 `import.meta.url` 从随包 `assets/rules/` 解析（可选 `rulesDir` 覆盖）；丢弃 `SATI_RULES_DIR` 环境变量、cwd/工作区根向上 walk 与项目 `.sati/rules.yaml` 自动发现。`loadRulePack` 仅接受显式 `manifestPath`。
- **分层包默认仅 base** — 无清单时 `loadRulePack` 只加载随包的 base 包；domain 与 override 层需显式清单。
- **规则集加载 fail-soft** — 资产缺失或损坏时降级为空规则集（门禁放行），而非使部署失败。
- **并入资产只覆盖可机器判定的规则** — 载荷为正文表述（分析原则、法条条件、判例引用）的上游规则未转成检查，留在本包之外；转换清单、检查类型映射与边界见[并入边界说明](../../../.agents/notes/implemented/architecture/2026-09-21-mady-rule-asset-merge-boundary.zh.md)。
- **规则按域与前提收窄，不按文书类型判定** — 作业 scope 只留本作业的域，规则的适用前提在文本未触及该主题时保持沉默，但没有任何环节判定文书类型：前提命中的规则（例如答复引述了权利要求文字）仍会报出它缺失的要素。
- **指南引用是自由文本** — `legalBasis` 原样进入输出，没有任何环节解析它，故规则引的《专利审查指南》节号只与其转录来源一样正确；`tests/guideline-citations.spec.ts` 记下资产须守的编号写法和已按 2023 年修订版核对过的节，其余引用尚未核验。

### 开发备注

无。

本包不发布 invariant 伴生组件：dsh-tools 运行时自身的 invariant 伴生组件负责执行与审计 EVI-011 守卫及 tools/post-execute 输出门禁。
