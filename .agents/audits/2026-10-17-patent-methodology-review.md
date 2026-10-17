# 专利 methodology 模块评审 — 可运行性与优化建议（2026-10-17）

- 触发：用户要求深度研究 `packages/patent/methodology` 是否完整可运行，调研开源社区并提出优化建议。
- 范围：`packages/patent/methodology` 的源码、随包数据、测试、README、发布清单，以及它在 `patent` preset、`patent-core`、`patent-tools` 中的接线。
- 基线：分支 `feat/patent-writing-patterns-optimization`，评审日期 2026-10-17。
- 工作区状态：评审期间工作区有 77 个与本模块无关的未提交改动；`git status --short packages/patent/methodology` 为空。评审阶段代码零改动；本次只新增本报告与执行计划两份审计文档。
- 方法：源码与文档直读、`rg` 调用方检索、`vitest` / `tsc` / `oxlint` / `publint` / `npm pack` 实跑、构建产物烟测、矩阵数据与两个独立开源转录逐格对比。
- 关联执行计划：[`2026-10-17-patent-methodology-optimization-plan.md`](2026-10-17-patent-methodology-optimization-plan.md)。

## 0. 结论先行

**`packages/patent/methodology` 可以构建、可以加载、可以调用；完整性不足，主要缺口在矩阵数据正确性和产品集成。**

| 维度 | 结论 | 关键依据 |
|---|---|---|
| 构建与类型 | 通过 | `tsc --noEmit` 退出码 0；`oxlint` 0 warning / 0 error |
| 单元与集成测试 | 通过 | 4 个测试文件、47 个用例全部通过；覆盖率 100% |
| 插件运行 | 通过 | 真实 Cordis Loader 组合测试通过；构建产物 `lib/index.js` 烟测通过 |
| preset 集成 | 部分 | `patent.patch.yml` 已挂载该插件，但专利技能只路由 `triz_contradiction_analysis`，没有技能引用 `triz` |
| 矩阵数据 | 不完整 | 随包矩阵 1190 个非空格；Casey Perno 转录 xls 与 pytriz 均为 1248 个，漏掉 58 个单原理格；另有 1 个格重复列出原理 35 |
| 库 API | 可调用，无消费方 | 8 个方法论组件、Registry、Injector 在仓库内没有调用方 |
| 文档与许可 | 部分 | README 的 1190/292 计数沿用了有缺陷的中间数据集；缺少矩阵数据来源与许可说明 |
| 发布包 | 基本可用 | `npm pack` 可打包；`publint` 警告 `./src/*` 导出在产物中不存在 |

## 1. 验证记录

```sh
pnpm exec vitest run packages/patent/methodology/tests
# 4 files, 47 tests passed

pnpm exec vitest run packages/patent/methodology/tests \
  --coverage --coverage.include='packages/patent/methodology/src/**' \
  --coverage.thresholds.lines=100 --coverage.thresholds.functions=100 \
  --coverage.thresholds.branches=100 --coverage.thresholds.statements=100
# All files 100%

pnpm exec tsc -p packages/patent/methodology/tsconfig.json --noEmit
# exit 0

pnpm exec oxlint packages/patent/methodology/src packages/patent/methodology/tests
# 0 warnings, 0 errors

pnpm run verify-node-next-types
# 397 workspace package declaration API(s) compile under NodeNext

pnpm exec vitest run packages/bundle/web-app/tests/patent-preset.spec.ts
# 28 tests passed

npm pack --dry-run --json   # 包内含 lib/index.js、lib/types、assets
pnpm exec publint packages/patent/methodology
# Warning: pkg.exports["./src/*"] is ./src/* but does not match any files.
```

构建产物烟测结果：40 条原理、39×39 矩阵，`lookupMatrixCell(14, 1)` 返回 `[1, 8, 40, 15]`，与经典矩阵一致。

## 2. 模块定位与运行链路

`@deepseek-ai/dsh-methodology` 实际由两层组成：

**第一层：产品面（TRIZ 工具）**

- `src/tool/triz.ts`：注册 `triz` 工具。无参数返回 39 个工程参数 + 40 条发明原理；传 `improving`/`worsening` 返回矩阵格推荐原理。
- `src/prompt.ts` + `src/index.ts`：注册常驻的 `tool:triz` 系统提示词区段（order 111），由 `registerSection` 开关控制。
- `assets/triz-matrix.json`、`assets/triz-principles.json`：随包数据。
- `src/data.ts`：数据加载、矩阵查格、参数检测。

