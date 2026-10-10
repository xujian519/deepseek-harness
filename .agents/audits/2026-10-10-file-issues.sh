#!/usr/bin/env bash
#
# File the 2026-10-10 three-mode scan findings (patent domain / document mode /
# patent self-media mode) as GitHub issues on the fork remote.
#
# Idempotent: an issue whose exact title already exists in any state is skipped,
# so the script can be re-run after a partial failure. Requires `gh` authenticated
# against the target repository.
#
#   bash .agents/audits/2026-10-10-file-issues.sh
#
# Every body is a quoted heredoc, so backticks and `$` inside them stay literal.
set -euo pipefail

REPO=xujian519/deepseek-harness

printf 'reading existing titles from %s ...\n' "$REPO"
existing=$(gh issue list --repo "$REPO" --state all --limit 1000 --json title --jq '.[].title')

file_issue() {
  local title=$1 labels=$2
  if grep -Fxq -- "$title" <<<"$existing"; then
    printf 'skip    %s\n' "$title"
    return 0
  fi
  gh issue create --repo "$REPO" --title "$title" --label "$labels" --body-file -
  printf 'created %s\n' "$title"
}

file_issue "run-gates 的两个模式在 CLI 上不可达：check:ci:snapshot / check:ci:artifacts 必然抛错（Mode 与 gatesForMode 均已实现）" \
  "area/infra,kind/bug-fix" <<'BODY'
P1 | 类型：Task | 来源：2026-10-10 三模式技术债扫描（专利域 / 文档模式 / 专利自媒体模式）

## Problem

`package.json` 把两个模式映射成可执行脚本，`run-gates.ts` 也把两个模式完整实现了，唯独**入口解析器不接受它们**——脚本一跑就抛。

- `package.json:99` → `"check:ci:snapshot": "tsx scripts/run-gates.ts ci-snapshot"`
- `package.json:100` → `"check:ci:artifacts": "tsx scripts/run-gates.ts ci-artifacts"`
- `scripts/run-gates.ts:18-36` 的 `Mode` 联合**包含** `'ci-snapshot'` 与 `'ci-artifacts'`
- `scripts/run-gates.ts:268-290` 的 `gatesForMode` **有**这两个分支（`ciBuildGate() + snapshotGate()` / `ciArtifactGates()`）
- `scripts/run-gates.ts:132-156` 的 `parseMode` **没有**这两个 case，落到 `default` 抛错

即：类型系统认为可达、实现已写好、脚本入口挂着，唯一的运行入口把它们拒绝了。

## 复现

```sh
pnpm run check:ci:snapshot    # run-gates: expected mode ci-primary | … | doc-quick, got "ci-snapshot".
pnpm run check:ci:artifacts   # 同上
```

对照（可用的相邻模式）：

```sh
pnpm run check:ci:bench       # parseMode 有 case，正常进入
```

`parseMode` 的错误文案本身也印证了缺口——它逐项列出 16 个模式，与 `switch` 的 case 集合一致，其中不含这两个。

## 影响

- 两个模式对调用方是「存在的命令」，实际 100% 失败：CI/本地照文档调用会得到解析错误而非门禁结果。
- **没有任何自动面调用过它们**：`.github/workflows/ci-fork.yml` 的 8 个 job（`node-checks` / `node-built-suites` / `node-snapshots` / `node-web-snapshots` / `node-hygiene` / `node-coverage` / `benchmarks` / `python-checks`）无一调用 `check:ci:snapshot` / `check:ci:artifacts`。所以「必然抛错」这件事在 CI 上是不可见的——没有 lane 会红，只有人手动跑才会撞见。
- `docs/testing.md` 与 `.agents/audits/2026-09-27-issue-triage-and-execution-plan.md` §8 的 #326 记录「已删除这两个模式及其 `check:ci:*` 脚本」——**当前 HEAD 上脚本、`Mode`、`gatesForMode` 三者都回来了，只有 `parseMode` 保持裁剪后的样子**，与记录的状态三方不一致。
- `AGENTS.md` 的 Commands 段没有列这两个命令，所以「文档说没有、脚本有、解析器也没有」是当前唯一自洽的解释，但这个解释没有被写进任何地方。

## 判定

**同步回退（merge artifact）**：上游 `dsh-v0.2.1-alpha.2` 合并（PR #381）把 `Mode` / `gatesForMode` / `package.json` 的对应行带回来了，`parseMode` 里的分支未随之恢复。

## Suggested fix

二选一，都要让三处一致：

1. **恢复**：`parseMode` 补 `case 'ci-snapshot':` 与 `case 'ci-artifacts':`，并同步错误文案里的模式清单。**若选这条，必须同时决定谁调用它**——当前 `ci-fork.yml` 无任何 job 引用，恢复解析器只是让命令「可跑」，仍然没有人跑它。
2. **删除**（与 #326 的原决定一致，也是当前无调用方的现实下更小的一步）：删掉 `package.json:99-100` 两行 + `Mode` 两个成员 + `gatesForMode` 两个分支 + `ciBuildGate`/`ciArtifactGates`（若因此变为无引用），并在 `docs/testing.md` 保留「本 fork 不接线」的记录。

无论选哪条，都应补一条形状断言：`parseMode` 接受的模式集合与 `Mode` 一一对应（现有 `scripts/run-gates.spec.ts` 覆盖门禁图，不覆盖这一处）。

## 验收

- `pnpm run check:ci:snapshot` 与 `pnpm run check:ci:artifacts` 要么正常进入门禁并给出结果，要么命令本身不存在——不允许「存在但必抛」。
- 新增的解析器/联合一致性断言在注入一个只存在于 `Mode` 的名字时失败。

## 关联

- #326（组装式 Web 快照与 `check:ci:snapshot`/`check:ci:artifacts`）：本条是该次收口在同步后的回退面。
BODY

file_issue "专利文书两套模板体系并存：doc-template 的 5 个 md 模板与 patent-document 的 11 个 SKILL+HTML 模板覆盖同名文书，受控草稿改造只落在其中一条" \
  "area/patent,kind/cleanup" <<'BODY'
P2 | 类型：Task | 来源：2026-10-10 三模式技术债扫描（专利域 / 文档模式）

## Problem

同一批专利文书，在同一个专利 preset 的目录里，有**两套互不相干的模板体系**，各自带一个模型可见工具、各自一套资产格式、各自一套内容模型：

| 体系 | 所属包 | 资产 | 工具 | 内容模型 |
|---|---|---|---|---|
| A | `packages/document/doc-template` | 17 个 Markdown（YAML front-matter + `vars` 变量表） | `list_doc_templates` / `render_doc_template` | 变量替换（`{{snake_case}}` 填值） |
| B | `packages/patent/patent-document` | 11 个模板目录（各自 `SKILL.md` + `assets/template.html` + `references/` + `example.html`），加共享的 `manifest.json` / `tokens.css` / `DOCS.md` | `render_patent_document` | 受控草稿（SpecDraft / TemplateDraft + 槽位） |

**同名文书**（可复算）：

| 文书 | A（`assets/templates/`） | B（`assets/templates/patent/`） |
|---|---|---|
| 权利要求书 | `patent/claims-spec.md` | `claims-spec/` |
| 无效意见 | `patent/invalidation-opinion.md` | `invalidation-opinion/` |
| 专利性意见 | `patent/patentability-opinion.md` | `patentability-opinion/` |
| 检索报告 | `patent/search-report.md` | `search-report/`、`search-report-form/` |
| OA 答复 | `patent/oa-response-sati.md` | `oa-response/` |

`patent.patch.yml` 同时挂载两者，于是模型对同一份文书有两个入口。历史上的受控草稿改造（PR #380 系列：`feat(patent)!: the controlled draft is the only content channel`、`feat(patent-document): the eight document templates join the draft model`、`build_patent_filing consumes the shared controlled draft`）**只搬到 B 一侧**，A 侧的 5 个专利 markdown 模板仍是变量替换模型，没有被这次「唯一内容通道」的决定覆盖。

## 复现

```sh
ls packages/document/doc-template/assets/templates/*/          # claims disclosure oa-response patent specification
ls packages/patent/patent-document/assets/templates/patent/    # 11 个模板目录 + manifest.json + tokens.css + DOCS.md + README.md
```

```sh
grep -n "doc-template\|render_patent_document" packages/bundle/web-app/presets/patent.patch.yml
```

## 影响

- **同一个交付语义有两条产出路径**，产出物不一致（HTML 模板 vs 变量填值），交付质量取决于模型选了哪个工具，而两个工具都在目录里。
- **受控草稿的纪律只覆盖一条路**：persona 已把正式交付绑定到 `render_patent_document`（受控草案），但 A 侧 `render_doc_template` 仍可用且不校验草案——绕过草案校验的路径仍然开着。
- **改动会双份**：模板样式、字段、体例修正需要在两处各改一次，且两边没有一致性门禁。

## 判定

**两套体系的正当性需要一次显式决定**，而不是继续各改各的。可能的收口方向：

