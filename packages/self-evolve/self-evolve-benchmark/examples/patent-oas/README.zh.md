# patent-oas 示例 Benchmark

[English](README.md) | 中文

面向专利实务的示例 benchmark,供 `@deepseek-ai/dsh-self-evolve-benchmark` 使用。基准 ID 为 `patent-oas`。每个 case 把公开的 `statement`(给执行 agent 的任务)与私密的 `rubric`(评分标准)物理分离,满足引擎的 statement/rubric 隔离约束(C2):执行、优化、应用角色只接触 statement;只有 evaluator 拿到 rubric。

## Cases

| case | 任务 | 评分维度 |
|---|---|---|
| `oa-answer` | 审查意见答复:检索→区别特征→实际解决的技术问题→技术启示→结论→修改权利要求书(六步) | 区别特征认定、技术问题、技术启示、结论与法条、检索与格式、修改接地与幅度 |
| `claim-drafting` | 交底书→权利要求书:独立权利要求+从属权利要求+引用关系 | 必要技术特征、保护范围、从权布局、引用层次、形式支持 |
| `infringement-comparison` | 侵权比对:全面覆盖原则+等同原则,逐特征比对+风险定级 | 比对完整性、等同运用、结论明确性、风险定级、法律依据 |
| `novelty-creative` | 新颖性/创造性分析:A22.2 单独对比 + A22.3 三步法 | 单独对比、区别特征、技术问题、结合启示、结论与法条 |

每个 case 目录必须含 `statement` 与 `rubric`;多轮 case 额外有一个 `rounds/02/statement` 文件:

```
cases/<case-id>/
├── statement             # 公开的第 1 轮任务文本 —— 目标 agent 唯一可见的输入
├── rubric                # 私密评分标准 —— 与 statement 物理隔离
└── rounds/02/statement   # 可选:第 2 轮脚本化审查意见
```

多轮 case 固定为两轮:执行者先作答,再收到作为新公开输入的脚本化审查意见,并修订上一轮交付物——运行器以 `previous-deliverable.md` 把它交给执行者。两轮用同一份 rubric 评分,门禁只判最后一轮。把审查意见写进 case 使第二回合可复现,而不是引入一个会变动的第二审查模型。

`patent-state/guidance.md` 是初始 agent state 种子:一份 model-visible 的专利作业规范(checklist),executor 按它完成交付物,optimize loop 以它为编辑对象。它只含通用作业方法,不含任何 case 的答案,不破坏 rubric 隔离。

## 问题空间 DAG 与回归门禁

`problem-space.yaml` 把这份金标覆盖的专利实务问题空间建成一张有向无环图:节点是交付物会被判定的切面,`dependsOn` 记录先决关系(检索先于区别特征认定,区别特征先于实际解决的技术问题,逐特征比对先于等同分析),每个 rubric 维度按自己的满分拆到它观测的节点上。`gate.yaml` 钉住金标内容摘要与分数门槛。

`pnpm run verify-patent-oas-gold`(CI,无需 key)校验:金标与 DAG 互相钉住(维度全部有映射、映射权重等于 rubric 满分、节点都有观测面、先决边无环)、已记录的金标摘要相符、已记录的基线能满足自己的门槛。`--run <record.json>` 按门槛判定一次实测记录,并把失败归因到问题空间节点;记录带逐次观测时,输出同时给出逐 case 与逐节点的极差和样本标准差;`--accept <record.json>` 把校验通过的实测记录提升为基线;金标被有意修改后用 `--write` 重录摘要。

run 记录是「测量」与「门槛」之间的契约:它只保存逐维度的原始观测分,case 分与节点分由 DAG 现算,因此不存在第二份会漂移的副本。字段为 `{ benchmarkId, recordedAt, provider?, modelId?, runsPerCase, cost?, tokens?: { input, output }, cases: [{ caseId, dimensions: [{ index, label, points, score, scores? }], rounds?: [{ round, statementDigest?, dimensions: [{ index, score, scores? }], deliverableDigests }] }] }`。`runsPerCase > 1` 时,`scores` 保留每次运行的原始分数,读者可据此复算方差与区间,而不必只信一个均值;`tokens` 与 `cost` 累计整次采集的每次调用(`tokens.input` 是计费输入,含缓存命中与缓存写入):每次调用都报告成本时取 provider 报告值,否则在 token 合计完整时按调用方给出的每百万 token 单价换算;只有部分调用报告用量时省略合计,不写部分值。单一输入单价统一适用于含缓存在内的计费输入;需要区分缓存价格时由接缝直接报告成本。多轮 case 的 `dimensions` 是终局维度,`rounds` 则保留每一轮的逐维度观测、开启该轮的脚本化审查意见摘要(`statementDigest`;第 1 轮没有)以及该轮每次运行的交付物摘要。门禁仍只判终局,并打印逐轮总分,因此修订是进步还是回退一目了然,而判定规则不变。基线落在 `packages/self-evolve/evaluation/patent-oas-baseline.json`;该文件不存在时门禁以非 0 退出并打印记录基线的命令——「没比对过」与「比对通过」不能共用一个退出码;本 fork 的必过 CI 车道会运行该门禁,退出码因此能拦住 PR。

