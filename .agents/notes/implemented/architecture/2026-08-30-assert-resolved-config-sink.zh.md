# Agent Note: M2 收敛 — 插件配置边界的唯一 `assertResolvedConfig`

Status: implemented

[English](2026-08-30-assert-resolved-config-sink.md) | 中文

## 问题

schemastery 在插件看到配置之前就填好每一个 schema 默认值,但类型系统无法表达这一事实:schema 输出类型是无条件的,而手写的 `Config` 接口全是可选——于是十三个源文件各自重写本地 `ResolvedConfig` 别名加 cast(`config as ResolvedConfig` / `as Required<Config>` / `config.thresholds as number[]`),每处都配两条固定注释之一,声称 schemastery 已填好字段。台账的担忧是具体的:任何未来绕过 schema 的调用点都会静默读到 `undefined`。重扫还发现台账已漂移——`code-mode.ts` 已并入 `ptc.ts`,`lsp-stdio` 与 e2b 两包的 cast 已消失,`as Required<Config>` 族长得超出了登记清单。

## 决策

`@deepseek-ai/dsh-value` 新增 `assertResolvedConfig(label, config, defaultlessKeys)` 与 `ResolvedConfig<C, K>` 类型:带默认值的键仍为 `undefined` 时在加载期以字段名抛错,返回同一对象且只保留声明的无默认键可选。十三个文件改调它;本地别名或收窄为从它派生(`type ResolvedConfig = ResolvedShape<Config>`),或作为受赋值检查约束的结构重述存留(shell 执行器的构造器字段与 settings 回调),或在只有 cast 使用它的地方直接消失。旧的两种注释风格随 cast 一起消失。

## 后果

M2 的 cast 族关闭,共享原语清单五之五完成。检查覆盖显式 `undefined` 值而非键的存在性,所以 helper 契约声明手工构造的配置仍必须经过 schema。台账记在 M2 名下的三个子项有意保持开放并单独归属:`default(undefined as unknown as T)` schema 惯用法(表达 schemastery「缺省不物化」行为;需要 vendor 级原语)、agent-loop 的整段 schema `as z<Config>`(schema↔接口对齐检查绕过,非边界 cast)、弱类型 `ToolDefinition.parameters` 槽位(`ptc.ts:679`、`schema.ts:572`;公共类型改造)。

## 落选方案

**类型化 schemastery 的 `.default()` 链使 resolved 形状可推断,去掉 `z<Config>` 注解。** 拒绝:注解正是让手写 `Config` 接口与 schema 在编译期对齐的机制;去掉它会重开 cast 族掩盖的漂移,而收窄 `.default()` 的输出类型是 vendored schemastery 修改,每次 sync 都有重放义务。

**只共享 `ResolvedConfig<Config>` 类型别名而不做运行时检查。** 拒绝:别名重述只是表象;真正的危险是未检查的 cast,纯类型的 helper 会让所有 cast 继续活着。
