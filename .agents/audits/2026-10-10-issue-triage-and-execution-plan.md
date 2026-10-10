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

## 2. 16 条一览（按脚本内的顺序）

「证据」列区分**本人逐行直读核实**（V）与**子代理实跑、本人未复算**（S）。本轮两条 S 条目（#10 / #12）已由 2026-10-10 的后续会话按复现命令重跑：`182 / 71`、`1135`、`140`、`16`、`37` 为当前实测值（原记载的 `v8 ignore = 1391` 无法复现），详见 §3 批次 A 与 §6。

| # | 标题（脚本内） | 标签 | 优先级 | 证据 | 依赖 | GitHub |
|---|---|---|---|---|---|---|
| 1 | run-gates 的两个模式在 CLI 上不可达 | area/infra, kind/bug-fix | **P1** | V | 需决定（删/恢复） | #383 |
| 2 | 专利文书两套模板体系并存 | area/patent, kind/cleanup | P2 | V | 需决定（收口方向） | #384 |
| 3 | verify-preset-divergence 只比较 ≥2 preset 都携带的 row id | area/infra, kind/techdebt | P2 | V | — | #385 |
| 4 | verify-preset-tool-refs 忽略 config 级工具裁剪 | area/infra, kind/techdebt | P2 | V | — | #386 |
| 5 | 文档模式与自媒体模式关掉 web_fetch | area/document, kind/cleanup | P2 | V | 需决定（开/不开） | #387 |
| 6 | patent-tools 的工具计数三处不一致 | area/patent, kind/doc | P2 | V | — | #388 |
| 7 | patent.md:77 断言「legalSearch 没有模型可见工具」 | area/patent, kind/doc | P2 | V | — | #389 |
| 8 | 文档模式契约与文档瑕疵批次 | area/document, kind/doc | P3 | V | — | #390 |
| 9 | 专利自媒体模式：外置 bundle 的装配行集已落后 | area/patent, kind/techdebt | P2 | V | 需决定（ralph 去留） | #391 |
| 10 | 台账与注释的机械计数过期批次 | area/docs, kind/doc | P3 | V（已复算 2026-10-10） | — | #392 |
| 11 | patent.md 的装配清单与磁盘不符 | area/patent, kind/doc | P2 | V | — | #393 |
| 12 | patent-law 的《专利法》索引覆盖度 37 vs 36 | area/patent, kind/doc | P2 | V（计数已复算：37） | — | #394 |
| 13 | verify-patent-oas-gold 在基线未记录时静默休眠并 exit 0 | area/patent, kind/techdebt | P2 | V | 需决定（进不进 CI） | #395 |
| 14 | 文档与依赖清单未覆盖 patent-filing | area/patent, kind/doc | P2 | V | 与 #11 同批 | #396 |
| 15 | 受控草稿的两条渲染通道各写一份表题/对象窄化实现 | area/patent, kind/techdebt | P3 | V | — | #397 |
| 16 | 以「实测」为据的 preset 断言没有可复算出处 | area/infra, kind/doc | P3 | V（形态已定：不可达） | — | #398 |

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

**仍未证实、需下一轮补的**：受控草稿契约与 11 个模板 `SKILL.md` 的逐项一致性（**下一轮第一优先**）；`verify-patent-document-output` / `verify-patent-team-roster` 的断言面；自媒体所需的广告法/专利标识资料是否存在于仓外。
