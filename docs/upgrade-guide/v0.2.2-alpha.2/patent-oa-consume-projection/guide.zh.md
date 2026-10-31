---
kind: upgrade-guide
description: "`consumes` 的条目现在可以带投影名（`'claim-chart#rows'`）：该阶段提示词拿到的是上游产物的紧凑摘要，而不是它的格式化 JSON；未注册的投影直接报错，不再静默退回全文。"
---

# 上游产物以投影形态进入提示词

[English](guide.md) | 中文

## 变更

`consumes` 的条目可以带一个 `#` 片段，指明投影：

```ts
consumes: ['dispute-framing-refine', 'parse#oa-summary', 'claim-chart#rows', 'response-plan', 'adversary-model', 'generate_keywords']
```

不带片段就是全文，与从前一致。随版发布两个投影：`claim-chart#rows` 与 `parse#oa-summary`。

理由是篇幅，不是口味。原子阶段发布的是 `JSON.stringify(value, null, 2)`，八要素的对照表到手就是 4516 字，其中大半是 `"quote": ""`、`"verified": false` 这类撰写阶段根本不读的字段。在录制的审查意见案上，`draft` 提示词从 8500 字降到 4303 字，减 49%，而撰写要用的东西一样没少。

`claim-chart#rows` 把结论行渲染成表格——要素、权项、要素原文、对比文件、结论、pin-cite——再用一行按结论分组列出缺口。逐行引用留在 run 记录里，答复正文按要素编号回指，不复述比对过程。`parse#oa-summary` 直接取解析阶段自己写出的 `office_action_summary`；该键缺席（重放路径不跑原子）时退回原文并注明。

投影的形态是 `(text, state) => string`。它只整形文本，不做校验：解析不了就把原文连同原因一起交出——投影抛错会把「上游多写了一个字段」升级成运行失败。只有**未注册**的投影会抛错，两处：传入 `options.projections`（名册，与 `atomNames` 同形）时的 `validateWorkflowManifest`，以及渲染器（无条件）——拼错一个投影名不得悄悄退回全文注入。

## 迁移

1. 既有 manifest 不受影响：不带片段即全文。上游是结构化 JSON、消费方只用其中一部分时，再逐条选择启用。
2. 阶段 id 现在禁止包含 `#`：它会把条目拆开，解析到一个从不存在的阶段。
3. 重复检测改为按上游阶段 id 比对，`['s1', 's1#rows']` 判为重复——同一份产出取两遍，两种写法都是错的。
4. 两个投影按 `<阶段 id>#<投影名>` 注册，因此 manifest 只要沿用 `parse` / `claim-chart` 这个阶段 id 就自动可用。阶段 id 不同则先按全文传，暂不提供从配置注册投影的接口。
5. 本次只改提示词，回放不受影响——但下一次 `record` 得到的答复会不同。请与相邻阶段一起重录，不要逐阶段重录。
