# Agent Note: 限制 Synapse 工作区详情请求的并发

Status: implemented

[English](2026-08-27-bounding-synapse-workspace-fetch.md) | 中文

## 问题

`packages/web/synapse/assets/app.js` 里的 `threadsForDshWorkspace` 为了解析某个 dsh 工作区的 threads，用一次无上限的 `Promise.all` 请求**每一个**工作区摘要的详情：

```js
const projections = await Promise.all(state.summaries.map(summary => api(`/synapse/api/workspaces/${summary.id}`)))
```

用户每打开一个 dsh 工作区，就会按每个摘要同时打出一路 `GET /synapse/api/workspaces/<id>`。工作区一多，渲染进程便耗尽它的请求预算，Chromium 会在一整批这些请求上报 `net::ERR_INSUFFICIENT_RESOURCES`——渲染进程对一大串工作区 ID 报「Failed to fetch」，且同一 ID 在函数重跑时被反复请求。

## 决策

把请求按有界批次折叠，而不是一次爆发：

```js
const summaries = state.summaries
const projections = []
for (let i = 0; i < summaries.length; i += 5) {
  const batch = summaries.slice(i, i + 5)
  projections.push(...await Promise.all(batch.map(summary => api(`/synapse/api/workspaces/${summary.id}`))))
}
```

任意时刻最多有 5 个 `api` 调用在途；切片顺序确定，下方投影的 `flatMap` 过滤不变。单次遍历不会重复拉取同一工作区，函数也不再淹没渲染进程。

## 备选方案

**后端加一个批量端点，一次返回所有工作区。** 否决，因为这会为一个视图局部的问题改动宿主 API 表面；前端本就按 id 拉取，修复属于调度，不属于线上契约。

**只拉当前工作区的详情。** 否决，因为该函数刻意扫描所有投影，以找到属于请求的 `sessionIds` 的 threads——这些 threads 分散在各工作区，单次详情拉取会漏掉它们，除非改变 schema。

**不改；容忍失败请求。** 否决，因为资源耗尽会劣化会话地图表面，并可能先于渲染进程崩溃。

## 影响

工作区详情请求现在分散在时间上，而不是一次性全发，渲染进程不再触发 `net::ERR_INSUFFICIENT_RESOURCES`；会话地图视图上的「Failed to fetch」提示消失。请求总数不变（该函数仍读取每个摘要），分批循环带来少量串行化代价，相比每请求延迟可忽略。
