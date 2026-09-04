---
description: "可选的 IM 集成 profile bundle：[`cordis.patch.yml`](cordis.patch.yml) 在任意 surface profile 之上插入唯一的 `xmanrui-dsh-im` 行，固定外部 [`@xmanrui/dsh-im`](https://github.com/xmanrui/dsh-im) 插件。该插件把至多九个 IM 渠道（微信、飞书、钉钉、企业微信、QQ、Slack、Telegram、Discord、WhatsApp）以及一个公网 AI Office 连接器接入本机 Harness。本包是静态 patch 容器、无运行时 API；profile composer 通过 `dsh.bundle.patch` 清单字段解析 patch，从不通过代码。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-im`

[English](README.md) | 中文

## 概述

可选的 IM 集成 profile bundle：[`cordis.patch.yml`](cordis.patch.yml) 在任意 surface profile 之上插入唯一的 `xmanrui-dsh-im` 行，固定外部 [`@xmanrui/dsh-im`](https://github.com/xmanrui/dsh-im) 插件。该插件把至多九个 IM 渠道（微信、飞书、钉钉、企业微信、QQ、Slack、Telegram、Discord、WhatsApp）以及一个公网 AI Office 连接器接入本机 Harness。本包是静态 patch 容器、无运行时 API；profile composer 通过 `dsh.bundle.patch` 清单字段解析 patch，从不通过代码。

本包**不是**任何内置 profile 模板的成员：`dsh-base`、`dsh-web-app`、`dsh-desktop-app` 都不引用它，因此没有 surface profile 默认加载 IM。profile 通过把 `@deepseek-ai/dsh-im` 加进其 `dsh.profile.bundles` 列表选择启用；在已安装的 `dsh` 上则是 `dsh plugin --profile <name> add @deepseek-ai/dsh-im`（CLI 的 `reconcilePlugins` 因其清单声明了 `dsh.bundle` 而把它追加进去）。In-box bundle 解析——名字先在本 dsh 安装中解析、再在 profile 自身的 `node_modules` 中解析——使 wrapper 对任意 profile 可用，同时把 IM 排除在默认闭包之外。

wrapper 把 `@xmanrui/dsh-im@3.0.5` 固定为单一依赖，为仓库提供唯一的命名入口与固定版本，也为 IM 文档与门禁提供归属地。上游包是外部 MIT 项目；除 patch 外，本 bundle 不贡献任何自身代码。

不发布运行时不变式伴生；本包是静态 patch 列表载体（由其他包持有的 loader 行的 YAML 文档），不挂载服务或事件，也没有可检查的可变关系；被固定的 xmanrui-dsh-im 行由其所属包承载对应插件的不变式。


## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

间接，经由被固定的行：`xmanrui-dsh-im` 行激活 `@xmanrui/dsh-im`，后者拥有自己的 model-visible 文本（host 与 client 插件面）与工具注册。本 bundle 自身不贡献任何 model-visible 文本、也不贡献工具。

#### KV Cache effect

无直接影响；被固定的 `@xmanrui/dsh-im` 包拥有其自身效果。

## Known Limitations and Deferred Work

- **IM 是选择启用、非默认** —— 启用该 bundle 会把 IM SDK 依赖闭包（`@tencent-connect/qqbot-*`、`@wecom/aibot-node-sdk`、`dingtalk-stream`、`qrcode`）挂到 profile 并浮现 IM 设置页；未列出它的 profile 不受影响。
- **被固定的上游是外部项目** —— `@xmanrui/dsh-im` 固定为 `3.0.5`；升级它需重新核对它相对所安装 core 的 `@deepseek-ai/dsh-*` 服务契约（它 inject `connection`、`credentials`、`webServer`、`typertGateway`）。

### 开发备注

无。
