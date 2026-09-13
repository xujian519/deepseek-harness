# Agent Note: 删除两处死导出，并让文档引用门禁覆盖 `.tsx`

Status: implemented

[English](2026-09-13-dead-exports-and-doc-reference-coverage.md) | 中文

## Problem

台账 L2 记了三处死导出并在 2026-08-28 清扫中修复，issue #93 发现同类仍在。`SessionTitleLlmConfigSchema`（[session-title-llm](../../../../packages/session/session-title-llm/src/index.ts)）把 `SessionTitleLlmConfigFields` 包进 `z.object`，全仓零引用；两个同族标题提供方各自用共享字段表拼装自己的对象，故该包装函数是字段表抽取留下的一件残留。`SESSION_QUERY_SQLITE_PATH_KEY`（[session-query-sqlite](../../../../packages/session-query/session-query-sqlite/src/index.ts)）命名了一个启动期上下文槽位，而它所镜像的 Context 合并键也没有读者：`10bb9cbf4a` 删除了 TUI 与 legacy 入口点，而那里持有唯一的提供方（`hostCtx.provide(SESSION_QUERY_SQLITE_PATH_KEY, queryIndexPath)`）与唯一的消费方（`path: !!js launcherSessionQueryPath ?? './.sessions/session-query.db'`）。该键的 catalog 豁免把文档归属推给了一个从未描述它的包 README。

三处引用指向不存在的路径。`chunks/editor.tsx` 与 `chunks/terminal.tsx` 引用 `docs/plans/2026-08-12-lazy-chunks-design.md`，而这两条注释是本仓库中指向 `docs/plans/` 目录的唯一引用——该目录并不存在。`tests/plugin-shape.spec.ts` 引用 `packages/ui/jsonrpc`，该路径已被 `3fc35c91ff` 改名为 `packages/sdk/server`。

`verify-doc-refs` 抓不到这两处 `.tsx` 引用：其 `PATTERNS` 只覆盖 `packages/**/*.ts`，于是同一编写面的 `.tsx` 一半不受检查。它的取词模式还会匹配任意更长路径中的形如文档的片段，因此只补扩展名会报出两个并不指向仓库文件的夹具路径。

## Decision

- **删除两处导出与其镜像的 Context 键。** 带类型的 Context 字段才是启动方安装的东西，而本仓库没有任何代码提供或读取这一个。`SERVICE_WALK_EXEMPTIONS` 随之去掉该条目，这也是生成器的要求：它会拒绝键不被任何 Context 合并声明的豁免。
- **把两处 chunk 注释指向该设计在包内的归属。** `chunk-loader.ts` 与 `tsdown.config.ts` 持有 chunk 注册表与 `chunkBundle` 构建，包 README 的源码映射同时点出这两者。
- **改为引用为 plugin-shape 守卫提供依据的事后复盘**，替代一个任何门禁都无法解析的包路径。[事后复盘 0001](../../../../docs/postmortem/0001-acp-default-export-drops-inject.zh.md) 记录了为什么一个多余 default 导出会让 Loader 丢弃 `inject`。
- **语料扩到 `packages/**/*.tsx`，并把引用定义为「开出一个路径的记号」**：位于记号起始处的 `docs/…` 或 `.agents/notes/…`，或一条对仓库根解析的 `./`/`../` 链的尾段。延续更长具名路径的记号不在范围内，于是夹具的虚拟路径 `/ws/docs/README.md` 不会进入报告。`apps/` 仍在语料之外：它形如文档的记号只出现在一个合成工具调用画廊的夹具路径里。
- **不新增死导出门禁。**[移除 knip 门禁](../process/2026-08-19-remove-knip.zh.md) 已经裁定本仓库不设全仓静态未使用导出的检查，且未来的检查必须理解 manifest 驱动的 Cordis 加载、生成产物与 Host/Client 分裂。

## Alternatives considered

- **把 Context 键保留为启动期扩展点。** 否决：它承载的值无人读取，故该槽位不可能是可用的契约，而它的 catalog 豁免还声明了一份并不存在的 README 归属。
- **把 `packages/ui/jsonrpc` 重新指向其继任者 `packages/sdk/server`。** 否决：会漂移的正是注释里的裸包路径，而事后复盘陈述了同一条理由且 `verify-doc-refs` 能解析它。
- **改为在包 README 里记录该启动期槽位，而不是删除它。** 否决：该槽位没有读者，记录它等于承诺包并未实现的行为。
- **在同一改动里把语料扩到 `apps/**`。** 否决：`apps/web/tests/clickable-links-gallery.e2e.ts` 把 `docs/press.md` 与 `docs/guide.md` 作为夹具工具参数传入，区分夹具路径与引用需要单独的规则。
- **新增一个只看 `packages/*/*/src` 引用的窄口径死导出检查。** 否决：它会把由生成代码、manifest 与树外插件消费的导出一并报出，而那正是移除 knip 时所放弃的豁免清单。

## Consequences

仓库少了两处公共导出与一个已声明的 Context 键，`session-query-sqlite` 失去了一个没有任何树内代码提供或读取的启动期槽位。`verify-doc-refs` 覆盖 4049 个文件而非 3577，客户端包的 `.tsx` 一半进入门禁。什么算一条引用，写在门禁取词模式的文档里并由 `scripts/verify-doc-refs.spec.ts` 钉住。`apps/` 仍有未受检查的引用，记录在此而不在门禁里。

## Testing

`scripts/verify-doc-refs.spec.ts` 覆盖六条验收路径：语料含 `.tsx` 且仍排除 `vendor/`、`.d.ts` 与构建出的 `lib/` 产物；缺失目标会被报出；`../` 链引用对根解析，其笔记消失后仍会被报出；具名路径分量被跳过；以 `/` 开头的记号仍受检查。在三处引用修复前对仓库运行该门禁，报出的正是那两行 `.tsx`，没有任何夹具路径。`session-title-llm` 与 `session-query-sqlite` 套件通过（88 个用例），`pnpm run typecheck` 通过，lint 在 4490 个文件上报 0 警告 0 错误。`pnpm run verify-cordis-catalog` 报告 105 个生成文件/区域最新；从 `session-query-sqlite` 删除的十行使该包在 `docs/config-catalog.md` 里的 `Source:` 指针由 93 变为 83，再生后的英文目录与其中文孪生都携带该值。

## Related

[移除 knip 门禁](../process/2026-08-19-remove-knip.zh.md) 持有「不存在全仓未使用代码检查」这一决定。
