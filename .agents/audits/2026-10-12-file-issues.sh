#!/usr/bin/env bash
#
# File the 2026-10-12 patent/document mode review as one GitHub issue on the
# fork remote.
#
# Idempotent: an issue whose exact title already exists in any state is skipped,
# so the script can be re-run after a partial failure. Requires `gh` authenticated
# against the target repository.
#
#   bash .agents/audits/2026-10-12-file-issues.sh
#
# The body is a quoted heredoc, so backticks and `$` inside it stay literal.
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

file_issue "专利模式与文档模式的调整取向：模式共同标准、persona 减重、对标清单落地（2026-10-12 评审）" \
  "area/patent,area/document,kind/techdebt" <<'BODY'
P0 | 类型：Task | 来源：2026-10-12 专利模式与文档模式评审（`.agents/audits/2026-10-12-patent-document-mode-review.md`）

## Problem

最近一个月是"高强度收口月"：三模式扫描的 16 条 issue 已全部闭合、四条假绿门禁接进必过车道、受控草稿成为唯一内容通道、第二条检索通道进入 provider。收口方向正确，但**收口之后没有换挡**。剩下的是需要裁决的判断，不是继续清点文档数字。

本条承载四项结构性调整与一条操作性发现。

### 1. 两个模式是同一概念的两个实例，却没有共同标准

| 维度 | 专利模式 | 文档模式 |
|---|---|---|
| 装配行（顶层 / 嵌套） | 27 / 17 = 44 | 19 / 12 = 31 |
| persona 正文 | 16,678 字符（CJK 6,614，约 8.2k tokens） | 2,248 字符（约 1.0k tokens） |
| 随包技能 | 15 个 / 104 KB | 6 个 / 24 KB |
| 领域包 | `packages/patent/` 16 个 | `packages/document/` 5 个 |
| 专利域模型可见工具 | 55 | 0 |
| 交付门 | `deliveryGate`（`patent.patch.yml:353`）：未跑过 `rule_check` + `law_verify` 就**拒绝** `render_patent_document` / `build_patent_filing` | `document_deliver`：模型**自愿**调用的登记 + 核验 |

差异本身合理。问题在三处**看不出是设计还是遗漏**：

- **两个模式都没有 `time-context` 行。** `standard` / `cordis` / `ptc` 有，专利与文档没有，而两者都是日期敏感（专利的期限纪律、文档的页脚日期与来源时效）。`time-context` 的 README 明写它只在 `standard` / `cordis` / `ptc` 声明，且 web patch 的 `personaPrefix` 只声明模型名与语言策略，所以这两个模式的 agent 拿不到当前日期，只能绕道跑 `date`。
- **"输出前强制质量门禁"在两个模式里的执行强度不同。** 专利的门设在"产出交付件"这一步（渲染与成文被拒），文档的门设在"登记交付"这一步——模型不调 `document_deliver` 而直接回复就没有东西阻止它。`document_deliver` 自身是 fail-closed 的（`placeholder` / `anti_pattern` 为 `block`），但它不是 `tools/post-execute` 上的门。
- **挂了 `tool-goal` 却没挂 `command-goal`**（`/goal` 命令入口缺失）；`tool-schedule` 也未挂，而专利的答复期限提醒本可以用它。整行缺失（相对 `standard`，排除 `preset-standard` 自身声明行）：专利缺 `command-goal` / `present` / `time-context` / `tool-plugin-manager` / `tool-plugin-market` / `tool-schedule`；文档另缺 `openviking`。

`preset-divergence-baseline.json` 的 `rowSets` 已记录这些缺失（#385 的处置是"记录"而非"补齐"），但记录只有 id、没有理由。

### 2. 专利 persona 已从"人设"变成"运维手册"

`patent.patch.yml:20-99` 是 16,678 字符的固定前缀，每请求都付。除身份与不可协商的纪律外，其余是操作手册：法条核验流程、cnlaw 的 MCP/REST 端点调用法、图谱与判例的检索式格式、团队派工模板、工作台协作、通道优先级、体例参数（含"4.23 毫米"）。它点名引用了 17 个技能。

- 同等内容放进技能是按需加载的（技能库 104 KB 只在加载时付费），放进 persona 是每请求都付；叠加 55 个专利域工具的 schema，固定前缀压力是叠加的。
- **部署可变项写死在提示里**：cnlaw 端点、通道顺序、图面字号下限。`figureFontMm: 4.25` 已进 `Config`（`patent.patch.yml:319`），persona 又抄了一遍 4.23 毫米。
- **重复维护**：案型路由、交付纪律、通道纪律在 persona 与技能里各有一份。10-10 那轮已见过这类副本失真的实例——`fetch` 两侧取值相反、`patent.md:77` 与代码相反、`patent.patch.yml:80` 的"实测"断言没有可复算出处（三处均已修，根因是"同一事实两处维护"）。
- 方向相反的佐证：`patent-law` 的 README 明写"persona 与专利技能把 cnlaw 声明段作为引用来源，因此随包文本不写端口"，插件侧已在做"声明段 + 引用"，persona 侧仍在写端点细节。

### 3. 09-30 对标清单未落地

| 项 | 内容 | 核查结果 |
|---|---|---|
| P0-1 | 交付物取代链与每轮留档强制力 | 无（`supersedes` 的命中全在无关语境） |
| P0-2 | 问题条目字段化（`kind→disposition`、`blocking` 三档）与轮次上限 | 无（`max_rounds` / `issue_item` 零命中；`docket` 仅 `docs/patent-workbench-plan.md:43` 一句提及） |
| P1-6 | 检索质量度量门（rank-of-first-relevant，BM25 基线） | 无（`nDCG`、"rank of first" 零命中；`patent_eval` 的 `retrieval` 仍是"关键词条数 ≥3 即 1.0"） |
| P1-7 | 语义检索最小闭环 | 无（`patent-knowledge/README.md:86` 仍写 "No vector or semantic retrieval in P1"） |

