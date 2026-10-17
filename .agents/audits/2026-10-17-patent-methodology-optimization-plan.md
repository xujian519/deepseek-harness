# 专利 methodology 优化执行计划（2026-10-17）

- 依据：[`2026-10-17-patent-methodology-review.md`](2026-10-17-patent-methodology-review.md)。
- 基线：分支 `feat/patent-writing-patterns-optimization`，评审日期 2026-10-17。
- 范围：`packages/patent/methodology` 的数据、工具契约、库 API、patent preset 路由、测试与发布清单。
- 状态：已执行（2026-10-17，方案 A）。
- 使用方式：每完成一项，把检查清单的 `[ ]` 改为 `[x]`，并在「完成证据」中写命令与关键输出。只写“已修复”不算完成。

## 0. 执行原则

1. 先修数据，再改契约；数据修复前不要重新录制依赖 `triz` 输出的快照。
2. 每个任务单独成 PR 或单独成 commit，按批次验证；不要把数据修正、工具契约、文档改写混在一个提交里。
3. 任何模型可见或发布包可见的行为变化，同步更新 README 与 upgrade guide。
4. 每次验证都保留命令与输出；本文件的「完成证据」是交付的一部分。
5. 遇到需要裁决的事项（Registry 去留、`triz` 路由），先写 Agent Note，再改代码。

## 1. 任务总览

| ID | 优先级 | 任务 | 依赖 | 预估 | 状态 |
|---|---|---|---|---|---|
| METH-01 | P0 | 修正矩阵数据：补 58 格、去重、更新计数与测试 | — | 0.5–1 天 | 完成 |
| METH-02 | P0 | 增加数据来源、许可与已知偏差说明 | METH-01 | 0.5 天 | 完成 |
| METH-03 | P1 | 明确 `triz` 与 `triz_contradiction_analysis` 的路由 | — | 0.5 天 | 完成 |
| METH-04 | P1 | 为物理矛盾增加分离原理 | METH-01 | 1–2 天 | 完成 |
| METH-05 | P1 | 决定 Registry 去留并实施 | — | 0.5 天决策 + 1–2 天实施 | 完成（方案 A） |
| METH-06 | P2 | 修复 `detectParamNumbers` 的误检与方向丢失 | METH-05 | 1 天 | 已取消（随方案 A 删除） |
| METH-07 | P2 | 收紧工具输出契约，资产启动校验 | METH-01 | 0.5–1 天 | 完成 |
| METH-08 | P2 | 修正发布清单与无效子路径导出 | — | 0.5 天 | 完成 |
| METH-09 | P3 | 增加 keyless 快照与 preset 断言 | METH-03, METH-07 | 0.5–1 天 | 完成 |
| METH-10 | P3 | 工具体验与库 API 质量收尾 | METH-07 | 0.5 天 | 完成（可选项跳过） |

## 2. 批次与顺序

### 批次 A：发布阻断项（P0）

先做 METH-01、METH-02。完成后，矩阵数据与来源可审计，后续所有测试和文档才有稳定基线。

### 批次 B：产品路由与能力（P1）

做 METH-03、METH-04、METH-05。METH-03 可与批次 A 并行；METH-04 依赖 METH-01；METH-05 是决策门，先裁决再实施。

### 批次 C：API 与打包（P2）

做 METH-06、METH-07、METH-08。METH-06 只在 Registry 保留时执行；METH-07 依赖 METH-01 的最终矩阵。

### 批次 D：防回归（P3）

做 METH-09、METH-10。快照必须在所有模型可见输出稳定后再录。

## 3. 任务详情

### METH-01 — 修正矩阵数据

**目标**：把 `assets/triz-matrix.json` 从 1190 个非空格修正为 1248 个，消除 `(19,9)` 的重复原理，更新测试与文档。

**依据**：评审报告 §3.1。Casey Perno xls 与 pytriz CSV 逐格一致；随包矩阵漏掉 58 个单原理格。

**改动文件**

- `packages/patent/methodology/assets/triz-matrix.json`
- `packages/patent/methodology/tests/methodology.spec.ts`
- `packages/patent/methodology/README.md`
- `packages/patent/methodology/README.zh.md`
- `packages/patent/methodology/README.i18n.yaml`
- 如属发布可见变化：`docs/upgrade-guide/v0.2.1-rc.1/<item>/guide.md` 与 `guide.zh.md`

**实施步骤**

