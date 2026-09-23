# Issue 分诊与执行计划（#207–#230，2026-09-23）

- 分诊对象：2026-09-23 全仓扫描开出的 24 条 issue（#207–#230，全部 OPEN）。
- 分诊基线：`master` HEAD（2026-09-23），即 09-23 扫描所依据的同一棵树。分诊时 HEAD 未移动（该提交到 HEAD 的距离为 0），24 条 issue 正文引用的行号与实测数字因此全部对应当前代码，没有一条结论来自代码漂移。
- 关联文档：审阅报告 [`.agents/audits/2026-09-23-repo-scan.md`](2026-09-23-repo-scan.md)；台账 `docs/TECH_DEBT.md` 的 2026-09-23 节。
- 本文用途：记录**哪些值得修、按什么批次修、每批如何验证**，以及三条经实测修正的 issue 框定。执行时按批推进，每批完成后回写本文件的「执行状态」列。

## 1. 结论

- **真缺陷 6 条**（会产生错结论、资源耗尽或失败）：#207、#210、#212、#218、#227、#230。
- **门禁盲区与可配置性 12 条**：盲区 #208、#209、#222、#223、#224；可配置性 #211、#217、#225；文档与门禁 #228、#221；契约与配置瑕疵 #229；重复收敛 #220。
- **结构债 2 条**：#219、#226。
- 分诊与扫描报告给出的 P1/P2/P3 有一处实质分歧：#208（P1）的**完整**修法是把 12 包 298 个 src 文件修到逐文件 100%，不是一批能完成的量；建议只做便宜的那一半（家族 glob 换成按包登记 + 到期条件）。
- 唯一影响判定结论的正确性问题只有 #207，其余 5 条真缺陷的影响面是本地失败、静默丢弃、资源无界与文档失真。
- 三条 issue 框定经实测需要收窄或撤销，见 §5：**#230 的复现条件、#217 的「无调用方」、#220 子项 1 已在 PR #195 撤回**。

## 2. 立即执行（真缺陷与低风险清理）

| Issue | 性质 | 复核证据 | 成本 | 风险 | 执行状态 |
|---|---|---|---|---|---|
| #230 | 生产缺陷 | 三处 `open(..., "w")` 未指定编码（`freecad-structure-script.ts:377,406,427`），`:428` 以 `ensure_ascii=False` 写中文 manifest | 3 行 | 无（输出不变） | 待做 |
| #227 | 资源耗尽 | `docx-kit/src` 内 `maxOutputLength\|maxEntries\|maxUncompressed` **零命中**；唯一解压点 `zip.ts:333`；可达链 `document-deliver/src/tool.ts:36,241`（4 MiB 上限）→ `extractDocxText` → `readZip` | 中 | 低（CRC 换实现需逐值对拍） | 待做 |
| #207 | 正确性分叉 | 两侧正则对拍实测分歧，见 §6 | 中 | 中（改动新颖性判定输入，须附快照） | 待做 |
| #212 | 语义与文档相反 | `merge.ts:19-21` 注释称「把单值转为数组」，实现返回 `[]`；`:35-41` 的 incoming 侧却包装 | 小 | 低（需先选语义） | 待做 |
| #210 | 装载期校验缺 2/9 | `event-types.ts` 声明 9 类，`invariant.ts:112-130` 只有 7 个 case | 小-中 | 低 | 待做 |
| #214 | 注释与事实相反 | `service.ts:858` 理由称载荷恒带 `assignee/attempt/attemptId`，该载荷里根本没有后两个字段 | 小 | 低 | 待做 |
| #213 | 死代码与失效豁免 | 两份 YAML sha 相同（`1f2d9e4c…`）；候选一指向不存在的 `packages/patent/assets/`；两条 `v8 ignore` 理由相反 | 小 | 低 | 待做 |
| #218 | 缓存吞 override | 缓存判断先于路径解析；**生产无调用方传 `overridePath`**，仅 `tests/ipc-standards-loader.spec.ts:16,21` 传 | 小 | 低 | 待做 |
| #215 | 同包双份 | `assertRendered` 两份（`generate-structure-figure.ts:169`、`generate-patent-figure.ts:818`） | 小 | 低（错误文案须逐字不变） | 待做 |
| #216 | 跨包双份 | PDF 三检常量与 `datePartOf` 两处；`paper-download.ts:81,106` 为**裸标记**（无理由文本） | 小-中 | 低（文案须逐字不变） | 待做 |
| #220 子项 2 | 机械重复 | `asset-location.ts` 五份（专利 3 + 文档 2） | 小 | 低（导出名与返回值不变） | 待做 |
| #228 | 文档失真 + 门禁盲区 | `packages/README.md:60` 与 `:66` 两行 `document/`；`verify-group-readme-packages` 只查单向 | 极小 | 无 | 待做 |
| #221 | 仓库治理 | 34 个标签中有 `area/patent` 无 `area/document` | 极小 | 无 | 待做 |
| #229 子项 1/4/5/7/9 | 契约与配置 | `store.ts:245` 字典序比较；`locales.ts:29,55` 硬编码 4 MiB；`checks.ts:76` 的容差与两份 skill 文案重复 | 小 | 低 | 待做 |

