# Agent Note：dsh plugin 失败提示背后的构建许可配置位置

Status: implemented

[English](2026-09-02-pnpm-plugin-failure-hint-config-homes.md) | 中文

## Problem

往 profile 安装 git 来源的插件（`dsh plugin --profile web add github:guchang/draw2code#…`）在实战中两次失败，而转发器的失败提示两次都指错了方向。提示说把 pnpm 打印的 key 加到 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 下。但在 pnpm 10.34.x 上，这项检查从不读取该配置：git-hosted prepare 的强制校验读取的是 profile `package.json` 的 `pnpm.onlyBuiltDependencies`——同一个 pnpm 二进制同时又警告 `pnpm` 字段"已不再读取"——而且它只匹配依赖路径形式的 key（`name@<tarball-url>` 或 `name@git+ssh://…#sha`），裸包名匹配不到 git-hosted 依赖；`allowBuilds` 条目与 workspace 文件清单都进不了这项检查。两次真实安装都是在把 pnpm 打印的 depPath key 写进 profile `package.json` 字段后才成功。

提示的触发条件也是错的：它只看转发的参数是否长得像 git 来源。第二次真实失败是 `ERR_PNPM_UNEXPECTED_STORE`（desktop profile 的 node_modules 由 pnpm 10 链接，而仓库 pin 已升到 pnpm 11），argv 里带着 `github:` 参数——按参数形状触发的提示会在那里打出 allowlist 提示，把 store 问题误导成 allowlist 问题；而一个传递依赖里带 git 包的 registry 插件则完全得不到提示。

## Decision

[apps/cli/src/plugin.ts](../../../../apps/cli/src/plugin.ts) 捕获 pnpm 的 stderr（原样回显，pnpm 自己的诊断照常可见；stdout 保持继承，进度与交互式 pnpm 流程的实时渲染不受影响），并通过导出的 `pnpmFailureHints(stderr, dir)` 从捕获的错误文本生成提示，不再看转发参数的形状。`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` 产出的提示说明确切的 key 形式，并指向 profile `package.json` 的 `"pnpm.onlyBuiltDependencies"`，同时注明 pnpm 10 从这里执行该许可清单、尽管它自己的输出指向 `pnpm-workspace.yaml`。`ERR_PNPM_UNEXPECTED_STORE` 产出的提示给出两条解决路径：换回安装该 profile 的 pnpm 大版本，或在 profile 目录跑 `pnpm install` 迁移 store。其余失败不打印提示。

## Alternatives considered

- **保留按 argv 的 git 形状触发** — 拒绝：失败原因与参数形状无关。desktop profile 安装 draw2code 时 argv 带着 `github:` 参数却撞上 `ERR_PNPM_UNEXPECTED_STORE`，形状触发的提示在那里只会误导；而带传递 git 依赖的 registry 插件则根本得不到提示。
- **按 pnpm 报错的建议指向 `allowBuilds`** — 拒绝：对照 pnpm 10.34.5 实测，`allowBuilds` 条目与 workspace 文件清单都进不了 git-hosted prepare 的强制校验；只有 `package.json` 的 `pnpm.onlyBuiltDependencies` 数组有效。

## Consequences

`dsh plugin` 的失败对实战中观察到的两类阻塞给出可行动的提示，其余情况保持沉默，提示不会与无关原因竞争。git 提示的文案记录了 pnpm 10.34 自相矛盾的行为——警告 `package.json` 的 `pnpm` 字段不再读取、却又从这里执行这份许可清单——将来若某个 pnpm 版本让 `pnpm-workspace.yaml`（或 `allowBuilds`）重新成为真正的执行位置，需要同步更新提示与 [apps/cli/tests/plugin-failure-hints.spec.ts](../../../../apps/cli/tests/plugin-failure-hints.spec.ts) 中的测试。