1. **A 侧退出专利域**：`doc-template` 的 `patent/` 这 5 个模板改由 B 侧承载（或删除），A 只服务通用文档模式；`doc-template` README 的模板计数随之调整。
2. **B 侧收敛为 A 的渲染器**：让受控草稿成为唯一内容源，模板资产统一为一种格式。
3. **显式并存 + 记录边界**：保留两套，但在 `docs/subsystems/patent.md` 与两个包 README 写明「哪一种文书走哪一条、为什么」，并加一条门禁（同名文书不得在两个体系里各有一份而无人声明差异）。

不论选哪条，都要先回答：**A 侧的 5 个专利模板现在还有没有真实消费方**（是否有场景只有它能做）。

## 关联

- #314（占位符文法两套）：同一族的「两套模板语义」，本条是文书层面的放大。
- `docs/subsystems/patent.md`、`packages/document/doc-template/README.md`、`packages/patent/patent-document/README.md` 三份文档对这套关系的口径需要一并核对。
BODY

file_issue "verify-preset-divergence 只比较「≥2 个 preset 都携带的 row id」，看不到「某个 preset 整行缺失」：standard 的 time-context / present / tool-schedule 在 patent、document 两个 preset 里整行不存在" \
  "area/infra,kind/techdebt" <<'BODY'
P2 | 类型：Task | 来源：2026-10-10 三模式技术债扫描（三模式共享面）

## Problem

`verify-preset-divergence` 的语义是「同一个 row id 在不同 preset 里的块内容不同」——它**按 row id 求交集**，因此一个 preset 少挂一整行时，这行在它身上根本不存在，交集里也就没有它，门禁无话可说。

`scripts/verify-preset-divergence.ts:109-116`：

```ts
for (const [id, files] of carriers) {
  if (files.length < 2) continue          // ← 只被一个 preset 携带的 id 直接跳过
  …
  if (new Set(hashes.values()).size > 1) divergences.set(id, hashes)
}
```

`scripts/verify-preset-divergence.ts:148-151` 的 stale 检查也只遍历基线里已有的 id，所以「基线没记过的新 id」拿不到任何报告。

## 复现

```sh
cd packages/bundle/web-app/presets
diff <(grep -oE '^ *- id: [a-zA-Z0-9_-]+' standard.patch.yml | sed 's/.*- id: //' | sort) \
     <(grep -oE '^ *- id: [a-zA-Z0-9_-]+' document.patch.yml | sed 's/.*- id: //' | sort)
```

实测输出（2026-10-10，HEAD 为 PR #382 合并后的基线；集合含各 group 的嵌套行）：

```
only in standard.patch.yml: command-goal, openviking, present, preset-standard,
                            time-context, tool-plugin-manager, tool-plugin-market, tool-schedule
only in document.patch.yml: doc-template, preset-document, skill-open-design, tool-document-deliver,
                            tool-subagent-claude-code, tool-subagent-codex
```

（`preset-standard` / `preset-document` 是各自的声明行，不具可比性；`tool-subagent-codex` / `tool-subagent-claude-code` 是 `delegation` group 里的嵌套行。去掉这些后，**standard 独有而在 document 里整行缺失的顶层行共 6 个**：`time-context`、`tool-schedule`、`command-goal`、`tool-plugin-market`、`present`、`tool-plugin-manager`；`openviking` 在第 7 位，但它在 `patent.patch.yml:488-490` 是**存在且 `disabled: true`**，所以「缺失」只对 document 成立。）

`patent.patch.yml` 与「自媒体 bundle」在 `time-context` / `present` / `tool-schedule` / `command-goal` / `tool-plugin-market` / `tool-plugin-manager` 六个上同样缺失；`openviking` 在自媒体 bundle 也缺。

`scripts/preset-divergence-baseline.json` 的 `rows` 分区共记录 **24** 个 row id（覆盖 `cordis` / `document` / `minimal` / `patent` / `ptc` / `standard` 六个 preset 文件），其中**没有任何一个**是上述这些行——因为它们各只被 1 个 preset 携带。基线因此只覆盖了「多 preset 共有且内容分叉」的 id，对「行本身缺不缺」完全无话可说。

## 影响

- **`time-context` 的缺失有功能后果**：`standard` 挂载 `@deepseek-ai/dsh-time-context`，patent / document / 自媒体三个模式都不挂。模型因此拿不到当前日期，而这三个模式恰好都以「日期敏感」为核心纪律（专利：答复期限、年费；文档：页脚版本与日期、来源时效；自媒体：热点选题）。
- **`present`（`@deepseek-ai/dsh-tool-present`）缺失**：交付物呈现工具的缺口没有记录在案，只有 patent/document 各自的专用交付行（`render_patent_document` / `document_deliver`）替代。
- **`tool-schedule` 缺失**：`standard` 的 subagent 行专门 `toolFilter.deny` 了 `schedule_*`，说明 schedule 是被当作默认能力对待的；三个 fork preset 既没挂也没有 deny 行，缺口同样无记录。
- 三处 README（`preset/*.md`）逐条列举了「本模式挂什么」并**只对 `tool-ralph` 写了显式的「omitted（理由）」**（`packages/bundle/web-app/presets/patent.md:25`），其余缺失行没有说明，读起来像是全部挂载了。

## 判定

这是 #322 那次收口的**残留盲区**：#322 建立了「差异要进基线」的机制，但基线的粒度是「同一个 id 的内容哈希」，不覆盖「行的有无」。基线因此会给一种虚假的完整感。

## Suggested fix

（与 #322 的形态保持一致：报告式，不强制相等）

1. 把门禁的报告面扩成两张表：**内容差异**（现有）与**行集差异**（新增：以出现次数最多的 preset 为参照，列出各 preset 缺失的 row id）。
2. 行集差异同样入基线（`preset-divergence-baseline.json` 增一个 `rows` 之外的分区），这样「有意不挂」与「忘了挂」可分。
3. 对确认为有意缺失的行，把理由写进对应 preset README 的「What it mounts」段（`tool-ralph` 已是先例），让理由与基线成对。

## 验收

- 注入「从 `document.patch.yml` 删掉一整行」的探针，门禁必须报出该 row id 与缺失的 preset。
- `pnpm run verify-preset-divergence` 在当前 HEAD 上给出与基线一致的行集差异，且每一项都有 README 理由或基线记录。

## 关联

- #322（跨 preset 一致性门禁）：本条是其残留盲区。
- #328（专利自媒体模式）：那条记录的外置 bundle 同样缺这些行，见本次扫描的自媒体条目。
BODY

file_issue "verify-preset-tool-refs 忽略 preset 的 config 级工具裁剪：document 的 fetch:false 已把 web_fetch 从目录摘掉，门禁仍把该包的全部工具算作已挂载" \
  "area/infra,kind/techdebt" <<'BODY'
P2 | 类型：Task | 来源：2026-10-10 三模式技术债扫描（三模式共享面）

## Problem

`verify-preset-tool-refs` 判定「某个工具名算不算已挂载」时，只认两件事：**行的 `disabled`**，以及**该行插件在 `docs/tool-catalog.md` 里的工具名集合**。它不看插件收到的 `config`，因此一个 `config` 开关能摘掉工具、门禁却看不见。

`scripts/verify-preset-tool-refs.ts:112-134`：

```ts
// A row the preset disables mounts nothing, neither its own tools nor a
// nested child's; `!!js` conditions arrive evaluated, so a platform-off row
// is skipped exactly as the load skips it.
if ((value as Record<string, unknown>).disabled === true) return
for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
  if (typeof item === 'string' && key === 'name') {
    for (const tool of catalog.get(item) ?? []) names.add(tool)   // ← 按包名取全部工具
  }
  …
}
```

而 `@deepseek-ai/dsh-tool-web` 的 `Config.search` / `Config.fetch` 是**真实的注册开关**（`packages/web/tool-web/src/index.ts:74-87`）：

```ts
if (resolved.search) { applyWebSearchTool(…) }
if (resolved.fetch) { applyWebFetchTool(…) }
```

`packages/bundle/web-app/presets/document.patch.yml:313-317` 设 `fetch: false`，所以该 preset 的模型目录里**没有** `web_fetch`；但门禁按包名把 `web_search` 与 `web_fetch` 一起算作已挂载。

## 复现

```sh
grep -n "fetch:" packages/bundle/web-app/presets/document.patch.yml   # fetch: false
pnpm run verify-preset-tool-refs                                      # 通过
```

对照：`disabled: true` 的行是**被正确跳过**的——这是 #321 的收口在评审轮补的那一条（`.agents/audits/2026-09-27-issue-triage-and-execution-plan.md` §10.1）。本条的 `config` 开关是同族盲区，当时未覆盖。

## 影响

- 门禁的承诺是「preset 技能正文引用的工具必须是该 preset 挂载的工具」。带 `config` 开关的插件（`tool-web` 的 `search`/`fetch`、以及任何 `toolName` 之外按 config 决定注册的插件）都被高估，技能文本可以引用一个模型看不到的工具而不报错。
- 反向也成立：**该报的报不出来**，所以 `fetch: false` 与 persona/技能里「事实必须有可验证来源」的冲突（见本次扫描的文档模式条目）不会被任何门禁提示。