`pnpm run gate:patent-oas` 负责采集。`--dry-run` 只打印计划(case、轮次、运行次数、agent 调用总数),不做任何模型调用;真实运行需要 `DEEPSEEK_API_KEY`(或声明该键的 `.env`),没有则以 0 退出并跳过。它每次调用起一个 `dsh --profile` 进程——每个 case 每轮一个执行者,在 agent state 的私有副本里工作并把交付物写进 `deliverable.md`;每个 rubric 维度每轮一个评估者,把 `{"score": n}` 形状的 JSON 对象写进 `score.json`——随后写出 run 记录,把所有产物与 agent 日志留在 `.artifacts/patent-oas/<stamp>/`,并按门槛判定本次运行。多轮 case 的第 2 轮在 `run-N/round-2/` 下执行:运行器复制第 1 轮的 agent state,把该轮交付物保留为 `previous-deliverable.md`,并删除旧的 `deliverable.md` 与 `agent.log`,以促使执行者写出新交付物、日志各轮分开。`headless` profile 的每次调用还带 `--json`,采集器因此能读取 `step_end` 事件里的 usage 并累计整次采集的 token。`--case <id>` 与 `--runs <n>` 用来缩小范围与重复运行;`--timeout-ms` 限单次调用、`--budget-ms` 限整次采集;`--input-usd-per-mtok` 与 `--output-usd-per-mtok` 在 provider 只报告 usage、不报告成本时提供 token 单价;基线由门禁提升,而不是由采集器。

采集到的分数测的是「调用方传入的 profile(缺省 `headless`)下的模型 + 作业规范」,而不是 patent preset 的工具集与人设,因此记录之间只在同一 profile 下可比——`provider` 与 `modelId` 两个字段就是为这条留的。

随仓提交的基线是一次 keyed 实测:2026-10-19、`headless` profile、每 case 三次运行,聚合 94.65,四个 case 分别为 95.65、98.60、90.42、93.93。这次实测按 B7 测量协议预注册的 `--runs=3` 执行,并新增 `oa-answer` 的「修改接地与幅度」观测节点——该节点三次运行 55/58/55,是当前测到的最弱一面,门槛因此单列 50 固定首测水平,不把首测值读成合格线。它没有方差或区间,也没有 `scores`、`tokens`、`cost`、`provider`、`modelId`:它记录在采集器留存逐次观测与用量之前;后两个字段只在调用方传入 `--provider` 与 `--model` 时出现。带 key 重新采集会把它们全部写入。当前金标还没有多轮 case:两轮链路由 spec 无 key 覆盖,真实多轮基线与脚本化审查意见都待带 key 重录。给 case 增加 `rounds` 会改变金标摘要,因此那次采集必须同时重录摘要与基线。除模型调用之外的一切另有覆盖:采集接缝可注入,spec 用桩把整条链路跑通并写出那两种产物,覆盖提示词、产物契约、逐维度聚合、两轮交接、真实启动参数,以及记录能被门禁接受。

## 播种

```sh
node seed.mjs [baseDir]
```

`baseDir` 缺省为 `~/.dsh/self-evolve-benchmark`(与引擎默认 `baseDir` 对齐;`$DSH_HOME` 覆盖 `~/.dsh`)。脚本幂等:重跑会原位覆盖 case 文件。

播种后的布局:

```
<baseDir>/benchmarks/patent-oas/
├── benchmark_config.yaml
├── oa-answer/statement|rubric
├── claim-drafting/statement|rubric
├── infringement-comparison/statement|rubric
└── novelty-creative/statement|rubric
<baseDir>/patent-state/
└── guidance.md   # 初始 agent state 种子
```

## 使用

播种后即可通过引擎公共方法跑闭环。引擎的 `baseDir` 应指向同一数据根,`agentStateDir` 指向播种出的 `patent-state` 工作副本:

```ts
await engine.establishBaseline('patent-oas', { runsPerCase: 1 })
await engine.optimizeLoop('patent-oas', {
  maxRounds: 3,
  targetScore: 80,
  runsPerCase: 1,
})
```

`agentStateDir` 默认指向 `patent-state` 工作副本(见专利 preset 装配);**不要**把真实案卷目录当作 `agentStateDir`——那会把真实产物整包打快照并允许优化器就地改写。
