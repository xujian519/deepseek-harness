#!/usr/bin/env bash
#
# File the 2026-10-19 three-mode scan findings (patent mode / document mode /
# patent self-media mode) as GitHub issues on the fork remote.
#
# Idempotent: an issue whose exact title already exists in any state is skipped,
# so the script can be re-run after a partial failure. Requires `gh` authenticated
# against the target repository.
#
#   bash .agents/audits/2026-10-19-file-issues.sh
#
# The bodies are quoted heredocs, so backticks and `$` inside them stay literal.
set -euo pipefail

REPO=xujian519/dsh-patent

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

file_issue "专利交付前置门禁可被空调用满足：rule_check / law_verify 接受空文本，patent_workflow_run 不校验 manifest" \
  "area/patent,kind/bug-fix" <<'BODY'
P1 | 类型：Task | 来源：2026-10-19 三模式全量扫描（专利模式）

## Problem

专利模式的交付前置门禁只记录「某个工具在本会话成功返回过」，不记录它读了什么。`rule_check` 与 `law_verify` 都接受空文本并返回成功，因此模型可以空调用两条前置闸门，随后 `render_patent_document` / `build_patent_filing` 仍被放行。`patent_workflow_run` 也只记录工具名，不记录 `manifestId`，任意 manifest 都能满足 OA 答复等模板的前置。

## Evidence

- `packages/patent/patent-rule/src/runtime/delivery-gate.ts:70-111`：`DeliveryAttemptLedger` 只存 `Set<string>` 工具名；`deliveryGateMissing` 只按工具名判定，不读入参或结果。
- `packages/patent/patent-tools/src/tool/rule-check.ts:263-285`：空文本不报错，返回 `blocked:false`。实测 `createRuleCheckTool().execute({text:''})` → `{"blocked":false,"scope":"patent","violations":0}`。
- `packages/patent/patent-law/src/tool/law-verify.ts:208-220`：`text:''` 时 findings 为空，且 `args.text !== undefined` 使 `no_input` 分支不触发。实测返回 `{"blocked":false,"findings":0,"unrecognized":0}`。
- `packages/patent/patent-tools/src/tool/patent-workflow-run.ts:340-364`：`manifestId` 可由调用方任选，结果带 `manifestId`；`packages/bundle/web-app/presets/patent.patch.yml:384-406` 的 `deliveryGate` 只写 `requires: [patent_workflow_run]`，没有 `whenArgs` 或结果比较。
- `packages/patent/patent-tools/README.md:145` 已承认 `评估输入` 只报告两次运行是否读了同一文本，不强制与落盘件一致。

## Impact

- persona 承诺的「交付前必须跑过规则与法条闸门」在调用记录上可以被空调用满足，交付件仍会落盘。
- 任意 manifest 的成功记录可冒充 OA 答复所需的 `patent_oa_response_v1` 收口；结构门 `PR-OA-007` 只覆盖 `draft` 的 26.3 判准，不补这个缺口。
- 这不是「文本不同」的已知限制，而是「零字节也能通过」的新缺口。

## Suggested fix

1. `rule_check` / `law_verify` 拒绝空白文本；`law_verify` 至少要求一条可识别的引用（或明确返回 `no_input`），并把「没有引用可查」当作未满足前置。
2. 门禁台账记录证据身份：`evaluated` 摘要、`scope`、`manifestId`、案卷键；交付时与本次 `draft` / 模板要求的 scope、manifest 比较，不一致即拒绝。
3. 为三个前置工具各补负例：空文本、无关文本、错误 manifest 均不能满足门禁。

## Acceptance

- 空 `rule_check` / `law_verify` 调用不能作为交付前置证据。
- `render_patent_document(template=oa-response)` 只接受 `patent_oa_response_v1` 的收口记录。
- 新增门禁单测覆盖上述负例。
BODY

file_issue "专利模式计数与模型可见描述漂移：preset README 仍写 32 个工具（实际 33），render_patent_document 模板参数仍写十一（实际十三）" \
  "area/patent,area/docs,kind/doc" <<'BODY'