## 3. 需先定口径（决策点）

| Issue | 决策点 | 建议 |
|---|---|---|
| #222 | fork 要不要性能门禁 | 既不发版也不追性能就**改口**：`docs/testing.md:13`、`docs/testing.zh.md:13`、`benchmarks/AGENTS.md` 与该 Agent Note 同步，并让 `scripts/ci-workflow.spec.ts:1200-1214` 不再对归档副本断言。要接线则复用 `workflows-disabled/ci.yml:193-237` |
| #223 | 27 个 built-* 套件要不要在 PR 上真跑 | 先做便宜的：跳过改 `::warning::` 让它在日志里可见；把 `pnpm run build` 挪进 vitest 车道是真正的修法，代价是 CI 时间 |
| #208 | 覆盖率盲区修到哪一步 | 只把 `vitest.config.ts:230` 的家族 glob 换成 12 条按包登记 + 到期条件；补测列长期 backlog |
| #209 | 单侧 `jscpd:ignore` 是否算缺陷 | 扫描报告已修正：单侧是全仓通行约定。只做无争议部分——补裸标记理由 + 一条「注入 30-token 克隆必须失败」的负例测试 |
| #211 / #225 / #217 | 哪些常量进 `Config` | #211 理由最强（慢机器上 FreeCAD 冷启动可远超 120s）。#225 的 11 组里只提升真正随部署变化者（`MAX_CONCURRENT_VERIFIERS`、`MAX_BUFFER_BYTES`、openviking 检索上限/TTL），其余写成「固定且为何固定」。#217 按 §5 收窄 |
| #212 | `merge` 语义选哪个 | 选「包装为 `[existing]`」与 `union` 的 incoming 侧对称；选「丢弃」则必须补断言与注释 |

## 4. 不排期

- **#219**（拆分 `generate-patent-figure.ts` 1683 行、`service.ts` 1387、`validate-specification.ts` 948、`state.ts` 913、`evidence/engine.ts` 876）：仓库先例（已关闭的 #86）是「能说出切割换来什么才动」。当前五个文件没有「某测试变得可行／某接口变得显式」的证成，只保留清单。
- **#226**（`terminal-bash` 发送生命周期收敛）：8 个 per-send 字段的取消／就绪交互只能靠 pinned 测试判对错，改错是静默的「已取消仍写入」。只做第 3 项——把「保留 marker + 轮询为权威」写成 README 契约；前两项等 reproducer 或真实缺陷驱动。
- **#229 子项 2/3/6/8/10**：按需处理。
- **#220 子项 1**（`isOptionalString` 去重）：**不重做**，理由见 §5。

## 5. 经实测修正的三处框定

**(1) #230 的复现条件比正文窄。** 本机 CPython 3.11／3.14 实测：`LANG=C LC_ALL=C`、甚至完全不设 `LANG/LC_ALL`，`locale.getpreferredencoding()` 都返回 `utf-8`（PEP 540 UTF-8 模式在 C/POSIX locale 下默认开启），写中文 manifest **通过**。只在关掉该模式时复现：`PYTHONUTF8=0 LANG=C` 下首选编码变为 `US-ASCII`，抛出的正是正文所述的 `UnicodeEncodeError: 'ascii' codec can't encode character '\u56fe'`（失败点同为 `json.dump` 的写入）。故缺陷机制成立、修法成立（三处补 `encoding="utf-8"`），但「非 UTF-8 locale 下必失败」不成立；FreeCAD 自带解释器的版本与构建方式未知（本机无 `freecadcmd`，该 spec 自带 `hasFreeCad` 跳过，无法端到端验证）。

**(2) #217 的「生产路径无调用方设置 `opts.timeoutMs`」不准确。** `paper_download` 的 `timeoutMs` 是**模型可设的工具输入**（`paper-download.ts:209`，`?? DEFAULT_TIMEOUT_MS`）；真正无任何出口的是重试预算与缓存 TTL。顺带发现正文未抓到的一处不一致：工具描述写 `default 60000`，而 `runtime/http.ts:70` 的 `DEFAULT_TIMEOUT_MS` 是 `30_000`，两处一并处理。

