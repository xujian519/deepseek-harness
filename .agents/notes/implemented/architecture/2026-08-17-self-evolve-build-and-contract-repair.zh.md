# Agent Note: self-evolve 构建与契约修复

Status: implemented

[English](2026-08-17-self-evolve-build-and-contract-repair.md) | 中文

## 问题

self-evolve 能力包（`@deepseek-ai/dsh-self-evolve`、`@deepseek-ai/dsh-self-evolve-basic` 和 `@deepseek-ai/dsh-tool-self-evolve`）已经偏离当前 harness 约定到无法编译、测试或打包的地步。`pnpm run build` 与 `pnpm run test` 在整个子树都失败。

具体失败包括：

- `dsh-brand` 现在使用字符串字面量标签作为 brand tag，但 `self-evolve/src/brand.ts` 仍声明为 `Branded<unique symbol, ...>`，且没有为本包自有 id 提供不透明 id 工厂。
- `dsh-invariants` 暴露的是 `(ctx, fail)` 分发器 API，而 `self-evolve/src/invariant.ts` 仍调用旧的 `(label, ctx, check)` 形态，导致每条 invariant 规则都是类型错误。
- `self-evolve-basic/src/index.ts` 直接把 id 当作字符串导入、`Config` 传入的 schemastery 形状无效、用错误的字段名访问 `ProjectionSnapshot.values`、`EvolveProposal` 联合类型收窄错误、向下游传递了错误的验证对象。
- `self-evolve-basic/tsconfig.json` 与 `tool-self-evolve/tsconfig.json` 引用了已迁移的包（`core/agent-loop-testkit` 与 `scope/scope`）。
- 三个包都没有 `tsdown.config.mjs`，因此即使编译通过也不会产出 bundle。
- 三个包中有两个缺少 `README.md`，而现有的 `dsh-self-evolve` README 使用了已弃用的 Model Experience 标题。
- 若干导出符号（`SelfEvolveEngine` 方法、`foldEvent`、配置类型）缺少必需的 JSDoc。

## 决策

在一次有范围的变更中把三个包修复到当前 harness 约定。

- `packages/self-evolve/self-evolve/src/brand.ts` 改用字符串字面量 tag 进行 branding，并导出 `SelfEvolveRunId`、`FailurePatternId`、`EvolveProposalId` 工厂，使调用方构造不透明 id 而非把原始字符串强制转换。
- `packages/self-evolve/self-evolve/src/invariant.ts` 针对当前 `dsh-invariants` 的 `(ctx, fail)` API 重写，通过 internal dispatch 检查与 session/event 检查来验证 `self-evolve/*` 事件括号。
- `packages/self-evolve/self-evolve-basic/src/index.ts` 导入 branded id 工厂，修正 `resolveConfig` 类型，使用真实的 schemastery object/dict/union API，正确读取 `ProjectionSnapshot.values`，通过 `kind` 判别式收窄 `EvolveProposal`，转发正确的验证对象，移除不存在的 `rank` 字段，并用 `SessionId(sessionId)` 包装 `requireSession`。
- `packages/self-evolve/self-evolve/src/index.ts` 保留 `EvolveProposal` 类型导出，并移除导致 lint 错误的未使用导入。
- `packages/self-evolve/self-evolve/src/failure-projection.ts` 通过 `node:crypto` 的 `createHash('sha1')` 替代异步 WebCrypto SHA-1 路径，使 `foldEvent` 变为同步；投影定义的 `apply` 现在真正折叠事件，而非原样返回状态。
- `self-evolve-basic` 与 `tool-self-evolve` 的 `tsconfig.json` references 现在指向 `test-support/agent-loop-testkit` 与 `core/scope`。
- 每个包新增 `tsdown.config.mjs`，将 `lib/types/{index,invariant}.js` 打包到 `lib/`。
- 每个包新增或更新 `README.md` 以满足 `verify-package-readme-model-experience`：`dsh-self-evolve` 作为共享能力库使用 sentence-form Model Experience；叶子包（`dsh-self-evolve-basic` 与 `dsh-tool-self-evolve`）使用完整 Model Experience 章节。
- 为导出的 `SelfEvolveEngine` 方法、`foldEvent`、`BasicSelfEvolveConfig`、`TriggerPolicy` 和 `BasicSelfEvolveEngine.config` 补充 JSDoc。

## 考虑过的替代方案

**删除 self-evolve 包。** 不予采纳。自进化插件是 harness 的一项蓄意能力；删除会丢弃服务定义、基础提供方以及被其他包作为示例引用的 `tool-self-evolve` 消费者。

**将这些包排除在工作区构建与测试图之外。** 不予采纳。损坏的包会静默腐烂，并且仍会破坏遍历 `packages/**` 的任何聚合命令；在树内的能力必须能够编译、测试和打包。

**只修复编译，跳过 README、tsdown 与 JSDoc。** 不予采纳。该变更仍会在 `hygiene`、`doc-sync` 与已发布包检查中失败；部分修复会让包仍无法发布。

## 后果

- `pnpm exec tsc -b packages/self-evolve/self-evolve packages/self-evolve/self-evolve-basic packages/self-evolve/tool-self-evolve --force` 通过。
- `pnpm exec vitest run packages/self-evolve/` 通过。
- 三个包中分别运行 `pnpm exec tsdown --config tsdown.config.mjs` 均成功。
- `pnpm exec tsx scripts/verify-package-readme-model-experience.ts` 对涉及的包无违规报告。
- 更广范围的 `pnpm run build:lib:host` 仍因未提交的 `packages/patent/` 文件中的无关类型错误而失败；该失败不在本次范围内。
- `pnpm run verify-agent-note-format` 与全量 `pnpm run verify-translation-pairing` 也因无关的未提交专利包 Agent Note 与 README 配对而失败；self-evolve 的配对单独检查时通过。