## Suggested fix

1. 让 `mountedToolNames` 接受一个「按 `(package, config)` 求工具集」的解析器：默认取目录全集，对已知的 config 开关（先用 `tool-web` 的 `search`/`fetch` 建表）做减法；表要放在门禁脚本里并带理由，作为「哪些 config 决定注册」的唯一清单。
2. 或者更保守：对**带 config 开关的插件**要求 preset 显式声明——例如要求 `fetch: false` 时在行上留一条注释/元数据，门禁读到就把该工具移出集合。
3. 补负例：在 `document.patch.yml` 的某个技能里注入 `` `web_fetch` ``，门禁必须失败（当前会通过）。

## 验收

- 注入 `` `web_fetch` `` 到 `skills/document/**` 的负例使门禁失败；把该行改成 `fetch: true` 后负例通过。
- `Disabled` 行与 `config` 关闭行两条路径各有对位用例。

## 关联

- #321（preset 技能引用未注册工具 + `verify-preset-tool-refs` 建立）：本条是该门禁的残留盲区。
- 本次扫描的「文档模式关掉 web_fetch」条目。
BODY

file_issue "文档模式与自媒体模式关掉 web_fetch（fetch: false），与 persona、document-quality-gate、document-report 的「事实必须可验证来源」纪律冲突；同一平台事实在 patent preset 侧结论相反且有理由" \
  "area/document,kind/cleanup" <<'BODY'
P2 | 类型：Task | 来源：2026-10-10 三模式技术债扫描（文档模式）

## Problem

同一个仓库、同一个平台事实（`dsh-base` 组合挂载了 http fetch provider），两个 preset 得出相反结论，且**只有一侧写了理由**。

**document 侧**（`packages/bundle/web-app/presets/document.patch.yml:311-317`）：

```yaml
          # The `web` service and its search provider stay in the host composition; only
          # the model-facing tool is per-session.
          - id: tool-web
            name: '@deepseek-ai/dsh-tool-web'
            config:
              fetch: false
              searchTimeoutMs: 60000
```

`fetch: false` 使 `applyWebFetchTool` 根本不被调用（`packages/web/tool-web/src/index.ts:84-86`），模型目录里没有 `web_fetch`。注释只解释了「web 服务留在宿主」，**没有一个字解释为什么关掉 fetch**。

**patent 侧**（`packages/bundle/web-app/presets/patent.patch.yml:436-451`）：同样的事实，写成 `fetch: true`，并给了 10 行理由——「每个随包组合都挂了 http fetch provider（`dsh-base` 组合 `dsh-web-fetch-http`，没有 bundle 关掉它）……打开来源页是 verify-before-cite 纪律核对引用的方式」。同一段话还被抄进 `presets/patent.md:25` 与 `:77`（「so `web_fetch` works without a deployment change」）。

**自媒体 bundle** 同样是 `fetch: false`（`~/.dsh/local-bundles/patent-media/cordis.patch.yml:307-311`），人设里把它写成了已知限制：「web 检索（fetch 默认关闭，web_fetch 需另行配置 provider）」。

## 与纪律的冲突（文档模式）

- persona（`document.patch.yml` persona 段）：「2. **无来源即撤回**：任何事实性断言（数据、日期、引用、版本）必须附可验证来源（URL / 文件路径 / 附件）；拿不出来源就删除该断言。」
- `packages/bundle/web-app/skills/document/document-quality-gate/SKILL.md:20-21`（P0，不通过不得交付）：「**来源**：每个事实性断言（数据/日期/引用/版本）有可验证来源；无来源的断言已删除或标注『待核实』」
- `packages/bundle/web-app/skills/document/document-report/SKILL.md:32`：「事实性陈述必须带来源（URL / 文件路径 / 引文）。」

纪律要求「打开并核对来源」，唯一能打开来源页面的工具却不在目录里；`web_search` 只给检索结果与摘要。于是「URL 来源」实际只能靠模型的记忆或用户提供的附件来满足。

## 复现

```sh
grep -n -A3 "id: tool-web" packages/bundle/web-app/presets/document.patch.yml   # fetch: false
grep -n -A3 "id: tool-web" packages/bundle/web-app/presets/patent.patch.yml     # fetch: true + 理由
grep -n "fetch" packages/bundle/web-app/presets/patent.md
```

（该差异**已**被 `scripts/preset-divergence-baseline.json` 记为一个哈希块：`tool-web` 的 `document.patch.yml=09d366928f` / `patent.patch.yml=6d1ff9647d` / `standard.patch.yml=ee66c15cda`。）

## 影响

- **记录的是「有差异」，不是「有理由」**：基线是内容哈希，无法承载「为什么这条差异是对的」。同一族里 `patent` 有理由、`document` 没有，读记录的人分不出哪一侧是有意、哪一侧是复制遗留。
- 文档模式的 P0 门禁与 persona 纪律在**无来源**时无法满足，模型的合理行为只剩「标注待核实」——与「交付成品」的定位相抵。
- 自媒体模式的图像/视频素材与判例核验同样需要抓取第三方页面，人设已把 `fetch: false` 写成限制，说明**已知但未决**。

## Suggested fix

先做一个决定，再让两侧一致：

1. **文档模式开 fetch**：与 patent 侧对齐（平台事实相同，fetch provider 已在宿主挂载），并把 `document.patch.yml` 的注释补成与 patent 侧同构的说明；自媒体 bundle 一并跟。
2. **确认文档模式确实不要 fetch**：那就把理由写进 `document.patch.yml` 的注释与 `presets/document.md`，同时**下调** persona 与 `document-quality-gate` 的措辞（例如把「URL 来源」改成「会话附件 / 用户提供的路径 / `web_search` 结果，并注明未打开原文」），不让纪律要求一个拿不到的能力。

顺带：给 `preset-divergence-baseline.json` 的每条记录补一句理由（或指向 README 的锚点），让「有意差异」可读。

## 验收

- 两侧（含自媒体 bundle）在同一平台事实上的一致结论，或各自有独立且写下来的理由。
- 文档模式的 P0「来源」项在所选方案下可被满足（有对位测试或快照场景）。
- `pnpm run test:docs` / `test:snapshot` 在改动模型可见文本后重跑。

## 关联

- #322（跨 preset 差异门禁）：本条是「差异有记录、无理由」的实例。
- #313（专利模式的端点与对外依赖声明）：同族的「部署前提要写在声明里」。
- 本次扫描的「verify-preset-tool-refs 忽略 config 级裁剪」条目。
BODY

file_issue "patent-tools 的工具计数三处不一致：README 说 30、index.ts JSDoc 说 31、实际注册 32 个（README 的枚举还漏了 9 个）" \
  "area/patent,kind/doc" <<'BODY'
P2 | 类型：Task | 来源：2026-10-10 三模式技术债扫描（专利域）

## Problem

同一个数字在三个地方各不相同，且真实值最大：

| 位置 | 值 |
|---|---|
| `packages/bundle/web-app/presets/patent.md:14` | **30** model-facing tools |
| `packages/patent/patent-tools/src/index.ts:2` | registering the **31** model-facing patent tools |
| `packages/patent/patent-tools/src/index.ts:527` | Register the **31** patent tools |
| 实际（`ctx.tools.register` 的不同工具名） | **32** |

`patent.md:14` 的枚举也漏项——它列的是「search, metadata, legal status, case/wiki/kg queries, claim-chart, office-action parsing, TRIZ contradiction analysis, drafting, analysis reports, evidence judgment, rule checking, figure generation, PDF download, knowledge notes, and the workflow/plan state machines」，**没有**提到 `law_search`、`patent_eval`、`validate_specification`、`patent_worker_validate`、`workbench_link_patent_case`、`recognize_chemical_structure`、`search_patent_figure`、`add_patent_figure_references`、`verify_patent_figure`、`generate_structure_figure` 中的任何一个。

## 复现（32 的算法）

`packages/patent/patent-tools/src/index.ts` 的 `apply()` 里 `ctx.tools.register` 共 36 处，其中 4 处在 `knowledge === undefined` 的 `else` 分支（`:575-578`）与 `if` 分支（`:555-573`）注册的是同名工具，去重后 **32** 个不同工具名：

```
patent_search, patent_metadata, patent_legal_status, patent_case_search, law_search,
patent_wiki_search, patent_kg_query, patent_eval, draft_claims, draft_specification,
validate_specification, rule_check, parse_office_action, patent_worker_validate,
patent_plan_task, workbench_link_patent_case, recognize_chemical_structure,
patent_analysis_report, claim_chart_build, triz_contradiction_analysis,
patent_workflow_run, flexible_plan, analyze_patent_figure, evaluate_evidence,
patent_workflow, search_patent_figure, generate_patent_figure,
add_patent_figure_references, verify_patent_figure, generate_structure_figure,
patent_pdf_download, knowledge_note_save
```

`render_patent_document` 不计入（`index.ts:7-9` 明示由 `dsh-patent-document` 注册）。

