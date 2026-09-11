# Agent Note：macOS 桌面端无签名构建

Status: implemented

[English](2026-09-11-desktop-unsigned-macos-builds.md) | 中文

## 问题

macOS 发布打包从构造上就绑定签名：`prepare:dsh` 为物化运行时中的每个 Mach-O 文件签名，`electron-builder` 带着 `forceCodeSigning` 接收 Developer ID 身份，`afterSign` 与磁盘映像钩子则验证或公证该身份产出的结果。发布环境会在一开始就解析这些输入，因此没有代码签名身份的构建主机无法产出任何可安装的应用——连用于本地测试的也不行——而同样的代码树在 `pnpm run dev:desktop` 下运行正常。

## 决策

`DSH_DESKTOP_UNSIGNED=1`（即 Windows 目标早已通过 `--unsigned` 选择的模式）现在覆盖 macOS：

- `prepare:dsh` 跳过运行时签名，保留其余每一个准备步骤。
- 构建器配置不再读取 Developer ID 与公证输入，并设置 `mac.identity: null`、`mac.forceCodeSigning: false`、`mac.notarize: false` 与 `dmg.sign: false`。其 `afterSign` 与 `artifactBuildCompleted` 钩子在其未曾创建的签名上做验证或公证之前直接返回。
- `package:mac:arm64:unsigned` 与 `package:mac:x64:unsigned` 暴露该模式。处于该模式下的 macOS 目标走普通 electron-builder 路径，而不是 App/DMG 公证拆分。

`identity: null` 而非省略该字段是关键：当该字段为 `undefined` 时 electron-builder 会回退到钥匙串身份，而这正是 `CSC_IDENTITY_AUTO_DISCOVERY=false` 已为 Windows 抑制的自动发现。

## 考虑过的替代方案

**为 macOS 增加第二个标志。** 否决：`--unsigned` 已经表示"产出一个不含发布身份的本地产物"，一个模式两个名字必然漂移。

**保留非 Windows 拒绝，并要求本地 macOS 构建提供 Developer ID。** 否决：这会让没有 Developer ID 的部署完全无法验证打包后的 shell、首次启动的运行时准备、插件安装或托盘。

**用 ad-hoc 身份（`-`）签名运行时。** 否决：`verifyMacOSRuntimeCode` 会把叶证书颁发机构与 Team ID 与发布身份比对，因此 ad-hoc 运行时在其后的验证中失败。

## 后果

无签名构建是本地 ad-hoc 产物，永远不是发布版本：它不含 Developer ID 签名与公证票据，在其他机器上会被 Gatekeeper 拒绝，签名与公证路径也不会被它走到。其余部分都是正式流水线，因此运行时准备、配置激活、插件恢复与 shell 行为都按发布版本的方式得到验证。该模式仅是构建输入，运行时没有任何代码读取它。它同样不写发布完成记录，因此无签名构建无法作为发布版本上传。

## 测试

`apps/desktop/tests/macos-signature.spec.ts` 固定构建器配置：在 `DSH_DESKTOP_UNSIGNED=1` 且没有任何 Developer ID、Team ID 或 `APPLE_*` 输入存在时，macOS 目标解析出 `identity: null`、`forceCodeSigning: false`、`notarize: false`、`dmg.sign: false` 与 null 发布目标。`apps/desktop/tests/package-target.spec.ts` 固定每个发布目标都接受 `--unsigned`。
