# 技术交底书四路抽取调用成本调研

日期：2026-10-21
范围：`patent_disclosure_v1` 的 `extract_problem` / `extract_features` / `extract_effects` / `extract_insight` 四次抽取调用
性质：只读调研，无代码改动

## 结论

- 四路抽取只出现在 `patent_disclosure_v1`（`packages/patent/patent-workflow/src/workflow/manifests.ts:143-173`）。四个阶段同 atom、无 `retry`、无 `consumes`，因此落在同一个并行窗口内并发执行（`packages/patent/patent-workflow/src/workflow.ts:189-210`；默认 `maxParallelStages = 4`，`workflow.ts:103`）。
- 每次调用都重复整份交底书，并在 8000 字符处截断（`packages/patent/patent-core/src/atoms/handlers/builtin/extract.ts:91`）。在截断上限处，四份 prompt 合计 32,613 字符，其中 24,051 字符是同一原文的三份重复，占 73.7%；另有约 1,578 字符的 JSON Schema 随四次请求重复下发。
- 发明认知那一路占一次调用、24.9% 的 prompt 字符，但提示词要求“逐条按 problems 的顺序对应”，该调用却从不读取 `problems`，而 `merge` 按数组索引配对（`extract.ts:206-212`）。这是四路拆分里唯一的语义对齐缺陷，与成本问题同源。
- 全并成一次调用理论省最多（约 74% 输入字符），但单次输出集中、质量与截断风险未测；把 `problems` 与 `insight` 合并成一次调用只省约 24% 输入字符，却同时修复上面的对齐缺陷，是低风险的第一步。
- 依赖前缀缓存的重排在本管线没有确定收益：四路调用并发冷启动，回退重跑时 prompt 本来就完全相同。
- 观测缺口：快照里没有交底书 manifest 的录制会话，`patent/model-call` 事件也不含阶段标识与 prompt，无法从现有记录归因到具体抽取路。本报告的字符数是静态实测，真实计费仍需一次带 key 的披露 run。

## 测量方法

- 直接调用真实的 `ExtractHandler.execute`，provider 桩捕获实际 prompt 与 `jsonSchema`；原文用等长汉字串，长度取 2000、6000、8000（默认截断上限）。
- 提示词由 `extract.ts:107-114` 构造：中文指令 + `dataBlock(text.slice(0, promptLimit))`；`dataBlock` 输出 `<data>\n<JSON 字符串>\n</data>`（`packages/patent/patent-core/src/prompt-hygiene.ts:29-32`）。
- 字符数为 `prompt.length` 实测值；schema 字符数为 `JSON.stringify(jsonSchema).length`。schema 不在 prompt 字符串内，而是作为结构化输出参数随每次请求下发（`packages/patent/patent-core/src/atoms/handlers/builtin/llm.ts` 的 `callLlm` → `provider.llm`）。
- token 换算假设中文约 0.6 token/字符，并以 0.5–0.8 做敏感性区间；这是估算，不是分词器实测。

## 实测字符数

| 原文截断长度 | problems | features | effects | insight | 四路合计 | 单份数据块 | 被重复的原文（3 份） | 重复占比 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2,000 | 2,113 | 2,267 | 2,107 | 2,126 | 8,613 | 2,017 | 6,051 | 70.2% |
| 6,000 | 6,113 | 6,267 | 6,107 | 6,126 | 24,613 | 6,017 | 18,051 | 73.3% |
| 8,000 | 8,113 | 8,267 | 8,107 | 8,126 | 32,613 | 8,017 | 24,051 | 73.7% |

每路除数据块外的固定文本：problems 96、features 250、effects 90、insight 109 字符（features 多出的是 MTU 拆分与标注规则）。四个 schema 各 394–395 字符，合计约 1,578 字符，同样四次重复。

发明认知一路在 8000 字符处的 prompt 占比：8,126 / 32,613 = 24.9%。

## token 成本换算（估算）

以 8000 字符上限、0.6 token/字符计：

| 方案 | 调用次数 | prompt 字符 | 估算输入 token | 相对现状节省 |
| --- | --- | --- | --- | --- |
| 现状四路 | 4 | 32,613 | ≈19,600 | — |
| 合并为单调用 | 1 | ≈8,300 | ≈5,000 | ≈14,600 token（≈74% 字符） |
| problems + insight 合并 | 3 | ≈24,600 | ≈14,800 | ≈4,800 token（≈24% 字符） |

按 0.5–0.8 token/字符，四路现状约 16,300–26,100 token，单调用节省约 12,100–19,400 token。schema 的重复下发未计入上表，单调用还能再省约 0.7k token 量级。

回退会放大差额：`consistency` 命中 `whenOutputMatches` 后回退到 `extract_problem` 一次（`manifests.ts:186-190`），四路抽取、`merge`、`groundedness` 全部重跑。已实现的决策记录也确认了这一点（`.agents/notes/implemented/architecture/2026-10-17-pfie-insight-slot-and-consistency-atom.md:63`）。即每次回退，现状再发四次抽取；单调用方案只再发一次，problems + insight 方案再发三次。

