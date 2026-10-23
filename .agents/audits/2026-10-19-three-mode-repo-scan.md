# 2026-10-19 三模式全量扫描：专利模式 / 文档模式 / 专利自媒体模式

- 基线：分支 `fix/patent-rule-hardening`（扫描当日 HEAD），日期 2026-10-19。
- 范围：`packages/patent/`（16 个包目录）、`packages/document/`（5 个包）、三模式 preset 与技能（`packages/bundle/web-app/presets/`、`packages/bundle/web-app/skills/{patent,document}/`）、文档工作室（`packages/client/ui-document-studio`）、专利团队客户端（`packages/client/ui-patent-teams`）、外置自媒体 bundle（`~/.dsh/local-bundles/patent-media/`）。
- 工作树：模式源码与 preset 无本轮改动；工作树中已有的 101 项改动集中在本轮无关的 `self-evolve`、CLI 文档与生成目录，未纳入本报告。
- 归档脚本：`.agents/audits/2026-10-19-file-issues.sh`（8 条 issue 正文，按标题幂等）。

## 门禁基线（本机实跑）

| 命令 | 结果 |
| --- | --- |
| `pnpm run lint` | 0 warnings / 0 errors，7174 文件，90 规则 |
| `pnpm run typecheck` | 5/5 通过（host compiler、Host Typert、host aggregate、client compiler、client aggregate） |
| `npx vitest run packages/patent packages/document` | 365 文件通过 + 1 跳过；5960 用例通过 + 2 跳过 |
| `pnpm run verify-preset-mode-baseline` | 2 个 delivery 模式 / 6 个 preset 通过 |
| `pnpm run verify-preset-tool-refs` | 267 处引用 / 6 个 preset 通过 |
| `pnpm run verify-preset-divergence` | 29 个记录差异 / 118 个 row-set 缺口与 6 个 preset 一致 |
| `pnpm run verify-tech-debt-counters` | 5 个计数与 `docs/TECH_DEBT.md` 一致 |
| `pnpm run report:structure` | 6186 文件（2748 测试、4 生成）；186 个函数 >150 行；76 个非生成源文件 >800 行 |

模式源码规模：`packages/patent` 423 个非测试 `src/*.ts` / 90,562 行；`packages/document` 38 个 / 7,060 行；两者共 366 个 `tests/*.spec.ts`。

## 结论摘要

本轮没有发现新的 P0 运行时崩溃；测试、lint、typecheck 与 preset 门禁全绿。真正的问题集中在三处：

1. **专利交付门禁的「证据」只是工具名**：空文本调用 `rule_check` / `law_verify` 即可满足前置，任意 `patent_workflow_run` manifest 也能满足模板前置（#501）。
2. **模式文档与模型可见描述持续漂移**：工具数 32→33、模板数 11→13 均未同步（#502）；文档 P0 门的描述与实现相反（#503）。
3. **模式外的维护面**：文档工作室以原始路径字符串作身份（#504）；CNIPR 页面等待硬编码（#505）；自媒体 bundle 无版本控制、图像链前置未声明（#506）。

其余两条是门禁完整性与未实现字段：#507 结构门对未知 ruleId fail-open；#508 `citation_analysis.topics` 解析后无消费者。

## 已建 issue

