# Agent Note: 把不可信提示文本隔离进数据块

Status: implemented

[English](2026-09-20-untrusted-prompt-text-in-data-blocks.md) | 中文

## Problem

每一处拼接外部文本的专利提示词——交底书、检索到的现有技术、权利要求、回退时的修订提示——都把那一段夹在两条裸 ` ``` ` 围栏之间；另有两个调用点连分隔符都没有。那段文本是不可信的：它来自用户上传、检索命中，或上一轮模型输出。交底书里只要出现一个 ` ``` `，围栏就被提前闭合，其后的全部内容都被读成指令；伪造一个 `</data>` 或一个收尾的 JSON 示例，效果相同。

两个调用点没有可闭合的分隔符。`patent-analysis-report.ts` 把拼接好的标题、摘要与权利要求直接接在「只输出 JSON，不要多余文字」这句话之后，于是指令区的最后一段就是攻击者可控的文本。`workflow-helpers.ts` 把阶段材料用裸换行接在阶段描述上。`chart.ts` 的目标对象列表与 `draft.ts` 的修订提示则无上界地拼入，长输入还会把提示词里其余内容挤走。

现有技术、对比结果等槽位上的 `|| '（无…）'` 兜底还有第二重失效：值一旦被包裹，空值会产生 `<data>\n\n</data>`，它非空，所以兜底永不触发，提示语从不进提示词。

## Decision

`packages/patent/patent-core/src/prompt-hygiene.ts` 导出 `dataBlock(value: unknown): string`：用 `JSON.stringify` 序列化，包进 `<data>…</data>`，并把每一处 `</` 替换为 `<\/`。换行、引号、反斜杠都成为 JSON 转义；`</data>` 字面量无法出现在块内。`<\/` 是 `/` 的 JSON 转义，故对块内内容做 `JSON.parse` 能逐字还原原文本。

闭合序列之外的单个 `<` 原样保留。有些提示词逐字引用用户文本——`厚度<5mm 且强度≥3MPa` 必须带着它的 `<` 到达模型——所以把每个 `<` 都转义，会把一个真实的注入面换成虚假的，并改变那些提示词所说的话。

`JSON.stringify` 的 lib 声明返回 `string`，但对 `undefined`、函数、symbol 实际返回 `undefined`。实现做的是收窄而非断言，并退回空串：`dataBlock(undefined)` 得空块，`dataBlock(null)` 得字面量 `null`。

四个值现在被包裹的兜底点——`inventiveness.ts` 的现有技术，以及 `novelty.ts` 的现有技术、对比结果、数值事实——改为判定 `value.length > 0`，不再依赖 `||`，因为包裹后的形态永不为假。

12 个文件里的 33 处生产调用点全部走 `dataBlock`：`patent-core` 里 9 个内置 handler 与图域，以及 `patent-tools` 里的 `analyze-patent-figure.ts`、`patent-analysis-report.ts`、`workflow-helpers.ts`。模块头为本条规则声明了适用面：指令区之外来的文本一律走 `dataBlock`，绝不以明文拼入。

四处原本没有截断的调用点一律不加截断。隔离与限长是两件事，而这四处无上界的原因各不相同：图表目标对象列表已由其生产者限长，分析报告文本已由报告自身的输入校验限长，工作流阶段材料与修订提示则本就与阶段产出同长。加一条上界会在一项以转义为题的改动里改变模型所见，而且没有实测需求支撑。

## Alternatives considered

**把载荷里每个 `<` 都转义。** 否决：提示词出于技术比对的需要逐字引用用户文本，`厚度<5mm` 是合法载荷。只有 `</` 序列能离开数据段，所以只转义它。

**在包裹的同时加一条长度上界。** 否决：那会超出转义修复本身改变模型可见输入，而这些点的无上界要么是有意的，要么已在上游处理。日后需要上界的改动可以凭自己的证据再加。

**保留 ` ``` ` 围栏，转义载荷内的围栏字符。** 否决：围栏没有转义机制，于是载荷要避开的是解析器认作分隔符的一切，而这一点无法在每个调用点逐一核查。有转义的分隔符（XML 式标签里的 JSON 字符串）让载荷的安全性成为包裹器的性质。

**只包裹 `patent-analysis-report.ts`——唯一既无分隔符又紧邻指令的那一处。** 否决：其余调用点的裸围栏会被同一份载荷注入，一个让大多数调用点留在可注入形态上的修复，后来的读者无法依赖。

**用一个「模型大概不会产出」的分隔符。** 否决：关于模型行为的假设不是编码的性质，而载荷的作者不是模型。

## Consequences

含 `</data>`、围栏或指令块的载荷，以单个已转义 JSON 字符串的形态到达模型。块内任何内容都无法提前结束它，因为唯一能结束它的序列无法出现在块内。

凡转换过的调用点，提示词文本都变了，故这是模型可见的改动。四处原本无上界的调用点现在有了块边界，但没有长度上界；其输入长度不变。

`dataBlock` 由 `@deepseek-ai/dsh-patent-core` 导出，所以 `patent-tools` 跨包消费它，而不是各自重写。

methodology 各组件对 `context.goal` 的模板字符串插值未动。该缺口在上游同样存在——是共同缺口而非移植丢失——补它应随组件本身，不在此处。

## Testing

`packages/patent/patent-core/tests/prompt-hygiene.spec.ts` —— 文本经块往返、由 `JSON.parse` 还原；换行、引号、反斜杠不破坏块；伪造的 `</data>` 被转义、无法终止数据段；单个 `<` 逐字保留；数组与对象同样序列化；`undefined` 得空块、`null` 得字面量，均不抛错。

`packages/patent/patent-tools/tests/workflow-chain-stage-executor.spec.ts` —— 原先钉住旧围栏形态的两条断言改为钉住数据块，端到端覆盖阶段材料那个调用点。

## Related

- [Sati 专利域作为 dsh 插件](../feature/2026-08-17-sati-patent-domain-dsh-plugins.zh.md) —— 本包所属的移植。
