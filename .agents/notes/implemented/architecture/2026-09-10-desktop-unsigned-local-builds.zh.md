# Agent Note: Unsigned local Desktop builds

Status: implemented

[English](2026-09-10-desktop-unsigned-local-builds.md) | 中文

## Problem

macOS 发布打包在构造上就与签名绑定：`prepare:seed` 为 seed store 里的每个 Mach-O 签名并随后离线复验重写后的 store，`electron-builder` 带着 `forceCodeSigning` 接收 Developer ID 身份，DMG 钩子再对磁盘映像公证。发布环境在最前面就解析这些输入，因此没有代码签名身份的构建主机无法产出任何可安装的应用——连用于本地测试的也不行——而同一棵树跑 `pnpm run dev:desktop` 却一切正常。

## Decision

`DSH_DESKTOP_UNSIGNED_BUILD=1` 让单个目标产出 ad-hoc 应用而不是发布件：

- `prepare-seed` 跳过 macOS 的 seed 签名（以及归档后的签名复验），其余 seed 步骤全部保留：lockfile 生成、离线安装证明、store 归档与完整性清单。
- builder 配置设置 `mac.identity: null`、`mac.forceCodeSigning: false`、`mac.notarize: false`，`afterSign` 钩子直接返回，不再校验一个它从未产生的签名。
- 身份与 Team ID 输入仍为必填，因为 builder 配置依旧解析它们；公证凭据集不再被读取。

## Alternatives considered

**用 ad-hoc 身份（`-`）签名。** 否决：seed 复验会把签名的叶权威与 Team ID 与发布身份比对，ad-hoc seed 会过不了它自己的校验步骤。

**在流水线之外手工拼装 seed。** 否决：等于重新实现已被拥有方负责的 seed 组装（lockfile、store 重写、归档、清单），并且会立刻与出货路径产生漂移。

**要求每一次本地打包都必须有证书。** 否决：这让没有 Developer ID 的部署完全无法验证打包后的外壳、首次启动的 seed 安装、插件安装乃至托盘。

## Consequences

未签名构建是 ad-hoc 本地产物，绝不是发布件：它既没有 Developer ID 签名也没有公证票据，其他机器上的 Gatekeeper 会拒绝它，签名与公证路径也不被它覆盖。其余全部走正式流水线，因此 seed 安装、profile 激活、插件恢复与外壳行为都按发布路径被验证。该开关只是构建输入；运行时没有任何代码读它。

## Testing

`apps/desktop/tests/macos-signature.spec.ts` 钉住该开关下的 builder 配置：在完全没有 `APPLE_*` 公证凭据的情况下，macOS 目标解析出 `identity: null`、`forceCodeSigning: false`、`notarize: false`，且它的 `afterSign` 钩子直接返回不做校验。该构建也在无代码签名身份的主机上端到端跑过：`DSH_DESKTOP_UNSIGNED_BUILD=1 … pnpm run package:desktop:mac:arm64:dir` 产出 `DSH Patent.app`（ad-hoc、`Identifier=Electron`、`TeamIdentifier` 未设置），它把 seed 装进全新的 `DSH_HOME`、启动后端，并打开已挂载工作台侧边栏的渲染进程。

## Related

- [Desktop composition mounts the workspace sidebar again](2026-09-10-desktop-workspace-sidebar-remount.zh.md) — 本次构建所携带的侧边栏挂载。