```sh
grep -c "ctx.tools.register(" packages/patent/patent-tools/src/index.ts
grep -n "31 model-facing\|Register the 31" packages/patent/patent-tools/src/index.ts
grep -n "30 model-facing" packages/bundle/web-app/presets/patent.md
```

## 影响

- 计数是模型可见面的规格说明——「这个模式给模型多少个工具」是 preset 的核心指标之一，也是历史上（#327）已修过一次的同类漂移（当时由 29 修到 30）。
- `docs/tool-catalog.md` 是生成的、可复算的真源；文本计数一旦与人手维护的枚举脱节，就没有东西会在新增工具时提醒。

## Suggested fix

1. 以 `docs/tool-catalog.md`（`verify-tool-catalog` 由当前源码重新生成，即产品真值）为准，把 `index.ts:2`、`index.ts:527`、`patent.md:14`（中英双写 `patent.zh.md`）三处统一为同一个数字，并在 `patent.md:14` 补全枚举或改成「N 个工具，清单见 `docs/tool-catalog.md`」。
2. 把计数写进已有的 `verify-*` 门禁：例如让 `verify-tool-catalog` 或 `patent-preset.spec.ts` 断言「README/preset 里声明的工具数与目录里该包的工具数一致」，避免第三次漂移。

## 验收

- 三处数字一致且等于目录真值；中英双语同步（`translation-pairing` 语料覆盖 `**/*.md`，改一侧必须改另一侧）。
- 新增计数断言在注入一个不一致的声明时失败。

## 关联

- #327（文档与台账数字过期批次）：同一族，本条是其中的专利域复现。
- #353（11 个专利域工具零调用且未归因）：枚举完整性是那条的前置。
BODY

file_issue "patent.md:77 断言「legalSearch 没有模型可见工具」与 law_search 已注册相反；persona 与代码一致，只有 README 停在旧状态" \
  "area/patent,kind/doc" <<'BODY'
P2 | 类型：Task | 来源：2026-10-10 三模式技术债扫描（专利域）

## Problem

`packages/bundle/web-app/presets/patent.md:77`（Known Limitations 第一条）写：

> Legal-text search (`ctx.patentKnowledge.legalSearch`) **has no model-facing tool**. `law_verify` covers citation form and index membership, not legal text …

但代码里 `law_search` 就是一个模型可见工具，且正是接在 `legalSearch` 上：

`packages/patent/patent-tools/src/index.ts:559-564`

```ts
    // 规范原文检索：法规条文与《专利审查指南》全文同出一库（知识库 documents 的两类文档）。
    ctx.tools.register(createLawSearchTool({
      searchLaw: (q, o) => knowledge.legalSearch(q, o),
      searchGuideline: (q, o) => knowledge.guidelineSearch(q, o),
      dbPath: knowledge.paths.queryDbPath,
    }))
```

无知识库时同样注册（`:576`），并从 `index.ts:87` 公开导出。persona 也把它当成主通道使用（`packages/bundle/web-app/presets/patent.patch.yml:35`、`:58`，两处都要求「`law_search` 检索 knowledge.db 的规范全文」）。

## 复现

```sh
grep -n "createLawSearchTool" packages/patent/patent-tools/src/index.ts
grep -n "no model-facing tool" packages/bundle/web-app/presets/patent.md
grep -n "law_search" packages/bundle/web-app/presets/patent.patch.yml
```

## 影响

- README 的 Known Limitations 是维护者判断「这个能力还缺什么」的入口。这一条会让人得出「法条原文检索还没有模型面、需要新建工具」的结论，而工具已经存在——可能引发重复建设，或让人删除看似无人使用的 `law_search`。
- `patent.md:57` 的 Knowledge-base strategy 段同样只把「cnlaw + patent_case_search + web_fetch + `99-知识库/`」列为通道，没有提 `law_search`，与 persona 的通道顺序（先 `law_search` 取原文）不一致。
- 这是 #327 那批「文档与代码相反」的同类，但**方向相反**：#327 记录的是 README 说 A、磁盘是 B 的陈旧叙述，本条是 README 少写了一个已交付能力。

## Suggested fix

1. 重写 `patent.md`（+ `patent.zh.md`）:77——把「has no model-facing tool」改成陈述事实：`law_search` 提供法条与《专利审查指南》全文检索（`scope=law` / `scope=guideline`），并 **保留原结论的实质部分**：`law_verify` 仍只管引用形式与索引收录，不等于条文核验。
2. 同步 `:57` 的通道清单，把 `law_search` 放到与 persona 相同的顺序位置。
3. 顺带核对 `docs/subsystems/patent.md` 是否也有同源的旧叙述。

## 验收

- `patent.md` / `patent.zh.md` 对 `law_search` 的陈述与 `index.ts:559-564` 的注册事实一致；`translation-pairing` 通过。
- 若此前有基于「无模型面」的判断（例如 #353 的归因表），一并复核。

## 关联

- #327（文档与台账数字过期批次）：同族。
- #353（11 个专利域工具零调用且未归因）：`law_search` 属于「有工具但调用面存疑」的那一类，本条只处理文档口径。
BODY

file_issue "文档模式契约与文档瑕疵批次：doc-template README 的模板路径与磁盘不符、占位符与门禁正则靠注释对齐（#314 的修法是复制字面量而非共享常量）" \
  "area/document,kind/doc" <<'BODY'
P3 | 类型：Task | 来源：2026-10-10 三模式技术债扫描（文档模式）

## 1. `doc-template/README.md:30` 的模板路径与磁盘不符

README 写：

> **Seventeen** templates ship under `assets/templates/patent/`, in five categories: `patent-report` (5), `specification` (4), `claims` (3), `oa-response` (3), and `disclosure` (2).

数字对（3+2+3+4+5 = 17），**路径不对**：只有 5 个在 `assets/templates/patent/` 下，另外 12 个在三个兄弟目录里。README 说的是 front-matter 的 `category` 名（`patent-report` / `specification` / `claims` / `oa-response` / `disclosure`），把它们当成了目录名。

```sh
ls packages/document/doc-template/assets/templates/
# claims  disclosure  oa-response  patent  specification
ls packages/document/doc-template/assets/templates/patent/     # 5 个：claims-spec / invalidation-opinion / oa-response-sati / patentability-opinion / search-report
```

注意历史：#327 修过一次这句（当时记的是「README 写 `<category>`、磁盘是 `patent/`」）。**方向被改反了**——现在是 README 写 `patent/`、磁盘是 `<category>`。

建议改法是同时写清两件事：「五类 17 个模板」与「磁盘上按目录分组（`patent/` 装 `patent-report` 类，其余同名目录各装一类）」。中英双语（`README.zh.md`）同步。

## 2. 占位符与门禁正则靠注释对齐，两份字面量无机械绑定（#314 残留）

`EXTRACTION_PATTERN`（渲染侧报告 residual）与 `PLACEHOLDER_PATTERNS[0]`（门禁侧判定阻断）是**同一个正则的两份字面量**：

- `packages/document/doc-template/src/vars.ts:24-25`
  ```ts
  /** Placeholder pattern for extraction: any non-empty content between double braces, matching the quality gate. */
  const EXTRACTION_PATTERN = /\{\{[^{}\n]{1,80}\}\}/gu
  ```
- `packages/document/document-deliver/src/checks.ts:90-92`
  ```ts
  /** Residual placeholder forms: the unfilled-variable braces plus the marker list the quality gate names. */
  const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
    /\{\{[^{}\n]{1,80}\}\}/gu,
  ```

对齐方式**只写在注释里**（「matching the quality gate」），没有任何测试断言两者相等，也没有共享常量。#314 的原始缺陷正是「渲染侧一套文法、门禁侧一套文法，模型按技能提示清空 residual 仍被打回」；当时的收口是把门禁侧的正则**抄**到渲染侧——修复了当下的语义，没有消除分叉的机制。任何一侧被单独改动（放宽 `{1,80}`、加 `\n` 处理、改成 Unicode 类）都会静默复现 #314。

建议：把该正则提到一个共享位置（`@deepseek-ai/dsh-doc-style` 或一个新的小模块），或至少加一条跨包一致性断言（读取两侧导出并比较 `source` + `flags`）。

### 复现

```sh
grep -n "EXTRACTION_PATTERN" packages/document/doc-template/src/vars.ts
grep -n -A6 "PLACEHOLDER_PATTERNS" packages/document/document-deliver/src/checks.ts
```

## 验收

- README 双语路径描述与 `ls` 输出一致。
- 占位符正则有共享来源或跨包一致性断言；注入「只改一侧」的探针使断言失败。

## 关联

- #314（占位符文法两套）、#327（文档过期批次）。
BODY

file_issue "专利自媒体模式：外置 bundle 的装配行集已落后于仓内 standard preset，仍挂载已退役的 experimental tool-ralph，且缺广告法/专利标识标注的合规载体与可执行的图像生成通道" \
  "area/patent,kind/techdebt" <<'BODY'
P2 | 类型：Task | 来源：2026-10-10 三模式技术债扫描（专利自媒体模式）

