# Agent Note: 补齐空的 IPC 审查标准卡片并为其源加门禁

Status: implemented

[English](2026-10-06-ipc-standards-empty-cards.md) | 中文

## Problem

`packages/patent/patent-core/assets/ipc-standards.yaml` 的 138 张 IPC 审查标准卡片中，21 张既无 `keyPoints` 也无 `tips`，另有 3 张只有 `keyPoints` 而无 `tips`。空卡片并非无害：`formatStandardsAsContext` 对两个数组都回落到空串，却仍把裸标题行 `- [A61] 创造性-三步法-A61医药 (patent-law-a22.3)` 拼进 `<memory-context>`。卡片声称提供其 IPC 部的创造性审查标准，实际提供零字，既占上下文预算，又让模型把这条记录读成"该部已有标准覆盖"。`ipcStandardsByArticle('patent-law-a22.3')` 一次返回 56 张卡，其中 24 张为空。

源素材一直都在。提取只读了每个源文件的主页面，而主页面已被拆分到子页：`创造性-审查标准-门窗.md` 只有 1894 字节，完全不含任何 `###` 要点段，内容搬到了 `创造性-审查标准-门窗-拆分-01-决定要点.md`。载荷就在提取器没有看的那一层目录里。

结果不会被任何机制发现。`tests/ipc-standards-loader.spec.ts` 只断言 `Array.isArray`，且只检查前 10 张卡——全是完整卡——因此把某张卡清空的编辑，或让源文件重构后其主页面变空的变化，都保持不可见。资产的 `source` 字段与头部注释都漏了 `Wiki/` 这一层路径元素，按记录的路径定位源文件得不到任何结果。

## Decision

从 `宝宸知识库/Wiki/复审无效/` 逐张提炼，补齐创造性域（`article: patent-law-a22.3`）全部 24 张空卡片，每张一条 `keyPoints` 判定规则加五条 `tips` 实务要点，格式对齐既有 43 张完整卡片。主页面不含要点段的卡片改从拆分子页取材——其中 11 张的载荷就在子页里。其余 71 张 `tips` 为空的卡片属新颖性、说明书、权利要求与外观设计域，不在本次范围内。

`formatStandardsAsContext` 跳过 `keyPoints` 与 `tips` 同时为空的卡片，且当没有一张卡片有实质内容时返回空串，卡片因此不再以"标题下无内容"的形态到达模型。

三项机制防止状态回退。一条非空断言覆盖随包资产的每一张卡片，另一条断言把每个 `source` 约束在 `宝宸知识库/Wiki/` 前缀内。`scripts/verify-ipc-standards-source.ts` 是新增门禁：读入资产，把每个 `source` 解析到知识库，主页面或任一拆分子页都可作为载荷载体，源缺失、路径格式错误或无可提取要点段时失败；库根由 `DSH_IPC_STANDARDS_SOURCE_ROOT` 指定，登记在 hygiene gate 组。头部注释与全部 138 条 `source` 的 `Wiki/` 层已修正——门禁的定位与人工回源都依赖它。

## Alternatives considered

**照搬 `nuo-*.yaml` 的旁挂补丁文件形态。** 先例无法迁移。`nuo-*.yaml` 存在活跃的上游再同步，手改会被覆盖，[字段级激活补丁 note](../feature/2026-09-20-field-level-activation-patches.zh.md)正是为在那种覆盖下存活而存在。本资产在两个仓库都没有生成器，没有任何东西会覆盖它；真正的问题是三份副本漂移（本仓 1 份、Mady 2 份），与再同步是相反的失效形态。loader 也没有可扩展的字段级叠加层：`loadIpcStandards` 只接受整文件的 `overridePath`。

**保留数据、只让 loader 告警。** 治标。卡片仍会声称一份它并不具备的覆盖，而读出该结论的仍然是模型。

**补齐全部 95 张 `tips` 为空的卡片。** 工作量约 4 倍，且其中 71 张属其他域的卡片并不构成这个缺陷；多数已带有可用的 `keyPoints`。

**源库不可达时让门禁静默通过。** 该库不是自包含的，检查应落在最早可解析点：未配置库时门禁报告载荷核对未执行；显式配置的路径不存在时按配置错误失败，而不是读出绿色。

**只补数据不加任何防护。** 库是一个活跃仓库，文件持续变动，空壳状态会再次悄悄回来。

## Consequences

双空壳已归零，创造性域 56 张卡片全部完整。更大的缺口只解决了一部分：71 张属其他域的卡片仍无 `tips`；另有 21 张卡片在源库自身就是双空壳，其内容无法从源库恢复。

门禁引入了对仓库外路径的本地依赖。没有 `DSH_IPC_STANDARDS_SOURCE_ROOT` 也没有同级库时，它校验 138 条 `source` 前缀并打印载荷核对未执行；在该配置下它无法发现源库重构。

副本漂移未变：Mady 持有两份与本仓逐字节相同的副本，本仓与这两份之间既无门禁也无共享生成器。[Mady 引入评估](../architecture/2026-10-06-mady-import-assessment-empty.zh.md)同样判定该资产在两仓逐字节相同，本次补齐只改了其中一份。

## Testing

`tests/ipc-standards-loader.spec.ts` 断言随包资产中不存在两个数组同时为空的卡片、每个 `source` 都以 `宝宸知识库/Wiki/` 开头，以及 `formatStandardsAsContext` 会把空卡片从混合列表中剔除、并在所有卡片都为空时返回空串。`scripts/verify-ipc-standards-source.spec.ts` 覆盖三种拒绝形态——主页面只剩核心标准段、源路径缺 `Wiki/` 层、源文件缺失——以及载荷由拆分子页承载时必须通过这一情形。

`packages/patent/patent-core` 报 53 个文件 798 个测试通过，`patent-` 记录会话快照报 11 个通过，改动文件通过 oxlint 与 `tsc -b tsconfig.host.json`。门禁对真实知识库报 138 张全部核对通过，对显式配置的不存在路径退出非零。

`ipc-standards-coverage.spec.ts` 此前用一张无内容的卡片走到无 `ipcDetail` 的格式化分支，等于固定了本次移除的裸标题行为；该 fixture 现已带上 `keyPoints` 条目，覆盖它本要覆盖的分支。