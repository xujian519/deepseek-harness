# Agent Note: patent preset 合并本地 cnlaw 增强

Status: implemented

[English](2026-09-03-patent-preset-merges-cnlaw-enhancement.md) | 中文

## Problem

两个 preset 组合了几乎相同的专利 Agent：发货版 `patent` preset 与本地撰写的 `patent-cnlaw` preset（用户 root，`~/.dsh/.agent-presets/patent-cnlaw`）。两者挂载相同的九个专利域插件，但人设纪律与技能不同，选择器因此显示两个读起来像重复的条目。本地副本是 2026-08-26 从当时 preset 取的快照，落后于持续收到修复（patent-teams 工具更新、self-evolve benchmark、附图视觉路由）的发货版。`discoverPresets` 按 shipped → 配置 → 用户顺序扫描，同名 id 先到先得，用户 root 的 preset 永远无法替换或隐藏同名发货版：收敛为一个条目只能在发货版自身完成。

## Decision

发货版 `patent` preset 现在成为唯一专利模式，按超集方式吸收本地增强的全部价值：

- 人设纪律 3（引用核验）与检索行改为优先本机 cnlaw REST 底座——`:8100 /search`、`/search/decisions`、`/search/judgments`，带 `source_path` 溯源与权威度排序 法条/法规 > 审查指南 > 判例(复审无效决定/判决) > 书籍，并保留 cnlaw 不可用时回退 `patent_case_search` / `patent_kg_query` 的显式兜底。输出纪律增加证据附录行（full_name + 条号/案号 + source_path，缺 source_path 按纪律 7 撤回）；既有成品交付约定行（md → docx tracked changes）保留。
- 工具段新增四个 cnlaw 用法段落：法条/指南核验、按理由判例定向检索（`ground` / `ipc` / `result` / `case_type`）、图谱导航（`:8001/api/cnlaw/graph/ground` 可选 `ipc`、`/graph/patent`，Neo4j 支撑）、案件决策链（`POST /api/cnlaw/case/<id>/decision`，按步序读取与 `/chain`）。
- 技能新增 `inventive-step-analysis`（创造性三步法证据包），`patent-prior-art-search` 改为 cnlaw 通道策略版（CNIPR → CN 专利检索/PDF、CNIPA → 官方状态核验、Google Patents → 外国/全球、`web_search` → 文献、`patent_search` → 本地备选，双源交叉核验）。其余十一个技能保留发货版内容，含案件治理三技能（`patent-matter` / `patent-fact-check` / `patent-compliance-review`）。
- 双语 README 在前置条件中把 cnlaw 底座记录为可选增强，并相应更新知识库策略与第一条 Known Limitation。
- 合并后删除所属机器上的用户 root `patent-cnlaw` preset；该删除是环境操作，不属于本仓库变更。

cnlaw 底座保持可选而非硬依赖：人设与 README 都写明回退路径，未运行本地 REST 服务的部署照常使用本 preset，改用内建专利工具核验。

## Alternatives considered

- **用户 root 创建名为 `patent` 的 preset 以遮蔽发货版。** 被发现契约拒绝：root 按 shipped 在前扫描、重复 id 被丢弃，发货版始终获胜，本地目录只会静默占用该 id 而无任何条目会选择它。
- **保留两个条目并改名显示（「基础版」vs「增强版」）。** 被拒绝：它保留了本变更要消除的重复——两套提示词与两套技能要维护，发货版继续漂移。
- **以本地 preset 为唯一模式、移除发货版。** 被拒绝：发货版属于 app 构建源与其他部署；该方向还会丢掉发货版侧更新（self-evolve benchmark、最新 patent-teams 工具集）。

## Consequences

- preset 现在在模型可见纪律中公布 cnlaw 端点；从不运行 semantica-cnlaw 的部署只付出回退路径成本（无硬启动依赖——REST 调用在使用时才发生，按纪律文本回退）。
- 人设纪律约增加 1.2 KB 提示词（四个 cnlaw 段落加证据附录行），在 64 KB `agent-instructions` 上限内。
- 增强现在随仓库版本发布而非本地快照：重建桌面 app 后，选择器只显示一个 `patent` 条目，内含合并后的超集；用户环境 `default: patent` 保持不变。