## 背景

#328 于 2026-09-27 以 `NOT_PLANNED` 关闭，决定「不作为仓内 preset 交付，改由用户级 bundle 承载」。该 bundle 存在于 `~/.dsh/local-bundles/patent-media/`，本次扫描的对象就是它。

**它不在仓库里，因此任何仓库门禁在结构上都看不到它**——而它消费的正是仓内那些被复制维护的 preset 行。

## Problem 1：装配行集落后于 `standard`（无记录、无门禁可见）

`~/.dsh/local-bundles/patent-media/cordis.patch.yml` 最后修改 2026-09-23（技能目录 09-28），**早于**上游 `dsh-v0.2.1-alpha.2` 同步（PR #381，2026-10-09/10）。逐行对比（复现命令见下）：

```
only in standard.patch.yml:  command-goal, openviking, present, preset-standard,
                             time-context, tool-plugin-manager, tool-plugin-market, tool-schedule
only in cordis.patch.yml:    preset-patent-media, tool-ralph,
                             tool-subagent-claude-code, tool-subagent-codex
```

去掉两个各自的声明行（`preset-*`）后：**`standard` 的 7 个顶层行在 bundle 里整行缺失**（`command-goal` / `openviking` / `present` / `time-context` / `tool-plugin-manager` / `tool-plugin-market` / `tool-schedule`），多出来的是 `tool-ralph` 与两个 `disabled: true` 的 subagent provider 行。

功能后果：

- **`time-context` 缺失**——自媒体以「热点 × 专利」为选题线，人设里也确有日期敏感的判断，模型却拿不到当前日期。
- **`present`（`@deepseek-ai/dsh-tool-present`）缺失**——交付物呈现缺口。
- **`tool-web` 为 `fetch: false`**（`:307-311`），人设（`:84`）把「fetch 默认关闭，`web_fetch` 需另行配置 provider」写成已知限制；而同一平台事实在 `patent.patch.yml:436-451` 侧是 `fetch: true` 且给了理由。
- **`backgroundMode` 的写法与仓内三个 preset 全部相反**：bundle 的 `tool-subagent`（`:245-250`）与 `tool-subagent-fork`（`:252-257`）**都带** `backgroundMode: continuable`，而 `standard.patch.yml:97-101`、`document.patch.yml:261-271`、`patent.patch.yml:232-242` 三处**都不带**；bundle 的两个 `disabled` provider 行（`:263-279`）另带 `backgroundMode: one-shot`，document 侧同两行不带。即这一族字段在 bundle 里是**超前**于仓内的，不是落后——但它同样没有任何记录说明是谁对。

## Problem 2：仍挂载 `@deepseek-ai/dsh-tool-ralph`（experimental，仓内已退役）

bundle `:289-293`：

```yaml
              - id: tool-ralph
                name: '@deepseek-ai/dsh-tool-ralph'
                config:
                  subagentProvider: spawn
                  maxRounds: 64
```

而仓内**两个** preset 都已撤下该行：PR #381 同步中的 `fix(sync): declare the fork packages' product roles and drop the direct ralph mount` 从 `document.patch.yml` 删除了同一块；`patent.patch.yml:218-219` 只留注释「`tool-ralph` is removed: a patent case needs goal / todo / workflow orchestration, not fresh-agent iteration.」包本体在 `packages/experimental/tool-ralph`。

即：一份**未随仓分发**的装配仍在挂载一个仓内已按产品口径退役的实验性能力，且没有任何记录说明这是有意的。

## Problem 3：图像技能链没有可执行的中间环节

13 个技能里 4 个是图像链（`patent-media-image-brief` / `-generate` / `-postproduction` / `-qa`），每个 12 行、英文、通用模板文风（与其余 9 个中文技能风格不一致）。其中 `patent-media-image-generate` 要求「Translate the approved brief into a structured prompt … Verify the active provider documentation before issuing a request」，但：

- preset 挂载的工具集合里**没有任何图像生成工具**（`tool-bash` / `tool-fs` / `tool-web` / `tool-jobs` / `tool-skill` / `tool-goal` / `tool-subagent*` / `tool-workflow` / `tool-ralph` / `tool-ask-user` / `tool-todo`）；
- 全仓 `generate_image|image_generate|text_to_image` 零命中（`packages/*/*/src`）；
- bundle 内除 `-postproduction` 提到 ImageMagick 的 `magick` 之外，**没有任何具体命令、脚本路径或 API 名**可执行（`grep -rn "magick|ImageGen|generate_image"` 除该处外零命中）。

对比同 bundle 的 `patent-media-video`（82 行）——它给了两条可复算的命令（`MoneyPrinterTurbo` 的 `cli.py` 调用）与数字人云 API 的前置条件清单。图像链缺这一层，属于 #328 记录的「仓内无图像生成能力」在 bundle 侧的**未填补**。

## Problem 4：仍缺广告法与专利标识标注的合规载体

`grep -rn "广告法|专利标识|标识标注|极限词|绝对化" skills/ cordis.patch.yml` → **零命中**。

bundle 的 `patent-media-compliance` 技能（81 行）自述「适用范围（老徐 2026-09-28 决策）：本技能的红线与门禁**只约束小红书账号**」，覆盖的是平台规则，不含《广告法》禁用语与专利标识标注（专利法第十七条 / 《专利标识标注办法》）。这是 #328 A 段列为缺口的一项，在 bundle 落地后仍未补。

（对照：仓内 `patent-rule` 有 `PAT-ABS-001`（回避绝对化表述），但其 `legalBasis` 写的是审查规范而非广告法，且该规则服务的是专利文书而非自媒体文案。）

## Problem 5：`.bak` 残留

```
skills/patent-media-humanize/SKILL.md.bak-20260928-aiops
skills/patent-media-publish/SKILL.md.bak-20260928-aiops
skills/patent-media-track/SKILL.md.bak-20260928-aiops
```

三份备份与各自的正式文件差异 18 / 83 / 15 行，留在活跃的技能目录里（`skill-filesystem` 按目录发现技能，`.bak` 文件不会成为技能，但它们是过期内容的第二副本）。

## 复现

```sh
# 1. 行集差异
cd packages/bundle/web-app/presets
diff <(grep -oE '^ *- id: [a-zA-Z0-9_-]+' standard.patch.yml | sed 's/.*- id: //' | sort) \
     <(grep -oE '^ *- id: [a-zA-Z0-9_-]+' ~/.dsh/local-bundles/patent-media/cordis.patch.yml | sed 's/.*- id: //' | sort)

# 2. ralph 仍在
grep -n -A4 "tool-ralph" ~/.dsh/local-bundles/patent-media/cordis.patch.yml
grep -n "tool-ralph" packages/bundle/web-app/presets/patent.patch.yml     # 只有注释

# 3. 图像链无出口
grep -rn "magick|ImageGen|generate_image|text_to_image" ~/.dsh/local-bundles/patent-media/

# 4. 合规载体缺
grep -rn "广告法|专利标识|极限词|绝对化" ~/.dsh/local-bundles/patent-media/

# 5. 残留
ls ~/.dsh/local-bundles/patent-media/skills/*/*.bak*
```

## 影响与判定

- **1 / 5 属于「外置产物的维护漂移」**：正常，但没有机制发现它——仓内 `verify-preset-divergence` 只扫 `packages/bundle/web-app/presets/*.patch.yml`（`scripts/verify-preset-divergence.ts:27`），bundle 不在其中；`verify-preset-tool-refs` 同理（`:30-31`）。
- **2 是一个待决定项**：要么 bundle 侧撤下 `tool-ralph`（与仓内口径一致），要么在 bundle 里写下「本模式有意保留 ralph，理由 X」。现在两边都不知道对方的状态。
- **3 / 4 是能力缺口**：#328 已把它们登记为「bundle 自带或另开仓内单」，bundle 落地后仍未补。

## Suggested fix

按优先级：

1. **把 bundle 的装配行对齐到当前 `standard`**（补 `time-context`，按需补 `present`；`fetch` 与 `patent` 侧取同一结论），并撤下 `tool-ralph` 或写下保留理由。
2. **给外置 preset 一条可见性通道**：把 bundle 的行清单纳入某个报告式检查（例如让 `verify-preset-divergence` 支持 `--extra-preset <path>`，或在 bundle 里放一份 `README` 记录它相对 `standard` 的有意差异）。否则每次仓内改 `standard`，bundle 都会静默落后——本次已经落后了 7 行，另有 4 处 `backgroundMode` 字段分叉方向相反。
3. **图像链补一层可执行出口**（选定 provider 或本地 CLI，并把命令写进技能），或把 4 个图像技能的 description/正文改成「需要部署提供图像通道，否则本链路不可用」，不再给出无法执行的指令。
4. **补合规模块**：广告法禁用语 + 专利标识标注（专利法第十七条 / 《专利标识标注办法》）作为 `patent-media-compliance` 的一节，或另立技能。
5. 清掉 3 份 `.bak` 残留。

## 验收

