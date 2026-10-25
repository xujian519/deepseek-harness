# Agent Note: Carrying the OA answer's search strategy through the manifest

Status: implemented

[English](2026-10-26-patent-oa-search-strategy-stage.md) | 中文

## Problem

`patent_oa_response_v1` 到答复正文为止。产品做的审查意见答复工作——解析通知书、把权利要求对照到引用文献、排答复计划、从对立审查员位置检验计划、撰写、检查——从头不问下一步该检索什么。`patent-oas` 在 `--execution workflow` 下测这份清单,缺口就出现在读数里:`oa-answer` 的第 5 维(「检索策略与答复格式」)得 45.0,它喂分的两个节点 `prior-art-search` 与 `deliverable-format` 双双低于节点下限,于是这一面带着这两个节点的豁免落了基线。见 [通过产品执行者测量 OA 工作流面](../process/2026-10-25-patent-oas-workflow-surface-measurement.zh.md),那里记下了删除条件:清单产出检索证据之后删掉豁免。

补这个缺口受测量的两个性质约束。

评委只读交付物。采集器每次评委调用只传一个评分维度加上 `draft` 阶段另存的文件;中间阶段产物——要素映射表、答复计划、关键词表——不进任何提示词。一个产出的证据没人看得见的阶段改不了任何读数,豁免照样得留着。

`oa-answer` 在 `retrieval: oracle` 下采集。对比文件 D1 与公知常识的认定直接写进 case 的 statement,而门禁把 `retrieval` 当可比性轴:`oracle` 读数与 `simulation` 读数不互比。仓库没有受控检索语料——`simulation` 只是一个声明过的取值,背后没有夹具——所以任何真去检索的阶段都会把这个 case 挪到门禁当前记不下的那根轴上。

## Decision

**`patent_oa_response_v1` 补的是 `generate_keywords`,即共用的关键词阶段,不是检索链。** 清单复用 [packages/patent/patent-workflow/src/workflow/manifests.ts](../../../../packages/patent/patent-workflow/src/workflow/manifests.ts) 里的 `SEARCH_KEYWORDS_STAGE`,也就是新颖性、创造性、披露与可专利性四份清单放在 `search` 原子之前那一个阶段。它插在 `adversary-model` 与 `draft` 之间,`draft` 在 `consumes` 里点名它——不绑定原子的阶段就是靠 `consumes` 拿上游产出的。`keywords` 原子由模型执行且不碰网络:它按自己既有的输入链(`pfe_triples` → `extraction_result` → `source_text`/`text`/`input`)读本次运行的材料,写出 `keywords` 数组。清单从此是 13 个阶段、4 个模型阶段,仍在出厂的 24/12 预算内。

**检索策略要落进交付物,而没做过的检索不得写成做过。** `draft` 的指导要求「证据与引用」一节写明覆盖上位、下位与同义词的关键词组、要用的 IPC/CPC 分类号、要检索的数据库,以及每组检索要判定什么——区别特征是否属公知常识、结合是否有动机。同一行禁止把未执行的检索写成已完成,禁止编造文献号与公开日。`prior-art-search` 的可观测量是「可执行的检索策略加上有依据的结论」,在 oracle 的 case 上,陈述出来的方案就满足;这条禁令才是防止虚构对比文件得分的东西。

**豁免是删掉,不是收窄;机制留着。** [examples/patent-oas/gate.yaml](../../../../packages/self-evolve/self-evolve-benchmark/examples/patent-oas/gate.yaml) 不再声明 `surfaces`。解析、`validateGateConfig` 的校验(节点名真实存在、至少绑定一个节点、至少留一个可评节点)与判定输出里的 `[not-assessed]` 行都保留,因为「这份清单结构上产不出该节点的证据」对别的被测面仍然值得表达。出厂策略为空这件事本身被钉住,而豁免的打分路径用构造出来的配置来跑。

