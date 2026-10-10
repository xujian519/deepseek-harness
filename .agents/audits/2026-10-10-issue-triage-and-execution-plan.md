# 2026-10-10 三模式技术债扫描 — 分诊与执行计划

- 来源报告：[`2026-10-10-repo-scan.md`](2026-10-10-repo-scan.md)（基线 `master` HEAD，PR #382 合并后）。
- 归档脚本：[`2026-10-10-file-issues.sh`](2026-10-10-file-issues.sh)（**16 条** issue 正文，幂等，按标题去重）。
- 前序：[`2026-09-27-issue-triage-and-execution-plan.md`](2026-09-27-issue-triage-and-execution-plan.md)（那轮的 #312–#328 已全部 CLOSED）。
- 本文件是**批次编排**：把 16 条发现分成可独立验收的批次，并标出哪些批次在动手前先要一次决定。

## 1. 归档方式（已完成）

扫描会话的 shell 在扫描中途因沙箱失效而不可用，16 条 issue 当时**均未创建**。2026-10-10 的后续会话执行了归档：

```sh
bash .agents/audits/2026-10-10-file-issues.sh
```

脚本按标题精确去重（`gh issue list --state all`），可反复重跑；每条输出 `created <title>` 或 `skip <title>`。本次 16 条**全部 `created`**，编号已回填到 §2 的「GitHub」列。

前置（当时均满足）：`gh` 已认证为 `xujian519`（scopes 含 `repo`），`area/*` 与 `kind/*` 八个标签均已在仓库中存在，`REPO=xujian519/deepseek-harness`（脚本第 15 行）与目标仓一致。

> 本批的落地记录（合并的 PR、批次落点、两条「先决定」项的取向、仍未做项）见 §7。

## 2. 16 条一览（按脚本内的顺序）

「证据」列区分**本人逐行直读核实**（V）与**子代理实跑、本人未复算**（S）。本轮两条 S 条目（#10 / #12）已由 2026-10-10 的后续会话按复现命令重跑：`182 / 71`、`1135`、`140`、`16`、`37` 为当前实测值（原记载的 `v8 ignore = 1391` 无法复现），详见 §3 批次 A 与 §6。

| # | 标题（脚本内） | 标签 | 优先级 | 证据 | 依赖 | GitHub |
|---|---|---|---|---|---|---|
| 1 | run-gates 的两个模式在 CLI 上不可达 | area/infra, kind/bug-fix | **P1** | V | 需决定（删/恢复） | #383 → PR #401 |
| 2 | 专利文书两套模板体系并存 | area/patent, kind/cleanup | P2 | V | 需决定（收口方向） | #384 → PR #407 |
| 3 | verify-preset-divergence 只比较 ≥2 preset 都携带的 row id | area/infra, kind/techdebt | P2 | V | — | #385 → PR #401 |
| 4 | verify-preset-tool-refs 忽略 config 级工具裁剪 | area/infra, kind/techdebt | P2 | V | — | #386 → PR #401 |
| 5 | 文档模式与自媒体模式关掉 web_fetch | area/document, kind/cleanup | P2 | V | 需决定（开/不开） | #387 → PR #405 |
| 6 | patent-tools 的工具计数三处不一致 | area/patent, kind/doc | P2 | V | — | #388 → PR #399 |
| 7 | patent.md:77 断言「legalSearch 没有模型可见工具」 | area/patent, kind/doc | P2 | V | — | #389 → PR #399 |
| 8 | 文档模式契约与文档瑕疵批次 | area/document, kind/doc | P3 | V | — | #390 → PR #400 |
| 9 | 专利自媒体模式：外置 bundle 的装配行集已落后 | area/patent, kind/techdebt | P2 | V | 需决定（ralph 去留） | #391 → 仓外（见 §7） |
| 10 | 台账与注释的机械计数过期批次 | area/docs, kind/doc | P3 | V（已复算 2026-10-10） | — | #392 → PR #408 |
| 11 | patent.md 的装配清单与磁盘不符 | area/patent, kind/doc | P2 | V | — | #393 → PR #399 |
| 12 | patent-law 的《专利法》索引覆盖度 37 vs 36 | area/patent, kind/doc | P2 | V（计数已复算：37） | — | #394 → PR #399 |
| 13 | verify-patent-oas-gold 在基线未记录时静默休眠并 exit 0 | area/patent, kind/techdebt | P2 | V | 需决定（进不进 CI） | #395 → PR #409 |
| 14 | 文档与依赖清单未覆盖 patent-filing | area/patent, kind/doc | P2 | V | 与 #11 同批 | #396 → PR #399 |
| 15 | 受控草稿的两条渲染通道各写一份表题/对象窄化实现 | area/patent, kind/techdebt | P3 | V | — | #397 → PR #402 |
| 16 | 以「实测」为据的 preset 断言没有可复算出处 | area/infra, kind/doc | P3 | V（形态已定：不可达） | — | #398 → PR #404 |