1. 在 `/tmp` 写一次性脚本，用 `xlrd` 解析 `triz_matrix.xls` 的 `CM4` 表，按“行=改善参数、列=恶化参数”归一化，再转成当前 `matrix[worsening-1][improving-1]` 的存储方向。
2. 用 `pytriz` 的 `matrix_values.csv` 做第二来源对拍；两份数据的集合与顺序应完全一致。
3. 生成新矩阵；对 `(19,9)` 的 `[8,35,35]` 人工复核。若无法确认正确集合，至少保证读取层去重并在数据说明中记录该源数据异常。
4. 更新测试：`1248 filled`、`234 off-diagonal empty`、`39 diagonal empty`、每格原理编号唯一、五个锚点格按集合匹配。
5. 更新 README 中英文的 1190/292/331 计数与 Known Limitations。
6. 重新录制 `README.i18n.yaml` 的配对哈希。
7. 如果 `triz` 的模型可见输出发生变化，补 upgrade guide。

**验收标准**

- `[3,15]` 返回 `[19]`，`[6,14]` 返回 `[40]`，`[14,20]` 返回 `[35]`。
- 全矩阵 `filled=1248`、`offDiagonalEmpty=234`、`diagonalEmpty=39`。
- 任意格无重复原理编号。
- `pnpm exec vitest run packages/patent/methodology/tests` 全绿。
- README 不再出现 1190/292。

**验证命令**

```sh
node -e "const M=require('./packages/patent/methodology/assets/triz-matrix.json');const f=M.flat();console.log(JSON.stringify({rows:M.length,cols:M[0].length,filled:f.filter(c=>c.length).length,empty:f.filter(c=>!c.length).length,diagonalEmpty:M.filter((r,i)=>r[i].length===0).length,offDiagonalEmpty:f.filter((c,i)=>!c.length&&Math.floor(i/39)!==i%39).length,duplicates:f.filter(c=>new Set(c).size!==c.length).length}))"
# 期望 {"rows":39,"cols":39,"filled":1248,"empty":273,"diagonalEmpty":39,"offDiagonalEmpty":234,"duplicates":0}
# 若决策为保留 (19,9) 源数据异常，duplicates 期望改为 1，并另加 lookupMatrixCell 去重断言。

pnpm exec vitest run packages/patent/methodology/tests
```

**风险与回滚**

- 风险：源数据本身的 `(19,9)` 重复无法判定；不要猜一个“看起来合理”的集合，保留源数据并在读取层去重，同时记录异常。
- 回滚：矩阵是单一资产文件，回滚该文件与测试计数即可；不要回滚 README 的来源说明。

### METH-02 — 数据来源、许可与已知偏差

**目标**：让审查者从包内文件追溯矩阵和中文原理文本的来源，并明确已知偏差。

**依据**：评审报告 §3.3。

**改动文件**

- `packages/patent/methodology/assets/README.md`（新建）
- `packages/patent/methodology/README.md`
- `packages/patent/methodology/README.zh.md`
- `packages/patent/methodology/README.i18n.yaml`

**实施步骤**

1. 在 `assets/README.md` 记录：Altshuller 原始出处、Casey Perno 2007 转录、`kamil-szczepanik/TRIZ-Agents` 的 xls、`Antropocosmist/triz-engineering-solver` 的 JSON、pytriz 的 CSV。
2. 记录每个中间来源的许可证状态；对未声明 LICENSE 的来源标注“待确认”，不要替它宣称 MIT。
3. 记录中文原理说明的翻译来源；若无法追溯，明确写“来源待确认”，并在发布前完成确认。
4. 记录已知偏差：58 个单原理格、`(19,9)` 重复、锚点校验协议。
5. 在包 README 的 Known Limitations 中链接 `assets/README.md`。

**验收标准**

- `assets/README.md` 存在，包含来源 URL、许可证状态、已知偏差、校验方法。
- 包 README 中英文都链接到该文件。
- 审查者可以不离开包目录完成来源追溯。

**验证命令**

```sh
test -f packages/patent/methodology/assets/README.md
rg -n "Casey Perno|Altshuller|kamil-szczepanik|pytriz|known deviation|已知偏差" packages/patent/methodology/assets/README.md
pnpm run verify-translation-pairing --write packages/patent/methodology/README.md
pnpm run verify-translation-pairing
```

**风险与回滚**

- 风险：许可证确认可能需要外部沟通；不要在未确认前把包标记为“许可已清理”。
- 回滚：该任务是纯文档，回滚只影响说明，不影响运行时。

### METH-03 — 明确 `triz` 与 `triz_contradiction_analysis` 的路由

**目标**：让模型和审查者清楚两个 TRIZ 工具各自的使用场景，消除工具选择歧义。

**依据**：评审报告 §3.2。

**改动文件**

- `packages/bundle/web-app/skills/patent/patent-disclosure-understanding/SKILL.md`
- `packages/bundle/web-app/presets/patent.patch.yml` 的 persona「工具与技能」段
- `packages/bundle/web-app/presets/patent.md` 与 `patent.zh.md`
- `packages/patent/methodology/src/prompt.ts`
- `packages/patent/methodology/README.md` 与 `README.zh.md`
- `packages/bundle/web-app/tests/patent-preset.spec.ts`

