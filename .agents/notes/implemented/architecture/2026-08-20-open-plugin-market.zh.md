# Agent Note：开放插件市场（ctx.pluginMarket）

Status: implemented

[English](2026-08-20-open-plugin-market.md) | 中文

## 问题

harness 没有开放的插件目录或受管安装管线：一切安装都走裸 `dsh plugin add`，无回滚、无 receipt 轨迹、无目录发现。第三方宿主与社区市场各自发明协议。

## 决策

新增 `@deepseek-ai/dsh-host-plugin-market`，以能力缝隙（Service Definition + 默认提供者）提供 `ctx.pluginMarket`：

- **目录协议**——用户注册的 HTTPS 源按 `docs/schemas/` 下的 wire schema 校验（源 manifest、查询、提供者分页、快照）。只发送源声明的查询参数；每条条目都盖上来源 provenance。
- **受限客户端**——`restricted-fetch.ts` 强制仅 HTTPS、禁止 URL 凭据与 fragment、在 DNS 解析前后封锁 loopback/私网/链路本地/metadata 目标、逐重定向重校验，并限制大小、超时与重定向深度。
- **受管安装**——`install.ts` 在 `pnpm add` 前快照 profile 清单，失败回滚，持久化支撑卸载的 receipt（校验 receipt 与 profile 匹配）。provider 以 registry 预览作为安装门禁：deprecated、无 dist、带生命周期脚本的包不会进入 profile。
- **CLI**——`dsh plugin source add|remove|list`、`search`、`preview`、`install`、`uninstall` 对解析出的 profile 运行同一管线。

源持久化于 `<profileDir>/.dsh-plugin-market/sources.json`；receipt 位于 `.../receipts/`。

## 影响

开放目录契约立到上游，第三方宿主与社区市场可收敛到同一协议。安装安全（快照/回滚/receipt）成为市场安装的默认路径。延后：安装恢复 WAL 与目录图标媒体代理（当前恢复机制是 receipt 轨迹），以及缝隙之上的 Web 设置页。

## 备选方案

- 以 npm registry 商店作为默认目录源：否决——无默认来源、无兜底来源、一次一个来源。
- 向渲染器客户端暴露包管理器运行器：否决——CLI 与 provider 是仅有的消费方；receipt 与快照留在服务端。
