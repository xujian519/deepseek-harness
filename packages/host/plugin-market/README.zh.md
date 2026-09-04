---
description: "开放插件目录缝隙（`ctx.pluginMarket`）：用户注册的 HTTPS 目录源、目录搜索，以及带快照/回滚与持久 receipt 的受管安装管线。远程目录载荷一律视为不可信输入——按 `docs/schemas/` 下的 wire schema 校验，并经受限 HTTPS 客户端获取。"
kind: "package-reference"
---

# `@deepseek-ai/dsh-host-plugin-market`

[English](README.md) | 中文

## 概述

开放插件目录缝隙（`ctx.pluginMarket`）：用户注册的 HTTPS 目录源、目录搜索，以及带快照/回滚与持久 receipt 的受管安装管线。远程目录载荷一律视为不可信输入——按 `docs/schemas/` 下的 wire schema 校验，并经受限 HTTPS 客户端获取。

不发布运行时不变式伴生；该能力的权威性位于 provider 持久化的 source/receipt 文件中，由 provider 自行观测。


## 目录

- [能力](#what-it-does)
- [组合](#composition)
- [安全边界](#security-boundary)
- [模型可见性](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

<a id="what-it-does"></a>
## 能力

- **目录协议**——源是 manifest（见 [`docs/schemas/catalog-source.schema.json`](docs/schemas/catalog-source.schema.json)），声明身份、署名、传输 base URL 与支持的查询参数。查询发往 `baseUrl + /v1/plugins`；分页遵循 [`catalog-provider-page.schema.json`](docs/schemas/catalog-provider-page.schema.json)。只发送源声明的参数；每条条目都盖上来源 provenance。
- **受限网络**——`restricted-fetch.ts` 强制仅 HTTPS、禁止 URL 凭据与 fragment、在 DNS 解析前后封锁 loopback/私网/链路本地/metadata 目标、逐个重校验重定向，并限制响应大小、超时与重定向深度。
- **受管安装**——`install.ts` 在 `pnpm add` 前快照 profile 的 `package.json`/`pnpm-lock.yaml`/`pnpm-workspace.yaml`，失败回滚，每次成功安装持久化 receipt。卸载前校验 receipt 与当前 profile 一致再执行 `pnpm remove`。provider 以 registry 预览作为安装门禁：deprecated、无 dist、带生命周期脚本的包不会经市场进入 profile。
- **CLI**——`dsh plugin source add|remove|list`、`dsh plugin search`、`dsh plugin preview`、`dsh plugin install`、`dsh plugin uninstall` 对解析出的 profile 运行同一管线。

<a id="composition"></a>
## 组合

以 profile 目录为配置挂载 provider：

```yaml
- id: plugin-market
  name: '@deepseek-ai/dsh-host-plugin-market'
  config:
    profileDir: /absolute/path/to/profile
```

源持久化于 `<profileDir>/.dsh-plugin-market/sources.json`；receipt 位于 `<profileDir>/.dsh-plugin-market/receipts/`。

<a id="security-boundary"></a>
## 安全边界

目录收录 ≠ 安全审核：被收录的包以当前用户权限安装并运行。受限客户端只允许主机获取有界内容；预览管线拒绝 deprecated 与无 dist 的发布并明示生命周期脚本。无签名校验——信任模型是显式声明的。

<a id="model-experience"></a>
## 模型可见性

无——本包不注册提示文本、工具 schema 或模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 预览的 Node 引擎检查是对首个比较器的启发式判断；配置 `engine-strict` 时包管理器仍是权威。
- 安装恢复（中断安装的 WAL）与目录图标媒体代理延后；当前恢复机制是 receipt 轨迹。

### 开发备注

无。
