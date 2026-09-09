---
description: "可选的 IM 集成 profile bundle：[`cordis.patch.yml`](cordis.patch.yml) 在任意 surface profile 之上插入唯一的 `xmanrui-dsh-im` 行，固定外部 [`@xmanrui/dsh-im`](https://github.com/xmanrui/dsh-im) 插件。该插件把至多九个 IM 渠道（微信、飞书、钉钉、企业微信、QQ、Slack、Telegram、Discord、WhatsApp）以及一个公网 AI Office 连接器接入本机 Harness。本包是静态 patch 容器、无运行时 API；profile composer 通过 `dsh.bundle.patch` 清单字段解析 patch，从不通过代码。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-im`

[English](README.md) | 中文

## 概述

可选的 IM 集成 profile bundle：[`cordis.patch.yml`](cordis.patch.yml) 固定外部 [`@xmanrui/dsh-im`](https://github.com/xmanrui/dsh-im) 插件，该插件把至多九个 IM 渠道（微信、飞书、钉钉、企业微信、QQ、Slack、Telegram、Discord、WhatsApp）以及一个公网 AI Office 连接器接入本机 Harness。本 bundle 是静态 patch 载体，无运行时 API、不贡献自身代码；上游包为 MIT 许可，固定在 `3.0.5`。没有任何内置 profile 包含它：启用方式是把 `@deepseek-ai/dsh-im` 加进 `dsh.profile.bundles`，或执行 `dsh plugin --profile <name> add @deepseek-ai/dsh-im`。


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

不发布运行时不变式伴生；本包是静态 patch 列表载体（由其他包持有的 loader 行的 YAML 文档），不挂载服务或事件，也没有可检查的可变关系；被固定的 xmanrui-dsh-im 行由其所属包承载对应插件的不变式。
