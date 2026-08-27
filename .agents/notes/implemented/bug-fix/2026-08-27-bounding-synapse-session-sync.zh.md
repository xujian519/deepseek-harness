# Agent Note: 限制 Synapse 会话同步 POST 的频率

Status: implemented

[English](2026-08-27-bounding-synapse-session-sync.md) | 中文

## 问题

`packages/client/synapse/src/client/index.ts` 里的 `syncSessions` 在会话或工作区列表每次变化时就 POST `/synapse/api/sessions/sync`，只做了微任务级合并：

```js
const syncSessions = () => {
  if (syncQueued) return
  syncQueued = true
  queueMicrotask(() => {
    syncQueued = false
    // ... POST /synapse/api/sessions/sync ...
  })
}
```

`ctx.sessions.list` 与 `ctx.workspaces.list` 都订阅了 `syncCurrentSession`，所以爆发并非来自单个循环，而是运行时在每次列表变化时触发该订阅。团队任务会快速生成大量 subagent 会话，令该订阅反复触发；每个微任务批次都发出一次 sync POST。后端处理每个 POST 时对完整投影跑 `store.syncSessions` 并返回工作区摘要，这又会重新武装工作区订阅，形成循环互相喂。渲染进程的并发请求预算被耗尽，Chromium 报出 `net::ERR_INSUFFICIENT_RESOURCES`，可能先于会话地图白屏背后的渲染进程崩溃。

## 决策

用 trailing debounce 取代微任务级合并，把一次爆发折叠成一次 POST：

```js
const SYNC_DEBOUNCE_MS = 300
const syncSessions = () => {
  if (syncTimer !== 0) window.clearTimeout(syncTimer)
  syncTimer = window.setTimeout(() => {
    syncTimer = 0
    const sessions = sessionRows()
    const sessionIds = new Set(sessions.map(session => session.id))
    const removedSessionIds = [...knownSessionIds].filter(id => !sessionIds.has(id))
    knownSessionIds = sessionIds
    void fetch('/synapse/api/sessions/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessions, removedSessionIds }),
    }).catch(() => {})
  }, SYNC_DEBOUNCE_MS)
}
```

定时器在销毁时清除。`removedSessionIds` 从 debounce 窗口结束后的最终快照计算，而非从开启窗口的第一次变化计算，因此在窗口内「消失又重现」的会话不会被误报为已移除；被移除且未复活的会话仍会报告一次。

## 备选方案

**保留微任务级合并，不加 debounce。** 否决，因为爆发跨越的是宏任务，而非单个微任务批次：同一 tick 内的多次列表变化会被合并，但跨 tick 的变化各自 POST，而这正是团队任务的特征。

**后端批量或限流。** 否决，因为爆发属于前端调度问题；后端 `store.syncSessions` 重放已是 revision 键控且廉价。

**提高渲染进程请求预算 / 调 Chromium。** 否决，这既不是本仓库的可配置项，也不是对 sync→workspaces→sync 闭环的修复。

## 影响

Sync POST 现在被限制为每 300 ms 的会话/工作区抖动约一次，而非每次订阅触发一次，渲染进程不再触发 `net::ERR_INSUFFICIENT_RESOURCES`。同步载荷总量不变——debounce 仍发送最终的完整会话集合。这与先前对工作区详情和线程历史加载的拉取侧分批是互补关系，而非替代：那次改变限制了有多少详情请求在途，这次改变限制了会话同步被推送多久一次。