- bundle 与 `standard` 的行集差异每一项都有记录（有意/待补）。
- 图像技能链的每一步都能指出一个已挂载的工具或一条可执行命令；不能则明写不可用。
- 合规技能覆盖广告法与专利标识标注，且有可引用的法规出处。

## 关联

- #328（专利自媒体模式规划态缺口清单，已 NOT_PLANNED 关闭并转为该 bundle 的指针）：本条是该指针指向的产物在 13 天后的实际状态复核。
- #313（专利模式对外依赖写进声明）：同族。
- 本次扫描的「verify-preset-divergence 看不到整行缺失」条目。
BODY

file_issue "台账与注释的机械计数过期批次：结构债 173/67 → 182/71、v8 ignore 1204 → 1135、@ts-expect-error 129 → 140、覆盖率豁免注释的专利包数 15 → 16" \
  "area/docs,kind/doc" <<'BODY'
P3 | 类型：Task | 来源：2026-10-10 三模式技术债扫描（跨域机械面）

## Problem

`docs/TECH_DEBT.md` 与覆盖率豁免注释里的可机械复算数字，在上游 `dsh-v0.2.1-alpha.2` 同步（PR #381）与受控草稿特性（PR #380）之后已过期：

| 位置 | 台账/注释写的 | 2026-10-10 实测 | 复算命令 |
|---|---|---|---|
| `docs/TECH_DEBT.md:310` | 173 个函数 > 150 行 / 67 个非生成源文件 > 800 行 | **182 / 71** | `pnpm run report:structure` |
| `docs/TECH_DEBT.md:313` | 1204 处 `v8 ignore` | **1135**（`src` 下 `.ts`；计入 `.tsx` 为 **1357**） | `git grep -h "v8 ignore" -- 'packages/*/*/src/*.ts' \| wc -l` |
| `docs/TECH_DEBT.md:307`、`:333` | `@ts-ignore` 1 处 / `@ts-expect-error` 129 处 | 1 / **140** | `git grep -h "@ts-expect-error" -- '*.ts' '*.tsx' \| wc -l`（全部落在测试目录与 `scripts`，`src` 内 0） |
| 覆盖率豁免注释 | 「15 个 patent 包」 | **16**（新增 `patent-filing`） | `ls -d packages/patent/*/ \| wc -l` |

> **口径说明（2026-10-10 后续会话复算）**：上表新值改用 `git grep`（只读 tracked 文件）复算，避免本机 `apps/desktop/.desktop-build/**` 构建残留里的 `node_modules` 命中——原报告的 `grep -rn "@ts-expect-error" packages apps scripts --include=*.ts` 在本机因此虚高到 **256**。同时原报告记载的 `v8 ignore = 1391` **无法复现**：按上表命令实测为 **1135**，把 `src` 下的 `.tsx` 计入也仅 **1357**。四条命令给出 `ls -d packages/patent/*/ | wc -l = 16` 与 `pnpm run report:structure = 182 / 71`，与记载一致。

**已独立核实**的部分是台账侧的文字本身（`docs/TECH_DEBT.md` 第 307/310/313/333 行的确写着 129 / 173 / 67 / 1204），以及 `packages/patent/` 下确有 16 个包目录（含 `patent-filing`）。

## 复现

```sh
pnpm run report:structure
git grep -h "@ts-expect-error" -- '*.ts' '*.tsx' | wc -l                 # 140
git grep -h "v8 ignore" -- 'packages/*/*/src/*.ts' | wc -l              # 1135
ls -d packages/patent/*/ | wc -l                                        # 16
sed -n '305,315p;330,336p' docs/TECH_DEBT.md
```

## 影响

- 结构债与抑制标记的计数是本仓库用来判断「恶化还是收敛」的唯一量化面（#86/#219/#292/#323 都依赖它）。数字一旦过期，下一轮复测就没有基线可比。
- 覆盖率豁免注释里的包数错一位，会让读者以为 `patent-filing` 已被豁免覆盖或不存在。

## Suggested fix

1. 就地更正 `docs/TECH_DEBT.md` 四处与本条同轮更新的注释。
2. **加一条机械兜底**：把这三类计数做成可复算报告（`report:structure` 已有先例），或让 `docs/TECH_DEBT.md` 的计数段落引用脚本输出而非手写数字。
3. 覆盖率豁免注释的包数不要写死——写成「见 `vitest.config.ts` 的 `coverage.exclude` 清单」并保证清单本身可读。

## 验收

- 台账四处数字与实跑一致；`pnpm run report:structure` 的输出与台账引用值相同。
- 复现命令用 `git grep`（只读 tracked 文件），在本机与 CI 上对同一 commit 给出同一个数字，不随构建残留漂移。
- 注释不再手写会漂移的包数。

## 关联

- #323（结构债口径与 `report:structure`）、#327（文档与台账数字过期批次）、#316（覆盖率豁免复现命令）：同一族。
BODY

file_issue "patent.md 的装配清单与磁盘不符：「thirteen further plugins」漏了 patent-filing，专利工具总数 36 无出处，:14 的 30 与目录的 32 不一致" \
  "area/patent,kind/doc" <<'BODY'
P2 | 类型：Task | 来源：2026-10-10 三模式技术债扫描（专利域）

## Problem

`packages/bundle/web-app/presets/patent.md` 的装配清单与磁盘三处不符。

**1. `:9` 的插件计数少于实际装配**

> Beyond the standard coding rows … the preset mounts **thirteen** further plugins

`:11-:23` 实列 **13** 个 bullet，但 preset 装配的专利域插件不止 13 个：

- `packages/patent/patent-filing` 在 `presets/patent.patch.yml:389-390` 有一条独立装配行（`- id: patent-filing` / `name: '@deepseek-ai/dsh-patent-filing'`），README 清单里**没有它**——而它是本模式**唯一**原生写 DOCX 的包（`patent.patch.yml:385-386` 的注释自述）；
- `@deepseek-ai/dsh-self-evolve-benchmark` 在 `:27` 以正文段落出现（`patent.patch.yml` 内成行，带自己的 isolate realm），也不在清单里。

`packages/patent/` 磁盘上是 **16** 个包目录（`patent-filing` / `patent-core` / `patent-index-asset` 在内），README 里没有任何一处给出可与它对账的包级或行级清单。

**2. `:14` 的 30 与目录的 32 不一致**

`:14` 把 `dsh-patent-tools` 描述为 "30 model-facing tools: search, metadata, legal status, …"，而 `docs/tool-catalog.md:50`（生成、可复算的真源）列出 **32** 个工具名。这条与另一条 issue「patent-tools 的工具计数三处不一致」同源：那条处理包内三处，本条处理 preset README 这一处。

**3. 专利域模型可见工具总数无处可查**

按 `docs/tool-catalog.md` 复算，专利域的模型可见专利工具是 **36** 个：`patent-tools` 32（`:50`）+ `patent-document` 2（`:51`：`render_patent_document` / `verify_deliverable`）+ `patent-filing` 2（`:52`：`build_patent_filing` / `verify_patent_filing`）。README 里没有任何一处给出这个总数，`:73` 的 Model Experience 段也不含后两者。

## 复现

```sh
sed -n '9,23p' packages/bundle/web-app/presets/patent.md          # 计数 13 + 13 个 bullet
sed -n '14p'    packages/bundle/web-app/presets/patent.md          # 30 model-facing tools
grep -n "patent-filing" packages/bundle/web-app/presets/patent.patch.yml     # :389-390
ls -d packages/patent/*/ | wc -l                                   # 16
sed -n '50,52p' docs/tool-catalog.md                               # 32 / 2 / 2
```

## 影响

- 按 README 判断「这个模式加了什么」会漏掉 `patent-filing`——它承载的是申请文件 DOCX 这条唯一的原生成文路径。
- 清单是手写的、磁盘是可算的，两者之间没有对账物；下一轮上游同步会继续漂移（本条的 30 就已经是一次漂移）。

## Suggested fix

1. 改 `:9` 的计数并把 `patent-filing`、`self-evolve-benchmark` 补进清单，或改写成「本模式装配 N 行专利域插件，清单见 `presets/patent.patch.yml`」。
2. `:14` 的计数以 `docs/tool-catalog.md` 为准改成 32，并补全枚举或改为「32 个工具，清单见 `docs/tool-catalog.md`」。
3. 补一条门禁：preset README 的装配清单与 `presets/patent.patch.yml` 的专利域 row 集合一致（与「patent-tools 工具计数」那条的门禁建议同形）。
4. 中英双写（`patent.zh.md`）同步；`translation-pairing` 语料覆盖 `**/*.md`，改一侧必须改另一侧。

## 关联

- 「patent-tools 的工具计数三处不一致」：同族，那条在包内，本条在 preset 面。
- 「文档与依赖清单未覆盖 patent-filing」：同一次遗漏在源码文档侧的复现。
BODY

file_issue "patent-law 的《专利法》索引覆盖度在包内 README 是 37、在 preset README 是 36（细则侧 26 一致），前者与磁盘一致" \
  "area/patent,kind/doc" <<'BODY'
P2 | 类型：Task | 来源：2026-10-10 三模式技术债扫描（专利域）

