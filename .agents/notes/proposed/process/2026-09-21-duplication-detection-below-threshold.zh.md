# Agent Note: Make duplication detection see the clones it currently masks

Status: proposed

[English](2026-09-21-duplication-detection-below-threshold.md) | 中文

## Problem

`pnpm run duplication` 对全仓报告 0 克隆,而这个数字并不是对仓库的测量。当前配置里有两个机制,使它对任何克隆规模较小的域都不成立。

第一个是阈值。`.jscpd.json` 设 `minTokens: 60`、`minLines: 6`。用发行配置单独扫 `packages/patent/patent-tools` 报 `0 clones`(54 文件 / 80521 tokens);用 `--min-tokens 30 --min-lines 5` 扫同一棵树报 **113 克隆 / 866 行重复(1.64%)/ 283 文件**,最大克隆 55 tokens。60 tokens 以下的克隆全部不可见,而该域最大的克隆就在这条线之下。

第二个是 ignore 标记。`jscpd:ignore-start` / `jscpd:ignore-end` 把它们之间的区域掩码,仓库用这对标记登记「承认但尚未收敛」的重复。当跨包对只有一侧带标记时,掩码该侧会让整对从报告中消失,于是标记从「登记豁免」变成「静默隐藏」。`packages/patent/tool-literature/src/tool/paper-download.ts:106,123` 与 `packages/patent/patent-workflow/src/invariant.ts` 带标记,而它们的对端(`packages/patent/patent-tools/src/tool/patent-pdf-download.ts`、`packages/patent/patent-teams/src/invariant.ts`)没有。

后果不限于专利域。一个报告 0 的门禁无法区分「没有重复」与「阈值之上没有重复」,因此它无法对短于 60 tokens 的新克隆失败,也无法用来论证某个域是干净的。

## Proposal

采用下列两条策略之一,并把选择写进 `.jscpd.json`、而不是留在配置默认值里。

**降低阈值并记录基线。** 把 `minTokens` 设为 30、`minLines` 设为 5,把得到的数量记为基线,并要求基线不再增长。这会让专利域实际产生的每一种规模的克隆都可见、可评审。

**或要求对称标记。** 保留当前阈值,并要求跨包对一侧新增的 `jscpd:ignore` 区域在同一改动中加到另一侧,标记文本写明它所配对的对手方。这消除了静默隐藏的失效形态,同时不动阈值。

两条策略都要配一条负例测试:探针在所选阈值的下界植入一处已知重复,门禁必须因此失败。没有它,阈值可以被一次无关编辑再次调高,门禁又回到报 0。

直接前置条件是把降阈值后暴露的重复收敛掉,使基线从一个已评审的数字开始,而不是从 113 处未经评审的克隆开始。候选清单见 `.agents/audits/2026-09-21-patent-domain-review.md`。

## Alternatives considered

**保留配置,靠评审者发现重复。** 否决:门禁存在的理由正是评审无法覆盖跨包重复;实测数量(30-token 下界下 113 克隆、最大 55 tokens)说明门禁当前并未覆盖本仓重复实际所在的规模区间。

**降阈值但不记录基线。** 否决:门禁会在既有 113 处克隆上失败,于是这次改动要么被回退,要么必须一次性收敛所有克隆——包括彼此生命周期无关的那些。

**禁用 `jscpd:ignore` 标记。** 否决:一次性收敛所有已承认的克隆不可达,而该标记是仓库记录「有意且有理据的豁免」的唯一机制。失效点是标记的不对称使用,不是标记本身。

## Acceptance criteria

- `.jscpd.json` 写明所选策略:降阈值并记录基线,或对称标记要求。
- 一条负例测试在所选下界植入重复,并证明门禁对它失败。
- 无论选哪条策略,落地的那棵树上 `pnpm run duplication` 仍然通过。
- 只在单侧带标记的跨包对,要么收敛,要么两侧都加标记。

## Risks

降低阈值会让本仓重复第一次变得可见,这意味着改动后的首次运行给出的是一个需要分诊的数字而不是干净结果;分诊本身就是要做的工作,而基线是它的记录。对称标记则把阈值留在原处,短克隆重复仍不可见,但消除了静默隐藏的失效形态。两条策略都改动全仓门禁,因此都应在独立改动中落地,并把基线记入 `docs/TECH_DEBT.md`。