**第二层：库 API（方法论注册表）**

- `MethodologyRegistry`、`injectMethodology`、`keywordMatch`。
- 8 个组件：5 Whys、MECE、SWOT、PDCA、鱼骨图、第一性原理、六顶思考帽、TRIZ。
- 这些组件是纯规则 prompt 模板，不调用 LLM，也不自动挂载。

**接线现状**

- `packages/bundle/web-app/presets/patent.patch.yml:492` 挂载了 `@deepseek-ai/dsh-methodology`。
- `packages/bundle/web-app/presets/patent.md:24` 将其描述为 "the triz tool"。
- 专利技能中只有 `patent-disclosure-understanding/SKILL.md:19` 引用 `triz_contradiction_analysis`（来自 `patent-tools`，内部复用本包的矩阵数据）。
- `rg` 结果显示：仓库内没有技能或产品代码引用 `triz` 工具本身，也没有代码调用 `MethodologyRegistry` / `injectMethodology`。

这带来一个核心判断：**包本身是完整的可运行单元；产品集成只完成了“挂载”，还没有完成“路由”。**

## 3. 完整性与正确性问题

### 3.1 P0：矩阵漏掉 58 个单原理格，另有 1 个重复格

这是最重要的发现。

随包数据统计：

| 指标 | 随包数据 | Casey Perno xls / pytriz |
|---|---:|---:|
| 非空格 | 1190 | 1248 |
| 对角空格 | 39 | 39 |
| 非对角空格 | 292 | 234 |
| 总空格 | 331 | 273 |

两个独立来源（`kamil-szczepanik/TRIZ-Agents` 的 `triz_matrix.xls` 与 `pytriz` 的 `matrix_values.csv`）逐格完全一致：1248 个非空格、234 个非对角空格、39 个对角空格。随包矩阵与它们相比，**恰好少了 58 个格，且这 58 个格在源数据中都只有一条推荐原理**。这符合“单值单元格被中间数据集解析时丢弃”的特征。

具体例子：

| 调用 | 随包结果 | 源数据结果 |
|---|---|---|
| `triz(improving=3, worsening=15)` | 无推荐 | 原理 19 |
| `triz(improving=6, worsening=14)` | 无推荐 | 原理 40 |
| `triz(improving=14, worsening=20)` | 无推荐 | 原理 35 |
| `triz(improving=19, worsening=9)` | `[8, 35, 35]` | `[8, 35, 35]`（源数据同样重复，需要人工复核） |

工具当前会把这些格渲染成：

> Recommended principles: none. The classical matrix lists no recommendation for this pair.

这句话对 58 个格是错误结论。对于专利规避设计、方案探索，模型会因此错过一条本应存在的发明原理。

完整漏格清单：

<details>
<summary>58 个漏格（改善参数, 恶化参数）→ 源数据推荐原理</summary>

`(3,15)→[19], (3,18)→[32], (4,34)→[3], (4,37)→[26], (6,14)→[40], (6,34)→[16], (6,38)→[23], (7,19)→[35], (7,34)→[10], (8,32)→[35], (8,34)→[1], (11,33)→[11], (11,34)→[2], (11,35)→[35], (12,22)→[14], (13,4)→[37], (13,6)→[39], (13,28)→[13], (13,29)→[18], (14,20)→[35], (14,22)→[35], (14,38)→[15], (15,24)→[10], (15,28)→[3], (16,21)→[16], (16,24)→[10], (16,31)→[22], (16,33)→[1], (16,34)→[1], (16,35)→[2], (16,38)→[1], (17,29)→[24], (18,21)→[32], (20,14)→[35], (21,16)→[16], (22,8)→[7], (22,14)→[26], (22,28)→[32], (22,38)→[2], (24,4)→[26], (24,15)→[10], (24,16)→[10], (24,18)→[19], (24,32)→[32], (24,38)→[35], (25,20)→[1], (26,21)→[35], (31,38)→[2], (32,8)→[35], (34,8)→[1], (34,11)→[13], (34,16)→[1], (35,37)→[1], (36,4)→[26], (37,4)→[26], (38,4)→[23], (38,31)→[2], (39,20)→[1]`

</details>

**根因判断**

