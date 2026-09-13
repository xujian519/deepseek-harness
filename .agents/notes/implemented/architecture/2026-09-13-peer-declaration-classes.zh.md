# Agent Note: 挂载说明符留作对等依赖，仅类型的服务边不留

Status: implemented

[English](2026-09-13-peer-declaration-classes.md) | 中文

## Problem

2026-09-11 的探查记录了 client ↔ host 的组级对等依赖互锁，并发现它已单向化：`@deepseek-ai/dsh-client-connection` 不再对任何 Host 包声明对等依赖，而 Host 包仍在把浏览器侧包声明为对等依赖。issue #96 点名三处声明要求重新定性：[`directory-picker-auto`](../../../../packages/host/directory-picker-auto/package.json) 的两个客户端面、[`frontend-static`](../../../../packages/host/frontend-static/package.json) 的 `connection`、以及 [`sdk-jsonrpc-server`](../../../../packages/sdk/server/package.json) 的 DeepSeek 适配器。

同一 issue 还要求组地图里的 `util/` 一行与该组的真实依赖集对齐。该行声称「无运行时依赖，仅不变量伴随 peer」，而 `chunked-list` 带 `zod`、`http-proxy` 带 `undici`、`output-retention` 与 `value` 带 `dsh-util-values`；`util/` 下没有任何包把 `dsh-invariants` 声明为对等依赖，唯一提到它的 [`http-proxy`](../../../../packages/util/http-proxy/package.json) 是作为测试依赖声明的。

## Decision

- **选择器的四个 peer 是运行时挂载说明符，保留不动。** `BACKEND_PACKAGES` 与 `SURFACE_PACKAGES` 装的是包*名*；本包不 import 它们中的任何一个，`apply` 通过 `ctx.loader.create({ name })` 挂载解析出的那一对。Loader 解析裸说明符时用的是组合根的 `baseUrl`（`vendor/loader/src/config/tree.ts:151-168`），而不是本包自己的 `node_modules`，因此让挂载可解析的是组合的清单——并且 `verify-cordis-config` 会把要求从选择器扩展到全部四个包（`scripts/verify-cordis-config.ts:436-437`），因为在没有 key 的 Linux CI 上只会解析到 `browse`，漏掉的 `-native` 会被长期掩盖。这四个 peer 正是从插件这一侧复述同一要求，它们与「本包自己的 loader 组合套件真实 import 两个 Host 后端、而为两个客户端面挂载 Loader 可见替身」是同一件事的两面。该要求现已写入包 README。
- **`frontend-static` 保留开发依赖声明，删除对等依赖。** 这条边是一个空的仅类型 import，唯一作用是引入 `connection` 的 `Context` 合并——该合并声明在 connection 包的 host 面（`packages/client/connection/src/rpc-host.ts:53`），本包 tsconfig 本就引用该面——而服务本身经由 `inject` 到达，从不经由该模块。重新生成一次 host 面声明后，产物里不含该包的任何痕迹，这正是这条边不需要安装面声明的原因：[published dependency faces](../process/2026-08-26-published-dependency-faces.zh.md) 规定「仅类型 import……与既有的纯元数据 peer……只放 `devDependencies`」，而消费同两个服务的两个 Host 包 [`api/gateway`](../../../../packages/api/gateway/package.json) 与 [`open-in-app`](../../../../packages/host/open-in-app/package.json) 早已只声明为开发依赖。源码里的合并 import 同时补上了同族包都有的那句注释。
- **`sdk-jsonrpc-server` 保留其 DeepSeek 适配器 peer。** `import * as LlmDeepSeek` 是真实的值 import，作为插件被挂载，且只在没有任何适配器负责该路由时挂载（`packages/sdk/server/src/server.ts:150-153`）：适配器的选择属于组合，随包发布的 profile 自己组合了 `llm-deepseek` 行（`packages/bundle/sdk-minimal/cordis.patch.yml:26-27`）。把这条边留在 `peerDependencies` 里就是把选择权留给组合，而不是把某个适配器钉进每一次安装；README 现在把该理由写在它所描述的回退行为旁边。
- **`util/` 一行改为实测依赖集。** 两个旧说法一并替换：该组不注册任何产品服务或事件，其运行期依赖只有 `zod`、`undici` 与 `dsh-util-values`，每个都待在需要它的原语里。

## Alternatives considered

- **把共享 wire 类型下沉成独立包**（issue 的第二条路）。否决：这两条边并非同一种形态。选择器根本不含 wire 类型，只有说明符字符串；而 connection 那条边的类型是一个已经为该类型发布 host 面的包的 Host 半侧服务定义，新建包只会让该定义与它的提供方分离，而该类型从不进入任何产物。
- **把选择器的挂载目标声明为普通依赖。** 否决：它们不是 import，而且在 pnpm 的严格布局下，普通依赖落在本包自己的 `node_modules` 里，而这不在「从组合根 `baseUrl` 开始」的那条解析链上——真正生效的是组合的声明，也正是配置门禁所强制的那份。
- **删掉选择器的两个客户端面 peer，把组间互锁彻底拆干净。** 否决：那四个名字是同一套挂载词汇，删掉一半的客户端面只会让它仅由组合应用声明，而 Host 面仍被声明两次。
- **把 `frontend-static` 的 `host-webserver` peer 与 `connection` 一起挪走。** 暂缓：该 peer 属于同一类别，且在依赖策略范围之外的另外六个包里也是如此（`directory-picker-auto`、`experimental/inspector`、`experimental/webworker-runtime`、`memory/openviking`、`web/synapse`、`webhook/webhook-github`）；把它们一起扫掉是一次影响面自成一体的策略扩展，而 issue #96 问的是 client 那条边。

## Consequences

`frontend-static` 不再对任何浏览器侧包声明对等依赖：它的 peer 只剩 `host-webserver` 与 cordis，且它发布的声明文件本来就从未提到 `client-connection`，因此没有任何消费者的安装发生变化。剩余的 Host→Client 对等依赖只有选择器的两个客户端面，它们是挂载说明符而非类型边，现已记录在它们所属包的 README 里。横跨七个未被策略覆盖的包的 `host-webserver` peer 类别保持原样，在此登记为候选清扫项，而不是做掉一半。

没有任何门禁读取插件侧的 peer 列表：组合那一侧由 `verify-cordis-config` 强制，而插件把某个挂载目标从自己的 peer 里删掉可以一直保持全绿，直到某次部署真的挂载它。正是这一不对称决定了那四个名字写进 README，而不是交给清单自行说明。

## Testing

对 `frontend-static` 删掉 `lib/tsconfig.tsbuildinfo` 与 `lib/types/index.d.ts` 后重新生成一次 host 面声明，得到的 `index.d.ts` 中 `dsh-client-connection` 出现 0 次，因此被删除的那条边确实在发布产物之外。把它从 `peerDependencies` 移除后，`pnpm install --lockfile-only` 报告「Already up to date」；新增的那行源码注释让该包的 `Config` 指针在生成的配置目录里从 30 移到 31，中文孪生同步、配对记录重录。`verify-cordis-config`、`frontend-static` 与 `directory-picker-auto` 套件、`typecheck`、lint、`duplication` 以及文档聚合门禁是本次改动必须保持全绿的检查。

## Related

[published dependency faces](../process/2026-08-26-published-dependency-faces.zh.md) 是本次裁定所应用的依赖分区策略的归属地。[cross-boundary declarations](../bug-fix/2026-09-12-cross-boundary-declarations.zh.md) 测量了哪些类型 import 会进入发布的声明文件，本笔记复用了该测量方法。