**实施步骤**

1. 在 `patent-disclosure-understanding` 的技能正文加一条路由：交底书识别用 `triz_contradiction_analysis`；已知参数编号、只查矩阵格用 `triz`。
2. 在 persona 的「工具与技能」段加同一句话，避免只靠技能加载时才看到。
3. 在 `TRIZ_PROMPT_TEXT` 和 `triz` 工具描述中写明“本工具只做参数编号查格，不做交底书识别”。
4. 在 `patent-preset.spec.ts` 增加断言：`methodology` 行存在且启用；可选断言 `triz` 工具在组合中注册。
5. 更新 preset README 与 methodology README 的说明。

**验收标准**

- `rg` 能在技能与 persona 中找到明确的两工具分工。
- `patent-preset.spec.ts` 对 `methodology` 行有专门断言，删除该行会让测试失败。
- `tool:triz` 区段文本与 README 的逐字文本一致。

**验证命令**

```sh
rg -n "triz_contradiction_analysis|triz" packages/bundle/web-app/skills/patent/patent-disclosure-understanding/SKILL.md
rg -n "triz_contradiction_analysis|triz" packages/bundle/web-app/presets/patent.patch.yml
pnpm exec vitest run packages/bundle/web-app/tests/patent-preset.spec.ts
```

**风险与回滚**

- 风险：persona 已经很长，新增句子可能推高固定前缀；优先放在技能里，persona 只加一句路由。
- 回滚：删除新增句子与测试断言即可。

### METH-04 — 为物理矛盾增加分离原理

**目标**：对角格不再只说“这是物理矛盾”，而是给出可执行的分离维度与原理。

**依据**：评审报告 §3.1 与 §4.2；pytriz 与 `triz-engineering-solver` 都随包提供分离原理。

**改动文件**

- `packages/patent/methodology/assets/triz-separations.json`（新建，或放进 `src/data.ts` 的常量）
- `packages/patent/methodology/src/data.ts`
- `packages/patent/methodology/src/tool/triz.ts`
- `packages/patent/methodology/src/types.ts`
- `packages/patent/methodology/tests/methodology.spec.ts`
- `packages/patent/methodology/README.md` 与 `README.zh.md`

**实施步骤**

1. 定义 4–5 条分离原理：空间分离、时间分离、条件分离、方向分离、系统层级分离。每条包含名称、说明、适用信号。
2. 在数据层提供 `loadSeparations()`，并在 `apply()` 时校验条目完整性。
3. 在 `mode: 'lookup'` 的输出中增加 `separations` 字段；仅当 `improving === worsening` 时返回，非对角空格继续返回空数组并保留“矩阵未收录”文案。
4. 更新输出 schema 与 README 的模型体验说明。
5. 增加测试：对角格返回分离原理；非对角空格不返回；未知编号不崩溃。

**验收标准**

- `triz(improving=5, worsening=5)` 返回至少 4 条分离原理，每条有名称与说明。
- 非对角空格仍返回“矩阵未收录”，不返回分离原理。
- 输出 schema 对 `separations` 有明确约束。
- 测试全绿。

**验证命令**

```sh
pnpm exec vitest run packages/patent/methodology/tests
node --input-type=module -e "import('./packages/patent/methodology/lib/index.js').then(async m=>{const t=m.createTrizTool();const v=await t.execute({improving:5,worsening:5});console.log(v.separations?.length)})"
# 先 build，再运行；期望 >= 4
```

**风险与回滚**

- 风险：新增输出字段会改变模型可见结果；需要同步 README 与可能的快照。
- 回滚：删除 `separations` 字段与数据文件，恢复对角格文案。

### METH-05 — 决定 Registry 的去留并实施

**结果：采用选项 A。** 决策记录见 [`2026-10-17-methodology-registry-scope.md`](../../notes/implemented/simplification/2026-10-17-methodology-registry-scope.md)，迁移说明见 [`guide.md`](../../../docs/upgrade-guide/v0.2.1-rc.1/methodology-registry-removal/guide.md)。

**目标**：消除“公共导出无消费方”的状态。两个可选分支必须选一个。

**依据**：评审报告 §2、§3.6；仓库内没有 `MethodologyRegistry` / `injectMethodology` 的调用方。

**选项 A：收缩为 TRIZ 包（推荐，若下一个版本没有消费计划）**