随包矩阵与 `Antropocosmist/triz-engineering-solver` 的 `contradiction_matrix.json` 完全一致；该数据集声明自己“full、1190 populated”，但它的上游 xls 实际是 1248。最可能的原因是中间数据集在解析 xls 时把单原理格当成了空值。也有可能是该数据集按“来源不确定就省略”的策略主动删掉了 58 格，但它没有在 meta 中记录这次删除。

**影响**

- 模型会得到“无推荐”的错误结论。
- README 中“292 个非对角空格”的说法随之失真；真实经典转录是 234 个。
- 测试 `matrix data is 39x39 with 1190 filled cells` 把缺陷固化成了预期值。

**建议修复**

1. 用 xls 或 pytriz 重新生成 `triz-matrix.json`，保留 1248 个非空格。
2. 对 `(19,9)` 的 `[8,35,35]` 做人工复核；最低限度在读取时去重，避免模型看到重复原理。
3. 更新测试：`1248 filled`、`234 off-diagonal empty`、`39 diagonal empty`、无重复原理编号。
4. 更新 README 中英文的 1190/292/331 计数。
5. 增加锚点测试：至少覆盖 `(1,3)`、`(1,9)`、`(1,14)`、`(1,27)`、`(14,1)` 五格，与源数据按集合比对。

### 3.2 P1：`triz` 与 `triz_contradiction_analysis` 职责重叠，产品路由缺失

当前 patent preset 同时挂载两个 TRIZ 入口：

| 工具 | 来源 | 输入 | 用途 |
|---|---|---|---|
| `triz` | 本包 | 两个参数编号 | 静态矩阵查格 |
| `triz_contradiction_analysis` | `patent-tools` | 交底书原文 | LLM 识别矛盾 + 代码落格 + 证据核验 |

问题在于：

- 专利技能只写了 `triz_contradiction_analysis`，没有写 `triz`。
- `tool:triz` 系统提示词区段却常驻，告诉模型“遇到技术矛盾时用 triz”。
- 模型同时看到两个名字相近的工具，缺少“何时用哪个”的路由规则。

这不会让功能不可用，但会增加工具选择歧义和无效调用。建议在 persona 或 `patent-disclosure-understanding` 技能中加一条明确路由：

> 需要从交底书识别矛盾、检查参数缺口时，用 `triz_contradiction_analysis`；用户已经给出工程参数编号、或只需要查某一格矩阵时，用 `triz`。

如果产品上不需要手动查格，另一个更省 token 的选择是把 `methodology` 行从 patent preset 移除，只保留它作为通用 agent 的 TRIZ 工具。两种选择都比现在的“挂载但不路由”更清晰。

### 3.3 P1：数据来源与许可没有随包记录

本包的 README、`assets/`、`package.json` 都没有说明矩阵和 40 条原理的中文文本来自哪里。当前可追溯的链条是：

- `triz_matrix.xls`（Casey Perno 2007 转录，Altshuller 1985）
- → `kamil-szczepanik/TRIZ-Agents`（GitHub 未声明 LICENSE）
- → `Antropocosmist/triz-engineering-solver`（MIT）
- → 本包 `assets/triz-matrix.json`

`triz-engineering-solver` 声称来源仓库是 MIT，但 GitHub API 显示 `kamil-szczepanik/TRIZ-Agents` 没有 LICENSE 文件。矩阵作为事实表格的版权风险通常较低，但 40 条原理的中文说明文本可能有翻译版权。对一个 `publishConfig.access: public` 的包，这是发布前应当确认的风险。

建议增加 `assets/README.md`，记录：

- 原始出处与转录版本
- 中间数据集与许可证
- 中文文本的翻译来源
- 已知偏差（58 个漏格、1 个重复格）
- 数据校验方法（锚点格、计数、无重复）

### 3.4 P2：库 API 的参数识别有误检和方向丢失

`src/data.ts:detectParamNumbers` 用 `text.includes(param.match)` 做子串匹配，`src/runtime/components/triz.ts:35` 的 `buildLookupLines` 对识别出的参数做全排列，并且两个方向都查。实测：

