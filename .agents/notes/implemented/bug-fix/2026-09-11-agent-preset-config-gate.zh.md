# Agent Note: 门禁拦截配置被插件拒绝的 preset 行

Status: implemented

[English](2026-09-11-agent-preset-config-gate.md) | 中文

## 问题

`dsh-agent-presets` 判断 preset 健康的依据是 composition 的形状，以及每一行的包能否解析。它从不把某一行的配置施加到该行具名插件的 schema 上，于是 roster 报告 preset 健康，而 loader 在挂载时拒绝它：

```
agent-presets: preset "patent-media" failed to mount: failed to apply loader entry persona
(@deepseek-ai/dsh-persona): invalid config: $.prefix missing required value
```

[2026-09-10 的 persona 字段改名](2026-09-10-persona-config-field-in-fork-presets.zh.md)对它触及的两个 preset 补上了这个缺口，并点名了留下的覆盖空洞：`mount.spec.ts` 只启动 fixture preset，而 `shipped-root.spec.ts` 只读取 shipped root 的结构，不把条目的配置与具名插件的 schema 做校验。因此，若某个 preset 携带被改名或删除的字段，它会在运行中的部署里失败，而不是在 CI 中失败。

2026-09-11，这件事落到具体的人身上：`$DSH_HOME/.agent-presets/patent-media` 处的自建 preset 仍写着 `text`，桌面应用因此无法挂载它的主人所选中的 preset。仓库里没有任何东西能报告这件事——该文件位于仓库之外，而本该抓住它的检查，对随包发布的 preset 同样不存在。

## 决策

`scripts/verify-agent-preset-config.ts` 在挂载之前施加 loader 所施加的 schema。它判定每个 shipped preset 声明的每一行——即匹配 `packages/bundle/web-app/presets/*.patch.yml` 的文件——并递归 loader 递归的那些行容器：group 的 `config` 列表、patch 文件的 `insert` 列表，以及 agent-preset 声明的 `config.plugins`。声明与其他行一样受判，而它所携带的子 composition 与它一并受判。

判定有三处镜像运行时，每一处都承担实际作用。插件取值来自 `exports.default ?? exports` 及其 `__esModule` 重复，与 `unwrapExports` 的读法一致——与 default export 并存的具名 `Config` 并不是运行时施加的那个 schema。不导出 `Config` 的插件直接通过，因为 `resolveConfig` 原样返回配置。调用形式是 `schema['~standard'].validate(config)`，即 `resolveConfig` 所求值的表达式，因此门禁的报错信息与运行时 `ValidationError` 的那一行逐字对应。

当 loader 会在本门禁触及不到的地方做决定时，该行被跳过而非判定：配置中任意位置出现 `!!js` 表达式（它先对着活的插件上下文插值，schema 才见到它）、真值的 `disabled`、并非工作区包的说明符、不经由 tsconfig `paths` 门面解析到 TypeScript 源码的说明符、Node 无法 import 的模块，以及不导出 `Config` 的插件。跳过的行按原因计数，因为一个所有行都被跳过的 preset 对仓库什么也没说。

语料下限让通过的运行保持诚实：shipped preset 的 glob 为空即抛错；某个声明没有任何一行被判定——既未通过也未拒绝——即判定失败，因此全部跳过的 preset 不能冒充干净的 preset。只有一个受判行违规的声明不算 unjudged：其违规照常报告，两类发现在同一次运行中打印，任一类都以 1 退出。`scripts/verify-agent-preset-config.spec.ts` 钉住边界表，其最后一项用例拿真实的 `dsh-persona` `Config` 校验门禁：`text` 被拒并报 `$.prefix missing required value`，`prefix` 被接受。

语料就是仓库所发布的东西本身。preset 创作如今是用户安装进 profile 的 bundle patch，因此已不存在供本门禁扫描的作者目录；而在 CI 中运行本门禁的文档聚合必须在干净树上通过，机器私有的语料做不到这一点。

## 考虑过的替代方案

