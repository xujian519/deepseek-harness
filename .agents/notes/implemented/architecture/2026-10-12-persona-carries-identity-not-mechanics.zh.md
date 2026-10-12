# Agent Note: Preset personas carry identity and routing, not tool mechanics

Status: implemented

[English](2026-10-12-persona-carries-identity-not-mechanics.md) | 中文

## Problem

agent preset 的 persona 是每次都付费的固定前缀；随包技能只在案件载入它时才付费。`patent` 的人设已经长成一本作业手册：全篇 15,498 字符里约 6,000 字符在讲怎么接 cnlaw 法律底座（MCP 调用式、REST 端点与其查询参数、IPC 树、按案决策链）、怎么在检索通道间降级、以及某个校验工具会报哪些结果键。撰写或检索要用这段文本，只算一个期限的案子不用。

有两条性质让这种增长不可见。没有门禁度量人设，也没有任何录制会话回放它：keyless 快照车道跑 headless profile，而该 profile 不挂 agent preset，所以没有一份期望输出含人设文本。真正读人设的 `patent-preset.spec.ts` 用例断言的是单条规则（cnlaw 声明段、证据核验、附图路由），不是纪律集在一次改写后是否还在。

## Decision

人设承载身份、九条作业纪律、案型路由表、标准作业流程与输出纪律。调用式移进每条路由行本已点名的技能：

- 法律底座的通道、REST 调用式、查询参数与引用格式移进 `patent-fact-check`——它本来就负责「可核验的来源从哪来」；图谱与按案决策链的 MCP 调用式并入 `inventive-step-analysis`，该技能本就记录四步证据包。
- 专利原文的下载降级链移进 `patent-prior-art-search`，它属于该技能的通道表；附图工具路由与附图索引移进 `patent-quality-gate` 与 `patent-document-polish`；工作台桥接移进 `patent-matter`；团队通道的理由与组队门槛移进 `patent-team-composition`。
- 部署可变项整体离开人设：图面字高下限与字号只写成本所的小四/四号体例要求，取值本身留在出图与复核工具读取的 `patent-tools` Config 字段里。

两条检查守住这个摆放。`scripts/preset-mode-baseline.json` 给每个交付型模式一个 `personaMaxChars` 上限（`patent` 为 12,000），由 `verify-preset-mode-baseline` 执行。`patent-preset.spec.ts` 把九条纪律各锚在承载其含义的那句话上，并逐字断言强制免责声明，因此丢掉一条纪律会让测试失败，而不是让所有门禁照旧变绿。

## Alternatives considered

- **把这些调用式留在人设里。** 否决：成本摊在每一次请求上，包括那些根本不会碰法律底座的请求，而人设本来就已经点名了承载各主题的技能。
- **新增一个 cnlaw 通道技能。** 否决：`patent-fact-check` 已经在回答「引用的来源从哪来」；再加一个技能会把同一主题拆到两个加载单元、两个归属地。
- **把上限写进 `scripts/doc-budgets.manifest.json`。** 否决：那份清单给文档正文设预算，而这个上限属于「一个交付型模式是什么」，是模式基线的主题。
- **用快照断言人设内容。** 否决：快照车道不挂 preset，而一份装着 9 KB 提示文本的期望文件会在每次改措辞时失败。

## Consequences

- 人设正文为 9,177 字符。只有案件载入承载它们的技能后，请求才为通道调用式付费；文本含义未变。
- 迁移后的文本继续遵守「模型可见的专利文本不得写出 cnlaw 端点字面量」：技能与 persona 由同一条断言扫描，端点仍取自 `patent-law` 按 Config 渲染的声明段。
- `verify-preset-tool-refs` 现在经技能解析迁移过去的引用；人设新加反引号的参数名与结果键名，按各自归属的工具登记为豁免引用。
- 纪律锚点是一份硬编码清单：增删纪律就要改这份清单，这是人设没有其它机检手段所付的代价。
