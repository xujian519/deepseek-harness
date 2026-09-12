# Agent Note: 声明式类型依赖、带品牌的桥接身份，与真实上报的 agent 版本

Status: implemented

[English](2026-09-12-cross-boundary-declarations.md) | 中文

## Problem

2026-09-11 的三个发现同源:一个跨越包边界的事实只在两处应当一致的地方之一被记录。

- `session-persistence-jsonl` 运行期从 `@deepseek-ai/dsh-value` 导入守卫 `isEEXIST`/`isENOENT` 却未声明该依赖(Issue #82)。该声明已随值下沉批次(#110)落地;剩下的是类型导入,而其中类型出现在公开 `.d.ts` 里的才是真缺陷:编译 `patent-tools`、`mcp-client`、`api-settings-controller`、`tool-fs-search`(`JsonValue`)、`token-meter`(`ImageAttachmentRef`)或 `host-synapse`(`ContentBlock`)声明的消费方,无法解析 manifest 从不安装的包。
- `patent-teams` 事件载荷、桌面桥载荷与 `ui-chat` 的 `ToolCallId` 把不透明 id 当裸字符串携带(Issue #83):于是团队 id 能被当作任务 id 读取,而客户端重复声明了宿主已经拥有的身份。
- ACP 握手上报 `agentInfo.version: '0.0.1'`,而包实际发布 `0.1.5-rc.2`(Issue #84),客户端因此无法判断自己在与哪个构建对话。

## Decision

每个事实现在都在它跨越边界处被陈述。

- **声明会进入产物平面的类型依赖。** 六对关系按各包既有惯例落入对应段:`patent-tools`、`mcp-client`、`api-settings-controller`、`tool-fs-search` 的 `dsh-util-values` 进 `dependencies`;`token-meter` 的 `dsh-attachment` 进 `peerDependencies`(并照惯例镜像到 dev);`host-synapse` 的 `dsh-llm` 进 `dependencies`。其余只做类型导入的包故意不声明:它们的类型从不进入产出的声明文件,声明只会白白增加安装要求。
- **在 id 离开属主处打品牌。** `patent-teams` 的载荷身份(`PatentTeamsTeamId`、`PatentTeamsTaskId`、`PatentTeamsMessageId`、`PatentTeamsAttemptId`)以及成员/队长会话 id,都在发点打品牌,因为 durable 团队文件保持裸字符串;桌面载荷(`MenuId`、`NotificationId`)配同名构造函数,在 shell 收到 Electron 桥回传处打品牌;`ui-chat` 的 `ToolCallId` 改为再导出宿主词汇,并在唯一说该词汇的接口处打品牌(`ui-tool` 的 `inspectCall`)。三个 spec 在编译期钉住品牌关系。
- **从 manifest 派生上报版本。** `acp` 通过 `createRequire(import.meta.url)('../package.json')` 读取自身 `package.json`,与 `@deepseek-ai/dsh-llm` 的 attribution 同法;其 bridge spec 把握手钉到该 manifest。

## Alternatives considered

- **声明每一处只做类型导入的工作区依赖。** 否决:依赖策略本就有意忽略类型导入,真正决定消费方是否需要该包的事实是产出的 `.d.ts`。
- **给 durable 团队文件与整个客户端 id 平面都打品牌。** 否决:那里的 id 是结构性的或私有的,且客户端的节点投影有意把宿主 id 归一为字符串;强行打品牌会波及客户端约二十处而没有需要保护的不透明边界。
- **在构建期注入 ACP 版本。** 否决:仓库已经由包 manifest 派生发布版本,相对路径在 `src/` 与打包后的 `lib/` 都能解析,构建期 define 只会多一条构建规则而不会取消 manifest 这个事实源。
- **把三个发现拆成三个 PR。** 否决:每一处都是小而可独立验证的改动,且本批共享同一个约束面与同一份 Agent Note。

## Consequences

六份公开声明现在列出了它们确实需要的依赖,客户端契约只剩一个工具调用身份,ACP 客户端看到的就是本构建的真实版本。两条边界被记录而不修:依赖门禁只挑选 client-faced 与 configured-host 包,因此纯 host 包仍可能导入未声明的工作区包(今日实测:`src` 内已无此类值导入);Electron 桥在它那一侧仍说裸字符串,`MenuId`/`NotificationId` 只存在于后端消费通知的一侧。代价是品牌在运行期被擦除——保证在三个 spec 里,而给来源错误的字符串打品牌的断言照样能编译。

## Testing

对十二个受改动包跑 `pnpm exec vitest run`;并跑 `pnpm run typecheck`、`pnpm run lint`、`pnpm run duplication`、`pnpm run test:docs` 与各 catalog 门禁。新增的 `ids.spec.ts`、desktop-seam 的身份断言与 `ToolCallId` 身份测试即编译期钉子。品牌不改变序列化值,因此没有会话 fixture 变动;而上报的版本确实改变一帧协议,钉住它的 `snapshots/acp` 期望由随后那批语料修复一并更新。

## Related

- [为其余空 catch 站点指名被吞掉的失败](2026-09-12-cross-package-catch-sites.zh.md)——同一审计的前一批。
- [在仓内 Issue 中跟踪技术债](../process/2026-09-11-tech-debt-issue-tracking.zh.md)——产出这些发现的扫描,记录在 Issue #82–#84。