**(3) #220 子项 1 不要照做。** 修它的 PR #195 往复三轮：抽出 `guards.ts` 会让 `patent-teams` 的双入口（`.` 与 `./invariant`）产生内容哈希 chunk，撞 `verify-built-package-invariants`；第二条评论虽证明「声明 `lib/guards-*.js` glob 即可」，但最终**撤回了 chunk 发布路线**（`package.json` 的 `files` 与 `check-workspace-constraints` 表均未改，`src/guards.ts` 在 HEAD 不存在）。重复的守卫是发布面取舍下的产物，不是疏漏；除非接受改发布文件清单，否则不做。

## 6. #207 的对拍实测（决定性证据）

```
输入                     novelty 侧           规格校验侧           结论
温度 20℃ 至 90℃          不识别为区间          识别为区间           分歧
重量比 50-80            识别为区间            完全不识别           分歧
20到90℃                识别为区间            不识别（缺「到」）    分歧
温度 25°c               单位归一含 °c         单位表不含 °c        分歧
20~90℃                 识别为区间            识别为区间           一致
5至10mm                 识别为区间            识别为区间           一致
```

「20℃ 至 90℃」是中文专利里极常见的写法，因此该分叉会实际改变新颖性图节点的数值结论。修复须附 `pnpm run test:snapshot -t patent`。

## 7. 执行批次与验证矩阵

| 批次 | 内容 | 验证 |
|---|---|---|
| 批 1 | #230（3 行）+ #221（新增标签）+ #228（删重复行 + 门禁双向校验） | `pnpm run test:docs`；#228 给 `verify-group-readme-packages` 补「注入重复行必失败」的负例 |
| 批 2 | #207（共享数值词表 + 对拍用例） | 新增用例须在修复前失败；追加 `pnpm run test:snapshot -t patent` |
| 批 3 | #227（`readZip` 预算经 `Config` + CRC 换 `node:zlib.crc32`） | 「超限被拒」与「恰好等于上限」两条用例；CRC 新实现与原实现逐值对拍 |
| 批 4 | #210 + #214（同包同面）+ #212 | 畸形 `task-validated`／`task-gated` 载荷必须被装载期校验拒绝 |
| 批 5 | #213 + #218（同文件）+ #215 + #216 + #220 子项 2 | 错误文案逐字不变；`pnpm run duplication` 归零 |
| 批 6 | #222／#223／#208／#209 的口径落地（含 #209 裸标记与负例测试） | `ci-workflow.spec.ts` 不再对归档副本断言 |
| 批 7 | #211／#217／#225 的 `Config` 出口（只做真随部署变化者） | 默认值不变；再生 `docs/config-catalog.md` |
| 批 8（仅文档） | #229 子项 9（串行理由成文）+ #226 第 3 项（补偿语义成文） | `pnpm run test:docs` |

任何改变模型可见输出的批次追加 `pnpm run test:snapshot -t patent`；改 `Config` 的批次再生 `docs/config-catalog.md`。

## 8. 分诊本次实跑的核对项（供后续读者省掉重跑）

- `git log -1` 与「issue 基线提交是否为 HEAD 祖先」的检查：HEAD 未移动，各 issue 的行号与实测数字对应当前代码。
- 两处正则对拍（§6）与 CRC-32 基准：逐位实现 **35.8 ms/MiB**（1 MiB 缓冲），`node:zlib.crc32` 在本仓 Node 上 `typeof === 'function'`。
- `LANG=C`／`PYTHONUTF8=0` 两个变体复现 #230（§5）。
- CI 结构：`ci-fork.yml` 共 4 个 job（`node-checks`、`node-hygiene`、`node-coverage`、`python keyless`），无 benchmark；vitest 车道只建 native addon。
- `built-*` 自跳过套件计数 **27**（与 #223 一致）。
- `vitest.config.ts:230` 确认位于 coverage 的 `exclude`；`packages/document` 不在其中。

## 9. 未证实项

1. #230 未在真实 FreeCAD 解释器下复现（本机无 `freecadcmd`）；本机复现依赖 `PYTHONUTF8=0`。
2. #227 的最坏分配量由压缩比决定，未在真实 Host 上触发 OOM。
3. #222 的修法二选一需维护者决定，本文件不预判 fork 是否**应**承担性能门禁。
