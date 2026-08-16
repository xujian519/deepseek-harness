# Agent Note: 新增插件开发参考文档

Status: implemented

[English](2026-08-17-plugin-authoring-reference.md) | 中文

## Problem

插件开发的约定与注意事项此前分散在各个 tier：概念在 [cordis-primer](../../../../docs/cordis-primer.md)，有序的「第一个插件」路径在 [user/develop/basic](../../../../docs/user/develop/basic/index.md)，操作流程在[扩展实操手册](../../../../docs/cookbook/extension-cookbook.md)，扩展点地图在[架构](../../../../docs/architecture.md)。没有一份文档充当插件作者必须掌握的查阅表；dsh 从 Cordis 生态继承的开源规范——Koishi 的插件纪律、Cordis 论文的可逆副作用、Agent Skills 与 MCP 的写作规则——在仓库内也没有一个归属处，让带相应背景的贡献者可以把心智模型映射到 dsh 对应项。

## Decision

- **一份顶层参考文档。** [docs/plugin-authoring.md](../../../../docs/plugin-authoring.md) 是约定与注意事项的查阅表，不是教程也不是操作指南。它包含三个部分：插件约定（A1–A8：插件形态、注入、配置、生命周期、事件、seam 写作、会话日志、整包义务）、注意事项清单（快速扫描全部 Do／Don't）、以及社区对照表（把十条上游规范映射到 dsh 对应项，并给出关系判定：一致／增强／特有／未建立）。
- **一条事实一个归属。** 参考文档链接其归属 tier 而非复述：概念归 cordis-primer，教程路径归 user/develop，流程归实操手册，扩展点地图归 architecture，包规则归 packages/AGENTS.md。它引用真实包的路径与行号（tool-todo、shell、bash-local、tool-bash、timeout-policy、llm-retry），而不是合成骨架。
- **社区对照留在仓库内。** 对照表面向贡献者，不投影到文档网站；website 零改动。上游 [cordiverse/cordis](https://github.com/cordiverse/cordis) 的 README 把文档链接指向 dsh 发布的 cordis-primer，这一事实记录在参考文档中。
- **不注册 word budget。** 按 [docs/AGENTS.md](../../../../docs/AGENTS.md)，该文档不受预算约束，由评审治理。
- **双语三件套同一次变更落地。** `plugin-authoring.md` 与 `.zh.md` 与 `.i18n.yaml` 同时提交；中文侧携带英文 `<a id>` 锚点，使站内片段链接在两种语言中都有效。

## Alternatives considered

- **并入扩展实操手册**——拒绝：实操手册是分步 how-to 的 tier；约定查阅表不是流程，埋进手册会让寻找规则的作者看不到它。
- **发布到网站**——拒绝：受众是仓库贡献者与深度使用者；网站投影面向产品用户的指南，现有的 `user/develop` 模块已覆盖公开教程路径。
- **社区对照独立成文**——拒绝：十行表格无法独立成立；对照只有傍着它映射的约定才有一席之地。
- **命名为 `plugin-guide` 或 `plugin-development`**——拒绝：`guide` 暗示教程，`development` 与贡献者工作流文档撞概念。

## Consequences

- 插件作者拥有一个集中约定 home，各部分链接到承载每条事实的 tier；未来向该参考文档新增内容必须把内容移回其归属 tier，而非复述。
- [development.md](../../../../docs/development.md) 的贡献者参考节链接新文档，日常工作流路径可以到达它。
- 上游规范变化（Koishi 规则调整、新的社区规范）只需更新 Part C 表格中的一行，而不是散落的段落。
- 双语配对增加一处维护面：每次编辑都像其他配对文档一样重录配对伴随记录。