- 把 7 个通用组件、Registry、Injector 移到 `examples/`、`packages/experimental/`，或删除。
- 保留 `triz` 工具、数据、`Methodology` 插件的 `triz` 组件（如果仍需库 API）。
- 在 Agent Note 记录决策与迁移路径；在 upgrade guide 记录导出移除。
- 更新 README、package description、导出清单。

**选项 B：接入真实消费方**

- 在 prompt-assembly 路径上增加一个受 Config 控制的 `autoInject`，调用 `injectMethodology`。
- 同时执行 METH-06、METH-10 的库 API 质量项。
- 增加集成测试，证明组件会被匹配并注入。

**实施步骤**

1. 写 Agent Note：`2026-10-17-methodology-registry-scope.md`，记录选项、理由、影响。
2. 按选项实施；更新所有受影响的导出与文档。
3. 若移除公共导出，补 upgrade guide。
4. 运行 `pnpm run typecheck`、包测试、`pnpm run test:docs`。

**验收标准**

- 选项 A：`rg "MethodologyRegistry|injectMethodology"` 在包外零命中；包 README 不再宣称完整 Registry；upgrade guide 已记录。
- 选项 B：至少一个真实消费方调用 `injectMethodology`，并有集成测试覆盖匹配与注入。
- 两种选项都要求：没有“导出但无人调用”的公共 API。

**验证命令**

```sh
rg -n "MethodologyRegistry|injectMethodology|DEFAULT_METHODOLOGY_COMPONENTS" --glob '!packages/patent/methodology/**' --glob '!**/node_modules/**' --glob '!**/lib/**'
pnpm exec tsc -p packages/patent/methodology/tsconfig.json --noEmit
pnpm run test:docs
```

**风险与回滚**

- 风险：删除公共导出是 breaking change；必须在 upgrade guide 中说明，并确认没有外部消费者。
- 回滚：恢复导出与 README；如果已移除文件，从 git 历史恢复。

### METH-06 — 修复 `detectParamNumbers` 的误检与方向丢失

**状态：已取消。** METH-05 采用方案 A 后，`detectParamNumbers`、八个组件与注入器一并删除；显式参数编号成为唯一输入，缺陷随代码移除而消失。以下保留原始方案作为再引入 Registry 时的参考。

**依据**：评审报告 §3.4。

**改动文件**

- `packages/patent/methodology/src/data.ts`
- `packages/patent/methodology/src/runtime/components/triz.ts`
- `packages/patent/methodology/tests/methodology.spec.ts`

**实施步骤**

1. 把 `match` 从短核心词改为最长匹配的同义词表；例如“应力”优先于“力”，“能量损失”优先于“能量”。
2. 对运动/静止参数对建立显式映射；文本只写“重量”时，要求上下文含“运动/静止”才选具体编号，否则返回参数对候选而不是两个编号。
3. 解析方向词：提高/增加/增强 → improving，降低/减少/减轻 → worsening；只注入方向一致的组合。
4. 对无法确定方向或参数对的文本，省略确定性查表段，让模型自行选择编号。
5. 增加测试：报告中的七个输入各一条断言。

**验收标准**

- `提高强度同时减轻重量` 只产生“改善 14、恶化 1”方向，不产生 1→14 或 2→14。
- `提高能力` 不再命中参数 10。
- `降低应力` 只命中 11。
- `减少能量损失` 不命中 19/20。
- `提高发动机功率，降低油耗` 至少不产生错误组合；无可确定对时省略查表段。
- 测试全绿。

**验证命令**

```sh
pnpm exec vitest run packages/patent/methodology/tests
```

**风险与回滚**

- 风险：同义词表可能漏掉领域词；用测试集逐步扩充，不要一次追求全覆盖。
- 回滚：恢复旧 `detectParamNumbers` 与测试；确定性注入段可临时关闭。

### METH-07 — 收紧工具输出契约与资产启动校验

**目标**：让输出 schema 表达真实的两种形状，去掉 `as unknown`，让资产缺失在启动时失败。

**依据**：评审报告 §3.5。

**改动文件**

- `packages/patent/methodology/src/tool/triz.ts`
- `packages/patent/methodology/src/index.ts`
- `packages/patent/methodology/tests/methodology.spec.ts`
- `packages/patent/methodology/tests/triz-tool-principle-gap.spec.ts`
- `scripts/no-unknown-casts.baseline.json`（如果基线需要更新）

**实施步骤**

1. 把 `output.schema` 改为 `oneOf`：catalog 与 lookup 两个对象，各自声明必填字段；如果 METH-04 已落地，lookup 分支同时声明 `separations`。
2. 删除 `renderTriz(value as unknown as TrizOutput)`，让类型从 `oneOf` 推断。
3. 在 `apply()` 中加载并校验矩阵、原理、分离原理（若 METH-04 已做）；失败时抛出带包名的错误。
4. 在 `lookupMatrixCell` 或工具层对推荐编号去重，并加测试。
5. 增加非法形状测试：`{ mode: 'lookup' }` 应被输出校验拒绝；`{ mode: 'bogus' }` 仍走 exhaustive 分支。
6. 更新 `no-unknown-casts` 基线。