**第 5 维仍然是一次观测喂两个节点。** 把 `deliverable-format` 与 `prior-art-search` 拆开,需要往 `cases/oa-answer/rubric` 加一个维度,那会改动 `goldDigest` 并让每条已提交记录失效:两面基线都得重采,而 `headless` 那组数字不再描述它当初被测的那次测量——正是 #573 排除的事。这层共用关系摆明而不藏:`forEachNodeWeight` 把一个维度的分数给该维度映射到的每个节点,所以只关乎格式的瑕疵也会记到检索节点上。真到了这层耦合妨碍判定的一天,拆分就是下一步,而且它连着两面重采一起到来。

## Alternatives considered

**补真检索链:`search`,再按 `time_baseline` 接 `prior_art_filter`。** 否决。`search` 调配置的检索 provider(`@deepseek-ai/nuo-patent` 上的 `createNuoSearchProvider`),出现哪些文献取决于采集当天的外部索引;交付物会带上基准钉不住的第三方文本,而 `oa-answer` 会变成没有语料支撑的 `simulation` case。删豁免是为了让两个面重新可比,这条路让两者谁都不比。它还要申请日与优先权日,而 case 的 statement 里没有。

**让关键词阶段读区别特征而不是通知书。** 否决:该原子已经按一条写明的输入链解析输入,而 OA 运行把通知书种进 `source_text`/`text`/`input`,通知书里既有引用文献的公开内容也有被攻击的权项。为一个消费方加输入选择器,是没有第二个消费方的可调项。

**先保留豁免、先拆评分维度。** 否决:证据缺口仍然敞着,却先改了已提交 `headless` 读数的含义;而拆分只有在交付物里有策略可评之后才值回重采的代价。

**评关键词阶段自己的产物而不是交付物。** 否决:被评的对象是递交给专利局的答复书。一份侧文件满足节点、交付物仍不写策略,只会让分数涨上去而工作成果没变。

## Consequences

重录的带 key 实测(2026-10-25T17:54Z,`oa-answer` 两轮跑一次,每轮 13 个阶段)把第 5 维推到 100.0,`prior-art-search` 与 `deliverable-format` 因此以 100.0 对着 70 的节点下限读数;case 94.8(逐轮 92.3 → 94.8,权项版本 1 → 2),该面聚合 94.76。提示词面三次运行在同一维度上是 96.67,所以豁免当初声明「这一面产不出证据」的那个切面,现在两个面都读得到——隔开两者的是缺的那个阶段,不是门槛,门槛一步没动。两轮的交付物都写明含上位、下位、同义词的关键词组、点名的 IPC/CPC 分类号、点名的数据库,以及每组检索要判定什么——也都没有为没人做过的检索写出文献号,那正是指导里那条禁令要守住的读数。

代价是每轮多一个模型阶段:一次两轮采集是 26 次阶段执行与 14 次 agent 调用,计费输入 3,105,545、输出 21,739 token;还有那层被暂缓拆开的耦合——`forEachNodeWeight` 仍然把第 5 维那一次观测同时给两个节点,所以只关乎格式的瑕疵也会记成检索失败。测到的仍是一份写明的方案,不是检索命中:查询真能命中多少要等受控的 `simulation` 语料才测得到,而把 `search` 原子接进这份清单会把记下的数换成那个。

`prior-art-search` 从此是工作流面判得了失败的节点:后来任何模型、指导或清单改动把检索方案那一节弄丢,读数是节点低于下限,而不是节点被豁免;`patent-oa-response` 与 `patent-oa-chain` 两份录制快照带着 13 阶段的形状。相关: [通过产品执行者测量 OA 工作流面](../process/2026-10-25-patent-oas-workflow-surface-measurement.zh.md) —— 本 note 兑现了它写下的删除条件 —— 以及 [专利评测测量协议](../process/2026-10-16-patent-eval-measurement-protocol.zh.md)。