P2 | 类型：Task | 来源：2026-10-19 三模式全量扫描（专利模式）

## Problem

专利域新增工具与模板后，多处计数和模型可见描述没有同步，且现有门禁抓不到：

- `packages/bundle/web-app/presets/patent.md:14` 与 `patent.zh.md:14` 仍写 **32** 个模型工具；`packages/patent/patent-tools/tests/registration.spec.ts:9` 的清单和 `docs/tool-catalog.md:51` 都是 **33** 个（新增 `matter_log_append`）。
- `packages/patent/patent-document/src/tool/render-patent-document.ts:106` 的模型可见参数描述写「one of the **eleven** shipped patent templates」，而同一工具的 `TEMPLATE_IDS`（`:19-31`）、`assets/templates/patent/manifest.json` 和 README 均为 **13** 个；生成目录 `docs/tool-catalog.md:6238` 与 `.zh.md:6240` 复制了这句错误描述。
- `docs/patent-mode-design.md:10` 的「当前状态」仍写 **9** 个场景模板与 13 个技能，和当前 13 个模板、15 个 preset 技能不一致（历史设计文档，但标题是「当前状态」）。

## Impact

- 模型从 `render_patent_document` 的参数描述得到错误的模板数量；用户从 preset README 得到错误的工具数量。
- 这类计数已多次回退（#327、#388、#393），目前仍靠人工发现。

## Suggested fix

- 修正上述三处（含中英双语与生成目录的源头）。
- 增加机械校验：从 `TEMPLATE_IDS` 与工具注册清单派生计数，断言 preset README / 工具参数描述 / 生成目录一致；至少把 `render_patent_document` 的参数描述纳入 `verify-preset-tool-refs` 或独立的小门禁。

## Acceptance

- preset README、参数描述、`docs/tool-catalog.md` 三处计数一致。
- 注入一处错误计数时，新门禁失败。
BODY

file_issue "文档模式的 P0 质量门是模型自述而非执行点：document_deliver 描述称「P0 全过才允许登记」，实现只告警且未知 id 不提示缺失项" \
  "area/document,kind/techdebt" <<'BODY'
P2 | 类型：Decision | 来源：2026-10-19 三模式全量扫描（文档模式）

## Problem

文档模式的 P0 质量门同时存在三种口径：

- `packages/document/document-deliver/src/tool.ts:489` 的参数描述：`质量门结果：P0 全过才允许登记`。
- `packages/bundle/web-app/skills/document/document-quality-gate/SKILL.md:11` 与 persona：`P0 全过才允许交付`、`P0 不通过不得交付`。
- `packages/document/document-deliver/src/tool.ts:646-660` 的实现：只把 `p0ChecklistWarnings(spec.gate.p0)` 收集为 warnings，只有确定性检查的 `block` 级 findings 会拒绝登记；P0 缺项从不拒绝。
- `packages/document/document-deliver/src/registration.ts:123-126` 只在 `missing.length > 0 && present.length > 0` 时报告缺失项；当调用只传未知 id（如 `['写法一']`）时，只报「未知的 P0 项」，不再点名六个缺失项。实测 `p0ChecklistWarnings(['写法一'])` 只返回未知项，`p0ChecklistWarnings(['P0-1'])` 才返回五项缺失。

工具 README 已明确 P0/P1 是模型自述、工具只并列报告 findings，因此这是**描述与实现不一致**，不是单纯缺测试。

## Impact

- 模型可以传任意非空 `p0` 字符串完成登记；studio 会显示「已声明 P0」徽标，读者可能理解为机器核验通过。
- 与 persona 的「P0 不通过不得交付」冲突；在真实交付中无法靠登记结果区分「六项都过」和「只报了一项」。

## Decision / Suggested fix

二选一，并让三处一致：

