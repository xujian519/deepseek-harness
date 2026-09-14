# Agent Note: 提取分析器的节点文本、导出映射与路径模块（Issue #86）

Status: implemented

[English](2026-09-14-analyzer-module-extraction.md) | 中文

## Problem

`packages/typert/generator/src/analyzer.ts` 长到 3235 行。`WorkspaceAnalyzer` 与 `FaceAnalyzer` 占去前 2650 行；剩下 584 行是类会调用、却与类不共享任何状态的模块级辅助函数尾部——每一个都接收编译器节点、字符串或路径，返回字符串、布尔值或普通模型值。

这个尾部并不均质。它是三个彼此无边相连的簇：读取语法节点（声明与成员文本、修饰符、JSDoc、字面量模型）、读取 `package.json` 导出映射、解析模块与文件系统路径。每一簇都只能经由同时装着分析器的那个文件抵达，因此想改「`package.json#exports` 如何映射到源码文件」，就得在 2700 行提取逻辑之下先找到它。

[拆分计划](../../proposed/simplification/2026-09-14-god-file-split-plan.zh.md)把这一刀定为批次 1 的 `analyzer` 项，估算为三刀各约 250 行。本 note 记录这一刀实际产出了什么。

## Decision

三个模块装载三簇，第四个模块装载它们共享的词汇。`src/analyzer.ts` 为 2806 行。

| 模块 | 行数 | 归属 |
| --- | --- | --- |
| `src/node-text.ts` | 397 | 25 个语法节点读取函数：`preferredDeclaration`、`declarationText`、`memberName`、`documentationOf`、`typertMode`、`visibilityOf`、`literalModel` 及其私有辅助 |
| `src/package-exports.ts` | 111 | 6 个导出映射读取函数：`isDualFacePackage`、`hostExportSubpaths`、`clientExportSubpaths`、`packageExportTargets`、`sourcePathForExport`，以及私有的 `exportTarget` |
| `src/module-path.ts` | 201 | 13 个模块与路径辅助函数：`moduleSpecifierOf`、`importBindingOf`、`moduleIdentity`、`formatDiagnostic`、`formatProgramDiagnostic`、`realPath`、`isWithin`、`slash` 等 |
| `src/types.ts` | 26 | `TypertAnalysisError`、`ModuleIdentity`、`ReferenceSite`、`EMPTY_DOCUMENTATION` |

七个辅助函数留在入口模块，作为新模块并不拥有的胶水层：`mergeWorkspaceModels`、`parseConfig`、`projectConfigPath`、`sourceFileHasSurface`、`hasPackageSurface`、`uniqueBy`、`compareCrossFaceLinks`。它们各自只被类或另一个留下的辅助函数调用，别无他处可达，因此入口模块是它们唯一的家。

### 这一刀按构造即保行为

被搬走的每一段都与离开入口模块的代码逐字节相同。没有函数体、常量或默认值发生变化；入口模块声明的导出与之前那八个同名。五处注释随其语句一同搬迁并保持原样：四处 `/* v8 ignore ... */` 注解（`node-text.ts` 3 处、`module-path.ts` 1 处），以及那三行 `//` 注释——它记录 `isRemoteSegment` 镜像 `dsh-typert-protocol` 的 `isTypertRemoteSegment()`，随其所描述的函数一同旅行。

### `TypertAnalysisError` 为何离开入口模块

`node-text.ts` 与 `module-path.ts` 都会抛出它。若把类留在 `analyzer.ts`，而入口模块又从那两个模块导入，导入图就会成环。它因此落到 `src/types.ts`：`packages/AGENTS.md` 早已把「本包自己的错误类」列入包的接缝词汇所拥有的运行期值，本改动也援引了计划第三条规则所要求的 Issue #99 例外。`ModuleIdentity`、`ReferenceSite`、`EMPTY_DOCUMENTATION` 随之同迁：入口模块的类与新搬出的辅助函数都要用这三者，安置在别处只会造出那条「搬走错误类正是为了避开」的回边。

入口模块通过 `export { TypertAnalysisError } from './types.ts'` 保住公开名，因此 `src/index.ts` 无需任何改动。

### 搬迁不得不补的 JSDoc

`verify-export-jsdoc` 扫描的是 `packages/*/*/src/**/*.ts` 下的每个文件，而不只是入口模块。44 个搬迁符号中有 38 个成为新模块的导出，因而各自需要一段带 `@param`/`@returns` 的注释；仍保持私有的 6 个——`classShape`、`normalizedDocText`、`firstSentence`、`rawJsDoc`、`exportTarget` 与 `realPathCache` 常量——只保留它们原本已有的注释。四个新文件在 482 行搬迁代码之外多出的 253 行，主体就是这些 JSDoc。

### 一处声明生成的约束

`importBindingOf` 的返回类型是 `ImportBinding`。在 `declaration: true` 下，具名返回类型必须能从生成的声明文件中命名，因此尽管 `importBindingOf` 是它唯一的用户，`ImportBinding` 仍从 `module-path.ts` 导出。`tsc --noEmit` 不会报出这一类错误；声明生成会，本刀两者都跑了。