> 标签 `area/*` 与 `kind/*` 需已在仓库里存在，否则 `gh issue create --label` 会失败并中断（脚本设了 `set -e`）。首次执行前可先 `gh label list --repo xujian519/deepseek-harness`；缺失时脚本会停在该条，补标签后重跑即可（已建的会自动 skip）。

## 3. 批次矩阵

批次内可一次 PR 收尾；批次之间的顺序只在有依赖时被约束。

### 批次 A — 文档口径（7 条，可立刻执行，无需决定）

覆盖 #6 / #7 / #8 / #11 / #12 / #14，以及 #10 的文本部分。

- **四个计数已复算（2026-10-10 后续会话）**：`report:structure` 的 **182 / 71**、`v8 ignore` 的 **1135**（`src` 下 `.ts`；计入 `.tsx` 为 1357）、`@ts-expect-error` 的 **140**（`.ts`+`.tsx`，全部落在测试目录与 `scripts`）、`patent` 包数 **16** 为当前实测值；原报告的 `v8 ignore = 1391` 无法复现。复算命令改用 `git grep`（只读 tracked 文件，避免 `apps/desktop/.desktop-build/**` 构建残留污染）：
  ```sh
  pnpm run report:structure
  git grep -h "@ts-expect-error" -- '*.ts' '*.tsx' | wc -l
  git grep -h "v8 ignore" -- 'packages/*/*/src/*.ts' | wc -l
  ls -d packages/patent/*/ | wc -l
  sed -n '61p' packages/patent/patent-law/README.md
  awk '/^articles:/{f=1;next} f&&/^  - article:/{n++} END{print n}' \
    packages/patent/patent-law/assets/law/cn-patent-law.yaml
  ```
- **改动面**：`packages/bundle/web-app/presets/patent.md` + `patent.zh.md`、`packages/patent/patent-tools/README.md`、`packages/patent/patent-tools/src/index.ts` 的两处 JSDoc、`packages/document/doc-template/README.md` + `.zh.md`、`docs/patent-workbench-tasks.md`、`docs/TECH_DEBT.md`、`packages/patent/patent-document/README.md`（若补 patent-filing 相关口径）。
- **门禁**：`pnpm run test:docs`（`translation-pairing` 语料覆盖 `**/*.md`，中英必须同改）、`pnpm run lint`。改动模型可见文本（`preset/*.md` 不在模型提示里，但 `patent.md:14` 的数字若被别处引用需一并核）时追加 `pnpm run test:snapshot -t "patent|document"`。
- **验收**：`patent.md` / `patent.zh.md` 的插件数与 `patent.patch.yml` 的专利域 row 集合一致；三处工具计数等于 `docs/tool-catalog.md:50` 的 32；`patent-law` 两侧覆盖度一致且等于 YAML 实测值。

### 批次 B — 门禁可达性（#1，先决定）

二选一，两个方向都在 issue #1 里给了改动清单。**本轮新增证据支持「删除」**：`ci-fork.yml` 的 8 个 job 无一调用这两个模式，所以恢复 `parseMode` 只是让命令「可跑」而仍无人跑；而 #326 的原决定本就是删除。

- 选删除 → 改 `package.json:99-100`、`scripts/run-gates.ts`（`Mode` / `gatesForMode` / 未引用的 `ciBuildGate`、`ciArtifactGates`）、`docs/testing.md` 留「本 fork 不接线」记录。
- 选恢复 → 补两个 `case` 与错误文案，并**同时指定调用方**（加一个 CI job 或明确写「仅本地手动」）。
- **门禁**：`pnpm exec vitest run scripts/run-gates.spec.ts scripts/ci-workflow.spec.ts`；新增一条「`parseMode` 接受的模式集合与 `Mode` 一一对应」的形状断言，并用注入一个只存在于 `Mode` 的名字证伪。