## Problem

同一份随包索引的覆盖度，两处 README 给出不同的《专利法》条数（《专利法实施细则》侧 26 一致）：

| 位置 | 《专利法》 | 《专利法实施细则》 |
|---|---|---|
| `packages/patent/patent-law/README.md:61` | **37** / 82 | 26 / 149 |
| `packages/bundle/web-app/presets/patent.md:79` | **36** / 82 | 26 / 149 |

**37 是对的**：`packages/patent/patent-law/assets/law/cn-patent-law.yaml` 的 `articles` 列表在 2026-10-10 实测含 **37** 条，与包内 README 一致；`patent.md:79` 的 36 过期。

`patent.md:79` 是 Known Limitations 里唯一说明核验覆盖度的地方（「Coverage is partial too — 《专利法》 indexes 36 of its 82 articles … so an existing article the index does not hold reports 索引中不存在 and still has to be looked up」）。读者据此判断「这个索引能拦住多少伪造条号」；数字少 1 会让一个索引里真实存在的条号读起来像落在索引外。

## 复现

```sh
sed -n '61p' packages/patent/patent-law/README.md        # 37
sed -n '79p' packages/bundle/web-app/presets/patent.md   # 36
sed -n '18,30p' packages/patent/patent-law/assets/law/cn-patent-law.yaml   # articles: 列表结构
awk '/^articles:/{f=1;next} f&&/^  - article:/{n++} END{print n" articles"}' \
  packages/patent/patent-law/assets/law/cn-patent-law.yaml                 # 37
```

> **口径说明**：上面第 3/4 条命令给出 37，来自本次扫描子代理的机械复算与本人对 `articles:` 列表结构的直读；**本次会话未由本人跑出该计数**（会话 shell 在扫描中途失效，见 `2026-10-10-repo-scan.md` §0）。关闭本条前请重跑一次确认。

## 影响

- 核验覆盖度是 `law_verify` 的对外承诺的一部分（「已核验 / 索引中不存在 / 条号超出有效范围」这三态的分界由覆盖度决定）。文档给出的覆盖度偏小，会让使用者低估索引，进而更依赖 `web_fetch` 回退。
- 这是「文档与代码相反」的又一处：与 `patent.md:77` 少写 `law_search`、`doc-template/README.md:30` 路径写反同族。

## Suggested fix

把 `patent.md`（+ `patent.zh.md`）`:79` 的 36 改为 37，并与 `patent-law/README.md:61` 的口径统一（两处都写「按 2020 年修正编号共 82 条，本索引覆盖其中 N 条」）。若希望不再漂移，可在 `verify-patent-law-index` 一类的门禁里断言「两处 README 声明的条数与 YAML 实际条数一致」。

## 关联

- 「patent.md 的装配清单与磁盘不符」、「patent-tools 的工具计数三处不一致」：同族的「README 手写计数与可复算真源脱节」。
BODY

file_issue "verify-patent-oas-gold 在基线未记录时打印「回归层休眠」并 exit 0；ci-fork.yml 的 8 个 job 无一调用它" \
  "area/patent,kind/techdebt" <<'BODY'
P2 | 类型：Task | 来源：2026-10-10 三模式技术债扫描（专利域）

## Problem

`scripts/verify-patent-oas-gold.ts:166-179`：

```ts
if (baseline === undefined) {
  console.log(`verify-patent-oas-gold: 基线未记录(${config.baselinePath});回归层休眠——记录一次实测后本门禁才比对分数。`)
} else {
  console.log(`verify-patent-oas-gold: 基线已记录 ${baseline.recordedAt};基线自身满足门槛。`)
}
if (flaggedRun !== undefined) { … }
return 0
```

基线缺失时**只打印一行说明并以 0 退出**——门禁读绿，而它要守的「专利 OAS 金标准分数回归」一点没跑。当前 `patent-oas-baseline.json`（`config.baselinePath`）不在仓库里（与 `packages/patent/patent-workflow/src/llmRunner.ts:22` 同一形态的本地基线路径），所以「基线缺失」是**默认状态**，不是异常状态。

同时 `.github/workflows/ci-fork.yml` 的 8 个 job —— `node-checks` / `node-built-suites` / `node-snapshots` / `node-web-snapshots` / `node-hygiene` / `node-coverage` / `benchmarks` / `python-checks` —— **没有一个**调用 `verify-patent-oas-gold`，也没有调用 `check:ci:snapshot` / `check:ci:artifacts`。这条门禁在任何自动面上都不存在。

## 复现

```sh
sed -n '160,180p' scripts/verify-patent-oas-gold.ts
grep -n "verify-patent-oas-gold" package.json                      # 仅在本地聚合脚本里
grep -nE "verify-patent-oas-gold|check:ci:snapshot|check:ci:artifacts" .github/workflows/ci-fork.yml   # 零命中
git check-ignore -v packages/patent/patent-workflow/*baseline*.json
```

## 影响

「有脚本 + `verify-*` 命名 + 能 exit 0」读起来像已接线；实际它既不自动跑、手动跑也在默认状态下静默放行。这正是本仓库反复出现的失效形态——对照 `verify-test-skips`（新增/加宽的 skip 变红，而不是在日志里读绿）与 `figure-graphviz-ci-signal.spec.ts`（缺 `dot` 时失败而不是跳过）那两次「读绿但没信号」的收口：两者都把「没测」与「通过」在**退出码**上分开了，本条没有。

## Suggested fix

1. **把「休眠」与「通过」在退出码上分开**：基线缺失时失败（并给出记录基线的命令），或在 CI 面显式跳过并打印 `::warning::`，不要静默 `return 0`。
2. **决定它是否进 CI**：
   - 进 —— 基线要随仓提交（它是编译产物式的指标基线，不是用户数据），并在 `ci-fork.yml` 加一个 job（`scripts/ci-workflow.spec.ts` 已对 benchmark job 的形状做过断言，可依同一形态补）。
   - 不进 —— 在 `docs/testing.md` 写明「本地门禁、CI 不跑」，并考虑改名或加 `--local-only` 之类的显式标记，避免被当成必过门禁。
3. 与「run-gates 的两个模式在 CLI 上不可达」一并处理：那次收口已经证明「存在但不可达」的门禁比没有门禁更坏。

## 关联

- 「run-gates 的两个模式在 CLI 上不可达」：同一族的「门禁存在性/可达性」。
BODY

file_issue "文档与依赖清单未覆盖 patent-filing：docs/patent-workbench-tasks.md 仍写「10 个 dsh-patent-*」「12 包」，包计数与磁盘的 16 包不符" \
  "area/patent,kind/doc" <<'BODY'
P2 | 类型：Task | 来源：2026-10-10 三模式技术债扫描（专利域）

## Problem

受控草稿改造（PR #380 系列的「新增 `patent-filing` 包」提交）落进 `packages/patent/patent-filing/` 后，源码文档侧的清单没有跟：

- `docs/patent-workbench-tasks.md:13`（Architecture 段）：「挂载 **10 个** `dsh-patent-*` 插件（`patent-core` 与 `patent-index-asset` 是纯库，经依赖引入，不单独挂载）」；
- `docs/patent-workbench-tasks.md:15`（Tech Stack 段）：「`@deepseek-ai/dsh-patent-*` **12 包**」；
- 磁盘上是 **16** 个包目录（2026-10-10 实测，含 `patent-filing`）。

数字内部也不自洽：16 包 − 2 个纯库 = 14 个可挂载包，而 `:13` 说 10、`:15` 说 12。`patent-filing`、`patent-deadline`、`patent-fees`、`patent-law` 等包在两处都没被计入。

## 复现

```sh
sed -n '13p;15p' docs/patent-workbench-tasks.md
ls -d packages/patent/*/ | wc -l                 # 16
ls -d packages/patent/*/ | sed 's#.*/##'         # 逐包核对
```

## 影响

- 这两行是「专利域有多少个插件」在源码文档里的唯一出处（`docs/patent-workbench-tasks.md` 是 `docs/patent-workbench-plan.md` 的可执行拆解，执行者按它判断阶段范围）。按 12 包规划会漏掉已交付的包。
- 与 `presets/patent.md:9` 的「thirteen further plugins」、`docs/tool-catalog.md` 的 36 个工具共同构成「同一个专利域规模有四套口径」的局面。

## Suggested fix

1. 把 `:13`/`:15` 的包数与实际对齐（按「16 个包目录 = 2 个纯库 + 14 个可挂载」表述，或直接改为「见 `packages/patent/` 与 `presets/patent.patch.yml`」）。
2. 核对 `docs/subsystems/patent.md` 是否同缺 `patent-filing`（**本次未逐段读该文件，属未证实项**，见 `2026-10-10-repo-scan.md` §5）。
3. 顺带把这份清单纳入「preset README 与 patch.yml 对账」的门禁语料，避免再次漂移。

## 关联

- 「patent.md 的装配清单与磁盘不符」：同一次遗漏的两个文档面。
BODY