## 现有快照能说明什么

- `snapshots/session/` 下含 `patent/model-call` 事件的 v4 录制只有侵权、无效、复审、OA 答复与 claim-chart，没有 `patent_disclosure_v1`。
- 这几份录制的 outputTokens 远大于输出字符数，例如无效流程单次 `outChars` 676、`outputTokens` 7,439，另一次 `outChars` 6,044、`outputTokens` 12,945。按 manifest 汇总，输出 token 是输入 token 的约 7.6–12.3 倍（侵权 98,834 / 8,019、无效 70,065 / 9,214、复审 92,528 / 9,300、OA 答复 69,519 / 5,633）。这说明这些流程的计费由（推理）输出主导；若抽取调用也呈现同样比例，省下的约 1.5 万输入 token 在整次 run 的总 token 中占比会明显小于 74%。抽取调用的真实输出规模没有录制，不能外推。
- `TokenUsage.inputTokens` 的定义是“未命中缓存的输入”，缓存读取与写入另行计数（`packages/llm/llm/src/types.ts:174-181`）。上述录制没有 `cacheReadTokens` 字段，无法判断输入是否命中过前缀缓存。

## 选项

### A. 四路合并为一次调用

- 变更：manifest 用一个 `extract` 阶段替换四个阶段；`ExtractHandler` 的无 `output_key` 模式目前只解析 `features/problems/effects`，需要补上 `insight`；schema 可要求四个键。
- 收益：prompt 字符约 −74%，调用数 4→1，回退成本从四次抽取降到一次；模型一次看到全部槽位，索引配对不再依赖四次独立生成的巧合。
- 风险：单次输出包含四个数组，输出更长、截断或非 JSON 的概率上升（当前非 JSON 回落为降级）；MTU 标注规则目前只作用于 features，合并后可能污染其他槽位或被整体丢弃；四路拆分源自 Mady 的 `mergeExtractionsNode` 移植，合并后的抽取质量没有本仓库证据。需要 3–5 份真实交底书做前后质量对比，单元测试证明不了这一点。

### B. 保留四路，把原文放到 prompt 前缀以命中缓存

- 现状 prompt 是“指令在前、`<data>` 在后”，四路调用的公共前缀只有开场一句；把 `<data>` 提前可把公共前缀扩大到整份原文。
- 但四个阶段经 `Promise.all` 并发（`workflow.ts:231-232`），冷缓存同时发起，谁也无法命中谁；回退重跑时四份 prompt 与上一轮逐字相同，本来就能整段命中，重排不增加收益。
- 若改为串行以吃缓存，墙钟时间从“最慢一次”变成“四次之和”，且缓存读取仍需计费；不确定收益不值得引入串行。该选项不单独推荐。

### C. 合并 problems 与 insight（推荐）

- 变更：给 `extract` 增加一次产出两个键的模式（例如 `output_keys: ['problems', 'insight']`），manifest 用三个阶段替换四个；`merge` 与下游不需要改。
- 收益：调用数 4→3，prompt 字符约 −24%，回退少发一次抽取；`insight` 与 `problems` 在同一次生成中产生，“逐条按 problems 顺序对应”从空承诺变成真实约束；features 的 MTU 规则保持独立，effects 不受影响。
- 风险与成本：problems 调用的输出略长；仍需更新 `manifest-atoms.spec.ts`、抽取单测与已实现决策记录中的四路事实；质量影响面小于 A。
- 备选做法“保留四路、把 problems 注入 insight 提示词”只能修复对齐，省不了调用，还要在并行窗口里插入串行屏障，不如 C。

## 建议

1. 先落地 C：收益确定、质量风险小，并顺带修掉 `insight` 与 `problems` 的索引对齐缺陷。
2. 同批给 `patent/model-call` 事件补上阶段标识。当前事件只有 `callSite` / `manifestId` / 输出与用量（`packages/patent/patent-workflow/src/model-call-log.ts`），同一 run 的四次抽取无法区分；补上阶段 id 后，下一次录制就能按路核对成本与质量。
3. 用一份真实交底书录制披露 run，比较 C 前后的抽取结果与 usage，再决定是否进一步走 A。若输出 token 占比与现有快照一致，进一步合并的收益主要是调用次数与回退成本，而不是总 token。

## 限制

- 字符数为构造输入下的实测，真实交底书的中英混排、标点与长术语会改变 token 比例。
- 没有披露 run 的录制，无法验证抽取调用的输出/推理 token 规模；所有 token 数字都应按估算看待。
- 本次未改代码；若采纳 C，需要同步更新决策记录与相关测试，并重新录制受影响的快照（如没有披露快照，则新增一份）。
