# Agent Note: `src/types.ts` 的运行时代码伴随物边界

Status: implemented

[English](2026-09-13-types-ts-runtime-companion-boundary.md) | 中文

## Problem

`packages/AGENTS.md` 要求 `src/types.ts` 只放类型、不放运行时代码,而 15 个包里的 19 个此类文件与之相悖。其中 17 个文件把运行时代码与被它服务的声明放在一起:brand 构造函数(`SessionId`、`SessionSeq`、`SessionLogOffset`、`FsTargetKey`、`FsVersion`、`SpillLocator`、`SubagentRunId`、`ApprovalRequestId`、`TeamId`、`TeamTaskId`、`TeamMessageId`、`WorkflowRunId`)、本包自己的错误类(`FsError`、`WebError`、`TerminalBackendCleanupError`、`GraphInterruptError`、`GraphEngineError`、`WorkflowError`)、由同文件声明确定的常量(`SESSION_FORMAT_VERSION`、`SESSION_SEARCH_RESULT_LIMIT`、`SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS`、`DSH_ENV_PREFIX`、`GRAPH_END`、`EVIDENCE_TYPES`、`LevelMust`/`LevelShould`/`LevelQuality`、`DRAFT_NOTICE`、`TERMINAL_TASK_STATUSES`),以及针对其中一个联合的谓词(`isGraphInterruptError`)。另有 2 个文件转发了别的模块的运行时代码:`shell/types.ts` 从 `dsh-subprocess` 再导出 `DSH_ENV_PREFIX`,`jobs/types.ts` 从自己的 `./brand.ts` 再导出 `JobId`。

19 个文件与之相悖的规则无法执行,审查者会学会跳过它。这条规则还牵动了覆盖率配置:`vitest.config.ts` 以「types-only 文件没有运行时覆盖率」为由把 `packages/*/*/src/types.ts` 排除在逐文件门禁之外——只有规则成立时,这个理由才站得住。Issue #99 把这一不一致登记为台账条目 L3。

## Decision

- **规则改为记录该边界。**[packages/AGENTS.md](../../../../packages/AGENTS.md) 现在写的是:`src/types.ts` 声明本包的接缝词汇——即其类型,加上该词汇定义的运行时代码(brand 构造函数、本包自己的错误类、常量、成员表、谓词)——并且绝不转发别的模块的运行时代码。这条允许范围由一个审查者能直接从文件本身回答的问题界定:该文件自己的声明是否点名了这个值?
- **转发移到入口。**`shell/src/index.ts` 从 `@deepseek-ai/dsh-subprocess` 再导出 `DSH_ENV_PREFIX`,`jobs/src/index.ts` 从 `./brand.ts` 再导出 `JobId`。两个 `types.ts` 只保留其词汇所需的部分——一个类型导入,或 `export type`——因此 bash 与 job 消费者导入的包根不变,没有任何消费者需要改动。
- **覆盖率注释陈述同一事实。**[vitest.config.ts](../../../../vitest.config.ts) 中 `types.ts` 的排除项现在写明:声明文件没有可执行代码,由包规则点名的运行时代码伴随物随文件一同排除,取代了此前已被证伪的「types-only 文件」说法。

## Alternatives considered

- **把所有运行时代码移入独立模块。** 否决有三条理由。brand 会移入 `./brand.ts` 叶文件,即 10 个包已采用的形式——但那个叶文件是为编译面存在的,而不是为了纯粹性:[jobs/brand.ts](../../../../packages/jobs/jobs/src/brand.ts) 写明了它的原因(包根与 `./types` 都经由 owner 签名触达 `dsh-agent`,而 Client 程序无法解析)。其余 13 个包需要同样的拆分,却没有任何行为收益,而且 id 的类型与它的一行构造函数本是一个概念,拆开会让同一个名字出现在两个文件里。第三,移出的值会落进受覆盖率门禁保护的文件,逐文件 100% 门禁于是会新要求为每个 brand 构造函数、以及 `FsError` 的构造函数写直接测试。
- **保留规则的原文,把这 19 个文件登记为债务。** 否决:这一实践是统一且有理由的——brand 紧靠它所 brand 的 id,接缝的错误类紧靠接缝——所以那条台账会变成永久的谎言,而不是待修清单。
- **连转发一并允许。** 否决:一个转发别的模块值的 `types.ts` 自身不携带任何声明,还为一个所有者已经导出的符号发布了第二条导入路径。`shell/types.ts` 的模块注释曾声称这次再导出让 bash 消费者「只有一个导入根」,而入口本身就能提供这一点,无需绕道。
- **把这些伴随物纳入逐文件覆盖率门禁。** 否决:该排除项是按文件的 glob,去掉它会让 19 个文件的运行时代码受门禁——那些代码是与类型相邻的一行体,行为已通过各自的消费者得到验证,而门禁会要求逐个补直接测试。

## Consequences

`types.ts` 保留一条狭窄的允许范围,并多了一条可陈述的判据。超出该范围的文件——服务、解析器、状态表——是审查发现项,边界也不再取决于错误类或 brand 辅助函数当初恰好写在哪里。不再有任何 `types.ts` 是别的包运行时代码的导入路径。逐文件门禁依旧不测量这些伴随物,而覆盖率注释现在如实说明了这一点,不再否认它。

## Testing

`pnpm run typecheck`(两个编译面)与 `pnpm run lint` 通过。移走的再导出经由原本就从包根导入它们的消费者验证——`packages/shell/shell-env`、`packages/shell/tool-bash`、`packages/jobs/jobs-local`、`packages/jobs/tool-jobs`——这些套件全部通过;纯声明文件仍产出相同的 `lib/types` 导出,由 `tsc -b` 对两个编译面复核。`pnpm run verify-module-graph` 报告三份产物均为最新:shell→subprocess 与 jobs→brand 两条边在两种写法下都存在,因为这两对在运行时同样互相导入。

## Related

- [在仓内 Issue 中跟踪技术债](../process/2026-09-11-tech-debt-issue-tracking.zh.md)——产出台账条目 L3 的扫描,记录在 Issue #99。
- [覆盖率豁免写明该文件自己的理由](../testing/2026-09-13-coverage-exemption-reasons.zh.md)——同一改动的另一半:由本规则那句被证伪的说法所支撑的那些豁免。
