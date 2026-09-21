# Agent Note: Job scopes for the patent rule gate

Status: implemented

[English](2026-09-21-patent-rule-job-scope-domains.md) | 中文

## Problem

`rule_check` 每个 scope 只给一个规则集：固定合规文件（`patent`）、电学合并（`patent-electrical`）、合并后的全量资产（`patent-full`，117 条）以及项目分层包。四类作业——审查意见答复、无效、复审、侵权——没有各自的 scope，检查某类作业的交付物只能在四条通用合规规则与全部随包规则之间二选一，而全量里含着与作业无关的域。

移植来的上游作业表（`builtinPatentManifests[].checkDomains`）不能直接当映射用。它是按 checker 引擎自己的规则集写的，其中三个域（`patent_invalidation`、`patent_reexamination`、`patent_amendment`）在本包资产里没有任何规则，而镜像资产又声明了它从未提及的域（`patent_oa_response`、`patent_procedure`、`patent_general`、`patent_utility`）。

## Decision

`PATENT_CASE_DOMAINS`（`packages/patent/patent-rule/src/runtime/patent-compliance.ts`）把四个作业 scope 映射到各自评估的规则 `domain` 列表，`rule_check` 接受这些名称作为 `scope` 取值。规则集仍是带激活覆盖的合并全量资产，域过滤发生在评估期，因此各 scope 共用一次加载、各自一条缓存。

一个 scope 评估通用域（`patent`、`patent_general`——合规规则与通用实务规则，任何专利交付物都适用）加上本作业的文书域与程序域，以及本作业必须答复或论证的条款所在的域：

| Scope | Manifest | 规则数 |
| --- | --- | --- |
| `patent-oa-response` | `patent_oa_response_v1` | 105 |
| `patent-invalidation` | `patent_invalidation_v1` | 97 |
| `patent-reexamination` | `patent_reexamination_v1` | 105 |
| `patent-infringement` | `patent_infringement_v1` | 39 |

实体条款所在的域取自本仓自己的理由表：`packages/patent/patent-core/src/notice/office-action.ts` 的驳回类型表与 `.../notice/grounds.ts` 的理由表。两张表指向同一组条款——新颖性（22.2）、创造性（22.3）、实用性（22.4）、充分公开（26.3）、权利要求（26.4）、修改（33 条）——资产把它们承载为 `patent_novelty`、`patent_inventiveness`、`patent_utility`、`patent_disclosure`、`patent_claims` 与 `patent_procedure`。

答复与复审评估同一个域集合：复审理由表 = 无效理由表 + 实用新型客体缺陷，而该缺陷规则在通用域；复审请求书又是答复式文书。两者仍分列 scope 名，因为模型按作业选入口而不是按域名词表选；将来某作业的资产出现自有域（例如 `patent_invalidation` 域的规则）时，就在那一行拆开列表，名称不变。无效不带答复实践域——那些规则的措辞是答复审查意见（逐点回应、答复期限），用在无效请求书上会误报。侵权只带侵权域：撰写与审查域里的完整性检查落在侵权意见书上会误报。

`evaluateText` 的 `domain` 选项接受单个域或域列表，未声明域的规则始终评估；这与 `packages/patent/patent-core/src/checker/engine.ts` 的 `RuleEngine.evaluate` 一致——后者本就接受 `string | readonly string[]`。

## Alternatives considered

**直接沿用移植来的上游作业表。** 否决：它指向的域里三个在本仓无规则，照它建的作业 scope 会静默地比名称暗示的评估面更小，并且漏掉现行资产里的答复实践域、程序域与实用性域。

**一个资产域一个 scope。** 否决：调用方得先知道资产的域名词表才选得出检查项，而作业命名的 scope 正是为了免掉这一步；全集的并集已由 `patent-full` 承担。

**在加载器里过滤规则集，交给工具一个更窄的 `RuleSet`。** 否决："已声明域未被选中即跳过、未声明域始终评估"这条语义已由 `evaluateText` 拥有，再加一层过滤就是同一规则的第二处住所。工具传域列表，引擎保留语义。

**运行时从理由表推导 scope，而不是列出域。** 否决：理由表按措辞识别条款，不知道规则域；这样的推导会把 notice 模块耦合到规则资产词表上，只为一张四行的静态表。

## Consequences

全量资产仍为 117 条；四个 scope 分别评估其中 105 / 97 / 105 / 39 条，四者并集覆盖合并结果的全部域，故任一资产域都有对应的作业入口——新增资产域不属于任何作业时测试转红。

过滤收窄的是规则集，不判断文本类型。资产里的完整性检查（`structural_analysis`）对任意文本都会报出缺失要素，故把某作业 scope 跑在别类文书上仍会得到这些命中——在一条四句样本上实测：`patent-oa-response` 与 `patent-reexamination` 各 69 条命中，`patent-invalidation` 68 条，`patent-infringement` 22 条，不过滤则 79 条。

四个作业技能尚未引用各自的 scope：它们经 `patent-quality-gate` 把关，调用 `rule_check` 时用默认的 `patent` scope；把它们指到作业 scope 会重录作业链场景的系统提示固定内容。

## Testing

`packages/patent/patent-rule/tests/case-scopes.spec.ts` 钉住四个 scope 名、每个列出的域都由随包资产声明（否则拼写错的域会让 scope 静默变窄）、四者并集覆盖合并结果的域、任何 scope 都不报出域外规则、未声明域的规则在每个 scope 都运行，以及每类 scope 各一条域内命中与一条域外缺席。`tests/rule-engine.spec.ts` 承载 `domain` 选项的单值、列表、空串与空列表行为。`packages/patent/patent-tools/tests/drafting-engine.spec.ts` 用同一段文本分别跑 `patent-full` 与 `patent-infringement` 以体现过滤，并断言未知 scope 的报错列出作业 scope。
