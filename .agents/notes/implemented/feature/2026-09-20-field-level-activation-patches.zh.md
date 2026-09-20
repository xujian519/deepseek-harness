# Agent Note: 施加字段级激活补丁，而不是只改 action

Status: implemented

[English](2026-09-20-field-level-activation-patches.md) | 中文

## Problem

`activation-overrides.yaml` 是专利规则评审结论的机器可读权威：`scripts/port-nuo-rules.ts` 会从上游重新生成 `rules/patent/nuo-*.yaml`，所以任何直接改那些文件的评审结论都会被下一次移植抹掉。补丁文件是结论唯一能存活的地方。

而补丁只能携带一个字段 `action`。`applyRuleOverrides` 把它展开到规则上，其余一律丢弃，于是「收紧匹配」类结论——补上 `X-REF-003` 漏掉的 9 种案号拼写、开启否定语境让 `防窃听装置` 不再被误拦、在本域追加放行词——无处落地。资产里 `EX-SEL-004` 那条自己就用文字写明了：留了一条 `negationContext` 的后续，而没有任何东西能施加它。

两种结构性失效是静默的。拼错的补丁键，以及补丁引用了规则集中不存在的 id，都不会产生告警：`applyRuleOverrides` 逐条查规则、查不到就略过，合规加载器只校验 `isRuleAction` 并把未知键丢弃。一条「写下来了但从未生效」的评审结论，与一条从未写下的结论无法区分。

`KeywordBlocklistCheck` 根本没有承载域否定词的字段，`RuleEngine.checkKeywordEntry` 调用 `hasNegationContext` 时也不传词表，所以连手工改资产都引入不了域词。

## Decision

补丁现在是**字段级合并，分两级**。`action` 整字段替换；`addKeywords`、`negationContext`、`additionalNegationWords` 在 check 级合并——`addKeywords` 追加到规则既有 `keywords` 之后，`negationContext` 覆盖开关，`additionalNegationWords` 追加到规则原有的词表之后。`ActivationRulePatch` 声明这四个字段，`ACTIVATION_PATCH_KEYS` 列出可接受的键（含仅作文档用途的 `reason`），使拼错的键可被报告而非不可见。

选择增补而不是重声明是有意的。在补丁里重声明整条 check 会在仓里造出第二份必须与生成规则同步维护的副本；而直接改生成物 `nuo-*.yaml` 会被下一次移植还原。增补式补丁既不改生成物，也不产生副本。

check 级键只适用于 `keyword_blocklist`；打在其它 check 类型上时报 issue 并保持规则原样。

`additionalNegationWords` 与 `negationContext` 是**正交**的：词表只提供词，开关是唯一开启过滤的东西。声明了词却没有 `negationContext: true`，在两个能观察到它的点位都会报告——手工资产走 `parseCheck`，补丁走 `applyActivationPatch`——而不是作为一条死声明通过。引擎不会自动开启：一条同时带 `negationContext: false` 与词表的规则是自相矛盾的，让词表静默胜出会掩盖两者中到底哪个在生效。补丁路径读的是**合并后**的词表，所以用 `negationContext: false` 关掉规则自带词表的补丁同样被告警。

域词按规则隔离，且以**紧邻前缀**匹配，而非走否定语境窗口。`hasNegationContext` 以 `adjacentWords` 接收它们——只在该词紧接命中位置之前时豁免，此时前缀与命中词合成一个复合主题（`防` + `窃听`）。若改走否定语境窗口，`通过检测用户行为，诱导其参与赌博` 里的 `检测` 就会豁免十余字之外的命中，静默丢弃公序良俗告警。而并进共享默认词表则会一次性放大所有否定语境规则的放行面——`PAT-RISK-001`、`PAT-ABS-001`、`INV-EVIDENCE-001` 等等——这正是 `rule-asset-review-samples.spec.ts` 里那两条「域词不外溢」用例存在的原因。

每一种结构性失效都收集为 `RuleSetValidationIssue` 而不是消失：未知键、未知规则 id、check 级键打在非 `keyword_blocklist` 上、列表字段非数组 / 为空 / 元素全为空串、开关不是布尔值、空补丁。`applyRuleOverrides` 增加可选的第三参 `issues` 收集器，既有调用点不受影响。`loadPatentFullRuleSet` 把收集器的消息并入自身 warnings。任一字段非法的补丁整条跳过——半截补丁不施加。

