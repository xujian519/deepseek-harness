# Agent Note: Document-studio preview over the workspace-files Remote

Status: implemented

[English](2026-09-19-document-studio-preview-over-the-workspace-files-remote.md) | 中文

## Problem

[上游 v0.1.2-alpha.1 同步](../process/2026-08-28-upstream-v0.1.2-alpha.1-sync.zh.md)删除了 `packages/host/apiproxy`，而它正是文档工作室预览读取（`connection.api.host.readFileText`）背后的宿主面。工作室保留了一个响亮失败的注入并带 `FIXME(port)`：选中产物文件显示的是错误而非其文本，打印动作更完全无法重新读取被截断的开头。该同步笔记把这一缺口记为 follow-up 1。

上游随后新增了会话作用域的 `workspaceFiles` Remote（`@deepseek-ai/dsh-api-workspace-files`）：它把可经会话文件系统解析的文件的**有界读取**提供给 Web 客户端，含 `stat`、文本分页（`read`）、字节窗口（`readBytes`）、完整字节（`readAll`）、目录列举与变更流。其上限是该插件的 `Config`（`maxBytes`、`maxFileBytes`、`maxLines`），由组合设定。

## Decision

工作室经 `remote.workspaceFiles` 读取产物文件，原先位于被删宿主 RPC 中的读取语义移入工作室的客户端半侧。

- **预览取一个字节窗口。** `readBytes(sessionId, resolve(path), {})` 请求宿主配置的窗口：`readBytes` 会拒绝宽于 `maxBytes` 的窗口，且对超大文件从不失败，这正是预览刚打印出的交付物所需。`readAll` 无法承担预览，因为它在文件超过 `maxFileBytes` 时是拒绝而非返回开头。
- **打印完整重读。** 预览头被截断时，`readAll(sessionId, resolve(path))` 返回整个文件供 PDF 使用，宿主的 `workspace-file/too-large` 拒绝则成为工作室既有的「文件过大」提示。其它失败保留宿主原消息。
- **`truncated` 在两次读取中只有一个含义**：该次读取没有返回完整文件——窗口未读到最后一个字节，或完整读取被宿主因体积拒绝。
- **路径经会话工作区解析**，与打开、在文件夹中显示两个意图完全一致（`resolveWorkspacePath(cwd, path)`），三个意图因此指向同一个文件。
- **文本解码落在 `src/client/file-reads.ts`。** 宿主的字节窗口设计上就是原始字节——不解码、不拒绝二进制——故 `decodeByteWindow` 承担文本契约：被窗口从中间切断的字符整字丢弃而不解码成替换字形，非法 UTF-8 抛错，由接线报为 `not valid UTF-8: <path>`。窗口是在字节边界上截断的前缀，故寻找不完整末序列的扫描最多跨一个字符。
- **视图注入面拆成两个读取**：`readFileText`（预览窗口）与 `readFileTextComplete`（打印），客户端的 `maxBytes` 形参、其 1 MiB 默认值与 `PRINT_MAX_BYTES` 上限一并删除：读取预算归宿主 `Config` 所有，客户端不再自持任何预算。
- **本包声明它所调用的东西。** `@deepseek-ai/dsh-api-workspace-files` 进入工作室的开发依赖（该 import 仅类型，用于生成的 Remote 面与字节窗口类型），包的 tsconfig 引用该包的客户端面配置，插件在 `remote`、`remote.session` 之外注入 `remote.workspaceFiles`。

## Consequences

选中产物文件重新可以预览，打印被截断的预览导出的是完整文档而非拒绝。工作室自此继承部署的读取上限：预览头是宿主的 `maxBytes` 窗口（默认 2 MiB）而非被删的 1 MiB 客户端预算；超过宿主 `maxFileBytes` 的文件报「文件过大」状态而非错误行；抬高任一上限是改 `dsh-api-workspace-files` 的组合配置，而不是改插件。

`FIXME` 已消失，[v0.1.2-alpha.1 同步笔记](../process/2026-08-28-upstream-v0.1.2-alpha.1-sync.zh.md)的 follow-up 1 闭合；其 follow-up 2（synapse live-reply 文本）仍开放。在既有的 bundle 产物豁免下工作室客户端源码仍不属逐文件覆盖率门禁，故新读取由单元测试与产物校验共同钉住——后者加载已构建插件并对真实注册表执行 apply。

## Alternatives considered

- **自建一个宿主 `readFileText` Remote。** 否决：上游 `workspaceFiles` 已提供以工作区解析为信任模型的会话作用域有界读取，再建一个文件读取 Remote 是复制一个能力接缝，而非消费它。
- **在客户端保留调用方的 1 MiB / 4 MiB 预算。** 否决：那是随部署变化的上限，现归宿主 `Config` 所有；客户端自选的窗口一旦超过 `maxBytes` 就被直接拒绝，保留这些常量会让打印重读在默认组合上失败。
- **预览改用 `read`（文本分页）而非字节窗口。** 否决：页的字节数超过 `maxBytes` 时是失败而非被缩短——这是上游的有意选择，使一页永远不会被误读为整个文件——那会把大 HTML 交付物变成错误，而那里本该是开头加截断提示。
- **在宿主侧解码窗口。** 否决：`readBytes` 的文档契约就是原始字节、不解码也不拒绝二进制，而需要文本的消费者是工作室；把严格解码留在消费者一侧即可保持被删 RPC 的行为，又不必为所有调用方拓宽共享端点的契约。
- **把整文件上限拒绝改为抛错并删除 `studio.print.tooLarge` 文案。** 否决：本地化提示才是用户需要的信息，用宿主的一句英文替换它会让双语界面退化。

## Testing

`pnpm exec vitest run packages/client/ui-document-studio` 六个文件 41 个用例通过，含新增的 `file-reads.client.spec.ts`（窗口解码、被切断的字符、非法 UTF-8、宿主上限拒绝映射为「文件过大」状态，以及两条失败消息）与 tsdown 产物校验——后者加载已构建客户端、对真实注册表 apply 插件并断言新的注入清单。两个视图测试经 `readFileTextComplete` 驱动打印路径。本次改动上 `pnpm run typecheck`（两个编译面）、`pnpm run lint`、`pnpm run duplication`、`pnpm run verify-package-dependencies`（71 个包）与文档门禁均通过。