### 批次 C — 门禁盲区扩展（#3 / #4 / #13）

三条都不改产品代码，只扩门禁的观察面，可各自独立 PR；彼此无依赖。

- **#3**：`scripts/verify-preset-divergence.ts` 增「行集差异」报告面（以出现次数最多的 preset 为参照，列出各 preset 缺失的 row id），并把行集差异入 `preset-divergence-baseline.json` 的一个新分区。**门禁**：注入「从 `document.patch.yml` 删掉一整行」的探针必须报出该 id 与缺失的 preset。
- **#4**：让 `mountedToolNames` 接受「按 `(package, config)` 求工具集」的解析器，先用 `tool-web` 的 `search`/`fetch` 建一张带理由的表。**门禁**：把 `` `web_fetch` `` 注入 `skills/document/**` 的某个技能必须让门禁失败，改成 `fetch: true` 后通过。
- **#13**：把「基线缺失」与「通过」在退出码上分开；并决定是否进 CI（进则基线随仓提交 + 加 job，不进则在 `docs/testing.md` 写明「本地门禁、CI 不跑」）。**门禁**：基线缺失时 `pnpm run` 该门禁须以非 0 退出。

### 批次 D — 专利权属面收口（#2，先决定）

`doc-template` 的 5 个专利 Markdown 模板与 `patent-document` 的 11 个受控草稿模板覆盖 5 类同名文书。**动手前必须先回答：A 侧的 5 个专利模板现在还有没有真实消费方**（是否有场景只有它能做）。三条候选路径见 issue #2；无论选哪条，都要在 `docs/subsystems/patent.md` 与两个包 README 写明边界，并加一条门禁防「同名文书在两个体系里各有一份而无人声明差异」。

- **门禁**：`pnpm run test:snapshot -t "patent|document"`；若删模板，`doc-template/README.md:30` 的 17 个数字随之调整（与批次 A 有文本冲突，**排在 A 之后**）。

### 批次 E — 平台事实取向（#5，先决定）

文档模式（+ 自媒体 bundle）的 `fetch` 是否开。理由与反理由见 issue #5：`patent` 侧有 10 行理由说「每个随包组合都挂了 http fetch provider」，`document` 侧同一事实相反取值而无理由。若确认不开，就必须**同时下调** persona `:32` 与 `document-quality-gate` 的「可验证来源」措辞，否则 P0 门禁要求一个拿不到的能力。

- **门禁**：`pnpm run test:snapshot`（persona / 技能文本是模型可见面）、`pnpm run test:docs`。
- **顺带**：给 `preset-divergence-baseline.json` 的每条记录补一句理由（或指向 README 锚点），让「有意差异」可读——这是 #322 收口留下的语义缺口。

### 批次 F — 受控草稿去重（#15，可立刻执行）

- **改动面**：`packages/patent/patent-core` 增共享的 `formatTableCaption(index, name)`，`patent-document/.../draftConverter/blocks.ts:33` 与 `patent-filing/.../filing/fromDraft.ts:30` 都改调它；`patent-filing/.../engine.ts:237-243` 的 `obj()` 改为复用 `patent-core` 的窄化工具（或让 `patent-core` 出抛错版）；`patent-document/.../templateResolver.ts:53-54` 去掉 `as TemplateManifest` 改为结构校验后 fail-loud。
- **门禁**：新增「同一份 SpecDraft 经两条通道得到的表题序列逐项相等」的对位用例，并注入「只改一侧前缀/中缀」证伪；`templateResolver` 的非法 JSON 用例断言报错指向该文件。
- **注意**：`patent-core` 是纯库，改动会影响所有专利包；这是新一轮「跨包复制」的收敛切口，与 2026-08-28 节的 M1 同族，建议同时在 `docs/TECH_DEBT.md` 的跨包复制类下记一笔。

### 批次 G — 外置自媒体 bundle（#9，先决定 ralph 去留）

bundle 不在仓库里，**任何仓内门禁在结构上都看不到它**。按优先级：

1. 行集对齐到当前 `standard`（补 `time-context`，按需补 `present`；`fetch` 与批次 E 取同一结论）；撤下 `tool-ralph` 或写下保留理由。
2. 给外置 preset 一条可见性通道（`verify-preset-divergence --extra-preset <path>`，或在 bundle 放一份相对 `standard` 的有意差异 README）。
3. 图像链补一层可执行出口，或把 4 个技能的 description/正文改成「需要部署提供图像通道，否则本链路不可用」。
4. 补合规模块（广告法禁用语 + 专利标识标注，专利法第十七条 / 《专利标识标注办法》）。
5. 清掉 3 份 `.bak`。

