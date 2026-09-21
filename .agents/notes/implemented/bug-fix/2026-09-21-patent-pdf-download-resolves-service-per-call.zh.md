# Agent Note: patent_pdf_download 按调用解析数据服务

Status: implemented

[English](2026-09-21-patent-pdf-download-resolves-service-per-call.md) | 中文

## Problem

本部署中 `patent_pdf_download` 每次调用都失败：2026-08-26 至 2026-09-21 的 143 个会话语料里 12 次调用 12 次失败，错误文本均为 `patent_pdf_download 需要 patent-data 服务（preset 挂载 @deepseek-ai/dsh-patent-data 后自动接线 ego 通道）；当前未挂载。`但 preset 确实挂载了该包，且与消费方同处一个 isolate 领域——错误文案指认的原因并不成立，把读者引向了一行本来就存在的配置。

真正的缺陷是激活顺序。`PatentData` 声明 `static inject = ['subprocess']`，其 fiber 要等宿主的 `subprocess` 服务存在才会激活；而 `dsh-patent-tools` 声明 `inject: ['tools']`，会比提供方早一个依赖跳激活。`packages/patent/patent-tools/src/index.ts` 正是在那次 apply 中读取一次 `ctx.get('patentData')` 并把它保存在闭包里：读取发生在提供方激活之前，于是所有按此顺序组合的运行时都注册了 fail-loud 桩——一个接线缺陷，以"未挂载"的形态呈现给模型。

同一语料给出了下游代价：工具长期失败后，代理改为手工下载专利——132 次 `patentimages.storage.googleapis.com` 直链与 366 次 `pdftotext` 命令——一个本已存在的工具能力，被绕过在工具本会留下的审计痕迹之外执行。

## Decision

下载通道改为按调用解析服务，而不是在 apply 期取值：

```ts ignore-check
const runEgo = createDownloadChannelRunner(() => ctx.get('patentData'))
```

`createDownloadChannelRunner`（位于 `packages/patent/patent-tools/src/tool/patent-pdf-download-channel.ts`）在每批下载时查询该 lookup。服务在场则走 ego-browser 通道；服务缺席、或其浏览器自报不可用（`setup_required`）时，退回无浏览器通道：抓取每篇专利页面的 CDN PDF 链接，把该 URL 交给工具既有的 fetch 兜底（`networkFetch`，带界重试、超时与 `Retry-After` 退避）。不属于 setup 问题的 ego 故障——脚本超时、返回不可解析、启动失败——仍然让调用失败，避免真实故障伪装成降级成功。

## Alternatives considered

- **保留 fail-loud 桩，依赖 preset 里那一行。** 否决：那一行确实存在。桩的消息断言依赖缺失，而真实故障是消费方"何时"去取它——这正是审计最初把该失败读成"preset 漏挂 patent-data"的原因。
- **在 `dsh-patent-tools` 上声明 `inject: ['patentData']`。** 否决：这会让全部 29 个专利工具都依赖一个可选数据服务，没有 ego 栈的宿主会连同检索、撰写、附图工具一起失去下载能力。
- **在 `ctx.inject(['patentData'], …)` 回调里注册工具。** 否决为主机制：服务缺席时该工具仍须出现在工具目录中（它是带降级路径的既有能力），而从回调注册意味着要么多一条注册路径、要么工具在会话中迟到；按调用解析还能跨越服务重启，一次性注册不能。
- **放弃 ego 通道，永远走抓取。** 否决：浏览器内拦截复用操作者的登录态，能保存仅靠 CDN 链接取不到的文件；兜底的存在是为了在无浏览器时仍可用，而不是取代它。

## Consequences

- 在服务迟到激活的组合里下载恢复可用；无可用浏览器时也能继续。十条通道测试覆盖 ego、浏览器不可用、服务缺席与非 setup 故障路径，另有一条组合测试复现该时序：只声明 `tools` 的消费方在 apply 期观察到 `ctx.get('patentData')` 为 undefined，一个 tick 后观察到该服务。
- 无浏览器的一批下载会对每篇专利先做一次页面抓取，比拦截路径慢，且依赖承载 CDN 链接的页面结构。
- 无浏览器通道依赖抓取自身的请求超时：LRU 缓存的抓取接缝（`cachedScrapePatent`）既不接受按次超时也不接受中止信号，一批抓取无法中途中止。模块文档已写明该限制。
- 工具对外契约未变——输出 schema、MANIFEST 断点续传、逐篇失败报告都保持原样；变化的只是由哪条通道服务该批下载，以及这批下载是否还会运行。
