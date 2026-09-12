# Agent Note: 组 README 包表与目录对齐的门禁

Status: implemented

[English](2026-09-12-group-readme-package-gate.md) | 中文

## Problem

十个组的 README 列出的包比其目录实际持有的少 16 个,两种语言都是如此:`client/` 少七个(`synapse`、`ui-dockkit`、`ui-document-studio`、`ui-patent-teams`、`ui-plugin-market`、`ui-sidebar-documentpreview`、`ui-sidebar-right`),`util/` 少两个(`contained-emit`、`value`),而 `api/`、`bundle/`、`core/`、`host/`、`session/`、`test-support/`、`web/` 各少一个。这 16 个包都已经有自己的包 README,因此这是漏列,而不是尚未成包。

[根组表](../../../../packages/README.zh.md)此前已被一轮工作补齐并纳入门禁,但 `packages/<group>/README.md` 下的组内包表没有任何门禁:`hygiene` 的各叶门检查 manifest、依赖与入口,`doc-sync` 检查 README 概要、模型体验段与双语配对。于是一个包可以被新增、发布、写下自己的页面,却始终不出现在读者用来了解本组内容的表里。

## Decision

- **`verify-group-readme-packages` 是归属门禁。** 它把每个组的 `## Packages`(或 `## 包`)段与 `packages/<group>/` 下持有 `package.json` 的目录集合比对,对段内未列出的每个包报一条诊断。它作为 `doc-sync` 的 quick 叶门运行,因此 `pnpm run test:docs` 与 fork CI 的文档作业都会执行它。
- **行只要链接了该包的 README 就算列出。** 门禁读 Packages 段内的链接目标,取目标所指的目录,因此链文本、列数与族内顺序仍由作者决定。`../` 目标指向别的组,会被忽略:那一行归那个组的 README 所有——`client/` 链接 `../test-support/client-runtime/`、`fs/` 链接 `../e2b/fs-e2b/` 都是如此。
- **两种语言在同一个门禁里检查。** 中英表是两个文件,配对门禁无法约束两者一致:它只把每一侧与配对记录的既有状态比对,因此「只加英文行」可以被记录在案,中文表则继续保持缺行。在这里同时检查两个文件堵住了这条路径。
- **空扫描或收窄扫描即失败。** 缺少 `## Packages` 标题、某组没有任何包、完全找不到组 README,都是诊断而不是静默通过。
- **16 条行补在语义相邻处**——`client/` 的右栏簇、`session/` 的持久化族、`value` 紧挨 `values`——而不是一律追加到表尾。`host/` 的 "All eight packages" 与 "Eight packages play the host roles"、`web/` 的 "Six packages play the web roles" 连同其中文对应句分别改为九与七。

## Alternatives considered

- **只检查英文 README,让 `verify-translation-pairing` 覆盖中文侧。** 否决:配对门禁把每一侧与配对上次记录的状态比对,因此「加英文行后重录」会被接受,中文表仍缺该行——正是本门禁要阻止的漂移。
- **由目录列表生成这两张表。** 否决:每一行都带手写职责,且多数组还带该包提供的 `ctx` 键;表按主题而非字母排序,生成器要么丢掉这些散文,要么为了让生成成立而重写全部 56 张表。
- **把它并进既有的包 README 门禁,而不是新增叶门。** 否决:`verify-package-readme-summaries` 与 `verify-package-readme-model-experience` 只校验单个 README 自己的章节,从不读组目录;把跨文件清单规则折进它们,会让每个门禁的报错名对不上它实际检查的内容。
- **交给 `verify-md-links` 承担。** 否决:链接可解析只能证明「已存在的行指向真实位置」,永远发现不了整行缺失。

## Consequences

组内包表不会再落后于目录,两种语言都不会,失败信息直接点名要补的包与文件。代价是包发生移动或改名时,同一改动里多了一处要更新;另外这门禁比它守护的表更严:它只读 Packages 段,因此一个包若列在后面的章节、或只出现在散文里,依旧算违规。

## Testing

`scripts/verify-group-readme-packages.spec.ts` 覆盖了合规表、逐个漏列包、行分散在多个族表、Packages 段之外的链接行、`../` 跨组目标、中文标题配 `.zh.md` 目标,以及缺段这几种情形。`scripts/run-gates.spec.ts` 断言该叶门留在 `doc-sync` 中。仓库现以 112 份组 README(56 组 × 2 语言)全绿;表改动之后重跑了 `pnpm run test:docs` 与 `pnpm run verify-translation-pairing`。

## Related

- [在仓内 Issue 中跟踪技术债](2026-09-11-tech-debt-issue-tracking.zh.md)——产出本发现的 2026-09-11 扫描,记录在 Issue #90。
- [根包表](../../../../packages/README.zh.md)——这些组内表所属的受门禁保护组表。
