# Agent Note: patent preset prefers the cnlaw MCP tools over REST

Status: implemented

[English](2026-09-15-patent-preset-cnlaw-mcp-first.md) | 中文

## Problem

已发布的 `patent` preset 只有一条通往 semantica-cnlaw 的路：persona 里逐端点写出的 `curl` 调用，指向本机 REST 服务（[cnlaw 增强 note](../../implemented/architecture/2026-09-03-patent-preset-merges-cnlaw-enhancement.zh.md)）。与此同时 cnlaw 项目交付了 `cnlaw/ingest/cnlaw_mcp.py`——一个 FastMCP 服务，把同一批 `:8001` 图与案件端点代理成原生工具，其模块 docstring 自己写明了意图：经 `@deepseek-ai/dsh-mcp-client` 接进来，"so the patent mode gets these as first-class `mcp__cnlaw__*` tools instead of raw curl"。

一旦某个部署挂上了这座桥，preset 的提示词就与工具面相互矛盾：模型读到的是"curl -sG http://127.0.0.1:8001/api/cnlaw/graph/ground …"作为图谱导航的做法，而覆盖同一批端点的七个结构化工具闲置未用。提示词是模型得知调用约定的唯一场所；一个挂了名却未被提及的工具，会输给一个被明确指示的工具。

## Decision

persona 现在表述为 **MCP 优先、REST 兜底**，并且是按能力分别声明的，而不是一条笼统规则：

- 纪律 3（法条引用核验）先把模型引向 `mcp__cnlaw__*`，并保留 `:8100 /search` 作为桥未覆盖字段的 REST 路径。
- 图谱导航以 `cnlaw_graph_ground(article, law, ipc, k)` 与 `cnlaw_graph_patent(pn)` 领起，各自紧跟其 `curl` 等价写法作为兜底。
- 案件决策链以 `cnlaw_case_record` / `cnlaw_case_get` / `cnlaw_case_chain` / `cnlaw_case_similar` 领起，同样各带 REST 兜底。
- persona 把 `cnlaw_inventive_step` 列为法条核验的**第一步**——一次调用即返回四步证据包（D1 / 区别特征 / 实际解决的技术问题 / 技术启示），每步带 `source_path`，创造性论证由此以证据包为骨架，而非从多次分散检索中手工拼装。
- 溯源标签去掉端口号：`cnlaw(:8100)` 与 `cnlaw(:8001/graph)` 统一为 `cnlaw`，引用纪律不再编码证据出自哪条通道。纪律 7（无来源即撤回）与证据附录要求不变。

端点清单仍留在提示词里，因为它是兜底路径，也因为 MCP 面是 REST 面的严格子集：`:8100 /search`、`/search/decisions`、`/search/judgments` 以及 `:8001` 的 IPC 路由都没有对应工具。分工是 `:8001` 的 graph/case/workflow 端点走 MCP，其余走 REST。

preset 仍是可选增强、不是硬依赖：不挂桥的部署看到工具缺席，而 persona 完整保留的 REST 指示就是可用的工作路径。

## Alternatives considered

- **用工具替换掉 curl 指示。** 否决：这会破坏每一个没有桥的部署（preset 当前的约定是 cnlaw 可选），也会搁置 `:8100` 的语义检索端点——它们没有 MCP 面。
- **不动 persona，靠工具描述完成发现。** 否决：preset 才是调用约定的归属地；模型会遵循明确的提示词而非未被提及的工具，而 2026-09-03 的 note 已经确立 preset 是这条纪律的唯一归属。
- **只在 preset 的前置条件里写明需要桥，而不改 persona。** 否决：通道之间的次序是按能力判断的（graph/case 走 MCP，search 走 REST），不是部署前置条件；一行前置说明仍然不会说明这个次序。
- **保留 `cnlaw(:8100)` / `cnlaw(:8001/graph)` 形式的溯源。** 否决：该标签命名的是通道，于是同一份证据会因通道不同而带不同标签——审计线索应当命名来源，而非传输方式。

## Consequences

- 挂桥的部署在图谱与案件工作上获得结构化参数与结构化返回，`cnlaw_inventive_step` 把创造性论证的证据搜集收敛为一次调用。
- 不挂桥的部署要为兜底付出一次失败的工具调用。模型能看到工具清单，所以这次失败是可读的而非静默的；同一段里 REST 指示仍然完整。
- persona 从 10,708 字节增至 11,094 字节，上限为 `agent-instructions` 的 64,536 字节（`maxBytes: 65536`）。
- 已发布 preset 与任何用户根副本再次分叉：在此日期之前取的本地 `patent-cnlaw` 快照没有 MCP 优先的次序。`discoverPresets` 先扫已发布根，所以 id 由已发布 preset 赢得，分叉是惰性的。
- 没有 recorded-session 快照钉住这段文本：patent preset 不在关键路径的已发布 profile 矩阵内，而 `verify-agent-preset-config` 校验的是 persona 的 schema（prefix/suffix）而非其散文。