**验收**：bundle 与 `standard` 的行集差异每一项都有记录（有意/待补）；图像链每一步都能指出一个已挂载工具或一条可执行命令，不能则明写不可用。

> 注意：bundle 在 `~/.dsh/local-bundles/`，修改属**用户级资产**，不进本仓 PR；如需版本化，应另开仓或纳入本仓 `packages/` 的某个 bundle —— 这是一个独立决定。

### 批次 H — 实测断言的出处（#16，形态已定）

**已核实（2026-10-10 后续会话）**：`grep -rn "experimental-tool-agent-team" packages/bundle/web-app/presets/*.patch.yml packages/bundle/web-app/cordis.patch.yml` **零命中**，`docs/tool-catalog.md:45` 写「the shipped `dsh-base` bundle keeps the package disabled」，判定随包组合下**不可达**。

形态因此确定为：把 `patent.patch.yml:80`（与 `standard.patch.yml` 侧的逐字副本）的理由改成事实陈述，并补一条「未启用该包时通用 `send_message` 不在工具目录」的对位用例；「若可达则补实测记录」的分支不再保留。顺带立一条轻约定：preset/persona 里的经验性断言要么可复算、要么写明是推断。

## 4. 依赖与建议顺序

```
批次 A（文档口径）──┐
                    ├─→ 批次 D（模板收口，会再动 doc-template README 数字）
批次 B（门禁可达性）─┤
批次 C（门禁盲区）──┤
批次 F（受控草稿去重）┘
批次 E（fetch 取向）─→ 批次 G（bundle 对齐，取同一 fetch 结论）
批次 H（先核实，后定性）
```

- **先做 A / B / C / F**：都不需要事先决定，且 A 与 B/C/F 改动的文件集几乎不重叠（A 是文档、B/C 是 `scripts/`、F 是 `packages/patent/`），可以并行。
- **D 排在 A 之后**：D 会再动 `doc-template` README 的模板数字，与 A 的文本有冲突面。
- **E 排在 G 之前**：G 的第一项要求 bundle 的 `fetch` 与仓内取同一结论，那个结论由 E 给出。
- **H 最后**：它的形态取决于一条尚未跑过的命令。

## 5. 每批的统一验收

1. `pnpm run lint` 与 `pnpm run typecheck` 通过（本轮**未跑**，见报告 §0）。
2. 改模型可见文本（persona / 技能 / preset README）→ `pnpm run test:snapshot -t "patent|document"` 与 `pnpm run test:docs`。
3. 改 `Config`（如 `tool-web` 的 `fetch`）→ 再生 `docs/config-catalog.md`，并以 `verify-tool-catalog` 复查。
4. 改工具注册面 → 再生 / 复查 `docs/tool-catalog.md`，且批次 A 里所有手写计数随之更新（这正是本轮四条计数类 issue 的根因：真源可算，声明手写）。
5. 每条门禁类改动都要有**负控制**：注入一个反例证明门禁会失败，并在 PR 描述里写出注入方式。
6. 收口时把 issue 号、commit、验证命令写回本文件 §2 的「GitHub」列（issue 号已回填：#383–#398）。

## 6. 关闭前必须重跑（S 类与未证实项）

| 项 | 命令 | 出处 |
|---|---|---|
| 结构债函数/文件计数 | `pnpm run report:structure` | #10 |
| `@ts-expect-error` 计数 | `git grep -h "@ts-expect-error" -- '*.ts' '*.tsx' \| wc -l`（=140） | #10 |
| `v8 ignore` 计数 | `git grep -h "v8 ignore" -- 'packages/*/*/src/*.ts' \| wc -l`（=1135） | #10 |
| `patent` 包数 | `ls -d packages/patent/*/ \| wc -l` | #10 |
| 《专利法》索引条数 | `awk` 计数，见 §3 批次 A | #12 |
| `agent-team` 包可达性 | 已核实：`grep -rn "experimental-tool-agent-team" presets/*.patch.yml cordis.patch.yml` 零命中 | #16 |
| 门禁红绿基线 | `duplication` / `test:docs` / `test:snapshot` / `test:coverage` | 报告 §0 |