| # | 优先级 | 标题 | 区域 |
| --- | --- | --- | --- |
| [#501](https://github.com/xujian519/deepseek-harness/issues/501) | P1 | 专利交付前置门禁可被空调用满足：rule_check / law_verify 接受空文本，patent_workflow_run 不校验 manifest | 专利模式 |
| [#502](https://github.com/xujian519/deepseek-harness/issues/502) | P2 | 专利模式计数与模型可见描述漂移：preset README 仍写 32 个工具（实际 33），render_patent_document 模板参数仍写十一（实际十三） | 专利模式 / 文档 |
| [#503](https://github.com/xujian519/deepseek-harness/issues/503) | P2 | 文档模式的 P0 质量门是模型自述而非执行点：document_deliver 描述称「P0 全过才允许登记」，实现只告警且未知 id 不提示缺失项 | 文档模式 |
| [#504](https://github.com/xujian519/deepseek-harness/issues/504) | P2 | 文档工作室以原始路径字符串作为交付物身份：绝对/相对拼写产生重复条目，改写后旧机器核验结论不会撤销 | 文档模式 / 客户端 |
| [#505](https://github.com/xujian519/deepseek-harness/issues/505) | P2 | CNIPR 通道的页面等待预算全部硬编码（45/30/20/15 秒、1 秒 ×10×2），patent-data Config 没有出口 | 专利模式 |
| [#506](https://github.com/xujian519/deepseek-harness/issues/506) | P2 | 专利自媒体外置 bundle 无版本控制与 CI 信号，且图像链依赖的 generate_image 只由 desktop-runtime profile 挂载 | 专利自媒体模式 |
| [#507](https://github.com/xujian519/deepseek-harness/issues/507) | P2 | 结构门禁的未知 ruleId 只写日志并忽略：preset 的 PR-OA-007 在规则资产改名后会静默失去执行点 | 专利模式 |
| [#508](https://github.com/xujian519/deepseek-harness/issues/508) | P3 | citation_analysis.topics 解析后无消费者：R2 主题相关性字段只产生加载告警，规则判定忽略它 | 专利模式 |

## 关键证据（逐条）

### #501 交付门禁可被空调用满足

- `packages/patent/patent-rule/src/runtime/delivery-gate.ts:70-111` 的台账只存 `Set<string>` 工具名；`deliveryGateMissing` 只按工具名返回缺口。
- 实跑 `createRuleCheckTool().execute({text:''})` 返回 `{"blocked":false,"scope":"patent","violations":0}`；`createLawVerifyTool().execute({text:''})` 返回 `{"blocked":false,"findings":0,"unrecognized":0}`。两者都不抛错，因而被 `tools/post-execute` 记为成功前置。
- `packages/bundle/web-app/presets/patent.patch.yml:384-406` 的 `deliveryGate` 只写 `requires: [rule_check, law_verify, matter_log_append]` 与 `requires: [patent_workflow_run]`，没有入参或 manifest 约束；`patent_workflow_run` 的 `manifestId` 可由调用方任选（`patent-workflow-run.ts:340-364`）。
- `packages/patent/patent-tools/README.md:145` 已记录 `评估输入` 只报告两次运行是否读了同一文本，不强制与落盘件一致；本轮补上「零字节也能通过」这一具体缺口。

### #502 计数与描述漂移

- `packages/bundle/web-app/presets/patent.md:14` 与 `patent.zh.md:14`：32 个模型工具。
- `packages/patent/patent-tools/tests/registration.spec.ts:9` 与 `docs/tool-catalog.md:51`：33 个（新增 `matter_log_append`）。
- `packages/patent/patent-document/src/tool/render-patent-document.ts:106`：`one of the eleven shipped patent templates`；同文件 `TEMPLATE_IDS` 与 `manifest.json` 均为 13。生成目录 `docs/tool-catalog.md:6238` / `.zh.md:6240` 复制了该描述。
- `docs/patent-mode-design.md:10` 的「当前状态」仍写 9 个模板、13 个技能。

### #503 文档 P0 门

- `packages/document/document-deliver/src/tool.ts:489`：`P0 全过才允许登记`。
- `packages/bundle/web-app/skills/document/document-quality-gate/SKILL.md:11` 与 persona：`P0 不通过不得交付`。
- `packages/document/document-deliver/src/tool.ts:646-660`：只收集 warnings，只有确定性检查的 `block` findings 会拒绝。
- `packages/document/document-deliver/src/registration.ts:123-126`：`missing.length > 0 && present.length > 0` 才报告缺失项；`p0ChecklistWarnings(['写法一'])` 实测只返回未知项，不点名六个缺失项。

### #504 工作室路径身份

- `packages/document/document-deliver/src/tool.ts:480` 允许绝对或工作区相对路径。
- `packages/client/ui-document-studio/src/client/document-deliverables.ts:387-406` 用 `entry.path` 原字符串去重；`augmented` 同样按原字符串匹配。
- `packages/client/ui-document-studio/src/client/workspace-probe.ts:80-82` 的 `samePath` 只去掉开头 `./`。
- 实测 `documentDeliverablesViewDefinition.create().replace(...)`：`out/report.html` 与 `/Users/me/work/out/report.html` 产生两条条目，后者带 `checks`，前者不带。

### #505 CNIPR 预算

- `packages/patent/patent-data/src/cnipr-script.ts:66-78`：登录轮询 1 秒 ×10×2、reload 45 秒、首页 goto 45 秒。
- 同文件其余路径：click 15 秒、结果页 45/30 秒、详情表单 30 秒、结果渲染 20 秒、详情 XHR 20 秒、翻页 30/20 秒。
- `packages/patent/patent-data/src/index.ts:176-184` 的 `Config` 只有 ego 五项、`nuoRequestChannel`、`cniprEnabled`；没有 CNIPR 页面等待出口。
- `CNIPR_SEARCH_PAGE_SIZE` / `CNIPR_SEARCH_MAX_HITS` 有站点账号限制的明确理由，未列为缺陷。

### #506 自媒体 bundle

- `~/.dsh/local-bundles/patent-media/README.md` 自述「不在任何版本控制内——没有历史、没有回滚点」；仓内 `verify-preset-*` 不扫 `~/.dsh/`。
- `skills/patent-media-image-generate/SKILL.md:8` 声明 `generate_image` 由 profile 挂载的 `dsh-image-gen` 注册；`cordis.patch.yml` 没有该行，README 没有 prerequisites；本机只有 `~/.dsh/profiles/desktop-runtime/package.json:15,33` 挂了该 bundle。
- 14 个技能无测试、无快照、无 CI 信号；`ego-browser` / `magick` / `MoneyPrinterTurbo` / `knowledge.db` 同样只在技能正文出现。

### #507 结构门 fail-open

- `packages/patent/patent-rule/src/runtime/structural-gate.ts:105-120`：未知 `ruleIds` 只 push warning，全部缺失时整条 entry 不生效。
- `packages/patent/patent-rule/src/index.ts:381-387`：warnings 只进 `ctx.logger.warn`。
- `packages/bundle/web-app/presets/patent.patch.yml:411-418`：`PR-OA-007` 是 `oa-response` 渲染的唯一 block 级结构门。

### #508 topics

- `packages/patent/patent-rule/src/runtime/RuleLoader.ts:354-359` 解析 `topics` 并告警「尚未实现」。
- `packages/patent/patent-rule/src/runtime/RuleEngine.ts:244-266` 只比较 `article > statute.max`，`topics` 不参与判定。
- 随包规则资产当前无 `topics:` 使用，故无行为回归，属未实现字段/死配置。

## 未立案的观察（有理由）

- **化学识别引擎未移植**：`recognize_chemical_structure` 恒返回 `usable:false`、`checkSmilesValidity` 恒空。已在包 README 的 Known Limitations 与 #353 的归因中记录；本轮不重复立案。
- **文档模式不设交付门**：2026-10-13 已裁决为有意弱于专利模式（`document-deliver` README 已知限制第 2 条）；不重复讨论。
- **PDF/PPTX 无文本读取器**：`document_deliver` 将其标为 `unchecked`，studio 也不伪装为通过；属已记录的覆盖边界。
- **文档工作室 4 个覆盖率豁免**：本轮实测 `StudioView.tsx` 86.75% / `document-deliverables.ts` 86.56% / `file-reads.ts` 87.17% / `index.ts` 0%，四项仍低于 per-file 100%，豁免保留合理；但 `vitest.config.ts` 注释里的 2026-09-28 数字（StudioView 92.15% 等）已过期，建议下次动该包时一并更新。`auto-switch.ts` 与 `workspace-probe.ts` 实测 100%，未被豁免。
- **结构债**：`report:structure` 仍为 186 个 >150 行函数 / 76 个 >800 行源文件，与 `docs/TECH_DEBT.md` 计数一致；专利域最大源文件已从 1684 行降到 1234 行（`generate-patent-figure.ts`），本轮不新立拆分 issue。
- **抑制标记**：`packages/patent` + `packages/document` 的 `src` 内 `@ts-expect-error` / `@ts-ignore` 为 0；307 处 `v8 ignore` 均有理由（`verify-suppression-reasons` 覆盖）。模式源码无真实 TODO/FIXME（命中均为正则文本或 `XXXX` 占位示例）。

## 未跑 / 未证实

- 未跑 `test:coverage`、`test:snapshot`、`test:e2e`、`doc-sync` 全量；本轮以定向测试与静态门禁覆盖扫描面。
- 未做浏览器实机验证：本轮是只读扫描，#504 的 UI 行为由纯函数复现（`documentDeliverablesViewDefinition` 与 `p0ChecklistWarnings`），未启动 Web 应用。
- 自媒体 bundle 是仓外目录，未做真实发布/图像生成端到端；#506 的结论基于 bundle/profile 文件与技能正文。
- `#354`（检索通道旁路）与 `#493`（tool-literature 取消语义）仍是开放 issue，本轮未重复立案。

## 复现命令

```sh
pnpm run lint
pnpm run typecheck
npx vitest run packages/patent packages/document
pnpm run verify-preset-mode-baseline
pnpm run verify-preset-tool-refs
pnpm run verify-preset-divergence
pnpm run verify-tech-debt-counters
pnpm run report:structure -- --top 25
```

`.agents/audits/2026-10-19-file-issues.sh` 可幂等重跑；标题已存在时跳过。
