# Agent Note: A deliverable's identity is its resolved path, not its spelling

Status: implemented

[English](2026-10-24-deliverable-identity-is-the-resolved-path.md) | 中文

## Problem

`document_deliver` 允许 `path` 是工作区相对路径或绝对路径，而交付工作室（`packages/client/ui-document-studio`）直接把调用写下的那个字符串当作交付物的身份。于是同一文件的两份拼写成了两行，且用其中一种拼写改写，撤不掉以另一种拼写记录的核验结论。

实测到的失败是：先 `write` `out/report.html`，再 `document_deliver` 登记 `/Users/me/work/out/report.html`，界面出现两条条目——第二条带 `format`、`gate` 与 `checks`，第一条什么都没有。用户会两次看到同一个文件，且无从判断哪一行描述的是磁盘上的字节。

缺口在两处，只有两处都补上才算闭合：

- **客户端以原始字符串为键。** `producedFromTimeline` 用 `seen.get(entry.path)` 去重，登记元数据也按同一字符串匹配；`mutationPath`/`pathValue` 保留调用方的拼写，`workspace-probe` 的 `samePath` 只去掉开头的 `./`。
- **宿主以声明路径为键记录核验报告。** 即使客户端完全规范化，也无法把 `checks` 报告接到以另一种拼写记录的交付物上，因为 `checksMeta()` 逐字投影的报告以 `entry.path` 为键。

## Decision

**交付物的身份是宿主解析后的规范路径；声明拼写只是显示文本。**

`DeliverableCheckReport` 与工作室的 `DocumentDeliverable` 都带一个可选的 `identity`，取值为 `ctx.fs.processPath(resolveTarget(...))`——正是文件变更工具早已写入 `tool/result` 的 `meta.path` 的那个规范绝对路径。`path` 保留调用方写下的拼写。

凡是判断"是不是同一个文件"的消费方都用 `identity`，凡是展示路径的消费方都展示 `path`：

- `producedFromTimeline` 以身份为键折叠，因此一个文件只有一行。
- 一行同时认领**两个**键——它的身份，以及它首次出现时的拼写。这是刻意的并集而非只用身份作键：跨越本次变更录制的日志里，变更调用解析出了身份，而登记结果没有记录身份；只用身份作键会把那个文件重新拆成两行。同时认领两个键，使折叠永远不会比"仅按声明路径"时合并得更少。
- `unreadable_ack` 条目按同一规范身份匹配文件，因此用一种拼写写下的原因能解释以另一种拼写声明的文件，"指向未登记的路径"提示也不会为同一个文件的两份拼写而响。
- 空态探测用两个键中的任一个匹配工作区列出的路径，并对两侧都做解析，使工作区相对路径的列项与绝对身份在同一空间里比较。

**被撤下的结论要记下来，而不只是丢掉。** `augmented()` 本来就不跨改写继承核验报告（声明续上了，核验没有），但徽标直接消失，读起来与"从未核验"一样。现在折叠发现撤下时会在条目上记录 `checksWithdrawn`，工作室据此渲染既有的"文件已变更，未重新核验"徽标。该事实在折叠中派生而非来自工作区 stat，因此重新加载会话后同样显示。

**`identity` 处处可选。** 该字段出现之前记录的结果必须仍能解析，此时工作室退回按声明拼写匹配。`identity` 存在但格式不合法时，整份核验载荷作废，与其他字段一致：绝不根据半份可读记录计算徽标。

宿主的一半在调用 `resolveUnreadableReports` **之前**完成规范化，而不是把 `ctx`/`exec` 穿进去。该函数因此保持纯同步——这正是既有调用方所依赖的——由异步的 `resolveAckIdentities` 承担文件系统工作。两种做法的可观察行为相同。

## Alternatives considered

**在客户端靠字符串处理做规范化。** 去掉 `./`、折叠 `..`、比较后缀，无需改动宿主，也无需新增线上字段。但这条路走不通：客户端在折叠时不知道会话的工作区根，因此无法在不猜测的前提下断定 `out/report.html` 与 `/Users/me/work/out/report.html` 是同一个文件——而猜错会把两个确实不同的文件合并，比它要修的重复更糟。它也看不穿符号链接，而宿主基于 `realpath` 的 target key 可以。

**只用身份作键折叠。** 表述更干净，也正是"身份就是键"的说法所暗示的。但它会让上述混合日志回退：变更调用记下了规范路径，而登记结果早于 `identity`，仍然会渲染成两行。有测试专门钉住该情形，只用单键的版本通不过。

**只记录规范路径、丢掉声明拼写。** 工作室此后会在用户认得 `out/report.html` 的地方显示绝对路径，且所有以声明路径为键的既有快照与测试都要改写。身份与显示是两件事；两者同时携带只多一个可选字段。

**让工作室经工作区 Remote 重新解析路径，而不是由宿主记录。** 这会让折叠变成异步且依赖 stat，而折叠是对事件窗口的纯函数，必须在重放时给出相同答案。在工具本来就解析路径的地方记录一次解析结果，才能让推导保持确定性。

## Consequences

- 一个文件无论怎么拼写都只有一行，且该行保留用户首次看到的拼写。
- 改写会在同一行上撤下结论，且该撤下能跨重新加载留存。
- `identity` 是线上承诺：它随 `document_deliver` 呈现元数据里的 `gate.checks[]` 传递，在所有状态下都存在（`checked`、`unchecked`、`unreadable`），因此一个从未被读取的 `pdf` 交付物同样按一个文件成键。它刻意不出现在面向模型回执里——对模型来说身份不是新闻，它写下的声明路径才是。
- 已录制的 `document-deliver` 快照会在下次刷新时增加 `"identity":"{{cwd}}/out/final.md"`，因为该 fixture 捕获的正是本次变更所扩展的持久核验元数据。`tool-schemas` 附属文件不变：请求头 pin 携带的是工具 `parameters`，不是 `output`。
- 工作室的新鲜度 token 比较与折叠的撤下判定，现在对"同一个文件"的含义达成一致，这正是两者能合并表述为同一个徽标的原因。
- 该决策不取代 [Document delivery studio](../feature/2026-08-23-document-delivery-studio.zh.md)。那一条确定的是工作室的架构（会话视图、自持产物词汇、有界读取 RPC）；本条修的是该架构中身份键的错误，两者并存。

## Testing

- 宿主：两种拼写产生同一个身份，每份报告保留自己的声明路径；`unchecked` 格式也带身份；呈现元数据在 `path` 旁携带身份，旧报告则整个省略该键；输出 schema 拒绝未声明的字段；`unreadable_ack` 可跨拼写附着，指向未登记文件时仍给提示。
- 客户端：相对路径写入 + 绝对路径登记（及其反向）折叠为一条；以另一种拼写改写会撤下结论并记录撤下；两个确实不同的文件不会被合并；没有身份的旧登记仍能按声明拼写与已解析身份合并；身份格式不合法则整份载荷作废。
