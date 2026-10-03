# Agent Note: patent_pdf_download 经 CDP 取回 PDF 响应体

Status: implemented

[English](2026-10-03-patent-pdf-download-captures-pdf-response-body.md) | 中文

## Problem

本机上每一批下载都在为一条不可能成功的浏览器腿付账：`Page.setDownloadBehavior` 在 Chromium 152 上已不落盘，于是 ego 脚本对每一篇都等满 `downloadTimeoutMs`（默认 60 000），再把一个 `fallback` 项交给工具的 HTTP 兜底去下载同一条 CDN 链接。10 篇的批次最多白等十分钟，只为什么都没下到。#350 里 2026-10-03 的实测是单篇 63 410ms，而它当时的定性——「ego 对象只暴露任务空间与 CDP，取字节路径需要 ego 侧下载原语」——已不再成立：当前版本（`ego-browser 0.5.1.13 / chromium 152.0.7977.54`）暴露 `page.cdp()`、`page.events()`、`page.waitForEvent()`，并有文档化的 `download.saveAs()`。

## Decision

生成的 ego 脚本改为取回响应体，而不是等待下载：用 `Network.enable` 武装页面 → 导航到 CDN PDF 链接 → 经 `page.events()` 读该 URL 的 `Network.responseReceived` → 用 `Network.getResponseBody` 取字节。不以 `%PDF-` 开头的响应体不是要的文档，直接丢弃。取不到的仍按既有语义报 `fallback` 项（带提取到的 CDN 链接），由工具的 fetch 兜底下载——降级路径与输出 schema 都没变。

探测定下的两个细节：

- CDN 链接取 `.pdf` 那个锚点，而不是第一个 CDN 锚点：CN 实用新型页先给的是附图 PNG，旧选择器会取到它。
- 任务空间按名解析且**不回收**，使下一次调用落在同一空间并保留登录态与标签页（跨进程两次 `taskSpace('<name>')` 返回同一个 `spaceId`）；旧脚本会把它关掉。

改动后本机实测：真实三篇各 1.8–2.8s、PDF 有效；经工具端到端一篇 2 661ms，报 `method: browser`。

## Alternatives considered

- **保留拦截、只缩短首次轮询。** 否决：这条腿在本 Chromium 上根本不落盘，花在它上面的预算等于零收益。batch-10 交付的正是那个短路，已被本次取代。
- **`page.waitForEvent("download")` + `download.saveAs()`**（当前 ego API 文档给出的下载原语）。未采用：Google Patents 的 CDN 以 `application/pdf` 应答，浏览器是内联渲染而不是下载，而 CDP 取字节已在真实页面上验证；下载原语适用于以附件形式应答的来源。
- **页面内 `fetch`。** 否决：CDN 是跨域，页面自身发起的请求会被拒——这正是字节必须经 CDP 取的原因。

## Consequences

- `method: browser` 的含义由「浏览器下载落盘」变为「浏览器取回响应体」；输出 schema 与取值不变。`downloadTimeoutMs`（默认 60 000）现在是每篇取回响应体的期限，默认整体预算的推算不变、仍是上界。
- 这条腿不再依赖页面级下载行为，因此每篇 60s 的空等消失；没有可用 ego 浏览器的宿主机仍照旧退到「抓页面 + HTTP」通道。
- 该机制要求 ego 版本暴露 `page.events()` 与 `Network.getResponseBody`；没有时该篇经脚本的逐篇 `try` 退到 fetch 兜底，不会让整批失败。
- `record: true` 的截图证据本次未实测；它仍在 PDF 导航之后截当前页面。
- [patent_pdf_download 按调用解析数据服务](2026-09-21-patent-pdf-download-resolves-service-per-call.zh.md) 里的按调用解析决策与无浏览器通道都不变，只有浏览器腿拿页面做什么变了。
