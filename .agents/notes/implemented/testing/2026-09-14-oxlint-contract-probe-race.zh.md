# Agent Note: 仓库扫描器排除 oxlint-contract 测试探针

Status: implemented

[English](2026-09-14-oxlint-contract-probe-race.md) | 中文

## Problem

`scripts/oxlint-contract.spec.ts` 会把名为 `oxlint-contract-*` 的临时探针文件写入真实的包源码和测试目录，以验证 oxlint 能为每类文件找到正确的 TypeScript 工程。这些探针在测试的 `finally` 块中被删除。

在探针存在期间，其他并发扫描仓库并逐个读取匹配文件的 spec，可能在 `globSync` 和 `readFileSync` 之间遇到已被删除的探针，抛出：

```
Error: ENOENT: no such file or directory, open '.../src/oxlint-contract-<uuid>.ts'
```

这是一个负载敏感的竞态：`pnpm exec vitest run scripts/` 在本地可复现，不同运行中失败的 spec 也不同（`gen-client-catalog.spec.ts`、`verify-application-entrypoints.spec.ts` 和 `verify-suppression-reasons.spec.ts`）。

## Decision

所有会经过探针出现路径的仓库扫描器，现在都会过滤掉包含 `oxlint-contract-` 的路径。这与已有的 `.gitignore` 和 `.oxlintrc.json` 忽略模式一致，这些模式已经把此类文件视为仅供测试的临时文件。

更新的扫描器：

- `scripts/slot-walk.ts` — `scanSlotFiles` 与 `indexExportedTypes`
- `scripts/verify-application-entrypoints.ts` — `SOURCE_EXCLUDES`
- `scripts/verify-suppression-reasons.ts` — `scanRepository` 的 glob 排除项
- `scripts/verify-client-ui-i18n.ts` — `sourceFiles`
- `scripts/verify-no-bare-dispatcher.ts` — `scanRepository`

## Alternatives considered

**把探针移入临时目录并配一份人造 tsconfig。**  rejected：该测试的目的是验证 oxlint 能为每类真实文件找到所属的 TypeScript 工程，因此探针必须位于真实包路径下，才能解析到正确的 `tsconfig.json`。

**把 `oxlint-contract.spec.ts` 放入顺序执行的池。**  rejected：仓库的测试策略把每个 spec 视为独立的单元，要求它们自己管理好临时路径；因为某个 spec 把文件泄漏到共享目录就将其串行化，是在掩盖泄漏而不是修复它。

## Consequences

`pnpm exec vitest run scripts/` 在多次连续本地运行中保持稳定。扫描器仍然能看到所有真实仓库文件；唯一被排除的是已被 git 和 oxlint 忽略的瞬态探针文件。

## Testing

修改后 `pnpm exec vitest run scripts/` 连续三次本地运行通过。此前在第一次运行中就能复现该竞态。

## Related

- Issue #132 — 本修改关闭的缺陷报告。
- `.oxlintrc.json` 中对 `oxlint-contract-*` 文件的忽略模式。
- `.gitignore` 中对 `oxlint-contract-*` 文件的条目。