### 计划中关于本文件的 `jscpd` 说法有误

计划的 Problem 段把 `analyzer.ts` 列入含 `/* jscpd:ignore-start */` 块的文件。它一个都没有。本包唯一的那对标记在 `src/cordis-catalog.ts`，且是括住被生成目录文本的字符串字面量，不是分析器源码的一段区域。本刀未触碰任何 `jscpd:ignore` 块，故计划的第一条规则对它不适用；计划的 Problem 段已随本改动订正。

## Verification

| 检查 | 结果 |
| --- | --- |
| `pnpm exec tsc -p packages/typert/generator/tsconfig.json --noEmit` | 干净 |
| `pnpm exec tsc -p packages/typert/generator/tsconfig.json --emitDeclarationOnly` | 干净——正是它证明了 `ImportBinding` 必须导出 |
| `pnpm exec vitest run packages/typert/generator` | 8 文件 / 201 通过，与切割前同一计数 |
| `pnpm run typecheck` | 通过，覆盖生成器的跨包消费方 |
| `pnpm exec tsx scripts/run-oxlint.ts packages/typert/generator/src` | 干净 |
| `pnpm exec tsx scripts/verify-export-jsdoc.ts` | 通过 |
| `pnpm run duplication` | 2197 个文件 0 处克隆 |
| `pnpm run test:docs` | 18 通过 / 0 失败 |
| 导出名对比 | 两侧同为 8 个同名导出 |
| 调用点检查 | 38 个导出符号在 `analyzer.ts` 中均有调用方；每个私有辅助在其所属模块内均被引用 |

批次 1 的验收标准成立：入口模块导出同名，没有任何测试需要改导入路径，也没有任何常量、默认值或 schema 取值被移动。

逐文件覆盖率门禁不适用于本包：`packages/typert/*/src/**/*.{ts,tsx}` 本就在 `vitest.config.ts` 的覆盖率 exclude 清单内，其注释记录了 typert 的正确性由其不插桩的测试套件检查。因此覆盖率不构成本刀的证据。

## Alternatives considered

- **把 `TypertAnalysisError` 留在入口模块，由两个新模块导入它。** 拒绝：入口模块从这两个模块导入，这正是拆分要避开的环；而且那样会让类离抛出它的代码 2600 行远。
- **用第四个簇模块（`syntax-types.ts`）替代 `src/types.ts`。** 拒绝：`ModuleIdentity`、`ReferenceSite`、`EMPTY_DOCUMENTATION` 被入口模块的类使用的程度不亚于被搬出的辅助函数，因此装载它们的簇模块会变成一个以某一簇命名、却紧贴入口模块的模块。`packages/AGENTS.md` 早已给这类词汇备好了家。
- **从 `src/index.ts` 再导出搬出的辅助函数。** 拒绝：它们此前都不是导出，再导出会拓宽已发布面。`src/index.ts` 未被改动。
- **在同一刀里拆入口模块的类。** 拒绝：计划把 `Remote`/RPC 分析器与类型建模器放在批次 2，并以「能证明该刀不扰动 `nodeOrdinals` 的 id 稳定性」为前提。在此处切它们，等于把那份证明变成这次搬迁的条件。
- **把辅助函数并入两个模块（`syntax.ts`、`paths.ts`）而非三个。** 拒绝：三簇之间没有边，且 `package-exports.ts` 完全不依赖共享词汇——把它并给任一邻居，都会造出今天并不存在的导入。

## Consequences

`analyzer.ts` 少了 429 行，只剩下分析器与其胶水层。代价是这笔账：搬迁 482 行，四个新文件 735 行，入口模块 56 行导入接线——253 行的增长来自模块头、导入，以及 `verify-export-jsdoc` 对 38 个新导出所要求的 JSDoc。没有任何东西被删除或重写，增长完全是拆分引入的脚手架。

这次搬迁还暴露出 `packageExportSpecifier` 与 `firstSentence` 在 `emitter.ts` 和 `cordis-catalog.ts` 中早已各有一份独立副本。搬迁维持了原有份数而不增加：分析器的那两份现在住在 `node-text.ts`，各一份，与从前一样。去重不属于本刀的工作——`emitter.ts` 与 `cordis-catalog.ts` 是不同的消费方，今天没有共享模块。

## Related

- [拆分七个上帝文件](../../proposed/simplification/2026-09-14-god-file-split-plan.zh.md)（计划；本刀是其批次 1 的 `analyzer` 项）
- [提取 python 运行期的字节计价与日志台账模块](2026-09-14-code-runtime-python-cost-and-ledger.zh.md)（批次 1 试点）
- [硬编码可调参数审计收尾](2026-09-14-hardcoded-tunable-closeout.zh.md)（Issue #88；批次 1 改动规则：常量与默认值不得移动）
- `packages/AGENTS.md`（包的接缝词汇落在何处）
