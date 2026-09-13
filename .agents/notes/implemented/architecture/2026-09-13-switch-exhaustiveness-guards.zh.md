# Agent Note: 闭合联合的 switch 以 `assertNever` 收尾，以及穷举 lint 选项决定的事

Status: implemented

[English](2026-09-13-switch-exhaustiveness-guards.md) | 中文

## 问题

Issue #89 报告全仓有 26 处穷举 switch 既无 `default` 也无 `assertNever`，并要求复核 oxlint 的 `considerDefaultExhaustiveForUnions: true` 是否与 AGENTS.md「闭合联合以 `assertNever` 收尾」的要求冲突。按解析器加类型检查器重新计数——`packages/*/*/src` 与 `apps/*/src` 下所有无 `default` 子句、且 case 标签全为字面量的 `switch`，再看 switch 表达式的类型——共 **69** 处：61 处是字面量联合，另有 8 处的判别值是普通 `string`（`method` 或 `topic` 名、迁移输入里未定型的 `event.type`、`value.toLowerCase()`），`assertNever` 在那里根本无法适用。

审计优先点名的六个静默面里，有两处的正确处理与它要求的相反：

- `packages/experimental/inspector/src/worker/inspection/network-store.ts` 的 switch 永远不会遇到未知 topic：`NetworkStore.append` 在进入 `ingest` 前就把 `topics` 集合（`FETCH_TOPICS`）之外的记录丢掉，所以缺的不是 `default` 子句，而是那道过滤处的说明。
- `session-format-*` 的迁移 switch 读的是未定型的输入，类型就是 `string`。

## 决策

**lint 选项保持 `true`。** 在 lint 配置副本里把它翻成 `false` 后，全仓有 **90** 处 switch 报 `switch-exhaustiveness-check` 失败，且每一处都是带 `default` 的有意子集处理——对可合并扩展的 `SessionEventMap` 做投影的那一族及同类。该选项正是给「某个构建无法替别的构建穷举」的联合留出写明理由的 `default` 的空间。`assertNever` 的契约并不依赖它：`assertNever(value: never)` 只接受 `never`，因此往闭合联合里加成员会在调用点令 `pnpm run typecheck` 失败——是每个消费方的构建，而非只有本仓的 lint 车道。

**闭合联合用 `assertNever`，开放判别值用写明边界的注释。** 本批为九处协议 switch 加了守卫（此前未识别的成员会静默通过）：`api/session-controller` 五处（Host 助手流累加器、Client 累加器、会话列表变更折叠、日志变更应用、日志变更翻译），外加 `client/ui-conversation` 的会话窗口折叠、`experimental/webworker-runtime` 的两处 shell switch（参数分段与重定向子类型）、以及 `experimental/inspector` 的 `validateRemoteObject`。每处 default 都带 `/* v8 ignore next -- closed-union backstop; ... */`，因为它在构造上不可达：值的类型是闭合的，inspector 那一处还由 `parseRemoteObject` 在 cast 之前只放行 `REMOTE_TYPES`。

**三处可扩展联合现在就地说明为何落空。** `compaction/compaction/src/tool-pairing.ts`（事件增量）、`interaction/permission-presets`（投影的引用不变变更闸门）、`compaction/compaction-basic/src/summarizer.ts`（既不属于三种失败之一的结束原因——`FinishReasonMap` 的类型文档本身就要求对未知种类落空）各自写明未知成员为何进入 default 而不是某个 case。

**第二批守卫了其余 52 处字面量联合中的 51 处。** 这 51 处现在都以 `default: assertNever(...)` 加同一句 ignore 理由收尾：10 个已声明 `@deepseek-ai/dsh-util-values` 的包里 16 处，19 个未声明的包里 35 处——这 19 个中的 7 个客户端包由 `pnpm run verify-package-dependencies --fix` 补声明（运行期值导入进 `dependencies`、浏览器打包的进 `devDependencies`），其余 12 个手工补，并补上相应的 `tsconfig` project reference。传给 `assertNever` 的是被 switch 的那个值本身，而不是它的判别属性：TypeScript 会把被 switch 的对象在 default 子句里收窄成 `never`，于是 `chunk.type` 在那里是 error 类型表达式，`tsc` 与类型感知 lint（`typescript/no-unsafe-argument`）都会拒绝它。第 52 处——`typert/generator` 的 `emitter.ts`——保留无 default 的 switch：根 `tsdown.config.ts` 会通过 Typert 构建插件在任何 workspace bundle 产出之前就导入该模块，因此共享版 `assertNever` 会让构建中途去找 `dsh-util-values/lib/index.js`——这是实测结论：干净 CI 构建会在该导入处失败，去掉它即通过。

**八处开放判别值逐处裁定，而不是加守卫。** 值得收紧的只有 `apps/desktop/src/bridge-server.ts`：它的白名单改为字面量类型的 `Set` 加一个 `method is DesktopBridgeMethod` 谓词，于是 `dispatch` 对闭合联合是全的，并以 `assertNever` 收尾。其余七处保留无 default 的 switch，把边界写在原地：`core/session` 的种子信封 switch（有六种类型携带它所断言的 LLM 信封，别的类型都是可合并扩展的插件事件）、四处 `session-format-*` 迁移 switch（更早的 disposition 表查找或内容过滤已经丢掉它们不处理的那些）、`skill-filesystem` 的 frontmatter 布尔拼写（其它字符串落到下面的 `TypeError`）、以及 `workflow-worker-thread` 的 `typeof` switch——它的八个结果由语言固定，操作数 `unknown` 也不会收窄成 `never`。第一批已裁定的 `network-store` 过滤边界保留其注释。