1. **执行点**：`document_deliver` 要求六个稳定 id 全部出现且无未知项，否则拒绝登记；补正负例与快照。
2. **明确为自述**：删除「P0 全过才允许登记」的参数描述，统一改成「P0 是声明，机器只核验可判定项」；studio 徽标与 README 使用同一措辞。无论选哪条，都应让 `p0ChecklistWarnings` 在「没有已知 id」时也点名全部缺失项。

## Acceptance

- 参数描述、技能/persona、工具实现三处口径一致。
- 有测试钉住 `p0: ['写法一']` 的结果（要么拒绝，要么同时报告未知项与六个缺失项）。
BODY

file_issue "文档工作室以原始路径字符串作为交付物身份：绝对/相对拼写产生重复条目，改写后旧机器核验结论不会撤销" \
  "area/client,area/document,kind/bug-fix" <<'BODY'
P2 | 类型：Bug | 来源：2026-10-19 三模式全量扫描（文档模式）

## Problem

`document_deliver` 允许 `path` 是「工作区相对路径（或绝对路径）」（`packages/document/document-deliver/src/tool.ts:480`），但工作室把原始字符串直接当作交付物身份：

- `packages/client/ui-document-studio/src/client/document-deliverables.ts:387-406` 的 `producedFromTimeline` 用 `seen.get(entry.path)` 去重，`augmented` 也按同一字符串匹配。
- `mutationPath` / `pathValue` 保留调用方写的原始拼写；`workspace-probe.ts:80-82` 的 `samePath` 只去掉开头的 `./`。
- 因此「`out/report.html` 写入 + `/Users/.../out/report.html` 登记」会显示成两条；后续相对路径改写也不会撤销绝对路径条目上的旧 `checks` 结论。

实测（`documentDeliverablesViewDefinition.create().replace`）：

```json
[{"seq":1,"path":"out/report.html"},{"seq":2,"path":"/Users/me/work/out/report.html","format":"html","gate":{"p0":["P0-1"],"p1":[]},"checks":{"status":"checked","findings":[]}}]
```

同一问题也影响 `unreadable_ack` 的按路径匹配（`registration.ts` 的 `ackByPath`）与空态探测的已知路径比较。

## Impact

- 工作室列表出现同一文件的两行，其中一行没有 gate/checks，用户无法判断哪条是当前版本。
- 旧机器核验结论在文件被改写后仍挂在另一个拼写的条目上，stale-verdict 逻辑失效。
- 选择、预览、打印动作可能指向不同条目，状态不一致。

## Suggested fix

- 用「会话 cwd 解析后的规范路径」作为身份键（显示仍保留原始路径）；`producedFromTimeline`、`augmented`、`checks` 查找、`unreadable_ack`、`samePath` 全部走同一 normalize。
- 补一条回归用例：相对路径写入 + 绝对路径登记（以及反向）只产生一行，后续改写撤销旧核验。

## Acceptance

- 同一文件的不同拼写只产生一个交付物条目。
- 改写后旧 `checks` 被撤销，studio 显示「文件已变化，未重新核验」。
BODY

file_issue "CNIPR 通道的页面等待预算全部硬编码（45/30/20/15 秒、1 秒 ×10×2），patent-data Config 没有出口" \
  "area/patent,kind/techdebt" <<'BODY'
P2 | 类型：Task | 来源：2026-10-19 三模式全量扫描（专利模式）

## Problem

`patent-data` 的 ego 预算已收进 `Config`（`commandName` / `probeTimeoutMs` / `defaultTimeoutMs` / `maxTimeoutMs` / `maxOutputBytes`），但 CNIPR 通道的浏览器页面等待仍全部写死在生成脚本里：