| 输入 | 识别结果 | 问题 |
|---|---|---|
| `提高强度同时减轻重量` | 1, 2, 14 | “重量”同时命中运动/静止两个参数，产生 1→14、2→14、14→1、14→2 四条查表 |
| `改善电池能量密度但增加重量` | 1, 2, 19, 20 | “能量”同时命中 19/20，产生能量↔重量的无意义组合 |
| `提高能力` | 10（力） | “能力”误命中“力” |
| `降低应力` | 10, 11 | “力”与“应力”同时命中 |
| `减少能量损失` | 19, 20, 22 | “能量”与“能量损失”同时命中 |
| `提高发动机功率，降低油耗` | 21 | 只识别一个参数，查表段直接省略 |
| `设计一种更轻更坚固的支架` | 无 | 常见口语没有命中“重量/强度” |

方向也没有被解析：文本说“提高强度同时减轻重量”，组件会把“改善重量、恶化强度”的反向组合也注入提示词。虽然提示词写了一句“若方向不符请忽略”，但把纠错负担交给模型不是确定性查表应有的行为。

这个缺口目前只影响库 API 的 `injectMethodology`，因为 `triz` 工具不调用 `detectParamNumbers`。如果未来把 Registry 接入产品，它会变成 P1。

建议二选一：

- **保留确定性注入**：改为最长匹配、同义词表、方向词解析（提高/降低/增加/减少），并对运动/静止参数对要求文本明确区分；只注入方向与文本一致的参数对。
- **删除确定性注入**：让模型通过 `triz` 工具自己选编号，组件只保留 TRIZ 的方法步骤。这样最省维护，也避免误检。

### 3.5 P2：工具输出契约与打包细节

**输出 schema 不是按 mode 封闭的**

`src/tool/triz.ts:154` 的输出 schema 只要求 `mode`，`parameters`、`principles`、`improving`、`worsening`、`recommended` 都是可选。理论上 `{ mode: 'lookup' }` 也能通过校验，然后 `render` 访问 `value.improving.label` 会崩溃。当前 execute 只产生合法值，所以没有实际故障，但 schema 没有表达“catalog 和 lookup 是两种互斥形状”。

建议把输出 schema 改成 `oneOf`：

- `{ mode: 'catalog', parameters, principles }`（三者必填）
- `{ mode: 'lookup', improving, worsening, recommended }`（四者必填）

这样还能去掉 `src/tool/triz.ts:164` 的 `value as unknown as TrizOutput`。该断言已在 `no-unknown-casts.baseline.json` 中登记为存量债务，改成 `oneOf` 后可以销账。

**打包导出有一个无效子路径**

`package.json` 的 `exports` 含 `"./src/*": "./src/*"`，但 `files` 只发布 `lib/index.js`、`assets`、`lib/types/**/*.d.ts`。`publint` 已警告该导出匹配不到任何文件。仓库内没有消费方使用这个子路径。建议二选一：把 `src` 加入 `files`，或删除 `./src/*` 导出。

**资产加载时机**

`loadMatrix()` / `loadPrinciples()` 在第一次工具调用时才 `readFileSync`。如果发布包漏了 `assets`，插件仍会正常加载、工具正常注册，直到模型第一次调用才报 ENOENT。建议在 `apply()` 里做一次轻量校验（加载两个资产并检查 39×39、40 条），让安装错误在启动时暴露。

### 3.6 P3：测试与文档的覆盖缺口

- `packages/bundle/web-app/tests/patent-preset.spec.ts` 有 28 个用例，但没有专门断言 `methodology` 行的存在；`scripts/preset-mode-baseline.json` 的 `requiredRows` 也不含 `methodology`。删除该行不会让现有 preset 测试失败。
- `snapshots/` 中没有包含 `triz` 工具的会话快照；`docs/tool-catalog.md` 固定了 schema，但 `tool:triz` 的逐字区段文本没有快照保护。
- README 的 Known Limitations 已经诚实列出“Registry 只是库 API”“区段静态”“只有经典矩阵”，但没有列出 58 个漏格和工具路由缺失。

## 4. 开源社区调研

### 4.1 可比项目