**验收标准**

- `rg "as unknown as TrizOutput" packages/patent/methodology` 零命中。
- 输出校验拒绝缺少 mode 必填字段的值。
- 缺少 `assets/triz-matrix.json` 时，插件加载失败，而不是等到第一次工具调用。
- `pnpm run verify-no-unknown-casts` 通过。
- 包测试全绿。

**验证命令**

```sh
rg -n "as unknown as TrizOutput" packages/patent/methodology || true
pnpm run verify-no-unknown-casts
pnpm exec vitest run packages/patent/methodology/tests
```

**风险与回滚**

- 风险：`oneOf` 的类型推断可能让 `render` 的参数类型变窄，需要调整 `renderTriz` 的签名；先在小范围试编译。
- 回滚：恢复对象 schema 与类型断言，保留启动校验。

### METH-08 — 修正发布清单与无效子路径导出

**目标**：让 `exports` 与 `files` 一致，`publint` 无警告。

**依据**：评审报告 §3.5。

**改动文件**

- `packages/patent/methodology/package.json`

**实施步骤**

1. 二选一：删除 `"./src/*": "./src/*"`，或把 `"src"` 加入 `files`。
2. 确认没有仓库内消费方使用该子路径；评审已确认零命中，优先删除。
3. 运行 `publint` 与 `npm pack --dry-run`，检查导出目标都存在。

**验收标准**

- `pnpm exec publint packages/patent/methodology` 无警告。
- `npm pack --dry-run --json` 中每个 `exports` 目标都能在包内找到。
- 包测试与 `verify-node-next-types` 仍然通过。

**验证命令**

```sh
pnpm exec publint packages/patent/methodology
npm pack --dry-run --json
pnpm run verify-node-next-types
```

**风险与回滚**

- 风险：外部消费者可能使用 `@deepseek-ai/dsh-methodology/src/...`；这是公共包，删除前在 upgrade guide 说明，或选择保留 src。
- 回滚：恢复 `exports` 与 `files`。

### METH-09 — 增加 keyless 快照与 preset 断言

**目标**：让 `triz` 工具 schema、`tool:triz` 区段文本和 preset 挂载都能被回归测试捕获。

**依据**：评审报告 §3.6。

**改动文件**

- `packages/bundle/web-app/tests/patent-preset.spec.ts`
- `snapshots/session/<scenario>/...`（新增或扩展）
- `snapshots/AGENTS.md` 遵循录制规则
- 如需要：`packages/patent/methodology/tests/scaffold.spec.ts`

**实施步骤**

1. 在 preset 测试中断言 `methodology` 行存在、启用，且工具 `triz` 在组合工具列表中。
2. 增加一个 keyless 的 tool-schema 快照，至少包含 `triz` 的 name、description、parameters。
3. 若快照框架支持，固定 `tool:triz` 的逐字区段文本；否则在 scaffold 测试中断言 `TRIZ_PROMPT_TEXT` 的哈希或全文。
4. 运行 `pnpm run test:snapshot -t <name>` 与 preset 测试。

**验收标准**

- 删除 `methodology` 行会让 preset 测试失败。
- 修改 `TRIZ_PROMPT_TEXT` 会让快照或 scaffold 测试失败。
- 快照无需 API key 即可回放。

**验证命令**

```sh
pnpm exec vitest run packages/bundle/web-app/tests/patent-preset.spec.ts
pnpm run test:snapshot -t <scenario-name>
```

**风险与回滚**

- 风险：快照录制可能需要 key；优先做 tool-schema/scaffold 断言，不依赖模型调用。
- 回滚：删除新增快照与断言。

### METH-10 — 工具体验与库 API 质量收尾

**目标**：在不改变模型可见语义的前提下，提升并行调用、Web 展示与库 API 质量。

**依据**：评审报告 §3.4、§3.6。

**改动文件**

- `packages/patent/methodology/src/tool/triz.ts`
- `packages/patent/methodology/src/runtime/MethodologyRegistry.ts`
- `packages/patent/methodology/src/runtime/keywordMatch.ts`
- `packages/patent/methodology/tests/methodology.spec.ts`

**实施步骤**

1. 为 `triz` 声明 `isConcurrencySafe: () => true`，并加执行模式测试。
2. 可选增加 `presentationMeta`，在 Web 卡片中显示 improving/worsening/recommended。
3. 若 Registry 保留：用 `Intl.Segmenter` 做中文分词，或删除未使用的 `keywords` 字段；给 `match` 增加稳定的 tie-breaker。
4. 若 Registry 保留：对 `context.goal` 做 `<data>` 围栏并转义 `</`，避免提示注入。
5. 更新 README 的 Model Experience 与 Known Limitations。