- `packages/patent/patent-data/src/cnipr-script.ts:66-78`：登录轮询 1 秒 × 10 次 × 2 轮，reload 45 秒，首页 goto 45 秒。
- 同文件检索/详情/法律状态路径：click 15 秒、结果页 45/30 秒、详情表单 30 秒、结果渲染 20 秒、详情 XHR 20 秒、翻页 30/20 秒。
- `packages/patent/patent-data/src/index.ts:176-184` 的 `Config` 只有 ego 五项、`nuoRequestChannel` 与 `cniprEnabled`；`createCniprChannel` 的 `timeoutMs` 只包住整个脚本，无法调整单步等待。
- 对照：`CNIPR_SEARCH_PAGE_SIZE` / `CNIPR_SEARCH_MAX_HITS` 有站点账号限制的明确理由，属可保留的固定值；上面这些是网络/部署差异，不是协议常量。

## Impact

- CNIPR 慢、登录态刷新或页面改版时，只能改代码重新发布；部署无法按环境调大/调小等待。
- 与 AGENTS.md「no hardcoded tunables in plugins」冲突；此前 #317 只收了 ego 预算，本轮扫到 CNIPR 这一面。

## Suggested fix

- 增加一组 validated `Config` 字段（例如 `cniprLoginPollMs` / `cniprLoginRounds` / `cniprNavigationTimeoutMs` / `cniprResultTimeoutMs` / `cniprDetailTimeoutMs`），带默认值与范围校验；生成脚本从配置注入。
- 若某一项确属站点协议常量，在 README 与代码注释写明理由，并加入「不配置」清单。
- 补一条非默认配置的生成脚本断言。

## Acceptance

- 所有非协议页面等待都能从 `Config` 调整。
- 默认值行为不变，新增非默认值用例。
BODY

file_issue "专利自媒体外置 bundle 无版本控制与 CI 信号，且图像链依赖的 generate_image 只由 desktop-runtime profile 挂载" \
  "area/patent,area/infra,kind/techdebt" <<'BODY'
P2 | 类型：Task | 来源：2026-10-19 三模式全量扫描（专利自媒体模式）

## Problem

专利自媒体模式位于 `~/.dsh/local-bundles/patent-media/`，是一个**不受版本控制**的派生物（`README.md` 自己写明「没有历史、没有回滚点」）：

- 仓内 `verify-preset-*` / `doc-sync` / 快照门禁都扫不到 `~/.dsh/`；行集漂移只能靠 README 里的手工 diff 命令。
- bundle 内 14 个技能无单元测试、无快照、无 CI 信号；`package.json` 只是 `dsh.bundle.patch` 指针。
- `skills/patent-media-image-generate/SKILL.md:8` 声明 `generate_image` 由「profile 挂载的 `dsh-image-gen` bundle 注册」，但 `cordis.patch.yml` 没有该行，`README.md` 也没有前置条件段；本机只有 `~/.dsh/profiles/desktop-runtime/package.json:15,33` 挂了 `dsh-image-gen`。换 profile 或换机器时图像链直接缺失。
- 其余技能依赖的 `ego-browser`、`magick`、`MoneyPrinterTurbo`、`knowledge.db` 同样只写在技能正文里，没有统一的 prerequisites/自检。

## Impact

- 媒体模式的「可执行出口」取决于本机 profile，无法从 bundle 自身判断是否可用。
- 任何技能/行集改动都没有回滚点或自动检查；这与仓内三个 preset 的基线门禁形成明显不对称。

## Suggested fix

- 将 bundle 移入 git 跟踪的路径（或独立仓库），至少给它一个可回滚的提交历史。
- 在 bundle `README.md` 增加 Prerequisites 段，逐项列出 `dsh-image-gen` / `ego-browser` / `magick` / `MoneyPrinterTurbo` / `knowledge.db` 及缺失时的降级行为。
- 在 `cordis.patch.yml` 里显式声明图像工具行（或写明「由 profile 提供」并在启动时校验），并加一个最小的组合/技能引用测试。
- 把行集与 `standard.patch.yml` 的对比从手工命令变成可执行检查（即使只在仓外脚本里）。

## Acceptance

- bundle 有版本控制与至少一个自动检查。
- README 的 prerequisites 与实际 profile 需求一致；缺失 `dsh-image-gen` 时技能给出明确失败而不是静默找不到工具。
BODY