| 项目 | 类型 | 与本模块相关的能力 | 可借鉴点 |
|---|---|---|---|
| [pytriz](https://github.com/mmysior/pytriz) | Python 库，MIT | 39 参数、40 原理、矩阵 CSV（1248 非空格）、5 条分离原理、BM25 检索、可选向量检索、Pydantic schema、LLM prompts | 分离原理、批量参数查表、检索式参数映射 |
| [triz-engineering-solver](https://github.com/Antropocosmist/triz-engineering-solver) | Agent skill，MIT，23 stars | 完整 39×39 矩阵、40 原理、76 标准解、ARIZ-85C、分离原理、8 条进化趋势、3 个示例、锚点校验协议 | 内容深度、数据校验、输出模板 |
| [AutoTRIZ](https://doi.org/10.1016/j.aei.2025.103312) | 论文 + [案例库仓库](https://github.com/shuojiangcn/AutoTRIZ-Repository) | LLM 自动完成问题表述、矛盾识别、矩阵查表、方案报告；教科书案例评测 | “LLM 负责识别，代码负责落格”的分工；案例评测 |
| [TRIZ Agents](https://arxiv.org/abs/2506.18783) | 论文 + [LangGraph 仓库](https://github.com/kamil-szczepanik/TRIZ-Agents) | 多 agent TRIZ 工作流、RAG 工具、评测 | 工作流编排与评测设计 |
| [Patent-GPT](https://github.com/PatentTRIZbasedAI20260226110030/Patent-GPT) | 专利 Agent，MIT | TRIZ + Agentic RAG、混合检索、规避设计、结构化专利草稿 | 交底书到矛盾的完整链路、规避设计 |
| [TRIZ-RAGNER](https://arxiv.org/abs/2602.23656) | 论文 | 把矛盾挖掘建模为 NER；稠密检索 + cross-encoder 重排 + 结构化提示 | 用检索/重排替代子串匹配 |
| [IdeaForge](https://arxiv.org/abs/2605.13311) | 论文 | 多方法论知识图谱、跨方法论收敛、权利要求生成 | 可追溯的中间结构 |
| [patent_creator](https://github.com/HappyThis/patent_creator) | 专利 Agent，MIT | Benchmark 驱动的专利构建优化 | 用评测集驱动改进 |

### 4.2 社区共识

1. **确定性查表 + LLM 识别是主流分工。** AutoTRIZ、Patent-GPT 和本仓的 `triz_contradiction_analysis` 都采用这个模式：模型负责理解技术问题，代码负责参数编号合法性、矩阵落格和证据核验。本模块的 `triz` 工具符合这个方向。
2. **数据来源和校验是社区的一等公民。** `triz-engineering-solver` 专门写了锚点格校验协议，并要求每个数据改动可追溯到原始出处。本包目前缺少这一层。
3. **物理矛盾需要分离原理，而不是一句提示。** pytriz 和 `triz-engineering-solver` 都随包提供 5 条/4 条分离原理；本包的对角格只告诉模型“用分离”，没有给出分离维度或原理，模型只能凭记忆补全。
4. **专利语言到 TRIZ 参数的映射适合用检索。** TRIZ-RAGNER 用稠密检索 + 重排 + NER 解决语义歧义；本包的库 API 仍用子串匹配。专利端的 `triz_contradiction_analysis` 已用 LLM 抽取，方向正确。
5. **评测和示例是成熟项目的标配。** AutoTRIZ 用教科书案例评测，patent_creator 用 benchmark 驱动；本包只有单元测试，没有“工具是否真的改善了模型输出”的评测。
6. **通用方法论组件正在从库 API 转向技能/工作流。** 社区更常见的是把 5 Whys、MECE、SWOT 写成技能或 agent 工作流，而不是暴露一个无消费方的 registry。本包的 8 组件库 API 与这个趋势相背。

## 5. 优化建议

### P0：先修数据

1. **重新生成矩阵**
   - 以 Casey Perno xls 与 pytriz CSV 的交集为准，写入 1248 个非空格。
   - 对 `(19,9)` 的重复原理 35 做人工复核；读取层先去重。
   - 更新测试计数、锚点格、无重复断言。
   - 验收：`triz(3,15)` 返回原理 19；`triz(6,14)` 返回原理 40；`triz(14,20)` 返回原理 35；全矩阵无重复原理编号。

2. **补数据来源与许可**
   - 新增 `assets/README.md`，记录原始出处、转录版本、中间数据集、许可证、已知偏差。
   - 在包 README 的 Known Limitations 中同步。
   - 验收：审查者能从包内文件追溯到 xls 和 Altshuller 原始来源。

### P1：把产品路由补完整

3. **明确 `triz` 与 `triz_contradiction_analysis` 的分工**
   - 在 persona 或 `patent-disclosure-understanding` 技能中加一条路由。
   - 在 `triz` 工具描述和 `tool:triz` 区段中说明“本工具只做参数编号查格，不做交底书识别”。
   - 验收：技能中有明确选择规则；preset 测试断言 `methodology` 行存在。

4. **为对角格补分离原理**
   - 增加 4–5 条分离原理（空间、时间、条件、方向、系统层级），在 `mode: 'lookup'` 的对角格返回。
   - 验收：`triz(improving=5, worsening=5)` 返回分离维度与原理，而不只是一句“physical contradiction”。

5. **决定 Registry 的去留**
   - 如果下一个版本没有真实消费方：把 7 个通用组件和 Registry 移到 `examples/` 或标记 experimental，包名/描述收缩为 TRIZ。
   - 如果保留：接入一个真实的 prompt-assembly 消费方，并修复 `detectParamNumbers`、`keywords`、prompt 围栏。
   - 验收：要么有消费方和集成测试，要么没有无消费方的公共导出。

### P2：修 API 与打包

6. **修复参数识别**
   - 最长匹配、同义词表、方向词解析、运动/静止参数对消歧。
   - 或者删除确定性注入，让模型通过 `triz` 工具选编号。
   - 验收：`提高强度同时减轻重量` 只产生“改善强度、恶化重量”方向；`提高能力` 不再命中参数 10。

7. **收紧工具输出契约**
   - 输出 schema 改为 `oneOf` 的 catalog/lookup 两种形状。
   - 删除 `as unknown as TrizOutput`。
   - 验收：非法形状在输出校验阶段被拒绝；`no-unknown-casts` 基线销账。

8. **修打包**
   - 删除 `./src/*` 导出，或把 `src` 加入 `files`。
   - 在 `apply()` 中校验资产存在。
   - 验收：`publint` 无警告；缺少 assets 时启动即失败。

### P3：体验与测试

9. **加一条 keyless 快照**
   - 记录 `triz` 工具 schema 和 `tool:triz` 区段文本，防止提示词漂移。
   - 验收：快照包含 `triz`；区段文本变化会让快照失败。

10. **工具体验**
    - 声明 `isConcurrencySafe: () => true`（只读、无状态）。
    - 可选增加 `presentationMeta`，在 Web 卡片中展示改善/恶化参数和推荐原理。
    - 可选增加更轻的 `parameters-only` / `principles-only` 模式，减少无参数调用的 token。
    - 验收：并行调用不串行化；Web 卡片可读。

## 6. 最小行动集

如果只做三件事：

1. **修矩阵数据**：1248 格、去重、锚点测试、更新文档计数。
2. **补数据来源与许可**：`assets/README.md` + README 说明。
3. **明确工具路由**：`triz` 与 `triz_contradiction_analysis` 的分工写进技能和提示词；若不需要 `triz`，从 patent preset 移除。

完成这三项后，这个模块可以从“可运行但数据不可靠”提升到“可发布、可被模型稳定使用”。Registry 的去留和分离原理可以作为下一轮迭代。

## Sources

- [pytriz](https://github.com/mmysior/pytriz)
- [triz-engineering-solver](https://github.com/Antropocosmist/triz-engineering-solver)
- [TRIZ-Agents](https://github.com/kamil-szczepanik/TRIZ-Agents)
- [AutoTRIZ paper](https://doi.org/10.1016/j.aei.2025.103312)
- [AutoTRIZ case-base repo](https://github.com/shuojiangcn/AutoTRIZ-Repository)
- [TRIZ Agents paper](https://arxiv.org/abs/2506.18783)
- [Patent-GPT](https://github.com/PatentTRIZbasedAI20260226110030/Patent-GPT)
- [TRIZ-RAGNER](https://arxiv.org/abs/2602.23656)
- [IdeaForge](https://arxiv.org/abs/2605.13311)
- [patent_creator](https://github.com/HappyThis/patent_creator)
- 本地文件：`packages/patent/methodology/src/data.ts`、`src/runtime/components/triz.ts`、`src/tool/triz.ts`、`assets/triz-matrix.json`、`README.md`
- 本地接线：`packages/bundle/web-app/presets/patent.patch.yml:492`、`packages/bundle/web-app/presets/patent.md:24`、`packages/bundle/web-app/skills/patent/patent-disclosure-understanding/SKILL.md:19`
