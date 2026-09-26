# patent-oas 示例 Benchmark

[English](README.md) | 中文

面向专利实务的示例 benchmark,供 `@deepseek-ai/dsh-self-evolve-benchmark` 使用。基准 ID 为 `patent-oas`。每个 case 把公开的 `statement`(给执行 agent 的任务)与私密的 `rubric`(评分标准)物理分离,满足引擎的 statement/rubric 隔离约束(C2):执行、优化、应用角色只接触 statement;只有 evaluator 拿到 rubric。

## Cases

| case | 任务 | 评分维度 |
|---|---|---|
| `oa-answer` | 审查意见答复:检索→区别特征→实际解决的技术问题→技术启示→结论(五步) | 区别特征认定、技术问题、技术启示、结论与法条、检索与格式 |
| `claim-drafting` | 交底书→权利要求书:独立权利要求+从属权利要求+引用关系 | 必要技术特征、保护范围、从权布局、引用层次、形式支持 |
| `infringement-comparison` | 侵权比对:全面覆盖原则+等同原则,逐特征比对+风险定级 | 比对完整性、等同运用、结论明确性、风险定级、法律依据 |
| `novelty-creative` | 新颖性/创造性分析:A22.2 单独对比 + A22.3 三步法 | 单独对比、区别特征、技术问题、结合启示、结论与法条 |

每个 case 目录下仅两个文件:

```
cases/<case-id>/
├── statement   # 公开任务文本 —— 目标 agent 唯一可见的输入
└── rubric      # 私密评分标准 —— 与 statement 物理隔离
```

`patent-state/guidance.md` 是初始 agent state 种子:一份 model-visible 的专利作业规范(checklist),executor 按它完成交付物,optimize loop 以它为编辑对象。它只含通用作业方法,不含任何 case 的答案,不破坏 rubric 隔离。

## 问题空间 DAG 与回归门禁

`problem-space.yaml` 把这份金标覆盖的专利实务问题空间建成一张有向无环图:节点是交付物会被判定的切面,`dependsOn` 记录先决关系(检索先于区别特征认定,区别特征先于实际解决的技术问题,逐特征比对先于等同分析),每个 rubric 维度按自己的满分拆到它观测的节点上。`gate.yaml` 钉住金标内容摘要与分数门槛。

`pnpm run verify-patent-oas-gold`(CI,无需 key)校验:金标与 DAG 互相钉住(维度全部有映射、映射权重等于 rubric 满分、节点都有观测面、先决边无环)、已记录的金标摘要相符、已记录的基线能满足自己的门槛。`--run <record.json>` 按门槛判定一次实测记录,并把失败归因到问题空间节点;`--accept <record.json>` 把校验通过的实测记录提升为基线;金标被有意修改后用 `--write` 重录摘要。

run 记录是「测量」与「门槛」之间的契约:它只保存逐维度的原始观测分,case 分与节点分由 DAG 现算,因此不存在第二份会漂移的副本。字段为 `{ benchmarkId, recordedAt, provider?, modelId?, runsPerCase, cases: [{ caseId, dimensions: [{ index, label, points, score }] }] }`。基线落在 `packages/self-evolve/evaluation/patent-oas-baseline.json`;该文件不存在时门禁报告「回归层休眠」并以 0 退出,不会静默通过。

`pnpm run gate:patent-oas` 负责采集。`--dry-run` 只打印计划(case、运行次数、agent 调用总数),不做任何模型调用;真实运行需要 `DEEPSEEK_API_KEY`(或声明该键的 `.env`),没有则以 0 退出并跳过。它每次调用起一个 `dsh --profile` 进程——每个 case 一个执行者,在 agent state 的私有副本里工作并把交付物写进 `deliverable.md`;每个 rubric 维度一个评估者,把 `{"score": n}` 形状的 JSON 对象写进 `score.json`——随后写出 run 记录,把所有产物与 agent 日志留在 `.artifacts/patent-oas/<stamp>/`,并按门槛判定本次运行。`--case <id>` 与 `--runs <n>` 用来缩小范围与重复运行;`--timeout-ms` 限单次调用、`--budget-ms` 限整次采集;基线由门禁提升,而不是由采集器。

采集到的分数测的是「调用方传入的 profile(缺省 `headless`)下的模型 + 作业规范」,而不是 patent preset 的工具集与人设,因此记录之间只在同一 profile 下可比——`provider` 与 `modelId` 两个字段就是为这条留的。

本仓从未执行过 keyed 实测,因此被验证的是「除模型之外的一切」:采集接缝可注入,spec 用桩把整条链路跑通并写出那两种产物。提示词、产物契约、逐维度聚合、真实启动参数,以及记录能被门禁接受,都有覆盖;真实模型是否按契约写出产物没有覆盖。

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