三项（P0-1 / P0-2 / P1-6）有外部一手证据、落点在既有扩展点，且与这一轮已验证有效的手法同族——把"人工勾选约定"换成"确定性 gate"（`patent_workflow_run` 曾 91 次 offered / 0 次调用，加交付前置门禁后不再是零）。

### 4. 两个模式的验收能力不对等

专利侧有语料观测面（`.dsh/reports/patent-optimization/` 的 `bypass.json` / `errors.json` / `kpi.mjs`），文档侧没有，因此文档模式的任何改动都无法回答"变好了没有"。

### 5. 操作性发现：代码已改，部署未升级

（来源：`#354` 的部署侧核对评论，2026-10-12 晚；评审未复跑打包件比对。）

第二条检索通道的代码已在 `master`，但桌面应用未重新打包：已安装的 `/Applications/DSH Patent.app` 与本地打包产物的 `app.asar` 里，`cnipr-channel` / `cniprEnabled` / `CNIPR_SEARCH` / `EGO_CNIPR` 全部零命中（对照：`dsh-patent-tools` 133 处、`patent_search` 30 处）。核心 bundle 由打包件的 `resources/app.asar/dsh` 提供、不进 profile 存储，因此"装个插件就升级"不可行。#354 第 1 条的语料级验收在重新打包并替换安装件之前不会改善。

## Evidence

```sh
# 规模与缺失行
python3 - <<'EOF'
import re
for f in ['patent','document']:
    p='packages/bundle/web-app/presets/%s.patch.yml'%f
    src=open(p,encoding='utf-8').read()
    m=re.search(r'id: persona(.*?)\n          - id: agent-instructions', src, re.S)
    print(f, 'persona chars=', len(m.group(1)))
EOF
grep -rn "time-context" packages/bundle/web-app/presets/
grep -n "deliveryGate:" packages/bundle/web-app/presets/patent.patch.yml

# 09-30 清单的落地核查
git grep -in supersedes -- packages/patent docs | head
git grep -in "max_rounds\|issue_item" -- packages/patent docs
sed -n '163,170p' packages/patent/patent-tools/src/tool/patent-eval.ts
sed -n '86p' packages/patent/patent-knowledge/README.md

# 工具数（生成表）
sed -n '50,58p' docs/tool-catalog.md
```

## Suggested fix

- [ ] **P0 · 定一份"交付型模式基线"**：把 `time-context`、交付门强度、命令与工具配套（`command-goal` / `tool-schedule`）列为所有交付型模式的必需面；逐行判断 `present` / `tool-plugin-market` / `tool-plugin-manager` 是否该有，并把**有意差异与理由**写进 `preset-divergence-baseline.json`（顺带补上 #322 留下的记录理由）。门禁：注入"删掉某一必需行"的探针必须报出该 id 与缺失的 preset。
- [ ] **P0 · 专利 persona 减重**：目标 12 KB 以内，作业手册段迁入技能或工具描述，persona 只留身份、不可协商的纪律、案型路由；迁完后 `figureFontMm` 这类部署可变项只在 `Config` 有一处权威。门禁：`pnpm run test:snapshot -t "patent"` 对位，确认纪律条目无丢失。
- [ ] **P1 · 落地 09-30 的 P0-1 与 P0-2**：交付物的取代链（`supersedes` 引用 + "未输出留档段视为本轮未完成"的执行点）与案卷问题条目的字段化（`kind→disposition`、`blocking` 三档语义、`max_rounds` 进 `Config` 并由规则或 stage handler 机检）。注意 `blocking` 的粒度：二元 gate 会让每次问人都停摆，需要三档语义。
- [ ] **P1 · 检索质量度量门**：不新建工具，先做纯评测资产（主指标 rank-of-first-relevant，辅以 MRR/nDCG，BM25 作基线），挂在 `benchmarks/` 或 `patent_eval` 旁；先确认数据集下载与使用条款（Patent-CE 为非商用）。
- [ ] **P2 · 文档模式补齐与清单再分诊**：补 `time-context` 与交付门强度，并建立文档模式的观测面；把 09-30 的 12 项重新分诊，明确写出不做哪些及理由。

## 验收

- 模式基线：每条必需行在 `patent` / `document` 两个 preset 里存在（或记录为有意差异 + 理由）。
- persona 减重：`patent.patch.yml` 的 persona 正文 ≤ 12 KB，且纪律条目在快照对位下无丢失。
- P0-1 / P0-2：有反例注入证明门禁会失败（记录注入方式）。
- 检索度量门：能对同一查询集给出 rank-of-first-relevant 与 BM25 基线对比。

## 关联

- `#354`（检索通道旁路，P1）：本条第 5 节是它语料级验收的前置；第二通道代码已在 `master`，缺的是桌面重新打包。
- `#385`（门禁看不到整行缺失）：已闭合，处置为"记录"；本条要求把记录升级为裁决。
- `#322`（跨 preset 一致性门禁）：已闭合，但"给基线每条记录补理由"这一通用做法仍未做，并入本条 P0。
- 09-30 对标清单：`.agents/audits/2026-09-30-patent-domain-external-benchmark.md`。
BODY

printf '\ndone. rerun this script any time; an existing title is skipped.\n'
