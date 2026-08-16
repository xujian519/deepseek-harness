# 插件开发指南

[English](plugin-authoring.md) | 中文

本参考文档是插件作者必须遵守的约定与注意事项的查阅表，而不是教程或分步操作指南。概念属于 [Cordis 入门](cordis-primer.md)；有序的「第一个插件」路径属于[第一个插件](user/develop/basic/index.md)；操作流程属于[实操手册：扩展插件形态](cookbook/extension-cookbook.md)与[实操手册：添加 workspace 包](cookbook/adding-a-package.md)；扩展点地图属于[新行为放哪里](architecture.md#where-new-behavior-goes)。

## A. 插件约定

每节用一段陈述约定，链接其归属文档，引用一个真实包，并列出由此得出的注意事项（Do／Don't）。

<a id="a1-two-plugin-shapes"></a>

### A1. 两种插件形态

Loader 接受两种导出形式：函数插件（function plugin）具名导出 `name`／`inject`／`Config`／`apply` 且没有默认导出，以及默认导出其类的 `Service` 子类。两种形式不得在同一个入口混用：混用会使 Loader 丢弃函数插件的命名空间（[事故复盘](postmortem/0001-acp-default-export-drops-inject.md)）。`packages/todo/tool-todo/src/index.ts:22-43` 是函数插件模板，`packages/shell/shell/src/index.ts:40-103` 是 Service 形态。

- Do——每个包只选一种形态，并保持函数插件的四个具名导出齐全。
- Don't——给函数插件添加默认导出，或导出没有 `name` 和 `inject` 的裸 `apply`。

<a id="a2-declare-dependencies-by-injection"></a>

### A2. 依赖声明式注入

必需服务通过 `inject` 声明（函数插件字段或 Service 子类的 `static inject`）；可选服务严格通过 `ctx.get(name)` 读取，缺失时必须大声失败。禁止在 `apply` 中运行时探测服务：它会使激活顺序不可预测，并在 reload 后遗留注册（[包规则](../packages/AGENTS.md)）。`packages/shell/bash-local/src/index.ts:102-103` 静态声明注入；`packages/shell/tool-bash/src/index.ts:185-200` 通过 `ctx.get` 读取可选服务，并在必需策略缺失时抛出。

- Do——可选服务通过 `ctx.get(name)` 读取，并在需要服务缺失时于最早可解析点大声失败。
- Don't——用 `typeof ctx.xxx !== 'undefined'` 探测切换行为，或对未声明的键使用 `ctx.<name>` 属性代理。

<a id="a3-config-schema-defaults-and-js"></a>

### A3. 配置：schema、默认值与 `!!js`

插件将其 `Config` 接口与同名 Schemastery schema 从同一模块导出配对；部署选择项为 `.required()`，默认值写在 schema 中，调用点不再补默认。`cordis.yml` 通过 `!!js` 表达式节点插值条目的 `config` 与 `disabled`（[Loader 配置](cordis-primer.md#loader-configuration)）。`packages/todo/tool-todo/src/index.ts:29-43` 将接口与 schema 配对；`examples/headless-agent/cordis.yml` 展示了条目配置与 `!!js`；overlay 的 `disabled` 补丁用于选择环境（`examples/acp-agent/subagent-durability-failure.cordis.snapshot.yml`）。

- Do——部署会变化的选项设为 `.required()`，在接口 JSDoc 中写明每个键的语义，并在 schema 中给出默认值。
- Don't——在 schema 中读取环境变量或嵌入密钥，或把补默认的逻辑留在 `run`／`resolve` 调用点。

<a id="a4-lifecycle-and-reversible-effects"></a>

### A4. 生命周期与可逆副作用

每项注册都是副作用：提示词片段、工具 schema、适配器、提供方和监听器通过 `ctx.effect()` 或 `ctx.on()` 安装，使 teardown 与 reload 按预期撤销；vendor 的 fiber 状态机把这一生命周期硬化，抵御重入卸载与卸载中途注册（[入门](cordis-primer.md)、[vendor 清单](../vendor/README.md)）。注册表贡献必须通过 HMR 安全测试证明释放（[测试策略](testing.md)）；`packages/guard/timeout-policy/src/index.ts:55-81` 在一个监听器内包装工具执行，并在 `finally` 中恢复信号。

- Do——把每项注册装入副作用作用域，并通过释放 fiber 的测试证明释放。
- Don't——在副作用作用域之外留下副作用，或在 `apply` 或构造函数顶层做异步启动工作。

<a id="a5-events-and-dispatch-modes"></a>

### A5. 事件与分发模式

事件名通过 TypeScript 声明合并注册；分发模式是每个事件公开约定的一部分，新的 harness 事件通过 `@mode` 标签记录模式（[分发模式](cordis-primer.md#dispatch-modes)）。waterfall（瀑布式事件）监听器是环绕中间件：调用 `next()` 委托，不调用直接返回则短路，并从 `next()` 的返回值读取被包装的结果（[Cordis Waterfall 语义](cordis-primer.md#cordis-waterfall-semantics)）。`packages/guard/timeout-policy/src/index.ts:55-81` 是参照包装层：它通过 `next()` 委托，仅在其期限触发时替换结果。

- Do——遵守已声明的分发模式，仅对顺序敏感的监听器使用 `prepend: true`，只做观察的监听器必须调用 `next()`。
- Don't——在 `emit` 监听器中拦截（它不被 await 且无返回值），或把 waterfall 监听器的返回值当作可选项。

<a id="a6-seam-authorship-definition-provider-consumer"></a>

### A6. seam 写作：Service Definition、Service Provider 与消费方

能力 seam（capability seam）有三个角色——Service Definition、Service Provider 与消费方（Consumer）——角色定义与服务图属于[能力 seam](capability-seams.md)和[架构](architecture.md#capability-seams)。作者义务是：Definition 是抽象 `Service`（绝不是 TypeScript `interface`），面向所有现存消费方设计；默认值由 `resolve(request): Spec` 补齐，`run` 只消费已解析的 spec；公开服务方法若只有一个内部调用者，则改为私有能力闭包。`packages/shell/shell/src/index.ts:65-101` 声明该 seam；`packages/shell/bash-local/src/index.ts:146-160` 在 `resolve` 中补齐默认值；`packages/shell/tool-bash/src/index.ts:370-380` 通过先 `resolve` 后 `run` 消费该 seam。

- Do——把工具 schema、Loader、UI、传输与提供方特定的行为留在消费方或提供方中，并面向每个现存消费方设计 Definition。
- Don't——让一个消费方决定服务约定，或暴露只有一个内部调用者使用的公开服务方法。

<a id="a7-session-log-and-projections"></a>

### A7. 会话日志与投影

会话日志是模型可见上下文的真源：`SessionEventMap` 是一个可经声明合并扩展、仅追加的映射，新增模型可见输入需要新事件并从日志渲染（[会话日志](architecture.md#session-log)、[session 子系统](subsystems/session.md)）。插件在其纯类型 `src/types.ts` 中扩展该映射，并从入口再导出类型，使声明合并在模块边界处存活；事件只在操作成功的提交点追加（[仅在提交点发布状态](../packages/AGENTS.md)）。`packages/core/session/src/types.ts:236` 拥有该映射；`packages/llm/llm-retry/src/types.ts:5-10` 扩展它；`packages/todo/tool-todo/src/types.ts:15-24` 改而扩展投影映射，`packages/todo/tool-todo/src/index.ts:128-148` 再从日志派生 `SessionProjectionMap` 视图。

- Do——在 `src/types.ts` 中扩展 `SessionEventMap` 并从入口仅做类型再导出，且只在操作成功后追加事件。
- Don't——在 `src/types.ts` 中放运行时代码，或在日志之外维护派生状态。

<a id="a8-ship-the-package-whole"></a>

### A8. 完整交付一个包

可发布的包是插件本体加上它的 `./invariant` 伴生（manifest 注册的事件／数据关系运行时检查）、包级 `tests/`，以及采用规范 Model Experience 格式的 README；产品可见插件需要非单元的 REAL-composition 测试，通过 Loader 启动 `cordis.yml`（[包规则](../packages/AGENTS.md)、[测试策略](testing.md)）。`packages/todo/tool-todo/src/invariant.ts` 是 invariant 伴生；`packages/todo/tool-todo/tests/loader-composition.spec.ts` 通过真实 Loader 启动 `cordis.yml`，证明 `allowParallelInProgress` 是真实可配置项而非常量。

- Do——为 `./invariant` 注册 manifest 名（空安装器给出包特定的 `No runtime invariant:` 理由），让 README 与 JSDoc 随行为变更同改，并补充 REAL-composition 测试。
- Don't——交付未解释的空 invariant，仅依赖手搭的 `ctx.plugin(...)` 套件，或把测试放在 `src/__tests__/` 下。

## B. 注意事项清单

本表是快速扫描面；每行的完整理由在其上方所属节中。

| 注意事项 | 方向 | 所属节 |
|---|---|---|
| 在同一个包中混用导出形式 | Don't | [A1](#a1-two-plugin-shapes) |
| 函数插件带默认导出，或裸 `apply` 缺少 `name`／`inject` | Don't | [A1](#a1-two-plugin-shapes) |
| 用运行时探测服务代替 `inject`／`ctx.get` | Don't | [A2](#a2-declare-dependencies-by-injection) |
| 可选服务缺失时静默降级 | Don't | [A2](#a2-declare-dependencies-by-injection) |
| 部署选择项在 schema 中留为可选 | Don't | [A3](#a3-config-schema-defaults-and-js) |
| 在 schema 中读取环境或嵌入密钥 | Don't | [A3](#a3-config-schema-defaults-and-js) |
| 在 `run`／`resolve` 调用点补默认 | Don't | [A3](#a3-config-schema-defaults-and-js) |
| 在副作用作用域之外留下副作用 | Don't | [A4](#a4-lifecycle-and-reversible-effects) |
| 在 `apply` 或构造函数顶层做异步启动 | Don't | [A4](#a4-lifecycle-and-reversible-effects) |
| 在 `emit` 监听器中拦截 | Don't | [A5](#a5-events-and-dispatch-modes) |
| 只观察的 waterfall 监听器不调用 `next()` | Don't | [A5](#a5-events-and-dispatch-modes) |
| 一个消费方决定服务约定 | Don't | [A6](#a6-seam-authorship-definition-provider-consumer) |
| 公开服务方法只有一个内部调用者 | Don't | [A6](#a6-seam-authorship-definition-provider-consumer) |
| 在 `src/types.ts` 中放运行时代码 | Don't | [A7](#a7-session-log-and-projections) |
| 在日志之外维护派生状态 | Don't | [A7](#a7-session-log-and-projections) |
| 在操作提交之前追加事件 | Don't | [A7](#a7-session-log-and-projections) |
| 未解释的空 `./invariant` | Don't | [A8](#a8-ship-the-package-whole) |
| 只用手搭 `ctx.plugin(...)` 套件作为产品可见测试 | Don't | [A8](#a8-ship-the-package-whole) |

## C. 社区对照

dsh 的插件模型继承自 Cordis 生态。本表把上游规范映射到 dsh 对应项，让带 Koishi 或 Cordis 背景的贡献者可以迁移心智模型；它只判定关系，每条规范的完整内容在其落点链接处。一个事实框定这段关系：上游 [cordiverse/cordis](https://github.com/cordiverse/cordis) 的 README 把文档链接指向 dsh 发布的 [Cordis 入门](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer)，因此 dsh 的框架文档副本承担着上游文档的职责。

| 社区规范 | 来源 | dsh 对应规范 | 关系 | 落点 |
|---|---|---|---|---|
| 每项注册都是可逆副作用 | [Cordis 论文](https://github.com/cordiverse/paper)、[Koishi 生命周期](https://koishi.chat/guide/plugin/lifecycle.md) | 注册通过 `ctx.effect()`／`ctx.on()` 安装，并有硬化的 fiber teardown | 增强 | [入门](cordis-primer.md)、[vendor 清单](../vendor/README.md) |
| 声明依赖，绝不运行时探测服务 | [Koishi 服务指南](https://koishi.chat/guide/plugin/service.md) | 必需服务用 `inject`，可选服务用严格 `ctx.get` | 一致 | [A2](#a2-declare-dependencies-by-injection)、[包规则](../packages/AGENTS.md) |
| 配置经 schema 校验并带默认值与描述 | [Koishi schema 指南](https://koishi.chat/guide/plugin/schema.md) | 同名 Schemastery schema；`!!js` 增加惰性插值 | 增强 | [A3](#a3-config-schema-defaults-and-js)、[Loader 配置](cordis-primer.md#loader-configuration) |
| 异步初始化放入生命周期事件 | [Koishi 生命周期](https://koishi.chat/guide/plugin/lifecycle.md) | vendor fiber 状态机硬化卸载与 teardown | 增强 | [vendor 清单](../vendor/README.md) |
| 可重用性显式声明 | [Koishi 生命周期](https://koishi.chat/guide/plugin/lifecycle.md) | preset 组合与 `isolate` realm 按会话划定能力集 | 增强 | [新行为放哪里](architecture.md#where-new-behavior-goes) |
| 元信息与 manifest 规范 | [Koishi 发布指南](https://koishi.chat/guide/develop/publish.md)、[Agent Skills 规范](https://agentskills.io/specification) | `@deepseek-ai/dsh-*` 命名与逐包 README 约定 | 一致 | [发布](user/develop/basic/publish.md)、[实操手册：添加 workspace 包](cookbook/adding-a-package.md) |
| 隐私与安全边界 | [Koishi 过滤器](https://koishi.chat/guide/plugin/filter.md)、[MCP 服务器指南](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/docs/draft/develop/build-server.mdx) | 密钥绝不内联：credentials 与 settings seam 在请求时解析 | 增强 | [A3](#a3-config-schema-defaults-and-js)、[能力 seam](capability-seams.md) |
| 文档渐进式披露 | [Agent Skills 规范](https://agentskills.io/specification) | 分层文档体系与 word budget，一条事实一个归属 | 特有 | [文档规范](AGENTS.md) |
| 类型级集成优先于包级耦合 | [Koishi 服务指南](https://koishi.chat/guide/plugin/service.md) | workspace 项目引用加上纯 `types.ts` 类型面 | 一致 | [TypeScript 项目布局](development.md#typescript-project-layout) |
| 发布 checklist 与弃用规范 | [Koishi 发布指南](https://koishi.chat/guide/develop/publish.md) | 发布 checklist 存在；尚无正式弃用机制 | 未建立 | [发布](user/develop/basic/publish.md) |
