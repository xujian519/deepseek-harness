---
description: "宿主 Remote 属主，面向开放插件目录发现表面：把只读 plugin-market seam 投影到生成的 pluginMarket 命名空间，供浏览器发现与预检。"
kind: "package-reference"
---
# 插件市场控制器

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-api-plugin-market-controller` 为浏览器插件发现暴露生成的 `ctx.remote.pluginMarket` 命名空间。它只转发 `ctx.pluginMarket` seam 的只读面——来源列表、来源目录搜索与安装预检——到浏览器。安装与卸载仍由 `dsh plugin` profile CLI 独占：该控制器不暴露任何写操作，因此浏览器会话能发现并预检插件，但永不修改 profile。当 plugin-market 提供方缺失时，命名空间保持已注册并以可行动配置错误返回，而不是静默缺失。

不发布运行时不变式伴生；插件市场能力继承目录来源、安装凭据及其事件，本包仅将其只读方法投射到线上。


## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把该包作为 Loader 条目挂进服务于浏览器插件发现表面的 profile（`dsh-web-app` bundle 就是这样）。条目独立于其提供方注册 `pluginMarket` 命名空间，因此提供方缺失会在调用时产生命名的 `internal` 失败，而不是缺失命名空间。其生成的描述符进入严格 Typert 注册表。

`listSources()` 返回宿主已注册的每个目录源，包含 `builtin` 标记，浏览器据此分辨离线捆绑目录与网络目录。`search(sourceId, query)` 把一条 `CatalogQuery` 转发到某个源，返回带来源印记的 `CatalogPage`；不支持的查询字段由提供方丢弃。`preview(ref)` 对 `name@version` 引用向注册表做预检，并返回 `InstallPreview`，不触碰 profile。

每个方法都把 seam 抛出的 `PluginMarketError` 映射为 `TypertRemoteFailure`，其 `code` 是业务闭集码，因此浏览器看到 `source-not-found`、`preview-failed`、`network` 等，而非不透明传输错误。任何其他失败变成 `internal` 并携带提供方消息。浏览器侧的 `result.error` 因此是携带业务码的类型化失败。

-----

<a id="model-experience"></a>
## 模型体验

无。插件发现是浏览器与宿主状态，不注册任何 prompt、tool 或 session 事件。

#### KV Cache 影响

无直接影响；读取 plugin-market 状态不改变已在途的模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **构造即只读**——该控制器不暴露任何安装或卸载方法。安装与卸载被有意留给 `dsh plugin` profile CLI，以使浏览器会话无法修改 profile。
- **尚无线上 HTTPS 目录源**——shipped 组合提供一个内置离线目录源，因此无需网络端点即可发现；但远程 HTTPS `dsh-plugin` 目录已延期。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
