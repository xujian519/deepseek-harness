---
description: "函数插件，用随包分发的费用索引为一件中国专利申请计价：案件应缴的费种及其计数基准、费用减缴、年费分档与滞纳金，以及永不给出索引支撑不了的金额的 patent_fees 工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-fees

[English](README.md) | 中文

## 概述

函数插件，用随包分发的费用索引为一件中国专利申请计价：案件应缴的费种及其计数基准、费用减缴、年费分档与滞纳金，以及永不给出索引支撑不了的金额的 patent_fees 工具。

## 目录

- [patent_fees 工具](#fee-tool)
- [费种与计数基准](#fee-items-and-counting-bases)
- [哪些已记录、哪些没有](#what-is-recorded-and-what-is-not)
- [费用减缴](#fee-reduction)
- [年费与滞纳金](#annual-fees-and-the-surcharge)
- [库 API](#library-api)
- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)

<a id="fee-tool"></a>
## patent_fees 工具

patent_fees 为一件案件计价：输入专利类型与本案所处的环节，按各费种的计数基准计算数量，在索引登记了减缴时按案件适用的减缴计算，并逐行给出该费种的法条依据。每行都标明金额是否已核验，任一适用项未核验时不给合计。

这个工具存在的原因：专利作业纪律要求费用由工具计算，却没有任何工具拥有它——人设与质量门禁都写着"费用用工具计算"，模型却无工具可调。它还让"拒绝"变得可用：未转录的金额是未知，因此工具交回的是费种清单并点名是什么挡住了合计，而不是一个会被读成价格的部分数字。

<a id="fee-items-and-counting-bases"></a>
## 费种与计数基准

每个费种声明它在哪个环节产生（`trigger`）以及数量按什么基准计（`basis`）：`per-case` 每件、`per-claim-beyond` 与 `per-page-beyond` 超过该费种 `freeUnits` 免费基数的每项／每页、`per-priority` 每项优先权要求、`per-annuity-year` 每个专利年度、`per-month` 每请求月数。调用方点名本案所处的环节；未被点名的环节下的费种一律不计价，因此报告覆盖范围恰好等于传入的环节。

```yaml
- id: claims-surcharge
  name: 权利要求附加费
  trigger: filing
  patentTypes: [invention, utility-model]
  basis: per-claim-beyond
  freeUnits: 10
  amount: null
  legalBasis: 专利法实施细则第110条第1款第（一）项
```

<a id="what-is-recorded-and-what-is-not"></a>
## 哪些已记录、哪些没有

费种的金额与支撑它的日期属于转录内容：`amount`（元，十进制字符串）、`sourceDoc`、`effectiveFrom`、`verifiedOn`。由此有三种状态，工具会标明每行处于哪一种：

| 状态 | 含义 |
| --- | --- |
| `verified` | 金额已记录，且有人对照 `sourceDoc` 核验的日期也已记录。 |
| `unverified` | 金额已记录，核验日期没有。该行给出数字并标明未核验。 |
| `unrecorded` | 金额未记录。该行只有适用性与计数，没有数字。 |

随包索引的每个费种都处于第三种状态：`amount`、`sourceDoc`、`effectiveFrom`、`verifiedOn` 全为 null，因此默认部署拿到的是费种清单、各项计数，以及明确的拒绝合计。随包文件确有的阈值（10 项、30 页）与滞纳金规则取自本仓自身的陈述——`draft-claims` 的注释与 `patent-deadline` 的年费条目——它们与金额一样属于未核验。

<a id="fee-reduction"></a>
## 费用减缴

`reductions` 每个减缴项目（`individual` 个人、`enterprise` 企业）一条，含 `reductionPercent`——**减缴**比例，85 表示仍需缴 15%——以及 `requiresFiling`，标明该减缴以事前办理费减备案为前提。费种只有经自身的 `reducible` 标记才进入减缴，年费类费种还要经 `reductionMaxYears`，因为只覆盖前 6 年年费的减缴不能打在第 20 年的折扣上。`reducible` 为 null 的费种会报"是否属于减缴范围未登记"并按全额计；比例未转录时不给任何减缴后金额。

<a id="annual-fees-and-the-surcharge"></a>
## 年费与滞纳金

年费按专利年度逐行计价。年度由调用方给出——日期归 `patent_deadlines`，由它报告哪些年度已到期——金额取自该费种的 `tiers`（落在已转录分档之外的年度会被报出，而不是被猜）。某年度存在超期时追加一行滞纳金：每超过缴费时间 1 个月加收当年全额年费的 `latePayment.monthlyPercent`，上限为 `latePayment.maxMonths`；超出该窗口时该行如实说明且不给金额，因为该费已不可缴。

<a id="library-api"></a>
## 库 API

- `loadFeeTable(path?)` / `parseFeeTable(source, origin)` —— 费用索引，按 fail-loud 校验。
- `computeFees(table, query, options)` —— 计价报告：逐行结果、待补输入项、减缴结论与合计。
- `parseYuan` / `formatFen` / `applyPercent` / `sumFen` —— 以整数分为单位的金额运算；百分比按分四舍五入（半值向上）。
- `createPatentFeesTool({ table, policy })` —— 基于已加载索引的工具。

不发布服务：索引是只读资产，工具是进程内消费者；第二个消费者像使用 `dsh-patent-core` 那样直接引入本库。

<a id="configuration"></a>
## 配置

Schemastery 配置；两个字段都有默认值。

| 键 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| feeTablePath | string | 随包资产 | 费用索引 YAML 的路径。文件缺失或格式错误会让插件加载失败。 |
| failOnUnverified | boolean | `true` | 任一适用行缺少已核验金额时不给合计。关闭后只汇总已核验行，并标明为部分合计。 |

<a id="model-experience"></a>
## 模型体验

### patent_fees 工具

#### 模型看到什么

注册一个名为 `patent_fees` 的工具，`patentType` 与 `triggers` 必填，`claims`、`specificationPages`、`priorityClaims`、`annuityYears`、`extensionMonths`、`lateMonths`、`reduction` 可选。结果是逐行计价结果——id、名称、基准、数量及其计数依据、单价、小计、应付、状态、减缴、法条依据、已记录来源与说明——加上待补输入项、减缴结论、合计与报告说明，渲染为 Markdown 表格，其后依次是合计、减缴、待补输入与说明。工具描述写明：金额只来自已转录的数据；任一适用行未核验时不给合计；未被点名的环节不计价。

#### Token 影响

工具启用期间每个请求都有固定的定义开销；每次结果是张表格加几段短小节，在压缩前会随会话重复发送。

#### KV Cache 影响

仅追加；新可见的结果文本跟随可复用的请求前缀，不会使既有 KV 缓存条目失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **随包索引不含任何金额。** `amount`、`sourceDoc`、`effectiveFrom`、`verifiedOn` 全为 null，因此 `patent_fees` 只报适用性、计数与法条依据，从不给数字；人设与质量门禁据此要求模型在报价前先查证金额。把官方收费标准转录进 `assets/fees/cn-fees.yaml`（逐费种补记公告文号与核验日期）是各部署针对自己要报的费种所做的后续工作。
- **结构性字段同样未核验。** `trigger`、`patentTypes`、`basis`、`freeUnits`、`reducible`、`reductionMaxYears`、`tiers`、`legalBasis` 取自本仓自身的陈述与专利域的环节名，并非官方来源；只有 `draft-claims` 钉住的两个 `legalBasis`、以及 `patent-deadline` 钉住的年费条号与滞纳金规则有可追溯的条号，而本仓已记录其细则编号存在 2020 版与 2010 版混用。开票前须逐字段对照现行收费标准公告。
- **日期归 `patent_deadlines`。** 本工具把 `annuityYears` 与 `lateMonths` 当输入，自身不计算任何日期与超期月数，因此没跑过 `patent_deadlines` 的调用方无法得知年度；若超期月数的算法与期限包的补缴窗口不同，两边结论会不一致。
- **百分比按分四舍五入（半值向上）**，这是本包的算术约定，只在 `money.ts` 声明一次；官方标准未规定不足一分的处理，若某部署需要与公开的取整结果一致，应就自己要报的金额逐项核对差异。
- **服务费、外国官费与索引未收录的费种不在范围内。** 索引只覆盖它列出的中国费种；报告对其他费用不作陈述，其沉默不是零。
- **不发布包不变量。** 金额是否正确是内容属性，任何运行期观测都不能独立证伪；可机械检查的部分（索引解析、数量运算、状态与拒绝合计）是工具执行的检查，不满足不变量的门槛。

### 开发备注

无。

不发布 companion：本包不拥有持久状态或会话事件，索引在加载时读取，每个导出都是显式查询上的纯函数。
