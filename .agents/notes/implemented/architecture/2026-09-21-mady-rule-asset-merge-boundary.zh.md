# Agent Note: 把 Mady 规则资产并入专利规则引擎

Status: implemented

[English](2026-09-21-mady-rule-asset-merge-boundary.md) | 中文

## Problem

Mady 的规则语料（`domains/rules/data/rules/`，27 个文件共 313 条）被当作专利规则门禁的来源，规则差集报告把 165 条留作并入目标。实际在 Mady 里跑的范围比语料显露的窄得多：`Check.Evaluate`（`domains/rules/evaluate.go`）只执行 `presence` / `absence` / `numeric` / `composition` 四种类型，对其他任何 `check.type` 一律返回 `Passed: true, Score: 0.5`，详情为"类型 %q 需要 LLM 判断，跳过自动检查"。语料中没有任何一条使用这四种可执行类型，因此这 313 条在 Mady 侧都没有被机器判定。

另有两个事实进一步收窄了并入范围。侵权文件 48 条携带的是空载荷（`keyword_blocklist` 的 `keywords: []`、`structural_analysis` 的 `requiresAll` 元素 `patterns: []`），没有可转换的内容。真正带字面关键词、模式或要素清单的条目，本仓 `assets/rules/patent/nuo-*.yaml` 已镜像；扫描"本仓缺失且带字面载荷"的条目，结果为零。

## Decision

并入落为本仓 `packages/patent/patent-rule/assets/rules/patent/` 下两个手写资产文件，二者都由 `loadPatentFullRuleSet` 经显式清单 `MERGED_RULE_FILES` 加载，与生成物镜像清单 `NUO_RULE_FILES` 并列。`activation-overrides.yaml` 作用于合并结果，故评审结论可指向任一族的规则。

`current-law.yaml`（3 条，`LAW-*` id）把现行法条基准落成对输出文本的确定性禁令：两年侵权诉讼时效（`民法典第188条` 规定为三年）、以已被替换的司法解释作为等同依据（现行为 `法释〔2009〕20 号第 17 条`）、把实用新型客体写成 `专利法第二条第二款`。三条都是 `pattern_analysis`，因此都不进入输出门禁——"两年"这类裸词用 `keyword_blocklist` 会大面积误报；基准未核验的条号按语义命名，不写条号。

`mady-gap-rules.yaml`（14 条，保留上游 id）转换镜像未覆盖的上游条目，沿用镜像生成时的同一套映射：

| 上游 check | 转换后的 check |
| --- | --- |
| `regex_pattern.antiPatterns` | `keyword_blocklist`（命中即违规） |
| `category_detection`（`categories[].keywords`、`minCategories` N/M） | `structural_analysis`（要素 = 各 category，`minConfidence` ≈ N/M） |
| `section_structure` / `specification_analysis`（`requiredSections`） | `structural_analysis`（要素 = 章节名） |
| `patent_*`（`requiredElements` / `requiredAspects`） | `structural_analysis`（要素 = 字面词串清单） |
| `regex_pattern.requireAny` | 不并入——与已镜像的 `X-REF-001` / `X-REF-002` 引用完整性规则等价 |

上游的 `block` 一律评审降为 `warn`（上游 `info` 降为 `log`），与"新并入的规则不得直接落 block"一致。评审结论就写在资产自身（该文件由手工维护）；`activation-overrides.yaml` 仍作用于合并结果，故日后的评审可指向任一族的规则。本次不含同义词补充：`synonyms.yaml` 只服务 `synonym_match`，而并入规则未使用该检查。其中两条禁令是 `keyword_blocklist`，`selectGateRules` 会与镜像规则一并取用，输出门禁因此从 9 条变为 11 条；既有场景文本不含其关键词。

不并入的条目及理由：

- **空载荷** —— 侵权 48 条与 `infringement-rules.yaml` 中 15 条无 `check` 的条目没有可匹配内容。
- **与既有规则等价** —— `CON-202` / `PR-FMT-001`（说明书五部分、摘要）与 `EX-DIS-001` / `EX-SPEC-003` 是同一检查；`CON-304` 与 `EX-CLM-004` 重复；`P-INV-005` 与各领域 `IPC-*-INV-*` 三步法变体与 `EX-INV-001` 重复；`EX-NOV-002` 退化为近乎恒真的两个词。并入会在同一文本上产出两条用户可见提示，差集报告明确禁止。
- **载荷为正文表述** —— 原则、法条条件、方法、判例引用（`amendment-rules.yaml` 15 条、`NOV-*`、`INV-*`、`DIS-*`、`CLA-*`、`RES-*`、`patent-core.yaml`、`novelty-rules.yaml`）。这些是撰写标准，不是模式；留在本包之外，归属技能层。
- **载荷是正确文本会用的措辞** —— `JD-DEF-006`（`贴标行为` / `标注商标`）、`IPC-B23-INV-002` 与 `IPC-H02-INV-001`（`割裂` / `分别判断` / `简单组合`，恰恰出现在陈述该标准本身的句子里）。字面禁令会命中正确表述。

## Alternatives considered

**转换全部 165 条差集条目。** 否决：多数载荷是抽象标签（`技术特征拆解`、`实质联系`、`客观要件`），字面匹配要么近乎恒真，要么在从不使用该标签的文本上命中；转换后只会增加提示噪音，不产生判定。

**修复 `nuo-compliance-enforceable.yaml` 的镜像转换。** 未做。`CON-COMP-0104` 上游是 `pattern_analysis` 加 `antiPatterns` 例外表——"引用审查指南但未指明章节"——镜像把它变成"文本未提及审查指南即命中"的完整性规则，`activation-overrides.yaml` 又把它降为 `log`。本仓不编辑生成物镜像（上游重新同步会静默覆盖改动），而激活补丁只能改 action 或追加关键词、无法表达例外表，故保留现状并在此记录。

**把现行口径禁令放进 `patent/compliance.yaml`。** 否决：该文件是通用合规 scope 的住所（4 条 `PAT-*`），把领域禁令放进去会改变默认 `patent` scope 的含义，并让一个事实有两个住所。

**把现行口径禁令落成 `keyword_blocklist` 以便输出门禁强制。** 否决：这些禁令需要正则窗口（"引用 … 17"、"实用新型 … 40 字内出现条号"），缩短后的裸词匹配会命中正确文本。

## Consequences

`rule_check(patent-full)` 现在评估 117 条规则，输出门禁 11 条。现行口径措辞与转换后的禁令经 `rule_check` 露出；现行口径禁令不拦输出，因此发布这类措辞的会话只在模型自检时才看到它。

剩余上游语料留在本包之外：没有可执行载荷，且正文型标准属技能层材料。并入集合、其上游 id 与边界断言在 `packages/patent/patent-rule/tests/merged-rule-assets.spec.ts` 中，未记录的并入或重新引入的等价规则都会让套件转红。

`CON-COMP-0104` 的镜像转换保持上述现状。将来若要修复镜像转换，须在上游或作为新资产进行，不能以补丁方式修。

## Testing

`packages/patent/patent-rule/tests/merged-rule-assets.spec.ts` 钉住两个文件的规则集、上游 id 对照表、评审降级（并入规则无 block；severity 在闭集内）、未并入的边界 id，以及每类并入规则各一条命中与一条放行文本。`tests/patent-full-rule-set.spec.ts` 与 `tests/output-gate.spec.ts` 承载新的规则数与门禁数。