file_issue "结构门禁的未知 ruleId 只写日志并忽略：preset 的 PR-OA-007 在规则资产改名后会静默失去执行点" \
  "area/patent,kind/bug-fix" <<'BODY'
P2 | 类型：Bug | 来源：2026-10-19 三模式全量扫描（专利模式）

## Problem

`patent-rule` 的制品结构门禁在加载时把声明的 `ruleIds` 换成规则集里的规则；找不到的 id 只 push 一条 warning，随后该条被剔除：

- `packages/patent/patent-rule/src/runtime/structural-gate.ts:105-120`：`规则集内不存在规则 ${id}，该条已忽略`；若所有 id 都缺失，整条 entry 不生效。
- `packages/patent/patent-rule/src/index.ts:381-387`：这些 warnings 只经 `ctx.logger.warn` 打印，不阻止插件加载，也不进入模型可见文本。
- `packages/bundle/web-app/presets/patent.patch.yml:411-418` 声明了 `PR-OA-007` 作为 `render_patent_document(template=oa-response)` 的唯一 block 级结构门。

即：规则资产一旦改名/漏带，OA 答复的 26.3 判准门禁会**静默变成 no-op**，只有翻日志才能发现。这与 AGENTS.md「Misconfiguration fails loud at load when self-contained」冲突；规则 id 与规则资产都在同一部署内，属自包含配置错误。

## Impact

- 交付前的最后一道确定性格结构门可能失效，而模型和用户都看不到。
- 现有测试只断言 warning 文本（`structural-gate.spec.ts:110-111,339`），没有断言「声明了 block 级规则却缺失时加载失败」。

## Suggested fix

- 对 `ruleIds` 中声明的每一个 id：缺失即抛 `PatentRuleAssetError`（至少对 `action: block` 的声明），或让 preset 加载失败并在 `dsh` 启动时可见。
- 若保留 fail-open，必须在模型可见的 preset/README 中写明，并让门禁在调用时返回可见的降级提示；不能只进 logger。
- 补负例：删除/改名 `PR-OA-007` 后，plugin 加载或首次门禁调用必须失败。

## Acceptance

- 结构门声明的 ruleId 缺失不会被静默忽略。
- 负例覆盖「规则资产改名」场景。
BODY

file_issue "citation_analysis.topics 解析后无消费者：R2 主题相关性字段只产生加载告警，规则判定忽略它" \
  "area/patent,kind/cleanup" <<'BODY'
P3 | 类型：Task | 来源：2026-10-19 三模式全量扫描（专利模式）

## Problem

`citation_analysis` 的 `topics` 字段被完整解析并放进 `RuleCheck`，但判定函数从不读取它：

- `packages/patent/patent-rule/src/runtime/RuleLoader.ts:354-359` 解析 `topics`，同时写一条「R2 主题相关性尚未实现，该字段不影响判定」的加载告警。
- `packages/patent/patent-rule/src/runtime/RuleEngine.ts:244-266` 的 `checkCitationAnalysis` 只比较 `article > statute.max`，`topics` 未参与任何分支。
- 随包规则资产（`rg 'topics:' packages/patent/patent-rule/assets/rules`）目前没有使用该字段，所以当前没有行为回归；但它是一个已声明、已类型化、会进加载告警的未实现能力。

## Impact

- 规则作者会以为写了 `topics` 就能做主题相关性判定，实际被静默忽略（只有加载日志）。
- 类型与文档保留一个不工作的字段，增加后续实现的误导成本。

## Suggested fix

二选一：

1. 实现 R2：在 `checkCitationAnalysis` 中按 `topics[article]` 检查命题/文本词项，补正负例与文档。
2. 删除：从 `patent-core` 的 `CitationAnalysisCheck` 类型、`RuleLoader` 解析与 README 中移除 `topics`，让「不支持」成为显式失败而不是告警后忽略。

## Acceptance

- 字段要么有消费路径与测试，要么从类型/加载器/文档中消失。
BODY
