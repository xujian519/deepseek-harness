# Agent Note: Synapse 画布分页、CSP 安全头与资产测试策略

Status: implemented

[English](2026-08-22-synapse-paging-and-security-headers.md) | 中文

## Problem

复刻的 Synapse 会话地图（`packages/web/synapse` 宿主行 + `packages/client/synapse` `dsh.client` 行）只覆盖了主路径，留下四个缺口。`/synapse/api/sessions/:id/history` 端点一次返回整个会话日志，长对话会让详情视图一次性加载并渲染全部内容。`/synapse` 页面与 API 只靠 Host 头 DNS 加固栅栏，没有任何 Content-Security-Policy 或 MIME 嗅探响应头。画布桥接（`post`/`dshRpc`/`settleRpc` 这套 requestId RPC 原语，以及文件尾部的 `message` 监听器——它负责把宿主到画布的事件路由起来）没有测试覆盖，桥接一旦被破坏会静默让 create/fork/send 全部失效。而 Web 表层扩展点没有出现在 `docs/architecture.md` 的「在哪里添加新行为」映射里，也不在 `web-app` 组合包 README 名册中。

## Decision

历史端点现在分页。`projectHistory(events, options?)` 先投影完整去噪列表（这样工具折叠会在边界处完整收拢），再按**排除式** `beforeSeq`（`sourceSeq < beforeSeq`，边界消息不会重复）过滤，并保留最近的 `limit` 条。路由解析 `limit`/`beforeSeq`（非法值 → 400），返回 `{ messages, hasMore }`，其中 `hasMore` 是「满足过滤的投影总数 > 返回条数」。画布 `loadThreadHistory` 始终带上 `limit`（默认 200），「加载更早」按钮以 `beforeSeq = 已加载最旧 sourceSeq` 请求更早一段并**前置**，保持升序；`state.historyHasMore` 控制按钮是否渲染。默认（无 options）仍返回全量，现有调用不变。

`/synapse/`（HTML 文档）现在带严格 `Content-Security-Policy`——`default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'`——外加 `Referrer-Policy: no-referrer`。每个 `/synapse` 响应（HTML、JS、CSS、API）都带 `X-Content-Type-Options: nosniff`。CSP 刻意只落在文档上：浏览器会忽略非文档响应上的 CSP。该资产兼容，因为 `app.js` 没有 `eval`/`new Function`/`blob:`/WebSocket，页面用外部同源 URL 加载 script 与 style（无内联脚本）；`styles.css` 只引用同源 `/synapse/deepseek-mark.svg`，地图使用内联 `style` 属性，由 `style-src 'unsafe-inline'` 允许。

`docs/architecture.md` 的「在哪里添加新行为」表新增一行，把 Web 表层会话地图/视图映射到宿主行 + `dsh.client` 行；`web-app` README 名册点名 `synapse` 与 `synapse-client`。

快照政策决策在此记录而非静默扩展：画布 UI 仍是客户端快照门禁之外的静态资产（两个包的 README 已声明这一点）。桥接契约改由新增的 jsdom 集成测试 `packages/web/synapse/tests/canvas-bridge.client.spec.ts` 固定——它把整份已提交的 `assets/app.js` 求值进 jsdom window，断言 post 载荷、RPC settle/路由与 message 路由。对运行中的服务器做 live curl 确认了实际输出的响应头；CSP 兼容性声明经静态核查确认。

## Alternatives considered

- **用两次 `projectHistory` 调用分别取页与计数。** 否决：`projectHistory` 是单一语义来源，单次投影就廉价且有界，因此路由只调用一次（不带 limit），对结果过滤列表就地切片，`hasMore` 从同一数组推导，而非重投影事件列表。
- **复用 `state.historyBySession` 存 `{ messages, hasMore }`。** 否决：`persistedMessagesFor` 把该会话值当纯数组读取，对象会弄坏详情视图；用并行的 `historyHasMore` 映射保持数组契约不变。
- **把地图内联成一个文档。** 否决：它是从 `/synapse/app.js` 托管的已提交静态资产，这既让浏览器表层可复现又可缓存；CSP 只需放行同源外部脚本。
- **扩展快照 harness 覆盖画布 UI。** 本改动否决：地图是 iframe 内自足的静态脚本、自带 markdown 渲染器，不是快照 harness 的 transcript；jsdom 桥接回归才是诚实且更便宜的契约测试（在此记录，避免被无声重新争论）。

## Consequences

- 长会话不再一次性全量加载：详情视图先展示最近 200 条，按需加载更早的段落，超长对话保持响应。
- `/synapse` 表层在 Host 栅栏之上获得真正的 CSP 纵深防御，非文档响应做了 MIME 嗅探；`frame-ancestors 'self'` 保持 DSH 同源 iframe 可用，同时挡住来自他处的嵌入。
- 分页与响应头改变了已交付的 API 表层，因此两个 README 的「已知限制」相应更新，双语配对重新记录。
- 原本零覆盖的画布桥接由 jsdom 全量装载回归固定；快照门禁继续排除该 iframe UI。