## 考虑过的替代方案

- **把 `considerDefaultExhaustiveForUnions` 翻成 `false`。** 依据上述实测否决：90 处有意的「子集 + default」处理将被迫穷举每个成员，而可扩展映射跨构建时给不出这种承诺；闭合联合这一半的规则也不需要它。
- **同样给 `NetworkStore` 的 switch 加 `assertNever`。** 否决：追加过滤让那个 default 不可达，加上去只是把边界在第二处死陈述一遍，而边界属于过滤处——本批把它写在了那里。
- **一次性守卫全部候选。** 改为分两批：第一批守卫九处协议 switch 并记录剩余分类，第二批按该分类机械落地 52 处字面量联合。分开做让「未识别变体跨越进程边界」的协议评审与「三十个包清单的机械清扫」各自独立。
- **把判别属性传给 `assertNever`。** 编译器否决：被 switch 的对象已收窄成 `never`，属性访问在 default 子句里是 error 类型，`tsc` 与 tsgolint 都会拒绝。传对象本身还让错误消息带上整个变体，诊断更有用。
- **用 `assertNever` 守卫 `workflow-worker-thread` 的 `typeof` switch。** 否决：`typeof` 恰好八个结果且由语言固定，而操作数 `unknown` 不会收窄成 `never`，不加 cast 就写不出这个守卫。
- **同样给 `typert/generator` 的 emitter 用共享 `assertNever`。** 依据实测的构建失败否决：根 tsdown 配置会在任何 workspace bundle 产出之前（经 Typert 插件）加载该模块，于是导入 values 包会让干净检出上的 host 构建以 `Cannot find module '…/dsh-util-values/lib/index.js'` 失败。该 switch 保留编译器自身的穷举保证，并就地写明这条约束。
- **在 `dispatch` 调用点给 `request.method` 加 cast。** 否决，改用语词谓词：cast 会落在热路径上且掩盖白名单关系，谓词只陈述一次，并让「白名单有项但 `dispatch` 没有 case」在编译期失败。
- **从 `@deepseek-ai/dsh-value` 再导出 `assertNever`**（该包已有 182 个声明方，且已在再导出 values 包的 `deepFreeze`，后者有 134 个声明方）。并非在可行性上否决——它能省掉大部分清单工作——但它会扩大一个被广泛使用的包的公开面，需要单独决策，而不是搭在本次改动里。

## 后果

六十处 switch 现在会对未识别的变体抛出具名错误——第一批的九处协议 switch 加上第二批的 51 处字面量联合——且每一处在任何构建出货前都会由编译器拒绝新成员。九处判别值改为写明边界：一处收紧成闭合联合，八处保留无 default 的 switch 并写明理由（七处未定型输入，加上被构建配置加载的 emitter）。`patent-teams` 的一个本地 `assertNever` 副本已删除改用共享版；`docs/module-graph` 双语对已再生，顺带补上了此前一次改动遗留未再生的 `token-meter` → `attachment` peer 边。对 `packages/*/*/src` 与 `apps/*/src` 的扫描现在报九处候选，全部是已裁定的站点。

## 测试

扫描按本 Note 的描述可复现：解析器加类型检查器遍历 `packages/*/*/src` 与 `apps/*/src`，第一批前报 69 处候选、之后 60 处，第二批之后 8 处。对七个受影响的包跑 `npx vitest run`：2409 通过。十三个被改文件的逐文件覆盖率仍为 100%（用带 `--coverage --coverage.include` 的定向运行验证，含其 ignore 注释之后的那些新 default 分支）；`network-store.ts` 的新用例用一个假想的新版 worker 记录钉住了 topic 边界。`pnpm run lint`（4489 文件 0 警告 / 0 错误）、`pnpm run typecheck`、`pnpm run duplication`（0 克隆）、`pnpm run verify-package-dependencies`（66 个包）、`pnpm run verify-suppression-reasons`（400 条抑制，零发现），以及上面的翻配置实测（`npx oxlint --config <flipped> .` → 90 处 `switch-exhaustiveness-check`）。

第二批重跑了同一扫描（九处候选）、对 36 个受影响包的测试套件跑 `npx vitest run`（9989 通过），并对被改的 `packages/*/*/src` 文件跑覆盖率——先用定向 `--coverage --coverage.include`，再用完整 `pnpm run test:coverage` 门禁（0 条逐文件阈值发现；两个无关套件在满载下超时，已记入台账）。同样为绿：`pnpm run clean` 之后的 `pnpm run typecheck`（正是这一步抓出 `typert/generator` 的导入问题）、`pnpm run lint`（4489 文件 0/0）、`pnpm run duplication`（0 克隆）、`pnpm run verify-package-dependencies`（66 个包）与 `pnpm run verify-client-packages`（57 个客户端包），以及在再生该双语对之后的 `pnpm run verify-module-graph`。

## 相关

- [以同仓库 Issue 跟踪技术债](../process/2026-09-11-tech-debt-issue-tracking.zh.md)——Issue #89 的登记处。
- [类型感知 lint 清理](../process/2026-08-29-type-aware-lint-cleanup.zh.md)——此前确立「抑制与防御注释是承重文档」的裁定，与本次同一「就地写明理由」的规则。
- [lint 抑制须说明理由](../process/2026-09-13-lint-suppression-reasons.zh.md)——与本次同批加入的门禁。