**验收标准**

- 两个 `triz` 调用可并行执行（执行模式测试通过）。
- 若保留 Registry：中文关键词不再返回整句 token；`context.goal` 在注入提示中被围栏包裹。
- 文档与测试同步。

**验证命令**

```sh
pnpm exec vitest run packages/patent/methodology/tests
pnpm exec tsc -p packages/patent/methodology/tsconfig.json --noEmit
```

**风险与回滚**

- 风险：`presentationMeta` 在 replay 时必须不抛错；先加 soft validation。
- 回滚：删除新增可选字段与测试。

## 4. 可验证检查清单

### 4.1 数据（METH-01 / METH-02）

- [x] `triz-matrix.json` 为 39 行 × 39 列。
- [x] `filled=1248`、`empty=273`、`diagonalEmpty=39`、`offDiagonalEmpty=234`。
- [x] 任意格无重复原理编号；若保留 `(19,9)` 源数据异常，`lookupMatrixCell` 返回去重结果并有测试记录。
- [x] 锚点格 `(1,3)`、`(1,9)`、`(1,14)`、`(1,27)`、`(14,1)` 与源数据按集合一致。
- [x] `triz(3,15)` 返回 `[19]`。
- [x] `triz(6,14)` 返回 `[40]`。
- [x] `triz(14,20)` 返回 `[35]`。
- [x] README 中英文不再出现 1190/292/331 的旧计数。
- [x] `assets/README.md` 存在，含来源、许可证状态、已知偏差、校验方法。
- [x] 包 README 链接到 `assets/README.md`。
- [x] `README.i18n.yaml` 已重新录制，`verify-translation-pairing` 通过。

### 4.2 路由（METH-03）

- [x] `patent-disclosure-understanding/SKILL.md` 含 `triz` 与 `triz_contradiction_analysis` 的分工说明。
- [x] `patent.patch.yml` 的 persona 含同一分工说明。
- [x] `TRIZ_PROMPT_TEXT` 与 `triz` 工具描述说明“只做参数编号查格”。
- [x] `patent-preset.spec.ts` 对 `methodology` 行有专门断言。
- [x] 删除 `methodology` 行会让 preset 测试失败。

### 4.3 分离原理（METH-04）

- [x] 数据层有 4–5 条分离原理，每条含名称、说明、适用信号。
- [x] 对角格 `triz(5,5)` 返回分离原理。
- [x] 非对角空格仍返回“矩阵未收录”，不返回分离原理。
- [x] 输出 schema 对 `separations` 有约束。
- [x] 测试覆盖对角、非对角空格、未知编号。

### 4.4 Registry（METH-05）

- [x] Agent Note 记录选项 A 或 B 的决策与理由。
- [x] 选项 A：包外 `rg` 零命中 `MethodologyRegistry` / `injectMethodology`；upgrade guide 记录导出移除。
- [x] 选项 B：至少一个真实消费方调用 `injectMethodology`，并有集成测试覆盖匹配与注入。（不适用：采用选项 A）
- [x] 包 README 不再宣称未落地的能力。

### 4.5 参数识别（METH-06）

**已取消**：Registry 随 METH-05 方案 A 删除，`detectParamNumbers` 不再存在；显式参数编号成为唯一输入。以下原始验收项保留作再引入参考。

- [-] `提高强度同时减轻重量` 只产生“改善 14、恶化 1”。
- [-] `提高能力` 不再命中参数 10。
- [-] `降低应力` 只命中 11。
- [-] `减少能量损失` 不再命中 19/20。
- [-] `提高发动机功率，降低油耗` 不产生错误组合；无可确定对时省略查表段。
- [-] 上述输入各有单元测试断言。

### 4.6 工具契约（METH-07）

- [x] 输出 schema 使用 `oneOf` 表达 catalog/lookup。
- [x] `rg "as unknown as TrizOutput"` 零命中。
- [x] `{ mode: 'lookup' }` 被输出校验拒绝。
- [x] 缺少 assets 时插件加载失败。
- [x] `pnpm run verify-no-unknown-casts` 通过。
- [x] 包测试全绿。

### 4.7 打包（METH-08）

- [x] `publint` 无警告。
- [x] `npm pack --dry-run --json` 中每个 `exports` 目标都存在。
- [x] `verify-node-next-types` 通过。

### 4.8 回归与体验（METH-09 / METH-10）