**已核实并销案（2026-10-10 后续会话）**：`lint`/`typecheck` 的 `build:lib:host` 归属——`pnpm run lint` 完整通过（含 `build:lib:host`，0 errors），当时的中断是会话级沙箱故障而非仓库失败；`docs/subsystems/patent.md` 确认同缺 `patent-filing`；`agent-team` 包在随包组合下不可达；§3.9 的四个计数已复算。


四个机械计数已由 `pnpm run verify-tech-debt-counters` 机检（PR #408），`patent-oas` 基线已记录入仓（PR #409）；其余各项仍是本清单。

**仍未证实、需下一轮补的**：受控草稿契约与 11 个模板 `SKILL.md` 的逐项一致性（**下一轮第一优先**）；`verify-patent-document-output` / `verify-patent-team-roster` 的断言面；自媒体所需的广告法/专利标识资料是否存在于仓外。

## 7. 落地记录（2026-10-10 后续会话）

§2 的 16 条里 15 条已闭合；#391 的仓内面为零（改动在用户级 bundle，证据在 issue 评论）。#322 已闭合，但其通用做法仍未做（见本节末）。

### 合并的 PR

| PR | 标题 | 覆盖 |
|---|---|---|
| #399 | docs(audits): record the 2026-10-10 three-mode scan and align the reported counts | #388 #389 #393 #394 #396；#390 的 README 面、#392 的文本面 |
| #400 | refactor(document): give the double-brace placeholder one definition | #390 |
| #401 | fix(gates): close the three blind spots and drop the unreachable modes | #383 #385 #386；#395 的退出码面 |
| #402 | refactor(patent): share the table caption, the JSON guard, and the manifest parse | #397 |
| #404 | docs(patent): state the team-channel reason from the mounting rows | #398 |
| #405 | fix(document): mount web_fetch so the source rule can open what it cites | #387 |
| #407 | refactor(patent): give patent deliverables one content channel | #384 |
| #408 | chore(docs): make the ledger's four counters machine-checked | #392 |
| #409 | fix(patent): run the patent-oas gold gate on a recorded baseline | #395 |
| #411 | fix(ci): read the archived issue workflows and run the policy suite | 本节末「一处已收尾的红态」（原「未立案」） |
| #412 | fix(ci): run the four static gates no lane reached | 本节末「同族的其余四个门禁」 |

#404 与 #405 以官方 stack #406 一起落地（`gh stack merge` 全有或全无）；其余各自独立合并。本文件不记提交标识——`verify-repository-references` 拒绝在维护文件里出现仓库提交 id——每个 PR 页上留有其合并提交与逐条验证命令。

### 批次落点

- **批次 A（文档口径）** → #399 + #400（占位符正则收敛到一处定义在 #400）。
- **批次 B（门禁可达性）** → #401，取向为**删除**：`ci-fork.yml` 无 job 调用那两个模式，恢复解析只让命令「能跑」而仍无人跑，与 #326 原决定一致。
- **批次 C（门禁盲区）** #385 / #386 → #401；#395 → 退出码在 #401、基线与 CI 车道在 #409。
- **批次 D（模板收口）** → #407：删掉 A 侧五个专利模板资产，受控草稿成为唯一内容源，机检用例钉住边界。
- **批次 E（fetch 取向）** → #405：**开**，仓内文档模式与 patent 侧取同一结论。
- **批次 F（受控草稿去重）** → #402：共享表题编号与 JSON 窄化，`templateResolver` 改为校验后 fail-loud。
- **批次 G（仓外自媒体 bundle）** → **仓外完成**：四个技能的 description 与正文改写为可执行通道（`generate_image`/`edit_image` + 本地 ComfyUI + `z-image-turbo`），实跑证据（1024×1024、8-bit RGB、598 KB、95.2 s）贴在 #391；行集对齐、`tool-ralph` 去留、广告法与专利标识标注的合规载体、3 份 `.bak` 仍未做。
- **批次 H（实测断言出处）** → #404：`patent.patch.yml:80` 的理由改为事实陈述 + 对位用例。

### 两条「先决定」项的取向

