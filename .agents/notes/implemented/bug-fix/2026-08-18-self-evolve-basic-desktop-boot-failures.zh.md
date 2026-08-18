# Agent Note：self-evolve-basic 缺失插件入口与空 target 误触防漂移校验

状态：implemented

[English](2026-08-18-self-evolve-basic-desktop-boot-failures.md) | 中文

## 问题

桌面端（以及任何加载 `base` bundle 的 dsh 后端）启动失败，根因分两层叠加：

1. `@deepseek-ai/dsh-self-evolve-basic` 从未导出 Cordis 插件入口——没有 `export default`，也没有 `apply`——而 `packages/bundle/base/cordis.patch.yml` 自 Phase 1 提交起就把它作为加载器条目 include。加载器以 `invalid plugin, expect function or object with an "apply" method, received object`（收到的是模块命名空间对象）拒绝加载。打包版桌面端之所以正常，是因为其内置资源早于该能力缝；源码/dev 启动则每次都失败。
2. 补上插件入口后又暴露第二层：schemastery 的 `z.object({...})` 会把缺失的嵌套对象字段归一化为 `{}` 而非 `undefined`，于是 `resolveConfig` 里的加载时防漂移校验把 `config.proposerTarget !== undefined` 对未配置的 target 判定为真，比较 `{}.provider === {}.provider`（`undefined === undefined`），在未配置这两个 target 的每次启动上都抛出 `validatorTarget must differ from proposerTarget`。

## 决策

1. `packages/self-evolve/self-evolve-basic/src/index.ts` 现在以 `export default BasicSelfEvolveEngine` 结尾。该类符合 Cordis 类插件契约（`new Plugin(ctx, config)`，带 `static Config` 与 `static inject`），与 `dsh-skill` 用 `export default SkillRegistry` 的形态一致。
2. `resolveConfig` 只在 target 同时携带 `provider` 与 `model` 时才视为已配置：空对象（schemastery 对缺失字段的归一化结果）被忽略，只填了一半的 target 以专用报错信息 fail loud。schema 保持不变——本版本 schemastery 的 `z.object(...)` 没有 `.optional()` 方法，且其字段默认即可选，因此 schema 层无法表达"缺失的对象字段产出 `undefined`"。

## 备选方案

- **给 target schema 加 `.optional()`**——本版本 schemastery 不可用（`z.object(...).optional is not a function`）；判定不可行。
- **给 target schema 加 `.required()`**——同样会拒绝未配置字段的 `{}` 归一化结果，破坏文档化的可选语义；否决。
- **静默忽略只填一半的 target**——与加载时 fail loud 的约定相悖；否决，改为专用报错。

## 后果

桌面端的源码/dev 启动以及 `base` bundle 重新能加载 `self-evolve-basic`；两个 target 都未配置的部署不再误触防漂移校验；只填了 `provider`/`model` 之一的 target 现在以精确报错在加载时失败，而不是静默携带一条残缺路由。新增回归测试覆盖 schema 归一化的空 target 路径（`BasicSelfEvolveEngine.Config(baseConfig())` 不得抛错，且"相等 target 抛错"的防漂移用例保持绿色）；43 个 provider 测试全部通过。