- [x] keyless 快照或 scaffold 测试固定 `triz` schema。
- [x] `TRIZ_PROMPT_TEXT` 变化会让测试失败。
- [x] 两个 `triz` 调用可并行执行。
- [x] 若保留 Registry：中文关键词不再返回整句 token。（不适用：Registry 已移除）
- [x] 若保留 Registry：`context.goal` 在注入提示中被 `<data>` 围栏包裹。（不适用：Registry 已移除）
- [x] `pnpm run test:docs` 或 `doc-sync` 通过（28/29；唯一失败为既有的本地未跟踪 `litho.docs/patent/README.md` 配对缺失，与本次改动无关）。

## 5. 决策点

| 决策 | 选项 | 结论 | 记录位置 |
|---|---|---|---|
| Registry 去留 | 收缩为 TRIZ / 接入消费方 | 采用方案 A：收缩为 TRIZ 工具包 | Agent Note `2026-10-17-methodology-registry-scope.md` |
| `triz` 是否留在 patent preset | 保留并路由 / 移除 | 保留并路由；技能与 persona 已写明分工 | `patent-disclosure-understanding/SKILL.md`、`patent.patch.yml` |
| `(19,9)` 重复格 | 去重 / 人工修正 / 记录异常 | 保留源值 `[8,35,35]`，读取层去重为 `[8,35]` | `assets/README.md` |
| 中文原理文本来源 | 可追溯 / 待确认 | 仍待确认；README 不宣称许可已清理 | `assets/README.md` |

## 6. 完成定义（DoD）

一个任务算完成，必须同时满足：

1. 代码或数据改动已落地。
2. 该任务的验收标准全部勾选。
3. 验证命令已运行，输出已写入「完成证据」。
4. 相关 README、JSDoc、upgrade guide 已同步。
5. 没有把无关改动混进同一提交。

整个计划算完成，必须同时满足：

- METH-01、METH-02、METH-03 全部完成。
- METH-04 或 METH-05 至少完成一项（视产品优先级）。
- `pnpm exec vitest run packages/patent/methodology/tests` 全绿。
- `pnpm exec tsc -p packages/patent/methodology/tsconfig.json --noEmit` 通过。
- `pnpm exec publint packages/patent/methodology` 无警告。
- `pnpm run test:docs` 通过。

## 7. 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 矩阵源数据本身有争议 | 修正后仍可能被质疑 | 记录两个独立来源与锚点校验；对 `(19,9)` 不猜值 |
| 新增分离原理改变模型输出 | 快照与文档需要同步 | 先完成 METH-01，再改输出；最后录快照 |
| 删除 Registry 是 breaking change | 外部消费者可能受影响 | 先确认包外零命中；upgrade guide 记录 |
| 快照录制需要 API key | P3 无法在 keyless CI 完成 | 优先用 tool-schema/scaffold 断言 |
| persona 新增路由句推高固定前缀 | 每请求成本增加 | 路由句放技能，persona 只留一句 |

## 8. 完成证据模板

每完成一个任务，在下面追加一节：

````markdown
### METH-XX — 完成证据

- 提交/PR：
- 改动文件：
- 验证命令与输出：

```sh
<command>
<key output>
```

- 未覆盖项/遗留风险：
````

## 9. 执行结果与完成证据

执行日期 2026-10-17。未创建 commit 或 PR；改动保留在工作区。

### METH-01 — 矩阵数据

- 改动：`assets/triz-matrix.json`（58 格由空补为单原理）、`src/data.ts`（读取层去重）、测试与中英文 README。
- 两个独立来源（Perno xls 与 pytriz CSV）逐格比对：`diffs 0`，均 1248 非空格。
- 新旧矩阵差异：`diff count 58`，全部为 `before: []`、`after: [单个原理]`。
- 计数：`{"rows":39,"cols":39,"filled":1248,"empty":273,"diagonalEmpty":39,"offDiagonalEmpty":234,"duplicates":1}`。
- 测试：`48 passed`（修正后、METH-02 前）。

### METH-02 — 来源与许可

- 新增 `assets/README.md`、`assets/README.zh.md`、`assets/README.i18n.yaml`。
- 记录 Altshuller、Perno 2007、TRIZ-Agents、pytriz、triz-engineering-solver 的链条、许可状态与 4 类已知偏差。
- 明确中文原理文本来源未确认，未宣称许可已清理。
- `verify-translation-pairing --write` 与全量检查通过（仅剩与本改动无关的 `litho.docs` 配对失败）。

### METH-03 — 工具路由

- `patent-disclosure-understanding/SKILL.md`、`patent.patch.yml` persona、`TRIZ_PROMPT_TEXT`、工具描述均写明：交底书识别用 `triz_contradiction_analysis`，显式参数编号查格用 `triz`。
- `patent-preset.spec.ts` 新增 `methodology` 行断言。
- 验证：`patent-preset.spec.ts` 29 用例通过。