资产获得代码现在支持的三条移植结论：`X-REF-003` 变体拼写、`EX-SEL-004` 的否定语境及其四个域词、`IPC-GEN-INV-002` 与重复项 `EX-INV-007` 并列降为 `log`。

## Alternatives considered

**把域放行词加进 `DEFAULT_NEGATION_WORDS`。** 否决：那是全局词表，一条条目会同时放大每一条否定语境规则。域词对 `EX-SEL-004` 有意义，对会静默继承它们的规则则是错的。

**让补丁重声明整条 `check`。** 否决：生成的 `nuo-*.yaml` 是规则体的唯一来源，补丁里的重声明是第二份会漂移的副本。追加字段让规则只有一个家、结论也只有一个家。

**直接改生成的 `nuo-*.yaml`。** 否决：`port-nuo-rules.ts` 会从上游重写这些文件，结论只能活到下一次移植。

**把「存在 `additionalNegationWords`」当作隐含开启开关。** 否决：`negationContext: false` 加一张词表是自相矛盾的声明，静默解决它会让规则的实际行为无法从文本读出。报告出来才能让两个键各自有意义。

**继续忽略未知键与未命中 id。** 否决：拼错的键或 id 恰恰是这个文件存在的理由所要防的失效——写下来了却从未生效的评审结论。此前这两者都不可观测。

## Consequences

只做匹配收紧的评审结论现在能落到补丁文件里。`EX-SEL-004` 放行合法安防主题而真实命中仍命中；`X-REF-003` 覆盖 12 种占位案号拼写而不扩大误拦面，因为每条新增备选都带 `202X`/`202x` 年份占位符，而真实案号的年份是数字。

补丁文件是被校验的。`loadActivationOverrides` 会跳过字段写错的补丁，`loadPatentFullRuleSet` 把未知 id、未知键、以及正交声明缺失三种情况作为 warning 浮出。

`RuleLoader.ts` 导出 `asStringArray` 与 `hasNonEmptyWord`，合规加载器用与资产解析器同一对判据校验列表字段。两者都不拒绝带首尾空白的元素：否定词表按字面匹配它，关键词表 trim 后再匹配，所以这样的元素确实会生效。

资产的补丁条数从 29 变为 31。`patent-full-rule-set.spec.ts` 把条数与「无警告」一起断言，所以将来一条写了却不适用的补丁会让套件转红，而不是被吸收。

## Testing

`packages/patent/patent-rule/tests/patent-full-rule-set.spec.ts` —— 补丁条数且无警告；check 级键是增补而非重声明；两键正交且缺开关被告警；未知 id 告警；未知键告警而已知键仍生效；check 级键打在非 `keyword_blocklist` 规则上告警且规则不变；增补词表但未开开关告警；空补丁告警。

`packages/patent/patent-rule/tests/rule-asset-review-samples.spec.ts` —— 每条评审结论各成一个可执行用例：9 种新 `X-REF-003` 拼写命中，半角大写拼写仍命中，真实案号放行，`EX-SEL-004` 的四个放行词各自放行其主题，真实违规仍命中，领域前缀只豁免紧邻命中，否定语境窗口的单向性被钉住，重复项只产出一条用户可见提示，以及两条「域词一旦进共享默认词表即转红」的用例。

`packages/patent/patent-rule/tests/rule-loader.spec.ts` —— `additionalNegationWords` 非数组、为空数组或元素全为空串时被告警且字段被丢弃，带首尾空白的元素则被保留；补丁在自带词表的规则上关掉 `negationContext` 时被告警，开着开关追加词则静默。

`packages/patent/patent-rule/tests/patent-compliance.spec.ts` —— 列表字段写错、空列表、元素全为空串的列表、开关非布尔，四种形态各自整条跳过补丁，而带首尾空白的元素被保留。

`packages/patent/patent-core/tests/text-utils.spec.ts` —— 紧邻前缀通道单独验证：紧邻前缀豁免，隔开前缀不豁免，前缀判定先于前置句界，空前缀不豁免任何命中。

## Related

- [Sati 专利域作为 dsh 插件](2026-08-17-sati-patent-domain-dsh-plugins.zh.md) —— 本包所属的移植。
