# Agent Note：patent_pdf_download 把整体预算按它自己的降级路径来算

Status: implemented

[English](2026-10-03-patent-pdf-download-budget-covers-degradation.md) | 中文

## Problem

`patent_pdf_download` 的默认整体超时按每篇固定 25 秒推算——`clamp(篇数 × 25s, 60s, 180s)`——而同一个请求交给 ego 腿的是 `pageTimeoutSec`（默认 20 秒）加 `downloadTimeoutMs`（默认 60 秒），每篇 80 秒。于是单篇调用用 60 秒的预算去盖最多 80 秒的许可工作量，三篇调用用 75 秒去盖 240 秒。

这个缺口只有走到工具自己文档化的回退路径时才会暴露。浏览器可用但脚本出错时 ego 腿会让整批直接失败，而「浏览器不可用」恰恰是回退到页面解析 + HTTP 下载的那一种情况。在本部署的 ego-browser 0.5.1.13（Chromium 152）上，拦截从不落盘，于是这条腿会先烧满整个轮询预算再回退——而整体超时更早一步掐断调用。2026-10-03 用真实案件的对比文件实测：默认调用在 60,007 毫秒时以 `patent_pdf_download 超出 ego-browser 整体超时` 结束，而同一次调用显式传 `timeoutMs: 180000` 后经 HTTP 兜底在 63,410 毫秒成功。

## Decision

默认值改由它所包住的单篇预算推算，加一次批级设置开销，并以入参自身的 300 秒为上限：

```ts ignore-check
const perPatentMs = pageTimeoutSecValue * 1000 + downloadTimeoutMsValue
timeoutMs = Math.min(300_000, Math.max(60_000, patents.length * perPatentMs + PER_BATCH_OVERHEAD_MS))
```

`PER_BATCH_OVERHEAD_MS` 取 15 秒。显式传 `timeoutMs` 的调用方不受影响。

## Alternatives considered

- **缩短 `downloadTimeoutMs`，让各项之和落回旧上限。** 否决：那个轮询预算正是可用的拦截路径下载大 PDF 所需要的，压缩它等于拿坏掉部署的时延去换正常部署的正确性。
- **让 ego 脚本在整体截止前先吐出部分结果。** 暂缓而非否决：这需要把截止时间传进脚本并为每篇留出余量，而且它本身并不让默认值与它所包的预算自洽。
- **改修拦截本身。** 在可用的接口面上做不到：`Page.setDownloadBehavior` 在 Chromium 152 上已失效（15 秒内目录没有任何文件落地），`Browser.setDownloadBehavior` 不在 `cdp` 的暴露面里（`'Browser.setDownloadBehavior' wasn't found`），经 `sendCDPMessage` 发送时也不产生任何效果，而在页面上下文里 `fetch` 那个 CDN 链接被 CORS 拒绝。`ego` 对象只暴露任务空间与 CDP，没有下载原语。

## Consequences

- 拦截卡住的默认批次现在会经 HTTP 兜底跑完，而不是失败；代价是先花掉 ego 轮询（每篇约 60 秒）。每篇仍然报告 `method` 与落盘路径，MANIFEST 续传行为不变。
- 工具的 schema 描述与 `timeoutMs` 的 JSDoc 写明新公式；`docs/tool-catalog.md` 及其中文配对重新生成。
- `patent-pdf-download.spec.ts` 断言推算结果与单篇预算之和的关系、显式 `pageTimeoutSec`/`downloadTimeoutMs` 参与推算、60 秒下限与 300 秒上限。
- preset 的 PDF 通道成为有顺序的降级链——先工具，再退避重试一次并换用 CNIPR、CNIPA、Google Patents 通道技能，最后才是直链且必须写明失败原因与所用通道；它引用的「检索通道顺序」现在指向同一条里已列出的顺序，而不是一个从未定义的章节。