- **#392 → 更正数字 + 加机械兜底门禁（PR #408）**：`pnpm run verify-tech-debt-counters` 逐行复算台账里带标记的声明表，值不一致、行格式不合、多出一行（无复算定义）、门禁有一项而台账未声明都失败；挂在 `doc-quick`，因此 CI 的必过车道 `node-checks` 会跑它。结构债两项复用 `report-structure.ts` 的同一函数，标记计数经 `git ls-files` 只读 tracked 文件（原命令会命中本机构建残留），门禁自身的两个源文件不计入标记计数。负控制：把 `v8 ignore` 改回 1204、或把 `@ts-expect-error` 写成含门禁自身的 145，都变红。
- **#395 → 真跑一次落基线 + 进 CI（PR #409）**：4 case × 1 次 = 24 次 agent 调用产出基线（聚合 97.95，17 个节点全部过门槛），记录只含逐维度分数；`ci-fork.yml` 的**必过** `node-checks` 直接运行该门禁——新开一个不在 ruleset 必过集里的 job 只是建议性信号，解决不了「没人跑、读绿」这个失效形态。

### 仍未做（登记，不在本轮）

- #391 的另外三项与 3 份 `.bak`（仓外用户级资产，不进本仓 PR）。
- #322「给基线每条记录补理由」的通用做法：本轮只把两侧理由写进各自的 preset 注释。
- #398 建议 4（preset/persona 里经验性断言要可复算或写明推断）——需要单独立一条撰写规则。
- #409 的基线没有 `provider`/`modelId`（采集器只在调用方传 `--provider`/`--model` 时写），换模型后的运行只能在 profile 层面可比。
- 09-27 节的历史计数保留为当日实测；当前值由 #408 的门禁机检。

### 一处已收尾的红态（PR #411）

`pnpm run test:issue-management` 曾在本 fork 的 master 上稳定红 3 条——它读 `.github/workflows/issue-policy.yml` 与 `issue-lifecycle.yml`，而这两个工作流在本 fork 归档于 `.github/workflows-disabled/`；同一族的 `scripts/ci-workflow.spec.ts` 早已用 `loadArchivedWorkflow` 改指归档，只有这个套件漏了。它此前只挂在 `ciSharedStaticGates`（`ci-primary`/`ci-static`/`hygiene`），而这些聚合没有任何工作流调用，所以红态不可见；与 #383 / #395 同一族（门禁存在但无人跑）。按 #395 的取向收尾：三处读取改指归档并具名（三处负控制各自命中对应用例），README 的两个同类死链一并改指并重录配对，套件接进必过车道 `node-checks`，由 `scripts/ci-workflow.spec.ts` 钉住该步。

接进车道才暴露第二层，它解释了这批红为什么长期没人看见：套件另有 5 条用例把仓库路径写死成 `deepseek-harness/deepseek-harness`，而实现按 `GITHUB_REPOSITORY` 参数化并在**模块加载时**读取该变量，于是 runner 给出的 fork slug 让这 5 条红——本机不设该变量才回落 `config.json` 的默认值而全绿。给工作流步骤加 `env:` 无效（GitHub 保留 `GITHUB_*` 名，首次接线即因此失败），改为套件自己在加载被测模块前钉住该值，四个本地模块随之改为动态导入。以宿主未设、fork slug、canonical 三种取值复跑均为 51/0；修前 fork 取值为 46/5。

### 同族的其余四个门禁（PR #412）

上游的 PR 车道是 `check:ci:static`（归档在 `.github/workflows-disabled/ci.yml`），等于 `ciSharedStaticGates` + 完整文档聚合 + `verify-module-graph`；本 fork 的 `ci-fork.yml` 从不调用它。落在 `hygiene` 聚合里的那一半仍在运行，余下四个没有任何车道：`verify-self-evolve-eval`、`verify-ipc-standards-source`、`verify-package-meta` 只注册在 `ciSharedStaticGates`，`test:approval-policy` 还出现在 `check-all` 这个本地排练模式。四者在本机均绿、keyless、不读构建产物，取向为**逐一接进必过车道**（与 #409 / #411 同一写法），由 `scripts/ci-workflow.spec.ts` 钉住。

接线时暴露出 `verify-ipc-standards-source` 在 runner 上根本不可能通过：它的默认源库根是本仓的上级目录，而该目录在 Actions 的检出上级必然存在，于是它走全量回源、对 138 张卡片全报缺失，而不是走它自己文档承诺的「源库不可用则只校验路径格式」。改为用源库目录本身（`宝宸知识库`）判定默认根是否可用；显式配置时的配置错误语义不变（目录不存在、或存在但不含源库，都仍失败）。三种根取值与模拟 CI 目录结构下的行为见 PR #412。