**扩展 `discoverPresets` 的健康检查来校验每行配置。** 否决：discovery 刻意从不 import 插件，正是这一点让一次 roster 读取停留在文件系统查找的代价上。校验需要插件的 `Config`，因而需要模块被加载，于是每次 roster 读取都会执行任意插件的顶层代码。

**用 `import.meta.resolve` 解析工作区包。** 否决：它只在 `tsx` 的 paths hook 生效时才能看见工作区包。在纯 Node 下，根 `node_modules/@deepseek-ai` 只有 15 个链接，而本门禁的 glob 覆盖 360 个包，于是大多数行都解析不到、被跳过，门禁会为"只查了语料的一小部分"报告成功。

**插件模块 import 失败时判定门禁失败。** 否决：四个工作区 client 包 import 了 `.module.css` 文件，Vite 处理得了而 Node 处理不了。这是模块图的性质，不是 preset 的缺陷，因它变红的门禁只会教人忽略它。

**用占位值替换表达式后校验未解析的 `!!js` 节点。** 否决：没有任何占位值能满足任意 schema，于是替换会对健康的 preset 产生误报——而破碎的判定会到达选择器：该 preset 带上 failed-to-load 徽标，且无法被选为默认。

## 结果

被改名或删除的配置字段如今在 CI 中失败，而不是在运行中的部署里失败——对六个 shipped preset 声明生效。用户从仓库外安装的声明仍在本门禁之外；registry 会把它的激活失败报告为一条破损的 roster 行，而这正是本门禁旨在提前的失败模式。

门禁所证明的比"配置正确"要窄。schemastery 合并未知键而非拒绝它们，因此一个拼错的**可选**键在这里与在运行时一样通过；门禁覆盖的是必填键缺失与已知键类型错误。覆盖范围在构造上也是部分的：168 个 shipped 行中有 48 行具名的模块根本不导出运行时 `Config`，32 行位于真值 `disabled` 之后，11 行携带 `!!js` 表达式，所以一次 shipped 运行校验 77 行，并把其余 91 行作为跳过上报，而不是悄悄把它们算作干净。

门禁的代价是每个不同的具名模块一次插件 import，对 shipped 集合是几秒钟，并运行在无需构建的文档聚合中。import 插件源码会打印它们自己的 stderr 警告，其中之一是某个触达 `node:sqlite` 的插件发出的 `ExperimentalWarning: SQLite`；门禁在 stdout 上报告，并以退出码被读取。

## 测试

`npx vitest run scripts/verify-agent-preset-config.spec.ts`（33 个测试）钉住边界表：配置里与 `disabled` 里的 `!!js`、被判定的 `disabled: 0` 对跳过的 `disabled: true`、group 递归含嵌套 group、group 行从不按自己的 `cordis:group` 名判定、`insert` 列表与声明的 `config.plugins` 均被递归且声明与其子行各按自己的 schema 受判、携带 `!!js` 的声明其子行仍受判、外部与不可 import 与无 schema 的行按原因计数、必填键缺失、类型错误、未知键被接受、两条语料下限——包括只有违规行的组合不进入 unjudged 列表——以及真实的 `dsh-persona` schema 拒绝 `text` 而接受 `prefix`。

`npx vitest run packages/preset/agent-preset-registry`（42 个测试）覆盖本门禁所依托的挂载与 roster 路径，`npx vitest run packages/bundle/web-app/tests/patent-preset.spec.ts`（3 个测试）把 fork 的 patent composition 断言留在如今发布它的声明上。把某个 shipped 声明的 persona 行改回 `text` 再跑门禁，会在该行所在行号报告 `$.prefix missing required value` 并以 1 退出。

## 相关

- [恢复 fork preset 的 persona 行到当前字段名](2026-09-10-persona-config-field-in-fork-presets.zh.md)——本门禁所补其覆盖缺口的那次事故。
- [Agent preset registry](../../../../packages/preset/agent-preset-registry/README.zh.md)——本门禁并列而非扩展的激活与 roster 路径。
