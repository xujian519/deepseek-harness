# Agent Note: 只为内联上限保留的 grep 命中生成预览

Status: implemented

[English](2026-09-16-grep-preview-scope.md) | 中文

## Problem

`retainGrepMatches` 在把列表截到前 `maxMatches`（默认 250）条之前，会为每一条已解析命中生成预览。保留器会丢弃上限之外的全部内容，因此在宽泛搜索里，这些被丢弃的预览正是该遍历的主要成本：在 80,000 条已解析命中上实测（27 MiB 的 `rg --json`），一次 `grep` 调用会做的三遍——面向模型的渲染、搜索卡片投影、post-execute 落盘决策——合计 131 ms，而其中被丢弃的 79,750 条命中的预览几乎就是全部；本次改动后同样三遍只需 1.7 ms。

`retainGlobPaths` 在 `src/` 中没有任何调用者；`glob` 的内联页由 `globCardPage` 与 `sampleAcrossTopLevel` 计算。

## Decision

- `retainGrepMatches` 只在保留器仍低于 `maxMatches` 时为命中生成预览。被丢弃的命中仍会 push，以保证省略计数精确——这也是保留器需要它们的唯一原因。
- 删除 `retainGlobPaths` 及其测试；原先使用它的三个 `globSearchMeta` 用例改为从本地 `globPage` 夹具构造内联页，也就是 `glob` 卡片投影实际收到的形状。

落盘产物不受影响：它自己的那一遍会为完整列表生成预览后再写入恢复文件，因此面向模型的文本、卡片元数据、恢复文件都保持原有的内容与上限。

## Alternatives considered

- **按命中数组身份记忆化保留结果，让 2–3 遍共享同一结果。** 已否决：预览修复后每遍只需约 0.6 ms，记忆化只能省下约 1.2 ms，却让同一个可变结果对象从三处调用点可达。
- **给 `ItemRetainer` 增加批量的 `pushOmitted(count)`。** 已否决：为省下每条被丢弃命中一次计数自增，就去改动共享保留工具的 API。
- **保留 `retainGlobPaths` 作为 `globSearchMeta` 测试用的夹具。** 已否决：测试夹具属于测试，而一个无人调用的导出辅助函数会被读成仍然生效的契约。

## Consequences

在 80,000 条已解析命中（27 MiB 的 `rg --json`）上实测，这也是本仓库中一次宽泛搜索的形状：

| 阶段 | 成本 |
|---|---|
| `parseGrepMatches`（split + 逐行 `JSON.parse`） | 84 ms |
| 三遍保留遍历，改动前 | 131 ms |
| 三遍保留遍历，改动后 | 1.7 ms |
| `formatGrepOutput` 处理保留页 | 0.1 ms |

保留值在改动前后完全相同：既比较了整体 `RetainedItems` 的序列化 JSON，也比较了其中保留行。

## Testing

- `packages/fs/tool-fs-search/tests/search-core.spec.ts`（新增）用「统计 `line` 读取次数」的命中钉住上限语义：保留行携带预览、省略计数精确，且 4,000 条命中的读取次数不多于 4 条命中。
- 负向控制（已运行并回退）：恢复「为每条命中生成预览」的循环会让计数用例失败（`expected 8000 to be 8`），其余三个用例仍然通过。
- `pnpm exec vitest run packages/fs/tool-fs-search/tests` —— 158 项通过；`search-core.ts` 的语句、分支、函数、行覆盖率保持 100%。

## Related

- [tool-fs-search](../../../../packages/fs/tool-fs-search/README.zh.md) —— 拥有两个搜索工具、它们的内联上限与落盘交接的包。
