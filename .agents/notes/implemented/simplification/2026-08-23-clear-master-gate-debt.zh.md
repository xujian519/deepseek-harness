# Agent Note：清理 master 五项既有门禁债务

Status: implemented

[English](2026-08-23-clear-master-gate-debt.md) | 中文

## Problem

master 带着 #23（synapse）、#24（ui-document-studio）、#26（self-evolve-eval）合并遗留的五项失败仓库门禁：

- `constraints`：`packages/self-evolve/evaluation/` 是嵌套的非包目录，里面放着一份无人引用的草稿启动清单。
- `verify-cordis-config`：web-app bundle 挂载了 `dsh-host-synapse` 与 `dsh-client-synapse`，但两个包名都无法经 `tsconfig.base.json` paths 解析，源码启动会回退到已构建的 `lib/`。
- `verify-export-jsdoc`：connection fixture 的 `createFixtureApi` 没有 JSDoc（其文档块漂移到了 `fixtureFiles` 上方）。
- `knip`：`campaign.e2e.ts`（带 key 的 e2e 测试）未声明为测试入口；`dsh-client-test-runtime` 是 `dsh-client-synapse` 未使用的 devDependency。
- `duplication`：五处 jscpd 克隆——`ui-deliverables`/`ui-document-studio` 共享的 turn 节点骨架、`migration.ts` 的 legacy 线程投影、`projection.ts`/`store.ts` 的工具过程折叠。

## Decision

- 把启动清单移到 `packages/self-evolve/`，与 `spec.md` 并列（链接已指向 `spec.md` 与 `test-support/self-evolve-eval`），`packages/<group>/<pkg>` 层级得以成立。
- 为 synapse 两个包补上 `tsconfig.base.json` 精确路径条目（包名带 host/client 前缀，组通配无法映射）。
- 把 `createFixtureApi` 的 JSDoc 块归位到函数上。
- 在 `self-evolve-eval` 的 knip workspace 入口声明 `tests/**/*.e2e.ts`（与 `api/remotes` 先例同形），并删除 synapse 未使用的 devDependency。
- 对允许共享模块的重复代码做提取：`migration.ts` 的 `projectThreadBase` 与 `projection.ts` 的 `foldToolProcessInto`（`store.ts` 复用）。而 `ui-deliverables`/`ui-document-studio` 的骨架是有意重复——studio 需要持有自己的 turn key 以便在未组合 `ui-deliverables` 时独立工作，且 client 包禁止跨包值导入——因此用配置认可的 `jscpd:ignore` 标记包裹并加注释说明。

## Alternatives considered

- **重命名 synapse 包**让组通配能映射。否决：为一张 paths 表做包改名，波及面过大。
- **删除启动清单。** 否决：它记录了 P1.10 证据路径，仍是未来的执行指南；移到 `spec.md` 旁边予以保留。
- **把 ui turn 节点骨架提取为共享工厂。** 否决：client 包禁止跨包值导入，且 studio 需要持有自己的 turn key 以便不组合 `ui-deliverables` 独立工作；配置认可的 `jscpd:ignore` 标记让这份有意的重复保持显式。
- **删除 `campaign.e2e.ts`。** 否决：它是真实的带 key e2e 测试；改为在 knip workspace 入口中声明。

## Consequences

master 上 `hygiene` 组十三道门禁全部通过（此前七道），全仓 typecheck、CI oxlint、受影响包测试与覆盖率门禁均绿。`self-evolve-eval` 的 e2e 入口落地了 [knip-config-cleanup note](../../archived/simplification/2026-08-19-knip-config-cleanup.md) 中推迟的 "e2e entry folding" 开放项。