file_issue "受控草稿的两条渲染通道各写一份表题编号与对象窄化实现：模块注释断言「两通道不可能分叉」，代码里是两份无共享的字面量" \
  "area/patent,kind/techdebt" <<'BODY'
P3 | 类型：Task | 来源：2026-10-10 三模式技术债扫描（专利域 · 异味代码）

## Problem 1：表题编号两份实现，注释断言「同一算法」

`packages/patent/patent-document/src/document/draftConverter/blocks.ts:4-5`：

> 表格表题按调用方传入的计数器全文档连续编号（「表 N · 名称」），**与 docx 通道使用同一算法，两通道表题不可能分叉**。

`packages/patent/patent-filing/src/filing/fromDraft.ts:4-5`：

> 表题「表 N · 名称」与摘要附图号都按草案决定，**两通道成文不可能分叉**。

但两条通道各有一份独立实现，没有共享函数：

- HTML 通道 `blocks.ts:28-33` —— 计数器 `TableCaptionCounter`（`:13-16`），输出 `` `<table><caption>表 ${captionCounter.count} · ${escapeHtmlText(block.name)}</caption>` ``；
- docx 通道 `fromDraft.ts:27-33` —— 计数器 `CaptionCounter`（`:21-24`），输出 `` { kind: 'p', text: `表 ${counter.count} · ${block.name}` } ``。

前缀 `表 `、中缀 ` · `、序号位置都是两处各自写下的一次性字面量。「同一算法」是**人工保证**，不是机械保证：任何一侧被改动（改成「表N」无空格、序号改中文字符、嵌套表格是否自增、转义策略不同）都会让 HTML 与 DOCX 对同一份草案给出不同表题，而现有门禁不会发现。

对照：同族的附图说明编号**是**共享的——`fromDraft.ts:14` 与 `blocks.ts` 侧都从 `@deepseek-ai/dsh-patent-core` 取 `numberedFigureDescriptions`。表题是同一批迁移里唯一没有共享的那一项。

## Problem 2：`obj()` 与 `asJsonRecord` 同义重复

`packages/patent/patent-filing/src/filing/engine.ts:237-243`：

```ts
/** 断言 JSON 值是对象。 */
function obj(value: JsonValue, where: string): Record<string, JsonValue> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PatentFilingError(`${where} 不是 JSON 对象`)
  }
  return value
}
```

`packages/patent/patent-core/src/llm-json.ts:45-49` 已导出同语义的 `asJsonRecord(value)`（返回 `undefined` 而不抛）。`patent-filing` 依赖 `patent-core`（`fromDraft.ts:11-17` 就从它导入），却没有复用它的窄化工具。后果是同一个「JSON 形状不对」的问题在两条路径下分别抛错/回 `undefined`，调用方要写两套处理。

## Problem 3：磁盘 JSON 裸断言成类型

`packages/patent/patent-document/src/document/templateResolver.ts:52-56`：

```ts
const raw = readFileSync(path, 'utf8')
manifestCache = JSON.parse(raw) as TemplateManifest
```

`TemplateManifest`（`:36-40`）的字段全是可选的，因此这个 `as` 把「manifest.json 结构不对」完全推迟到使用点；`resolveTemplate`（`:64-70`）随后以 `manifest.templates ?? []` 消费，最坏情况下错误信息变成「未知模板 "…"（可用: 无）」，而不是「manifest.json 格式错误」。同一仓库里 `patent-law` 的索引走的是「校验失败即抛、消息指出文件与字段」的路子，这里没有。

## 复现

```sh
sed -n '1,10p;12,36p' packages/patent/patent-document/src/document/draftConverter/blocks.ts
sed -n '1,10p;20,34p' packages/patent/patent-filing/src/filing/fromDraft.ts
sed -n '235,244p' packages/patent/patent-filing/src/filing/engine.ts
sed -n '40,50p'   packages/patent/patent-core/src/llm-json.ts
sed -n '36,58p'   packages/patent/patent-document/src/document/templateResolver.ts
```

## Suggested fix

1. 把表题渲染提成 `patent-core` 的一个共享纯函数（`formatTableCaption(index: number, name: string): string`），两条通道都调用它，编号自增仍由各自计数器负责；补一条对位用例断言「同一份 SpecDraft 经两条通道得到的表题序列逐项相等」。
2. `patent-filing` 的 `obj()` 改为复用 `patent-core` 的窄化工具；若需要抛错语义，在 `patent-core` 加 `requireJsonRecord(value, where)` 并让两包共用，不要在包内各写一份。
3. `readTemplateManifest` 改为解析后校验形状（失败即抛，消息含文件路径与出错字段），去掉 `as TemplateManifest`。

## 验收

- 「同一草案两通道同表题」的对位用例在单独改动任一侧的表题字面量时失败。
- `patent-filing` 不再有与 `patent-core` 同义的 JSON 窄化实现。
- `manifest.json` 被替换成非法 JSON 时的报错指向该文件，而不是「未知模板」。

## 关联

- 「专利文书两套模板体系并存」：那条是模板**资产**的并存，本条是渲染**实现**的并存。
BODY

file_issue "以「实测」为据的 preset 断言没有可复算出处：patent.patch.yml:80 对通用 send_message 的结论与 standard 侧逐字相同，两处都写「实测」而无验证记录" \
  "area/infra,kind/doc" <<'BODY'
P3 | 类型：Task | 来源：2026-10-10 三模式技术债扫描（三模式共享面）

## Problem

`packages/bundle/web-app/presets/patent.patch.yml:80` 对模型下了一条硬纪律，理由是「实测」：

> 不要用通用 `send_message`、`wait_agent`、官方 agent-team 的 `team_task_*` / `spawn_teammate` 做团队协调：通用 `send_message` 在本会话会解析到另一套实现（**实测**直接报「active teammate … not found」），消息既不进团队邮箱也不进团队事件日志与看板。

该结论与 `standard.patch.yml` 侧**逐字一致**，两处都标「实测」，但**没有任何地方记录这次实测**（没有日期、没有会话、没有复现步骤、没有对位用例）。

需要核实的点：

- `docs/tool-catalog.md:45` 明确写「The shipped `dsh-base` bundle **keeps the package disabled**」——`send_message` 由 `@deepseek-ai/dsh-experimental-tool-agent-team` 注册，而该包在随包基础组合里是关闭的。若 patent preset 也不启用它，模型目录里就没有 `send_message`，「解析到另一套实现」这件事在随包组合下不可能发生，纪律的理由与现状不符。
- 反之若某条装配路径（用户级 profile patch、桌面端组合）启用了它，则「实测」是真的，但没有写清是哪条路径、哪个版本。

`standard.patch.yml` 侧的同一段是**同一次扫描判为「非分叉」**的两处逐字相同文本——所以这不是「两个 preset 结论不同」，而是「同一个未验证断言被复制到两处」。

## 复现

```sh
sed -n '80p' packages/bundle/web-app/presets/patent.patch.yml
grep -rn "active teammate" packages/bundle/web-app/presets/    # 两处逐字相同
sed -n '45p' docs/tool-catalog.md                              # dsh-base keeps it disabled
grep -rn "experimental-tool-agent-team" packages/bundle/web-app/presets/*.patch.yml
```

> **口径说明（2026-10-10 后续会话已跑）**：上面最后一条命令输出**零命中**；配合 `docs/tool-catalog.md:45`「the shipped `dsh-base` bundle keeps the package disabled」，判定 `@deepseek-ai/dsh-experimental-tool-agent-team` 在随包组合（含 patent / document preset）下**不可达**。本条的形态因此确定为「把 `:80` 的理由改成事实陈述 + 对位用例」，不再保留「若可达则补实测记录」的分支。

## 影响

- 这条纪律是 persona 里的强制项（「协调通道唯一」），它排除了一整组官方工具。理由若站不住，模型会被要求避开一个其实不存在或被错误描述的通道。
- 更普遍地：preset 与 persona 文本里的**经验性断言**（「实测报错」「默认关闭」「需要另行配置」）没有一处记录验证方式。这类断言会随上游同步静默失真——本次扫描已经在 `fetch: false` / `patent.md:77` 上见过两个实例。

## Suggested fix

1. 把 `patent.patch.yml:80` 的理由改成事实陈述：随包 `dsh-base` 保持 `@deepseek-ai/dsh-experimental-tool-agent-team` disabled，因此本组合里没有通用 `send_message`；部署若自行启用该包，则另说。
2. `standard.patch.yml` 侧的同一段逐字文本一并改——两处是同一个断言被复制到两处，一处过期另一处必然同样过期。
3. 补对位用例：断言随包组合未启用该包时，通用 `send_message` 不在模型工具目录里（现状是只有文本断言、没有机械面）。
4. 建立一条轻约定：preset/persona 里的经验性断言要么可复算、要么写明是推断——本次扫描已积累三个反例（`fetch` 两侧取值、`patent.md:77`、本条），够立一条规则。

## 关联

- 「文档模式与自媒体模式关掉 web_fetch」：同族的「preset 文本断言与平台事实脱节」。
BODY

printf '\ndone. rerun this script any time; existing titles are skipped.\n'
