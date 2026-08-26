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