### METH-04 — 分离原理

- 新增 `assets/triz-separations.json`，5 条：space、time、condition、direction、system-level。
- `loadSeparations` 导出；`triz(5,5)` 返回 5 条；非对角空格返回空数组且不渲染分离段。（原计划的 `separationById` 因无生产消费方在 review 后移除。）
- 输出 schema 的 lookup 分支要求 `separations`。
- 验证：`separations 5 recommended 0`（built lib 烟测）。

### METH-05 — Registry 方案 A

- 新增 Agent Note（英文/中文/配对）与 upgrade guide（英文/中文/配对）。
- 删除 `src/runtime/` 下 Registry、Injector、keywordMatch 与 8 个组件，共 11 个文件。
- 移除导出：`MethodologyRegistry`、`DEFAULT_METHODOLOGY_COMPONENTS`、`extractMethodologyKeywords`、`injectMethodology`、`fiveWhys`、`mece`、`swot`、`pdca`、`fishbone`、`firstPrinciples`、`sixHats`、TRIZ 组件、`detectParamNumbers`、方法论协议类型。
- 包外 `rg` 对上述符号零命中（历史文档与升级指南除外）。
- 验证：`verify-upgrade-guides`、`verify-md-links` 通过；`typecheck` 通过。

### METH-06 — 已取消

- 随 METH-05 方案 A 删除 `detectParamNumbers`；显式参数编号成为唯一输入，不再存在文本误检与方向丢失路径。

### METH-07 — 工具契约与启动校验

- 输出 schema 改为 `oneOf`：catalog 与 lookup 各自要求完整字段。
- 删除 `as unknown as TrizOutput`；`verify-no-unknown-casts --prune` 移除基线条目后通过（1801 条既有断言）。
- `apply()` 调用 `validateTrizAssets()`；缺失矩阵时 `host.plugin()` 直接拒绝，工具不注册。
- 新增测试：`{mode:'lookup'}` 被 schema 拒绝；资产结构与缺失文件均有断言。
- `validateTrizAssets` 校验矩阵/原理/分离原理的数组与对象结构、原理编号恰为 1–40、分离原理数量恰为 5、id 唯一且 signals 非空；结构损坏也以带包名的错误在加载时失败。
- `TrizOutput` 由 `OUTPUT_SCHEMA` 经 `InferValue` 推导，schema 成为唯一来源。
- 包级覆盖率：语句/分支/函数/行均为 100%。

### METH-08 — 打包

- 删除 `exports["./src/*"]`。
- `publint`：`All good!`。
- `npm pack --dry-run` 仅含 `lib/index.js`、`lib/types/{index,data,prompt,types,tool/triz}.d.ts`、assets、README 与 LICENSE。
- `verify-node-next-types`：397 个包声明通过。

### METH-09 — 回归断言

- `TRIZ_PROMPT_TEXT` 使用 keyless inline snapshot 固定逐字文本。
- `triz` 的模型可见 schema 使用 inline snapshot 固定 name、description、parameters。
- 两者变化都会让包测试失败，无需 API key。

### METH-10 — 体验与并发

- `triz` 声明 `isConcurrencySafe: () => true`，并有测试断言。
- `presentationMeta` 可选增强未实现；不影响本轮验收。

### 全量验证

```sh
pnpm exec vitest run packages/patent/methodology/tests packages/bundle/web-app/tests/patent-preset.spec.ts
# 7 files, 64 tests passed

pnpm exec vitest run packages/patent/methodology/tests --coverage --coverage.include='packages/patent/methodology/src/**'
# All files 100% statements/branches/functions/lines

pnpm run build:artifacts   # 7/7 gates passed
pnpm run build:check       # 2/2 gates passed
pnpm run typecheck         # 5/5 gates passed
pnpm run lint              # 0 errors, 1 pre-existing unrelated warning
pnpm run test:docs         # 28/29; only litho.docs/patent/README.md (local, untracked) fails pairing
```

### 未覆盖项与遗留风险

- 中文原理文本与 Perno 转录的许可确认仍待人工完成；发布前必须补齐。
- 删除公共导出已按 pre-stable 规则记录 upgrade guide；仓库外消费者无法在本次验证中确认。
- `triz` 输出新增 `separations` 字段会改变模型可见结果；当前 patent 录制快照未包含 `triz`，无需重录。

## 10. 变更记录

| 日期 | 任务 | 状态 | 证据 |
|---|---|---|---|
| 2026-10-17 | 计划创建 | 待执行 | 本文件 |
| 2026-10-17 | METH-01…METH-10 | 完成/部分取消 | 本文件 §9 |
